const nodemailer = require('nodemailer');

/**
 * Lazily-created singleton transporter so we don't reconnect on every email.
 * All config comes from environment variables - see .env.example.
 */
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for 587/25
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      : undefined,
  });

  return transporter;
}

/**
 * Notifies a provider by email that a new booking request has come in.
 * Email delivery is treated as best-effort: failures are logged and
 * swallowed by the caller so they never roll back or fail the booking
 * itself (see bookingController.createBooking).
 *
 * @param {{
 *   providerEmail: string,
 *   providerName: string,
 *   customerName: string,
 *   serviceTitle: string,
 *   bookingDate: string,  // "YYYY-MM-DD"
 *   bookingTime: string,  // "HH:mm"
 *   notes?: string,
 * }} details
 */
async function sendBookingRequestEmail(details) {
  const { providerEmail, providerName, customerName, serviceTitle, bookingDate, bookingTime, notes } = details;

  if (!process.env.SMTP_HOST) {
    // No SMTP configured (e.g. local dev without email set up) - skip quietly
    // rather than throwing, since email is not required for booking creation.
    console.warn('SMTP_HOST is not set - skipping booking notification email.');
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const subject = `New booking request: ${serviceTitle} on ${bookingDate}`;
  const text =
    `Hi ${providerName},\n\n` +
    `You have a new booking request.\n\n` +
    `Service: ${serviceTitle}\n` +
    `Customer: ${customerName}\n` +
    `Date: ${bookingDate}\n` +
    `Time: ${bookingTime}\n` +
    (notes ? `Notes: ${notes}\n` : '') +
    `\nLog in to your Bulk dashboard to confirm or decline this request.\n`;

  const html =
    `<p>Hi ${escapeHtml(providerName)},</p>` +
    `<p>You have a new booking request.</p>` +
    `<table cellpadding="4" cellspacing="0">` +
    `<tr><td><strong>Service</strong></td><td>${escapeHtml(serviceTitle)}</td></tr>` +
    `<tr><td><strong>Customer</strong></td><td>${escapeHtml(customerName)}</td></tr>` +
    `<tr><td><strong>Date</strong></td><td>${escapeHtml(bookingDate)}</td></tr>` +
    `<tr><td><strong>Time</strong></td><td>${escapeHtml(bookingTime)}</td></tr>` +
    (notes ? `<tr><td><strong>Notes</strong></td><td>${escapeHtml(notes)}</td></tr>` : '') +
    `</table>` +
    `<p>Log in to your Bulk dashboard to confirm or decline this request.</p>`;

  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || '"Bulk" <no-reply@bulk.ug>',
      to: providerEmail,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error('Failed to send booking notification email:', err.message);
    return { sent: false, reason: 'send_failed' };
  }
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Notifies a user by email with a password reset link.
 */
async function sendPasswordResetEmail({ email, token }) {
  if (!process.env.SMTP_HOST) {
    console.warn('SMTP_HOST is not set - skipping password reset email.');
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const resetLink = `${process.env.CORS_ORIGIN || 'http://localhost:5173'}/reset-password?token=${token}`;
  const subject = 'Reset your Bulk password';
  const text =
    `You requested a password reset.\n\n` +
    `Click the following link to reset your password:\n${resetLink}\n\n` +
    `If you did not request this, please ignore this email.\n`;
  const html =
    `<p>You requested a password reset.</p>` +
    `<p><a href="${escapeHtml(resetLink)}">Click here to reset your password</a></p>` +
    `<p>If you did not request this, please ignore this email.</p>`;

  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || '"Bulk" <no-reply@bulk.ug>',
      to: email,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error('Failed to send password reset email:', err.message);
    return { sent: false, reason: 'send_failed' };
  }
}

module.exports = { sendBookingRequestEmail, sendPasswordResetEmail };
