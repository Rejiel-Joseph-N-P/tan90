const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const {
  submitVideoRequest,
  getVideoRequests,
  getMyVideoRequests,
  approveVideoRequest,
  rejectVideoRequest
} = require('../controllers/videoRequestController');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    cb(null, `req-${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});

router.post('/submit', verifyToken, upload.single('video'), submitVideoRequest);
router.get('/all', verifyToken, verifyAdmin, getVideoRequests);
router.get('/mine', verifyToken, getMyVideoRequests);
router.post('/approve/:id', verifyToken, verifyAdmin, approveVideoRequest);
router.post('/reject/:id', verifyToken, verifyAdmin, rejectVideoRequest);

module.exports = router;