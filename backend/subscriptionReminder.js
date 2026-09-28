const pool = require('./db');
const { sendSubscriptionExpiryReminder } = require('./emailService');

async function checkExpiringSubscriptions() {
  const result = await pool.query(`
    SELECT u.id, u.email, u.display_name, u.username, u.subscription_expires
    FROM users u
    WHERE u.subscribed = true
      AND u.subscription_expires IS NOT NULL
      AND u.subscription_expires = CURRENT_DATE + INTERVAL '3 days'
      AND u.email IS NOT NULL
  `);

  for (const user of result.rows) {
    console.log(`Sending expiry reminder to ${user.email}`);
    await sendSubscriptionExpiryReminder(user);
  }
}

checkExpiringSubscriptions()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
