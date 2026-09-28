const express = require('express');
const router = express.Router();
const { verifyToken, verifyAdmin } = require('../middleware/auth');
const pool = require('../db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { sendSubscriptionConfirmationEmail } = require('../emailService');

// GET all users
router.get('/users', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, display_name, role, subscribed,
       subscription_expires, created_at FROM users ORDER BY created_at DESC`
    );
    res.json({ success: true, users: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching users' });
  }
});

// DELETE user
router.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const user = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    if (user.rows[0]?.role === 'admin') {
      return res.status(403).json({ success: false, message: 'Cannot delete admin' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error deleting user' });
  }
});

// ACTIVATE subscription manually (admin)
router.post('/users/:id/subscribe', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const expires = new Date();
    expires.setMonth(expires.getMonth() + 1);
    await pool.query(
      `UPDATE users SET subscribed = true, subscription_expires = $1 WHERE id = $2`,
      [expires, id]
    );
    await pool.query(
      `UPDATE subscription_requests SET status = 'approved'
       WHERE user_id = $1 AND status = 'pending'`, [id]
    );
    // Send confirmation email
    const userRes = await pool.query(
      'SELECT username, email FROM users WHERE id = $1', [id]
    );
    // get email from access_requests
    const emailRes = await pool.query(
      `SELECT ar.email FROM access_requests ar
       JOIN users u ON LOWER(REGEXP_REPLACE(ar.full_name, '\\s+', '', 'g')) = u.username
       WHERE u.id = $1 LIMIT 1`, [id]
    );
    if (emailRes.rows[0]?.email) {
      try {
        await sendSubscriptionConfirmationEmail(
          emailRes.rows[0].email,
          userRes.rows[0]?.username,
          expires
        );
      } catch (e) {
        console.error('Sub email error:', e.message);
      }
    }
    res.json({ success: true, message: 'Subscription activated for 1 month' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error activating subscription' });
  }
});

// REMOVE subscription
router.post('/users/:id/unsubscribe', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE users SET subscribed = false, subscription_expires = NULL WHERE id = $1`, [id]
    );
    res.json({ success: true, message: 'Subscription removed' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error removing subscription' });
  }
});

// GET subscription requests
router.get('/subscription-requests', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT sr.*, u.username, u.display_name, u.subscribed
       FROM subscription_requests sr
       JOIN users u ON sr.user_id = u.id
       ORDER BY sr.created_at DESC`
    );
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching requests' });
  }
});

// REJECT subscription request
router.post('/subscription-requests/:id/reject', verifyToken, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE subscription_requests SET status = 'rejected' WHERE id = $1`, [id]
    );
    res.json({ success: true, message: 'Request rejected' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error rejecting' });
  }
});

// GET categories
router.get('/categories', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT category FROM videos WHERE category IS NOT NULL ORDER BY category'
    );
    res.json({ success: true, categories: result.rows.map(r => r.category) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching categories' });
  }
});

// GET preferences
router.get('/preferences', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT preferred_categories FROM user_preferences WHERE user_id = $1',
      [req.user.id]
    );
    const prefs = result.rows[0]?.preferred_categories || '';
    res.json({ success: true, preferred_categories: prefs ? prefs.split(',') : [] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching preferences' });
  }
});

// SAVE preferences
router.post('/preferences', verifyToken, async (req, res) => {
  const { preferred_categories } = req.body;
  try {
    const prefsString = Array.isArray(preferred_categories)
      ? preferred_categories.join(',') : '';
    await pool.query(
      `INSERT INTO user_preferences (user_id, preferred_categories)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET preferred_categories = $2`,
      [req.user.id, prefsString]
    );
    res.json({ success: true, message: 'Preferences saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error saving preferences' });
  }
});

