const pool = require('../db');
const bcrypt = require('bcrypt');
const {
  sendCredentialsEmail,
  sendAccessRequestNotification
} = require('../emailService');

const submitAccessRequest = async (req, res) => {
  const { full_name, email, reason } = req.body;

  if (!full_name || !email) {
    return res.status(400).json({
      success: false,
      message: 'Full name and email are required'
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Please enter a valid email address'
    });
  }

  try {
    const existing = await pool.query(
      'SELECT id FROM access_requests WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'A request with this email already exists'
      });
    }

    await pool.query(
      `INSERT INTO access_requests (full_name, email, reason)
       VALUES ($1, $2, $3)`,
      [full_name, email, reason || '']
    );

    // Notify admin email
    try {
      await sendAccessRequestNotification(full_name, email, reason);
    } catch (emailErr) {
      console.error('Admin notification email failed:', emailErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'Access request submitted. Admin will review and send credentials to your email.'
    });

  } catch (err) {
    console.error('Access request error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Server error submitting request'
    });
  }
};

const getAccessRequests = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM access_requests ORDER BY created_at DESC`
    );
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching requests' });
  }
};

const approveAccessRequest = async (req, res) => {
  const { id } = req.params;
  try {
    const requestResult = await pool.query(
      'SELECT * FROM access_requests WHERE id = $1', [id]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    const accessRequest = requestResult.rows[0];

    if (accessRequest.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Request already processed' });
    }

    const username = accessRequest.full_name
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 20);

    const rawPassword = Math.random().toString(36).slice(-6).toUpperCase() +
      Math.random().toString(36).slice(-6) +
      Math.floor(Math.random() * 90 + 10);

    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    await pool.query(
      `INSERT INTO users (username, password, role, display_name)
       VALUES ($1, $2, 'viewer', $3)`,
      [username, hashedPassword, accessRequest.full_name]
    );

    await pool.query(
      `UPDATE access_requests SET status = 'approved' WHERE id = $1`, [id]
    );

    await sendCredentialsEmail(
      accessRequest.email,
      username,
      rawPassword,
      accessRequest.full_name
    );

    res.json({
      success: true,
      message: `Account created and credentials sent to ${accessRequest.email}`
    });

  } catch (err) {
    console.error('Approve error:', err.message);
    res.status(500).json({ success: false, message: 'Error: ' + err.message });
  }
};

const rejectAccessRequest = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE access_requests SET status = 'rejected' WHERE id = $1`, [id]
    );
    res.json({ success: true, message: 'Request rejected' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error rejecting request' });
  }
};

module.exports = {
  submitAccessRequest,
  getAccessRequests,
  approveAccessRequest,
  rejectAccessRequest
};