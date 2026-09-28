const pool = require('../db');
const path = require('path');

// SUBMIT VIDEO REQUEST
const submitVideoRequest = async (req, res) => {
  try {
    const { title, description, request_type, video_link } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false, message: 'Title is required'
      });
    }

    if (request_type === 'link' && !video_link) {
      return res.status(400).json({
        success: false, message: 'Video link is required'
      });
    }

    if (request_type === 'file' && !req.file) {
      return res.status(400).json({
        success: false, message: 'Video file is required'
      });
    }

    const result = await pool.query(
      `INSERT INTO video_upload_requests 
       (user_id, title, description, request_type, file_path, video_link)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, status, created_at`,
      [
        req.user.id, title, description || '',
        request_type,
        req.file ? req.file.filename : null,
        video_link || null
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Video request submitted successfully',
      request: result.rows[0]
    });

  } catch (err) {
    console.error('Video request error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET ALL VIDEO REQUESTS (admin)
const getVideoRequests = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT vr.*, u.username as submitted_by
       FROM video_upload_requests vr
       JOIN users u ON vr.user_id = u.id
       ORDER BY vr.created_at DESC`
    );
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching requests' });
  }
};

// GET MY REQUESTS (viewer)
const getMyVideoRequests = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM video_upload_requests 
       WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching requests' });
  }
};

// APPROVE VIDEO REQUEST (admin)
const approveVideoRequest = async (req, res) => {
  const { id } = req.params;
  const { admin_note } = req.body;
  try {
    await pool.query(
      `UPDATE video_upload_requests 
       SET status = 'approved', admin_note = $1 WHERE id = $2`,
      [admin_note || '', id]
    );
    res.json({ success: true, message: 'Request approved' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error approving request' });
  }
};

// REJECT VIDEO REQUEST (admin)
const rejectVideoRequest = async (req, res) => {
  const { id } = req.params;
  const { admin_note } = req.body;
  try {
    await pool.query(
      `UPDATE video_upload_requests 
       SET status = 'rejected', admin_note = $1 WHERE id = $2`,
      [admin_note || '', id]
    );
    res.json({ success: true, message: 'Request rejected' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error rejecting request' });
  }
};

module.exports = {
  submitVideoRequest,
  getVideoRequests,
  getMyVideoRequests,
  approveVideoRequest,
  rejectVideoRequest
};