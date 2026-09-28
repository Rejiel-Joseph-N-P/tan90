// =====================
// CREATE VIEWER ACCOUNT
// Run with: node createUser.js
// Change username and password below before running
// =====================
require('dotenv').config();

const bcrypt = require('bcrypt');
const pool = require('./db');

async function createUser() {
  // --- CHANGE THESE VALUES ---
  const username = 'viewer1';
  const password = process.env.SEED_PASSWORD;
  if (!password) { console.error('Set SEED_PASSWORD first'); process.exit(1); }
  // ---------------------------

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, password, role)
       VALUES ($1, $2, $3)
       RETURNING id, username, role`,
      [username, hashedPassword, 'viewer']
    );

    console.log('✅ Viewer account created:');
    console.log(result.rows[0]);

  } catch (err) {
    if (err.code === '23505') {
      console.log('⚠️  Username already exists');
    } else {
      console.error('❌ Error:', err.message);
    }
  } finally {
    await pool.end();
  }
}

createUser();