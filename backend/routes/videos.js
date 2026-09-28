const express = require('express');

const router = express.Router();
const multer = require('multer');
const path = require('path');
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const pool = require('../db');
const { uploadVideo, getVideos, streamVideo } = require('../controllers/videoController');

// Video storage
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const ext = require('path').extname(file.originalname).toLowerCase();
    const dest = ext === '.mkv' ? path.join(__dirname, '../../uploads/mkv') : path.join(__dirname, '../../uploads');
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = file.originalname.replace(/\s+/g, '-');
    cb(null, `${timestamp}-${originalName}`);
  }
});

// Thumbnail storage
const thumbStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads/thumbnails'));
  },
  filename: (req, file, cb) => {
    cb(null, `thumb-${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`);
  }
});

const videoFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('video/') ||
      file.mimetype === 'application/octet-stream') {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  }
};

const imageFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files allowed for thumbnails'), false);
  }
};

const uploadVideoMulter = multer({
  storage: videoStorage,
  fileFilter: videoFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10GB
});

const uploadThumbMulter = multer({
  storage: thumbStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB for thumbnails
});

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum video size is 10GB.'
      });
    }
    return res.status(400).json({ success: false, message: 'Upload error: ' + err.message });
  }
  if (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next();
};

// GET all videos
router.get('/', verifyToken, getVideos);

