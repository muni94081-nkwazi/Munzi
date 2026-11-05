const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const reviewModel = require('../models/reviewModel');
const bookingModel = require('../models/bookingModel');
const customerProfileModel = require('../models/customerProfileModel');
const providerProfileModel = require('../models/providerProfileModel');

/**
 * @route   POST /api/reviews
 * @desc    Leave a review for a completed booking. One review per booking.
 *          Only the customer on that booking may leave the review.
 * @access  Private (customer)
 * @body    { bookingId, rating (1-5), comment? }
 */
const createReview = asyncHandler(async (req, res) => {
  const customerProfile = await customerProfileModel.findByUserId(req.user.id);
  if (!customerProfile) throw new AppError('Customer profile not found.', 404);

  const { bookingId, rating, comment } = req.body;

  const booking = await bookingModel.findById(bookingId);
  if (!booking) throw new AppError('Booking not found.', 404);

  if (booking.customer_id !== customerProfile.id) {
    throw new AppError('You may only review your own bookings.', 403);
  }

  if (booking.status !== 'completed') {
    throw new AppError('You can only review a booking after it has been completed.', 400);
  }

  const existingReview = await reviewModel.findByBookingId(bookingId);
  if (existingReview) {
    throw new AppError('This booking has already been reviewed.', 409);
  }

  const review = await reviewModel.createReview({
    bookingId,
    customerId: customerProfile.id,
    providerId: booking.provider_id,
    rating,
    comment,
  });

  // Keep the provider's cached average rating in sync.
  await providerProfileModel.refreshAverageRating(booking.provider_id);

  res.status(201).json({ success: true, data: review });
});

/**
 * @route   GET /api/reviews/provider/:providerId
 * @desc    List all reviews for a given provider (public).
 * @access  Public
 * @query   page?, limit?
 */
const listByProvider = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const reviews = await reviewModel.listByProvider(req.params.providerId, { limit: Number(limit), offset });
  res.status(200).json({ success: true, data: reviews });
});

module.exports = { createReview, listByProvider };
