const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const pool = require('../config/db');
const userModel = require('../models/userModel');
const passwordResetModel = require('../models/passwordResetModel');
const { sendPasswordResetEmail } = require('../utils/mailer');

/**
 * @route   PATCH /api/auth/change-password
 * @desc    Authenticated user changes their own password.
 * @access  Private
 * @body    { oldPassword, newPassword }
 */
const changePassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const user = await userModel.findByEmail(req.user.email);
  if (!user) throw new AppError('User not found.', 404);

  const matches = await bcrypt.compare(oldPassword, user.password_hash);
  if (!matches) throw new AppError('Current password is incorrect.', 401);

  const hash = await bcrypt.hash(newPassword, 12);
  await pool.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [hash, user.id]
  );

  res.status(200).json({ success: true, message: 'Password changed successfully.' });
});

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Request a password reset. Generates a token and emails the user a reset link.
 *          Always returns 200 to prevent account enumeration.
 * @access  Public
 * @body    { email }
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await userModel.findByEmail(email);

  // Always respond with success to prevent enumeration.
  if (!user) {
    return res.status(200).json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await passwordResetModel.createResetToken({ userId: user.id, token, expiresAt });
  await sendPasswordResetEmail({ email: user.email, token });

  res.status(200).json({ success: true, message: 'If that email exists, a reset link has been sent.' });
});

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset the password using a valid reset token.
 * @access  Public
 * @body    { token, newPassword }
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  const resetRecord = await passwordResetModel.findValidToken(token);
  if (!resetRecord) {
    throw new AppError('This reset link is invalid or has expired.', 400);
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await pool.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [hash, resetRecord.user_id]
  );

  await passwordResetModel.markUsed(resetRecord.id);

  res.status(200).json({ success: true, message: 'Password has been reset. You can now log in.' });
});

module.exports = { changePassword, forgotPassword, resetPassword };