// POST upload video — admin only
router.post('/upload', verifyToken, verifyAdmin,
  (req, res, next) => {
    uploadVideoMulter.single('video')(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  uploadVideo
);

// POST upload thumbnail — admin or subscriber (owner)
router.post('/thumbnail/:id', verifyToken,
  (req, res, next) => {
    // Create thumbnails folder if not exists
    const fs = require('fs');
    const thumbDir = path.join(__dirname, '../../uploads/thumbnails');
    if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
    next();
  },
  (req, res, next) => {
    uploadThumbMulter.single('thumbnail')(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  async (req, res) => {
    const pool = require('../db');
    const fs = require('fs');
    try {
      const { id } = req.params;

      // Check ownership — admin can update any, subscriber only their own
      let video;
      if (req.user.role === 'admin') {
        video = await pool.query('SELECT * FROM videos WHERE id = $1', [id]);
      } else {
        video = await pool.query(
          'SELECT * FROM videos WHERE id = $1 AND owner_id = $2',
          [id, req.user.id]
        );
      }

      if (!video.rows[0]) {
        return res.status(404).json({ success: false, message: 'Video not found' });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false, message: 'No thumbnail image provided'
        });
      }

      // Delete old thumbnail if exists
      if (video.rows[0].thumbnail) {
        const oldPath = path.join(
          __dirname, '../../uploads/thumbnails', video.rows[0].thumbnail
        );
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      await pool.query(
        'UPDATE videos SET thumbnail = $1 WHERE id = $2',
        [req.file.filename, id]
      );

      res.json({
        success: true,
        message: 'Thumbnail updated',
        thumbnail: req.file.filename
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Error updating thumbnail' });
    }
  }
);

// GET single video by ID (works for series episodes too)
router.get('/single/:id', verifyToken, async (req, res) => {
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
       WHERE v.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Video not found' });
    res.json({ success: true, video: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE video — admin deletes any, subscriber deletes own
router.delete('/:id', verifyToken, async (req, res) => {
  const pool = require('../db');
  const fs = require('fs');
  const pathModule = require('path');
  try {
    const { id } = req.params;
    let video;

    if (req.user.role === 'admin') {
      video = await pool.query('SELECT * FROM videos WHERE id = $1', [id]);
    } else {
      // Subscribers can only delete their own
      const subCheck = await pool.query(
        'SELECT subscribed FROM users WHERE id = $1', [req.user.id]
      );
      if (!subCheck.rows[0]?.subscribed) {
        return res.status(403).json({
          success: false, message: 'Not authorized to delete videos'
        });
      }
      video = await pool.query(
        'SELECT * FROM videos WHERE id = $1 AND owner_id = $2',
        [id, req.user.id]
      );
    }

    if (!video.rows[0]) {
      return res.status(404).json({ success: false, message: 'Video not found' });
    }

    // Delete video file
    const ext = pathModule.extname(video.rows[0].filename).toLowerCase();
    const filePath = pathModule.join(
      __dirname, ext === '.mkv' ? '../../uploads/mkv' : '../../uploads', video.rows[0].filename
    );
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    if (video.rows[0].jellyfin_id) {
     const axios = require('axios');
     await axios.delete(
    `${process.env.JELLYFIN_URL}/Items/${video.rows[0].jellyfin_id}?api_key=${process.env.JELLYFIN_API_KEY}`
     ).catch(() => {}); // silent fail — don't block delete if Jellyfin is down
     }

    // Delete thumbnail if exists
    if (video.rows[0].thumbnail) {
      const thumbPath = pathModule.join(
        __dirname, '../../uploads/thumbnails', video.rows[0].thumbnail
      );
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    }

    await pool.query('DELETE FROM videos WHERE id = $1', [id]);
    res.json({ success: true, message: 'Video deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error deleting video' });
  }
});

// GET subscriber's own videos
router.get('/my-videos', verifyToken, async (req, res) => {
  const pool = require('../db');
  try {
    const result = await pool.query(
      `SELECT v.*, u.username as uploaded_by_name
       FROM videos v JOIN users u ON v.uploaded_by = u.id
       WHERE v.owner_id = $1 ORDER BY v.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, videos: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching videos' });
  }
});

// POST upload subscriber video
router.post('/upload-subscriber', verifyToken,
  async (req, res, next) => {
    const pool = require('../db');
    const user = await pool.query(
      'SELECT subscribed FROM users WHERE id = $1', [req.user.id]
    );
    if (!user.rows[0]?.subscribed) {
      return res.status(403).json({
        success: false,
        message: 'You need an active subscription to upload videos'
      });
    }
    next();
  },
  (req, res, next) => {
    uploadVideoMulter.single('video')(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  async (req, res) => {
    const pool = require('../db');
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No video file provided' });
      }
      const { title, description, category, tags } = req.body;
      if (!title) {
        return res.status(400).json({ success: false, message: 'Title is required' });
      }
      const result = await pool.query(
        `INSERT INTO videos
         (title, description, filename, uploaded_by, category, tags, video_type, owner_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'subscriber', $4)
         RETURNING id, title, filename, created_at`,
        [title, description || '', req.file.filename, req.user.id,
         category || 'General', tags || '']
      );
      const subExt = require('path').extname(req.file.filename).toLowerCase();
      if (subExt !== '.mp4') {
        transcodeVideo(result.rows[0].id, req.file.filename)
          .catch(err => console.error('Subscriber transcode error:', err));
      }

      res.status(201).json({
        success: true,
        message: subExt !== '.mp4'
          ? 'Uploaded! Transcoding in background — will be playable shortly'
          : 'Video uploaded successfully',
        video: result.rows[0]
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Server error: ' + err.message });
    }
  }
);


// PATCH skip intro timestamp — admin only
router.patch('/:id/skip-intro', verifyToken, verifyAdmin, async (req, res) => {
  const pool = require('../db');
  try {
    const { skip_intro_at } = req.body;
    await pool.query(
      'UPDATE videos SET skip_intro_at = $1 WHERE id = $2',
      [skip_intro_at ? parseInt(skip_intro_at) : null, req.params.id]
    );
    res.json({ success: true, message: 'Skip intro time saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error saving skip intro time' });
  }
});

// STREAM video — supports ?token= query param for video elements that can't send headers
router.get('/stream/:filename', (req, res, next) => {
  if (req.query.token) {
    req.headers['authorization'] = 'Bearer ' + req.query.token;
  }
  next();
}, verifyToken, streamVideo);

// SERVE thumbnails
router.get('/thumbnail/:filename', (req, res) => {
  const filePath = path.join(
    __dirname, '../../uploads/thumbnails', req.params.filename
  );
  const fs = require('fs');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Thumbnail not found' });
  }
  res.sendFile(filePath);
});

// GET related videos
const { getRelatedVideos } = require('../controllers/videoController');
router.get('/related/:id', verifyToken, getRelatedVideos);

module.exports = router;
// =====================
// SUBTITLE ROUTES
// =====================
const axios = require('axios');
const fs = require('fs');
const srtToVtt = require('srt-to-vtt');
const { Readable } = require('stream');

const SUBTITLE_DIR = path.join(__dirname, '../../uploads/subtitles');
if (!fs.existsSync(SUBTITLE_DIR)) fs.mkdirSync(SUBTITLE_DIR, { recursive: true });

// Multer for manual subtitle upload
const subtitleStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SUBTITLE_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`)
});
const uploadSubtitleMulter = multer({
  storage: subtitleStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.srt', '.vtt'].includes(ext)) cb(null, true);
    else cb(new Error('Only .srt and .vtt files allowed'), false);
  },
  limits: { fileSize: 2 * 1024 * 1024 }
});

// Helper: convert SRT buffer to VTT and save
async function saveSrtAsVtt(srtBuffer, filename) {
  const vttFilename = filename.replace(/\.srt$/i, '.vtt');
  const vttPath = path.join(SUBTITLE_DIR, vttFilename);
  await new Promise((resolve, reject) => {
    const readable = Readable.from(srtBuffer);
    const writable = fs.createWriteStream(vttPath);
    readable.pipe(srtToVtt()).pipe(writable);
    writable.on('finish', resolve);
    writable.on('error', reject);
  });
  return vttFilename;
}

// Helper: get OpenSubtitles JWT token
async function getOsToken() {
  const res = await axios.post('https://api.opensubtitles.com/api/v1/login', {
    username: process.env.OPENSUBTITLES_USERNAME,
    password: process.env.OPENSUBTITLES_PASSWORD
  }, {
    headers: {
      'Api-Key': process.env.OPENSUBTITLES_API_KEY,
      'Content-Type': 'application/json',
      'User-Agent': 'tan90/1.0'
    }
  });
  return res.data.token;
}

// SEARCH OpenSubtitles by title
router.get('/subtitles/search', verifyToken, async (req, res) => {
  const { query, language } = req.query;
  if (!query) return res.status(400).json({ success: false, message: 'Query required' });
  try {
    const response = await axios.get('https://api.opensubtitles.com/api/v1/subtitles', {
      params: {
        query,
        languages: language || 'en',
        per_page: 10
      },
      headers: {
        'Api-Key': process.env.OPENSUBTITLES_API_KEY,
        'User-Agent': 'tan90/1.0'
      }
    });
    const results = response.data.data.map(item => ({
      id: item.id,
      file_id: item.attributes.files[0]?.file_id,
      title: item.attributes.feature_details?.movie_name || query,
      year: item.attributes.feature_details?.year,
      language: item.attributes.language,
      release: item.attributes.release,
      downloads: item.attributes.download_count,
      rating: item.attributes.ratings
    }));
    res.json({ success: true, results });
  } catch (err) {
    console.error('OpenSubtitles search error:', err.response?.data || err.message);
    res.status(500).json({ success: false, message: 'Search failed' });
  }
});

// DOWNLOAD subtitle from OpenSubtitles and attach to video
router.post('/subtitles/download/:videoId', verifyToken, verifyAdmin, async (req, res) => {
  const { file_id } = req.body;
  if (!file_id) return res.status(400).json({ success: false, message: 'file_id required' });
  try {
    const token = await getOsToken();
    // Request download link
    const dlRes = await axios.post('https://api.opensubtitles.com/api/v1/download', {
      file_id,
      sub_format: 'srt'
    }, {
      headers: {
        'Api-Key': process.env.OPENSUBTITLES_API_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'tan90/1.0'
      }
    });
    const downloadUrl = dlRes.data.link;
    const fname = dlRes.data.file_name || `subtitle-${file_id}.srt`;

    // Download the actual file
    const fileRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(fileRes.data);

    // Convert SRT → VTT and save
    const vttFilename = await saveSrtAsVtt(buffer, fname);

    // Delete old subtitle if exists
    const video = await pool.query('SELECT subtitle_file FROM videos WHERE id = $1', [req.params.videoId]);
    if (video.rows[0]?.subtitle_file) {
      const oldPath = path.join(SUBTITLE_DIR, video.rows[0].subtitle_file);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    // Attach to video
    await pool.query('UPDATE videos SET subtitle_file = $1 WHERE id = $2', [vttFilename, req.params.videoId]);
    res.json({ success: true, subtitle_file: vttFilename });
  } catch (err) {
    console.error('Subtitle download error:', err.response?.data || err.message);
    res.status(500).json({ success: false, message: 'Download failed' });
  }
});

// MANUAL subtitle upload (SRT or VTT)
router.post('/subtitles/upload/:videoId', verifyToken, verifyAdmin, (req, res) => {
  uploadSubtitleMulter.single('subtitle')(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });
    try {
      let finalFilename = req.file.filename;

      // If SRT, convert to VTT
      if (path.extname(req.file.originalname).toLowerCase() === '.srt') {
        const srtBuffer = fs.readFileSync(req.file.path);
        finalFilename = await saveSrtAsVtt(srtBuffer, req.file.filename);
        fs.unlinkSync(req.file.path); // remove original SRT
      }

      // Delete old subtitle if exists
      const video = await pool.query('SELECT subtitle_file FROM videos WHERE id = $1', [req.params.videoId]);
      if (video.rows[0]?.subtitle_file) {
        const oldPath = path.join(SUBTITLE_DIR, video.rows[0].subtitle_file);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      await pool.query('UPDATE videos SET subtitle_file = $1 WHERE id = $2', [finalFilename, req.params.videoId]);
      res.json({ success: true, subtitle_file: finalFilename });
    } catch (err) {
      console.error('Subtitle upload error:', err);
      res.status(500).json({ success: false, message: 'Upload failed' });
    }
  });
});

// DELETE subtitle from video
router.delete('/subtitles/:videoId', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const video = await pool.query('SELECT subtitle_file FROM videos WHERE id = $1', [req.params.videoId]);
    if (video.rows[0]?.subtitle_file) {
      const filePath = path.join(SUBTITLE_DIR, video.rows[0].subtitle_file);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await pool.query('UPDATE videos SET subtitle_file = NULL WHERE id = $1', [req.params.videoId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error removing subtitle' });
  }
});

// SERVE subtitle file (public — needed for <track> element)
router.get('/subtitles/file/:filename', (req, res) => {
  const filePath = path.join(SUBTITLE_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Subtitle not found' });
  }
  res.setHeader('Content-Type', 'text/vtt');
  res.sendFile(filePath);
});

// =====================
// REACTIONS (like/dislike)
// =====================
router.post('/react/:id', verifyToken, async (req, res) => {
  const { reaction } = req.body;
  const videoId = req.params.id;
  const userId = req.user.id;
  if (!['like', 'dislike'].includes(reaction)) return res.status(400).json({ success: false });
  try {
    const existing = await pool.query('SELECT * FROM video_reactions WHERE video_id=$1 AND user_id=$2', [videoId, userId]);
    if (existing.rows[0]) {
      if (existing.rows[0].reaction === reaction) {
        await pool.query('DELETE FROM video_reactions WHERE video_id=$1 AND user_id=$2', [videoId, userId]);
      } else {
        await pool.query('UPDATE video_reactions SET reaction=$1 WHERE video_id=$2 AND user_id=$3', [reaction, videoId, userId]);
      }
    } else {
      await pool.query('INSERT INTO video_reactions (video_id, user_id, reaction) VALUES ($1,$2,$3)', [videoId, userId, reaction]);
    }
    const counts = await pool.query('SELECT reaction, COUNT(*) FROM video_reactions WHERE video_id=$1 GROUP BY reaction', [videoId]);
    const result = { likes: 0, dislikes: 0, userReaction: null };
    counts.rows.forEach(r => { if (r.reaction === 'like') result.likes = parseInt(r.count); else result.dislikes = parseInt(r.count); });
    const userR = await pool.query('SELECT reaction FROM video_reactions WHERE video_id=$1 AND user_id=$2', [videoId, userId]);
    result.userReaction = userR.rows[0]?.reaction || null;
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/reactions/:id', verifyToken, async (req, res) => {
  const videoId = req.params.id;
  const userId = req.user.id;
  try {
    const counts = await pool.query('SELECT reaction, COUNT(*) FROM video_reactions WHERE video_id=$1 GROUP BY reaction', [videoId]);
    const result = { likes: 0, dislikes: 0, userReaction: null };
    counts.rows.forEach(r => { if (r.reaction === 'like') result.likes = parseInt(r.count); else result.dislikes = parseInt(r.count); });
    const userR = await pool.query('SELECT reaction FROM video_reactions WHERE video_id=$1 AND user_id=$2', [videoId, userId]);
    result.userReaction = userR.rows[0]?.reaction || null;
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// =====================
// COMMENTS
// =====================
router.get('/comments/:id', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.content, c.created_at, u.username, u.display_name
       FROM comments c JOIN users u ON c.user_id = u.id
       WHERE c.video_id = $1 ORDER BY c.created_at DESC`,
      [req.params.id]
    );
    res.json({ success: true, comments: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/comments/:id', verifyToken, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ success: false, message: 'Comment cannot be empty' });
  try {
    const result = await pool.query(
      `INSERT INTO comments (video_id, user_id, content) VALUES ($1,$2,$3)
       RETURNING id, content, created_at`,
      [req.params.id, req.user.id, content.trim()]
    );
    res.json({ success: true, comment: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/comments/:commentId', verifyToken, async (req, res) => {
  try {
    const comment = await pool.query('SELECT user_id FROM comments WHERE id=$1', [req.params.commentId]);
    if (!comment.rows[0]) return res.status(404).json({ success: false });
    if (comment.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    await pool.query('DELETE FROM comments WHERE id=$1', [req.params.commentId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// =====================
// WATCH HISTORY
// =====================
router.post('/history/:id', verifyToken, async (req, res) => {
  const videoId = req.params.id;
  const userId = req.user.id;
  const { progress_seconds, duration_seconds } = req.body;
  try {
    await pool.query(`
      INSERT INTO watch_history (user_id, video_id, progress_seconds, duration_seconds, watched_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (user_id, video_id)
      DO UPDATE SET progress_seconds=$3, duration_seconds=$4, watched_at=NOW()
    `, [userId, videoId, progress_seconds || 0, duration_seconds || 0]);
    res.json({ success: true });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

router.get('/history', verifyToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await pool.query(`
      SELECT wh.video_id, wh.progress_seconds, wh.duration_seconds, wh.watched_at,
             v.title, v.filename, v.thumbnail, v.series_id, v.category
      FROM watch_history wh
      JOIN videos v ON v.id = wh.video_id
      WHERE wh.user_id = $1
      ORDER BY wh.watched_at DESC
      LIMIT 20
    `, [userId]);
    res.json({ success: true, history: result.rows });
  } catch (err) { res.json({ success: false, message: err.message }); }
});

router.get('/history/:id', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const videoId = req.params.id;
  try {
    const result = await pool.query(
      'SELECT progress_seconds, duration_seconds FROM watch_history WHERE user_id=$1 AND video_id=$2',
      [userId, videoId]
    );
    res.json({ success: true, history: result.rows[0] || null });
  } catch (err) { res.json({ success: false }); }
});
