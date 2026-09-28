const express = require('express');
const router = express.Router();
const { login } = require('../controllers/authController');
const pool = require('../db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../emailService');
const { verifyToken } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', login);

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }
  try {
    const result = await pool.query(
      'SELECT id, username, email FROM users WHERE email = $1', [email]
    );
    // Always return success to prevent email enumeration
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        message: 'If that email exists, a reset link has been sent.'
      });
    }
    const user = result.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, token, expires]
    );

    await sendPasswordResetEmail(email, user.username, token);

    res.json({
      success: true,
      message: 'If that email exists, a reset link has been sent.'
    });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) {
    return res.status(400).json({
      success: false, message: 'Token and new password are required'
    });
  }
  try {
    const result = await pool.query(
      `SELECT * FROM password_reset_tokens
       WHERE token = $1 AND used = false AND expires_at > NOW()`,
      [token]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false, message: 'Invalid or expired reset link'
      });
    }
    const resetToken = result.rows[0];
    const hashed = await bcrypt.hash(new_password, 10);

    await pool.query('UPDATE users SET password = $1 WHERE id = $2',
      [hashed, resetToken.user_id]
    );
    await pool.query(
      'UPDATE password_reset_tokens SET used = true WHERE id = $1',
      [resetToken.id]
    );

    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/auth/update-email — user saves their email for password reset
router.post('/update-email', verifyToken, async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email format' });
  }
  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false, message: 'Email already in use by another account'
      });
    }
    await pool.query('UPDATE users SET email = $1 WHERE id = $2', [email, req.user.id]);
    res.json({ success: true, message: 'Email saved successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error saving email' });
  }
});

module.exports = router;
// POST /api/auth/refresh — silently refresh token if still valid
const jwt = require('jsonwebtoken');
router.post('/refresh', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Issue new token with fresh 8h expiry
    const newToken = jwt.sign(
      { id: decoded.id, username: decoded.username, role: decoded.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ success: true, token: newToken });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
});