// REQUEST subscription (user initiates PayU payment)
router.post('/request-subscription', verifyToken, async (req, res) => {
  try {
    const existing = await pool.query(
      `SELECT id FROM subscription_requests
       WHERE user_id = $1 AND status = 'pending'`, [req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending subscription request'
      });
    }

    const userRes = await pool.query(
      'SELECT username, display_name FROM users WHERE id = $1', [req.user.id]
    );
    const user = userRes.rows[0];

    // Generate PayU payment hash
    const txnId = 'TAN90_' + Date.now() + '_' + req.user.id;
    const amount = process.env.SUBSCRIPTION_AMOUNT || '50';
    const productInfo = 'tan90 Monthly Subscription';
    const firstName = user.display_name || user.username;
    const key = process.env.PAYU_MERCHANT_KEY;
    const salt = process.env.PAYU_MERCHANT_SALT;

    // PayU hash: key|txnid|amount|productinfo|firstname|email|||||||||||salt
    const hashString = `${key}|${txnId}|${amount}|${productInfo}|${firstName}|${req.user.id}@tan90.in|||||||||||${salt}`;
    const hash = crypto.createHash('sha512').update(hashString).digest('hex');

    // Save pending subscription request
    await pool.query(
      `INSERT INTO subscription_requests (user_id) VALUES ($1)`, [req.user.id]
    );

    res.json({
      success: true,
      paymentData: {
        key,
        txnId,
        amount,
        productInfo,
        firstName,
        email: `${req.user.id}@tan90.in`,
        hash,
        payuBaseUrl: process.env.PAYU_BASE_URL,
        successUrl: `http://localhost:5000/payment-success.html`,
        failureUrl: `http://localhost:5000/payment-failure.html`
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error initiating payment' });
  }
});

// PAYMENT SUCCESS WEBHOOK (PayU calls this)
router.post('/payment-success', async (req, res) => {
  try {
    const { txnid, status, hash } = req.body;

    if (status !== 'success') {
      return res.status(400).json({ success: false, message: 'Payment not successful' });
    }

    // Extract user_id from txnId format: TAN90_timestamp_userId
    const parts = txnid.split('_');
    const userId = parseInt(parts[2]);

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Invalid transaction' });
    }

    const expires = new Date();
    expires.setMonth(expires.getMonth() + 1);

    await pool.query(
      `UPDATE users SET subscribed = true, subscription_expires = $1 WHERE id = $2`,
      [expires, userId]
    );

    await pool.query(
      `UPDATE subscription_requests SET status = 'approved'
       WHERE user_id = $1 AND status = 'pending'`, [userId]
    );

    res.json({ success: true, message: 'Subscription activated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error processing payment' });
  }
});

// GET my subscription status
router.get('/my-subscription', verifyToken, async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT subscribed, subscription_expires FROM users WHERE id = $1',
      [req.user.id]
    );
    const pending = await pool.query(
      `SELECT id FROM subscription_requests WHERE user_id = $1 AND status = 'pending'`,
      [req.user.id]
    );
    res.json({
      success: true,
      subscribed: user.rows[0]?.subscribed || false,
      subscription_expires: user.rows[0]?.subscription_expires,
      has_pending_request: pending.rows.length > 0
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching subscription' });
  }
});

