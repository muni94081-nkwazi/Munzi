const express = require('express');
const router = express.Router();

const bookingController = require('../controllers/bookingController');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/roleCheck');
const { validate, schemas } = require('../middleware/validate');

// GET /api/bookings/me - list logged-in user's bookings (as customer or provider)
router.get('/me', protect, bookingController.listMyBookings);

// GET /api/bookings/:id - view a single booking (participant only)
router.get('/:id', protect, bookingController.getBooking);

// POST /api/bookings - create a booking (customer only)
router.post(
  '/',
  protect,
  restrictTo('customer'),
  validate(schemas.createBookingSchema),
  bookingController.createBooking
);

// PATCH /api/bookings/:id/status - transition a booking's status (participant only)
router.patch(
  '/:id/status',
  protect,
  validate(schemas.updateBookingStatusSchema),
  bookingController.updateBookingStatus
);

module.exports = router;
