const pool = require('../db');
const fs = require('fs');
const path = require('path');
const NodeClam = require('clamscan');

const getClamAV = async () => {
  const clam = await new NodeClam().init({
    clamdscan: {
      socket: '/var/run/clamav/clamd.ctl',
      timeout: 60000,
      active: true
    }
  });
  return clam;
};

const uploadVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No video file provided' });
    }

    const {
      title, description, category, tags,
      requested_by_user_id, series_id, episode_number, season_number, is_short
    } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, message: 'Video title is required' });
    }
    // Virus scan uploaded file
    try {
      const clam = await getClamAV();
      const hostPath = req.file.path.replace('/app/uploads', '/storage/tan90/uploads');
      const { isInfected, viruses } = await clam.scanFile(hostPath);
      if (isInfected) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, message: `File rejected: virus detected (${viruses.join(', ')})` });
      }
    } catch (scanErr) {
      console.warn('ClamAV scan failed (skipping):', scanErr.message);
    }
    // Prevent duplicate uploads
    const existing = await pool.query(
      'SELECT id FROM videos WHERE filename = $1',
      [req.file.filename]
    );
    if (existing.rows[0]) {
      return res.status(409).json({ success: false, message: 'This video already exists in the platform' });
    }

    const result = await pool.query(
      `INSERT INTO videos
       (title, description, filename, uploaded_by, category, tags,
        requested_by, series_id, episode_number, season_number, skip_intro_at, video_type, is_short)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, title, description, filename, category, tags,
                 series_id, episode_number, season_number, skip_intro_at, created_at`,
      [
        title,
        description || '',
        req.file.filename,
        req.user.id,
        category || 'General',
        tags || '',
        requested_by_user_id || null,
        series_id || null,
        episode_number || null,
        season_number || 1,
        req.body.skip_intro_at ? parseInt(req.body.skip_intro_at) : null,
        'admin',
        req.body.is_short === 'true'
      ]
    );

    const videoId = result.rows[0].id;
    const uploadedExt = require("path").extname(req.file.filename).toLowerCase();
    const thumbDir = path.join(__dirname, "../../uploads/thumbnails");
    const thumbFilename = `auto-thumb-${videoId}.jpg`;
    const thumbPath = path.join(thumbDir, thumbFilename);

    if ([".mkv", ".hevc", ".avi", ".mov"].includes(uploadedExt)) {
      // MKV/non-MP4 — register with Jellyfin + generate thumbnail in background
      (async () => {
        try {
          const axios = require("axios");
          const jellyfinUrl = process.env.JELLYFIN_URL || "http://localhost:8096";
          const jellyfinKey = process.env.JELLYFIN_API_KEY;
          await axios.post(`${jellyfinUrl}/Library/Refresh?api_key=${jellyfinKey}`).catch(() => {});
          let jellyfinId = null;
          // Use short name (strip timestamp prefix) for better Jellyfin search
          const shortName = req.file.filename.replace(/^\d+-/, '').replace(/\.[^.]+$/, '').substring(0, 30);
          for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 5000));
            try {
              const searchRes = await axios.get(`${jellyfinUrl}/Items?recursive=true&searchTerm=${encodeURIComponent(shortName)}&api_key=${jellyfinKey}`);
              if (searchRes.data.Items && searchRes.data.Items.length > 0) { jellyfinId = searchRes.data.Items[0].Id; break; }
            } catch (e) {}
          }
          // If still not found, try full item list and match by filename
          if (!jellyfinId) {
            try {
              const allRes = await axios.get(`${jellyfinUrl}/Items?recursive=true&api_key=${jellyfinKey}`);
              const match = allRes.data.Items && allRes.data.Items.find(item =>
                item.Path && item.Path.includes(req.file.filename)
              );
              if (match) jellyfinId = match.Id;
            } catch (e) {}
          }
          const { exec } = require("child_process");
          const videoPath = path.join(__dirname, "../../uploads", req.file.filename);
          await new Promise(resolve => exec(`ffmpeg -ss 60 -i "${videoPath}" -vframes 1 -vf scale=640:-1 "${thumbPath}" -y`, () => resolve()));
          const thumbExists = require("fs").existsSync(thumbPath);
          await pool.query("UPDATE videos SET jellyfin_id = $1, thumbnail = $2 WHERE id = $3", [jellyfinId, thumbExists ? thumbFilename : null, videoId]);
          console.log(`MKV registered: id=${videoId} jellyfin=${jellyfinId}`);
        } catch (e) { console.error("Jellyfin registration error:", e.message); }
      })();
    } else {
      const { exec } = require("child_process");
      const videoPath = path.join(__dirname, "../../uploads", req.file.filename);
      exec(`ffmpeg -ss 10 -i "${videoPath}" -vframes 1 -vf scale=640:-1 "${thumbPath}" -y`, async (err) => {
        if (!err && require("fs").existsSync(thumbPath)) {
          await pool.query("UPDATE videos SET thumbnail = $1 WHERE id = $2", [thumbFilename, videoId]);
        }
      });
    }
    res.status(201).json({ success: true, message: "Video uploaded successfully", video: result.rows[0] });

  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + err.message
    });
  }
};

