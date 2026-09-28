// =====================
// DATABASE CONNECTION
// This file creates a connection pool to PostgreSQL.
// A "pool" means Express keeps several connections open
// and reuses them — much faster than reconnecting every time.
// =====================
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

// Test the connection when the server starts
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Database connected successfully');
    release(); // return the connection back to the pool
  }
});

// Export the pool so any route/controller can use it
module.exports = pool;