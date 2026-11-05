const bcrypt = require('bcryptjs');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { signToken } = require('../utils/token');
const pool = require('../config/db');
const userModel = require('../models/userModel');
const providerProfileModel = require('../models/providerProfileModel');
const customerProfileModel = require('../models/customerProfileModel');

/**
 * @route   POST /api/auth/signup
 * @desc    Register a new user as either a 'provider' or 'customer'.
 *          Creates the base user row plus the matching profile row.
 * @access  Public
 * @body    { email, password, role, businessName?, category?, fullName?, phone?, address?, description? }
 */
const signup = asyncHandler(async (req, res) => {
  const { email, password, role, businessName, category, fullName, phone, address, description } = req.body;

  const existing = await userModel.findByEmail(email);
  if (existing) {
    throw new AppError('An account with this email already exists.', 409);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await userModel.createUser({ email, passwordHash, role });

  let profile;
  if (role === 'provider') {
    profile = await providerProfileModel.createProviderProfile({
      userId: user.id,
      businessName,
      description,
      phone,
      address,
      category,
    });
  } else {
    profile = await customerProfileModel.createCustomerProfile({
      userId: user.id,
      fullName,
      phone,
      address,
    });
  }

  const token = signToken({ id: user.id, role: user.role, email: user.email });

  res.status(201).json({
    success: true,
    message: 'Account created successfully.',
    data: { user, profile, token },
  });
});

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate a user and return a JWT.
 * @access  Public
 * @body    { email, password }
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await userModel.findByEmail(email);
  if (!user) {
    throw new AppError('Invalid email or password.', 401);
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw new AppError('Invalid email or password.', 401);
  }

  if (!user.is_active) {
    throw new AppError('This account has been deactivated.', 403);
  }

  const token = signToken({ id: user.id, role: user.role, email: user.email });

  res.status(200).json({
    success: true,
    message: 'Logged in successfully.',
    data: {
      user: { id: user.id, email: user.email, role: user.role },
      token,
    },
  });
});

/**
 * @route   GET /api/auth/me
 * @desc    Get the currently authenticated user's basic info + profile.
 * @access  Private
 */
const getMe = asyncHandler(async (req, res) => {
  const user = await userModel.findById(req.user.id);
  if (!user) throw new AppError('User not found.', 404);

  const profile =
    user.role === 'provider'
      ? await providerProfileModel.findByUserId(user.id)
      : await customerProfileModel.findByUserId(user.id);

  res.status(200).json({ success: true, data: { user, profile } });
});

/**
 * @route   PATCH /api/auth/push-token
 * @desc    Store (or clear) the current device/browser's FCM token so the
 *          server can push notifications to this user. Call this after
 *          login and whenever the token refreshes (web push tokens can
 *          rotate; mobile tokens can too on app reinstall).
 * @access  Private
 * @body    { token: string | null }
 */
const registerPushToken = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (token !== null && typeof token !== 'string') {
    throw new AppError('token must be a string or null.', 400);
  }

  await pool.query('UPDATE users SET fcm_token = $1, updated_at = NOW() WHERE id = $2', [token, req.user.id]);
  res.status(200).json({ success: true, message: token ? 'Push token registered.' : 'Push token cleared.' });
});

module.exports = { signup, login, getMe, registerPushToken };
