require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./db');

const newPassword = 'admin1234';

async function resetPassword() {
  try {
    const hash = await bcrypt.hash(newPassword, 10);

    // Try to find by username 'anonymous'
    const result = await pool.query(
      'UPDATE users SET password = $1 WHERE username = $2 RETURNING username',
      [hash, 'Anonymous']
    );

    if (result.rows.length > 0) {
      console.log('✅ Password reset for:', result.rows[0].username);
      console.log('New password:', newPassword);
    } else {
      console.log('Username anonymous not found — showing all admins:');
      const admins = await pool.query(
        'SELECT id, username, role FROM users WHERE role = $1', ['admin']
      );
      console.log(admins.rows);
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

resetPassword();