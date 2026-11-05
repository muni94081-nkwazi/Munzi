const express = require('express');
const router = express.Router();

const profileController = require('../controllers/profileController');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/roleCheck');
const { validate, schemas } = require('../middleware/validate');

// ─── Provider profile endpoints ─────────────────────────────────────
// GET /api/providers - public directory of providers
router.get('/providers', profileController.listProviders);

// GET /api/providers/:id - view a single provider's public profile
router.get('/providers/:id', profileController.getProvider);

// PATCH /api/providers/me - update own provider profile
router.patch(
  '/providers/me',
  protect,
  restrictTo('provider'),
  validate(schemas.updateProviderProfileSchema),
  profileController.updateMyProviderProfile
);

// ─── Customer profile endpoints ─────────────────────────────────────
// PATCH /api/customers/me - update own customer profile
router.patch(
  '/customers/me',
  protect,
  restrictTo('customer'),
  validate(schemas.updateCustomerProfileSchema),
  profileController.updateMyCustomerProfile
);

module.exports = router;