// UPDATE profile (username + password + display_name)
router.post('/update-profile', verifyToken, async (req, res) => {
  const { new_username, new_password, display_name, current_password } = req.body;
  try {
    const userRes = await pool.query(
      'SELECT * FROM users WHERE id = $1', [req.user.id]
    );
    const user = userRes.rows[0];

    // Verify current password
    const match = await bcrypt.compare(current_password, user.password);
    if (!match) {
      return res.status(401).json({
        success: false, message: 'Current password is incorrect'
      });
    }

    let updateQuery = 'UPDATE users SET';
    const values = [];
    const updates = [];

    if (display_name) {
      values.push(display_name);
      updates.push(` display_name = $${values.length}`);
    }

    if (req.body.email) {
      const existing = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [req.body.email, req.user.id]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({
          success: false, message: 'Email already in use'
        });
      }
      values.push(req.body.email);
      updates.push(` email = $${values.length}`);
    }

    if (new_username && new_username !== user.username) {
      // Check username not taken
      const existing = await pool.query(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [new_username, req.user.id]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({
          success: false, message: 'Username already taken'
        });
      }
      values.push(new_username);
      updates.push(` username = $${values.length}`);
    }

    if (new_password) {
      const hashed = await bcrypt.hash(new_password, 10);
      values.push(hashed);
      updates.push(` password = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false, message: 'Nothing to update'
      });
    }

    values.push(req.user.id);
    updateQuery += updates.join(',') + ` WHERE id = $${values.length}`;
    updateQuery += ' RETURNING id, username, display_name, role';

    const result = await pool.query(updateQuery, values);
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error updating profile' });
  }
});

// CREATE series (admin or subscriber)
router.post('/series', verifyToken, async (req, res) => {
  const { title, description } = req.body;
  if (!title) {
    return res.status(400).json({ success: false, message: 'Title is required' });
  }
  try {
    // Check if subscriber
    if (req.user.role !== 'admin') {
      const subCheck = await pool.query(
        'SELECT subscribed FROM users WHERE id = $1', [req.user.id]
      );
      if (!subCheck.rows[0]?.subscribed) {
        return res.status(403).json({
          success: false, message: 'Only admin or subscribers can create series'
        });
      }
    }
    const result = await pool.query(
      `INSERT INTO series (title, description, created_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [title, description || '', req.user.id]
    );
    res.status(201).json({ success: true, series: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error creating series' });
  }
});

// GET all series
router.get('/series', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, u.username as created_by_name,
       COUNT(v.id) as episode_count
       FROM series s
       LEFT JOIN users u ON s.created_by = u.id
       LEFT JOIN videos v ON v.series_id = s.id
       GROUP BY s.id, u.username
       ORDER BY s.created_at DESC`
    );
    res.json({ success: true, series: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching series' });
  }
});

// GET single series with episodes
router.get('/series/:id', verifyToken, async (req, res) => {
  try {
    const series = await pool.query(
      'SELECT s.*, u.username as created_by_name FROM series s LEFT JOIN users u ON s.created_by = u.id WHERE s.id = $1',
      [req.params.id]
    );
    if (!series.rows[0]) {
      return res.status(404).json({ success: false, message: 'Series not found' });
    }
    const episodes = await pool.query(
      `SELECT v.*, u.username as uploaded_by_name
       FROM videos v
       LEFT JOIN users u ON v.uploaded_by = u.id
       WHERE v.series_id = $1
       ORDER BY v.season_number ASC, v.episode_number ASC`,
      [req.params.id]
    );
    res.json({
      success: true,
      series: series.rows[0],
      episodes: episodes.rows
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching series' });
  }
});

// DELETE series (admin or creator)
router.delete('/series/:id', verifyToken, async (req, res) => {
  try {
    const series = await pool.query(
      'SELECT * FROM series WHERE id = $1', [req.params.id]
    );
    if (!series.rows[0]) {
      return res.status(404).json({ success: false, message: 'Series not found' });
    }
    if (req.user.role !== 'admin' && series.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    // Remove series_id from videos but don't delete them
    await pool.query('UPDATE videos SET series_id = NULL, episode_number = NULL WHERE series_id = $1', [req.params.id]);
    await pool.query('DELETE FROM series WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Series deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error deleting series' });
  }
});

// UPDATE series thumbnail
router.post('/series/:id/thumbnail', verifyToken, async (req, res) => {
  const multer = require('multer');
  const path = require('path');
  const fs = require('fs');
  const thumbDir = path.join(__dirname, '../../uploads/thumbnails');
  if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, thumbDir),
    filename: (req, file, cb) => cb(null, `series-${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`)
  });
  const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

  upload.single('thumbnail')(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });
    try {
      await pool.query('UPDATE series SET thumbnail = $1 WHERE id = $2', [req.file.filename, req.params.id]);
      res.json({ success: true, thumbnail: req.file.filename });
    } catch (e) {
      res.status(500).json({ success: false, message: 'Error saving thumbnail' });
    }
  });
});

module.exports = router;