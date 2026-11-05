const express = require('express');
const router = express.Router();

const availabilityController = require('../controllers/availabilityController');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/roleCheck');
const { validate, schemas } = require('../middleware/validate');

// GET /api/availability/me - logged-in provider's own availability
router.get('/me', protect, restrictTo('provider'), availabilityController.listMine);

// GET /api/availability/provider/:providerId - public view of a provider's availability
router.get('/provider/:providerId', availabilityController.listByProvider);

// POST /api/availability - add an availability window (provider only)
router.post(
  '/',
  protect,
  restrictTo('provider'),
  validate(schemas.createAvailabilitySchema),
  availabilityController.createAvailability
);

// PATCH /api/availability/:id - update an availability window (owning provider only)
router.patch(
  '/:id',
  protect,
  restrictTo('provider'),
  validate(schemas.updateAvailabilitySchema),
  availabilityController.updateAvailability
);

// DELETE /api/availability/:id - remove an availability window (owning provider only)
router.delete('/:id', protect, restrictTo('provider'), availabilityController.deleteAvailability);

module.exports = router;
