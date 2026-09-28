const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const pool = require('./db');

const queue = [];
let isProcessing = false;

async function transcodeVideo(videoId, inputFilename) {
  return new Promise((resolve) => {
    queue.push({ videoId, inputFilename, resolve });
    processQueue();
  });
}

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  const { videoId, inputFilename, resolve } = queue.shift();
  const uploadsDir = path.join(__dirname, '../uploads');
  const inputPath = path.join(uploadsDir, inputFilename);
  const baseName = inputFilename.replace(/\.[^.]+$/, '');
  const outputFilename = `${baseName}.mp4`;
  const outputPath = path.join(uploadsDir, outputFilename);

  console.log(`🎬 [Transcode] Starting: ${inputFilename}`);

  try {
    await pool.query(
      `UPDATE videos SET title = title || ' ⏳' WHERE id = $1`,
      [videoId]
    );
  } catch (e) { console.error('DB mark error:', e.message); }

  // Try VAAPI hardware encoding first, fall back to software
  const success = await tryVaapi(inputPath, outputPath) ||
                  await trySoftware(inputPath, outputPath);

  if (success) {
    console.log(`✅ [Transcode] Done: ${outputFilename}`);
    try {
      await pool.query(
        `UPDATE videos SET filename = $1, title = REPLACE(title, ' ⏳', '') WHERE id = $2`,
        [outputFilename, videoId]
      );
      if (fs.existsSync(inputPath) && inputPath !== outputPath) {
        fs.unlinkSync(inputPath);
        console.log(`🗑️  Deleted original: ${inputFilename}`);
      }
    } catch (e) { console.error('DB update error:', e.message); }
  } else {
    console.error(`❌ [Transcode] All methods failed: ${inputFilename}`);
    try {
      await pool.query(
        `UPDATE videos SET title = REPLACE(title, ' ⏳', ' ❌') WHERE id = $1`,
        [videoId]
      );
    } catch (e) {}
  }

  resolve(success);
  isProcessing = false;
  processQueue();
}

function tryVaapi(inputPath, outputPath) {
  return new Promise((resolve) => {
    console.log('🔧 [Transcode] Trying VAAPI hardware encoding...');

    const args = [
      '-vaapi_device', '/dev/dri/renderD128',
      '-i', inputPath,
      '-vf', 'format=nv12,hwupload',
      '-c:v', 'h264_vaapi',
      '-qp', '23',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ac', '2',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

    const env = { ...process.env, LIBVA_DRIVER_NAME: 'i965' };
    const ff = spawn('ffmpeg', args, { env });

    ff.stderr.on('data', (data) => {
      const line = data.toString();
      if (line.includes('time=')) {
        const m = line.match(/time=(\S+).*speed=(\S+)/);
        if (m) console.log(`🎬 [VAAPI] time=${m[1]} speed=${m[2]}`);
      }
    });

    ff.on('close', (code) => {
      if (code === 0) {
        console.log('✅ [Transcode] VAAPI succeeded');
        resolve(true);
      } else {
        console.warn('⚠️  [Transcode] VAAPI failed, will try software');
        // Clean up failed output
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        resolve(false);
      }
    });

    ff.on('error', () => resolve(false));
  });
}

function trySoftware(inputPath, outputPath) {
  return new Promise((resolve) => {
    console.log('🔧 [Transcode] Falling back to software encoding...');

    const args = [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ac', '2',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

    const ff = spawn('ffmpeg', args);

    ff.stderr.on('data', (data) => {
      const line = data.toString();
      if (line.includes('time=')) {
        const m = line.match(/time=(\S+).*speed=(\S+)/);
        if (m) console.log(`🎬 [Software] time=${m[1]} speed=${m[2]}`);
      }
    });

    ff.on('close', (code) => resolve(code === 0));
    ff.on('error', () => resolve(false));
  });
}

module.exports = { transcodeVideo };
