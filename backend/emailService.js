const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

const sendCredentialsEmail = async (toEmail, username, password, fullName) => {
  await transporter.sendMail({
    from: `"tan90 Platform" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: 'Your tan90 Account is Ready',
    html: `
      <div style="font-family:'Segoe UI',sans-serif;max-width:520px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
        <div style="background:#0f0f0f;padding:32px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#fff">tan90</div>
          <div style="color:#555;font-size:12px;margin-top:4px">Private Video Platform</div>
        </div>
        <div style="padding:36px 32px">
          <div style="font-size:18px;font-weight:600;color:#111;margin-bottom:12px">Hi ${fullName},</div>
          <div style="color:#555;font-size:14px;line-height:1.7;margin-bottom:28px">Your access request has been approved. Use the credentials below to sign in.</div>
          <div style="background:#f8f8f8;border:1px solid #e8e8e8;border-radius:12px;padding:24px;margin-bottom:28px">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:16px">Your Login Credentials</div>
            <div style="margin-bottom:12px;display:flex;justify-content:space-between">
              <span style="color:#888;font-size:13px">Username</span>
              <span style="font-weight:600;font-family:monospace;background:#fff;border:1px solid #e0e0e0;padding:4px 12px;border-radius:6px">${username}</span>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span style="color:#888;font-size:13px">Password</span>
              <span style="font-weight:600;font-family:monospace;background:#fff;border:1px solid #e0e0e0;padding:4px 12px;border-radius:6px">${password}</span>
            </div>
          </div>
          <div style="background:#fffbf0;border:1px solid #f0e0a0;border-radius:10px;padding:14px 18px;font-size:13px;color:#886600">
            Please change your password after your first login. Keep your credentials private.
          </div>
        </div>
        <div style="text-align:center;padding:20px;border-top:1px solid #f0f0f0;color:#aaa;font-size:12px">tan90 · Private Access Only</div>
      </div>`
  });
};

const sendAccessRequestNotification = async (fullName, email, reason) => {
  await transporter.sendMail({
    from: `"tan90 Platform" <${process.env.GMAIL_USER}>`,
    to: process.env.ADMIN_NOTIFICATION_EMAIL,
    subject: 'New Access Request — tan90',
    html: `
      <div style="font-family:'Segoe UI',sans-serif;max-width:520px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
        <div style="background:#0f0f0f;padding:32px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#fff">tan90</div>
          <div style="color:#555;font-size:12px;margin-top:4px">Admin Notification</div>
        </div>
        <div style="padding:36px 32px">
          <div style="font-size:18px;font-weight:600;color:#111;margin-bottom:16px">New Access Request</div>
          <div style="background:#f8f8f8;border:1px solid #e8e8e8;border-radius:12px;padding:24px;margin-bottom:20px">
            <div style="margin-bottom:10px"><span style="color:#888;font-size:13px">Name: </span><strong>${fullName}</strong></div>
            <div style="margin-bottom:10px"><span style="color:#888;font-size:13px">Email: </span><strong>${email}</strong></div>
            <div><span style="color:#888;font-size:13px">Reason: </span><strong>${reason || 'Not provided'}</strong></div>
          </div>
          <div style="color:#555;font-size:13px">Log in to your admin dashboard to approve or reject this request.</div>
        </div>
        <div style="text-align:center;padding:20px;border-top:1px solid #f0f0f0;color:#aaa;font-size:12px">tan90 · Private Access Only</div>
      </div>`
  });
};

const sendSubscriptionConfirmationEmail = async (toEmail, username, expiryDate) => {
  await transporter.sendMail({
    from: `"tan90 Platform" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: 'Your tan90 Subscription is Active',
    html: `
      <div style="font-family:'Segoe UI',sans-serif;max-width:520px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
        <div style="background:#0f0f0f;padding:32px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#fff">tan90</div>
        </div>
        <div style="padding:36px 32px">
          <div style="font-size:18px;font-weight:600;color:#111;margin-bottom:12px">Hi ${username},</div>
          <div style="color:#555;font-size:14px;line-height:1.7;margin-bottom:24px">Your subscription has been activated! You now have access to your upload dashboard.</div>
          <div style="background:#f0fff0;border:1px solid #c0e0c0;border-radius:10px;padding:16px 20px;margin-bottom:24px">
            <div style="color:#2a7a2a;font-weight:600">✓ Subscription Active</div>
            <div style="color:#555;font-size:13px;margin-top:4px">Expires: ${new Date(expiryDate).toLocaleDateString()}</div>
          </div>
          <div style="color:#555;font-size:13px">Visit your profile page to access your upload dashboard.</div>
        </div>
        <div style="text-align:center;padding:20px;border-top:1px solid #f0f0f0;color:#aaa;font-size:12px">tan90 · Private Access Only</div>
      </div>`
  });
};

const sendPasswordResetEmail = async (toEmail, username, resetToken) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;
  await transporter.sendMail({
    from: `"tan90 Platform" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: 'Reset Your tan90 Password',
    html: `
      <div style="font-family:'Segoe UI',sans-serif;max-width:520px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
        <div style="background:#0f0f0f;padding:32px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#fff">tan90</div>
          <div style="color:#555;font-size:12px;margin-top:4px">Password Reset</div>
        </div>
        <div style="padding:36px 32px">
          <div style="font-size:18px;font-weight:600;color:#111;margin-bottom:12px">Hi ${username},</div>
          <div style="color:#555;font-size:14px;line-height:1.7;margin-bottom:24px">
            We received a request to reset your password. Click the button below to set a new password.
            This link expires in 1 hour.
          </div>
          <div style="text-align:center;margin-bottom:24px">
            <a href="${resetUrl}" style="background:#0f0f0f;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">
              Reset My Password
            </a>
          </div>
          <div style="background:#fff8f8;border:1px solid #f0d0d0;border-radius:10px;padding:14px 18px;font-size:13px;color:#883333">
            If you did not request a password reset, ignore this email. Your password will not change.
          </div>
        </div>
        <div style="text-align:center;padding:20px;border-top:1px solid #f0f0f0;color:#aaa;font-size:12px">tan90 · Private Access Only · Link expires in 1 hour</div>
      </div>`
  });
};

module.exports = {
  sendCredentialsEmail,
  sendAccessRequestNotification,
  sendSubscriptionConfirmationEmail,
  sendPasswordResetEmail
};

async function sendSubscriptionExpiryReminder(user) {
  const name = user.display_name || user.username;
  await transporter.sendMail({
    from: `"tan90" <${process.env.GMAIL_USER}>`,
    to: user.email,
    subject: 'Your tan90 subscription expires in 3 days',
    html: `
      <h2>Hi ${name},</h2>
      <p>Your tan90 subscription expires on <strong>${user.subscription_expires}</strong>.</p>
      <p>Renew now to keep access to your upload dashboard and subscriber features.</p>
      <a href="${process.env.FRONTEND_URL}/profile.html" 
         style="background:#fff;color:#000;padding:10px 20px;text-decoration:none;border-radius:6px;">
        Renew Subscription
      </a>
    `
  });
}
