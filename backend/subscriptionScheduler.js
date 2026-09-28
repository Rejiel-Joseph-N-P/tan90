require('dotenv').config();
const pool = require('./db');

// =====================
// SUBSCRIPTION SCHEDULER
// Runs daily to auto-deactivate expired subscriptions.
// Add sendSubscriptionExpiryReminder / sendSubscriptionExpiredNotice
// to emailService.js and uncomment below to re-enable email alerts.
// =====================

// =====================
// CHECK SUBSCRIPTIONS
// =====================
async function checkSubscriptions() {
  const now = new Date();
  console.log(`[Scheduler] Running subscription check at ${now.toISOString()}`);

  try {
    // Find expired subscriptions and deactivate them
    const expiredResult = await pool.query(`
      SELECT u.id, u.username
      FROM users u
      WHERE u.subscribed = true
        AND u.subscription_expires IS NOT NULL
        AND u.subscription_expires::date < CURRENT_DATE
    `);

    for (const user of expiredResult.rows) {
      await pool.query(
        `UPDATE users SET subscribed = false, subscription_expires = NULL WHERE id = $1`,
        [user.id]
      );
      console.log(`[Scheduler] Deactivated expired subscription for ${user.username}`);
    }

    if (expiredResult.rows.length === 0) {
      console.log('[Scheduler] No expired subscriptions to process');
    }

  } catch (err) {
    console.error('[Scheduler] Error checking subscriptions:', err.message);
  }
}

// Run once at startup, then every 24 hours
const INTERVAL_MS = 24 * 60 * 60 * 1000;
checkSubscriptions();
setInterval(checkSubscriptions, INTERVAL_MS);

module.exports = { checkSubscriptions };
