const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const passwordController = require('../controllers/passwordController');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');

// POST /api/auth/signup - register as provider or customer
router.post('/signup', validate(schemas.signupSchema), authController.signup);

// POST /api/auth/login - authenticate, returns JWT
router.post('/login', validate(schemas.loginSchema), authController.login);

// GET /api/auth/me - get current authenticated user + profile
router.get('/me', protect, authController.getMe);

// PATCH /api/auth/push-token - register/clear this device's FCM token
router.patch('/push-token', protect, authController.registerPushToken);

// PATCH /api/auth/change-password - authenticated user changes their own password
router.patch('/change-password', protect, validate(schemas.changePasswordSchema), passwordController.changePassword);

// POST /api/auth/forgot-password - public, generates reset token, sends email
router.post('/forgot-password', validate(schemas.forgotPasswordSchema), passwordController.forgotPassword);

// POST /api/auth/reset-password - public, validates token, updates password
router.post('/reset-password', validate(schemas.resetPasswordSchema), passwordController.resetPassword);

module.exports = router;
