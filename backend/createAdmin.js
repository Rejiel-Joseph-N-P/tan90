// =====================
// ONE-TIME ADMIN CREATION SCRIPT
// Run with: node createAdmin.js
// Do NOT expose this as an API route
// =====================
require('dotenv').config();

const bcrypt = require('bcrypt');
const pool = require('./db');

async function createAdmin() {
  // --- CHANGE THESE VALUES ---
  const username = 'admin';
  const password = process.env.SEED_PASSWORD;
  if (!password) { console.error('Set SEED_PASSWORD first'); process.exit(1); }
  // ---------------------------

  try {
    // Hash the password with bcrypt
    // The "10" is the salt rounds — higher = slower but more secure
    // 10 is the industry standard balance
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, password, role)
       VALUES ($1, $2, $3)
       RETURNING id, username, role`,
      [username, hashedPassword, 'admin']
    );

    console.log('✅ Admin created successfully:');
    console.log(result.rows[0]);

  } catch (err) {
    if (err.code === '23505') {
      console.log('⚠️  Admin already exists with that username');
    } else {
      console.error('❌ Error creating admin:', err.message);
    }
  } finally {
    // Close the database connection and exit
    await pool.end();
  }
}

createAdmin();