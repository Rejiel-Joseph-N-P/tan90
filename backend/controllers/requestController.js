// =====================
// REQUEST CONTROLLER
// Users submit requests/feedback
// Admin can view all requests
// =====================
const pool = require('../db');

// =====================
// SUBMIT REQUEST
// POST /api/requests
// Any logged-in user can submit
// =====================
const submitRequest = async (req, res) => {
  const { message } = req.body;

  if (!message || message.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Request message cannot be empty'
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO requests (user_id, message)
       VALUES ($1, $2)
       RETURNING id, message, status, created_at`,
      [req.user.id, message.trim()]
    );

    res.status(201).json({
      success: true,
      message: 'Request submitted successfully',
      request: result.rows[0]
    });

  } catch (err) {
    console.error('Submit request error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Server error submitting request'
    });
  }
};

// =====================
// GET ALL REQUESTS
// GET /api/requests
// Admin only
// =====================
const getRequests = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.message, r.status, r.created_at,
              u.username as submitted_by
       FROM requests r
       JOIN users u ON r.user_id = u.id
       ORDER BY r.created_at DESC`
    );

    res.json({
      success: true,
      requests: result.rows
    });

  } catch (err) {
    console.error('Get requests error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Server error fetching requests'
    });
  }
};

// =====================
// MARK REQUEST AS SEEN
// PATCH /api/requests/:id/seen
// Admin only
// =====================
const markAsSeen = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE requests SET status = 'seen'
       WHERE id = $1
       RETURNING id, status`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    res.json({
      success: true,
      message: 'Request marked as seen',
      request: result.rows[0]
    });

  } catch (err) {
    console.error('Mark seen error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Server error updating request'
    });
  }
};

module.exports = { submitRequest, getRequests, markAsSeen };