const getVideos = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT v.id, v.title, v.description, v.filename, v.thumbnail,
              v.category, v.tags, v.created_at, v.video_type,
              v.series_id, v.episode_number, v.season_number, v.skip_intro_at,
              v.jellyfin_id, v.owner_id, v.subtitle_file, v.is_short,
              uploader.username as uploaded_by,
              requester.username as requested_by_username,
              requester.display_name as requested_by_display,
              s.title as series_title
       FROM videos v
       JOIN users uploader ON v.uploaded_by = uploader.id
       LEFT JOIN users requester ON v.requested_by = requester.id
       LEFT JOIN series s ON v.series_id = s.id
       WHERE v.series_id IS NULL
       ORDER BY v.created_at DESC`
    );
    res.json({ success: true, videos: result.rows });
  } catch (err) {
    console.error('Fetch videos error:', err.message);
    res.status(500).json({ success: false, message: 'Server error fetching videos' });
  }
};

const getRelatedVideos = async (req, res) => {
  const { id } = req.params;
  try {
    const current = await pool.query('SELECT * FROM videos WHERE id = $1', [id]);
    if (!current.rows[0]) {
      return res.status(404).json({ success: false, message: 'Video not found' });
    }

    const v = current.rows[0];
    const tags = v.tags ? v.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

    // Find related by same series first, then category, then tags
    const related = await pool.query(
      `SELECT v.id, v.title, v.filename, v.thumbnail, v.category,
              v.tags, v.series_id, v.episode_number, v.season_number,
              v.created_at, u.username as uploaded_by,
              s.title as series_title,
              CASE
                WHEN v.series_id = $2 AND $2 IS NOT NULL THEN 3
                WHEN v.category = $3 THEN 2
                ELSE 1
              END as relevance
       FROM videos v
       LEFT JOIN users u ON v.uploaded_by = u.id
       LEFT JOIN series s ON v.series_id = s.id
       WHERE v.id != $1
         AND (
           v.series_id = $2
           OR v.category = $3
           OR ($4 != '' AND (${tags.length > 0
             ? tags.map((_, i) => `v.tags ILIKE '%' || $${i + 5} || '%'`).join(' OR ')
             : 'FALSE'
           }))
         )
       ORDER BY relevance DESC, v.created_at DESC
       LIMIT 12`,
      [id, v.series_id || null, v.category, v.tags || '', ...tags]
    );

    res.json({ success: true, videos: related.rows });
  } catch (err) {
    console.error('Related videos error:', err.message);
    res.status(500).json({ success: false, message: 'Error fetching related videos' });
  }
};

const streamVideo = (req, res) => {
  try {
    const filename = req.params.filename;
    const fileExt = path.extname(filename).toLowerCase();
    const videoPath = fileExt === '.mkv'
      ? path.join(__dirname, '../../uploads/mkv', filename)
      : path.join(__dirname, '../../uploads', filename);

    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ success: false, message: 'Video file not found' });
    }

    // Detect MIME type from extension
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.mp4': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.m4v': 'video/mp4',
      '.ts': 'video/mp2t',
      '.m2ts': 'video/mp2t',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });

      fs.createReadStream(videoPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(videoPath).pipe(res);
    }
  } catch (err) {
    console.error('Stream error:', err.message);
    res.status(500).json({ success: false, message: 'Server error during streaming' });
  }
};

module.exports = { uploadVideo, getVideos, getRelatedVideos, streamVideo };