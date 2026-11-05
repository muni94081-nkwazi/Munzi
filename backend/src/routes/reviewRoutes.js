const express = require('express');
const router = express.Router();

const reviewController = require('../controllers/reviewController');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/roleCheck');
const { validate, schemas } = require('../middleware/validate');

// GET /api/reviews/provider/:providerId - public list of a provider's reviews
router.get('/provider/:providerId', reviewController.listByProvider);

// POST /api/reviews - leave a review for a completed booking (customer only)
router.post(
  '/',
  protect,
  restrictTo('customer'),
  validate(schemas.createReviewSchema),
  reviewController.createReview
);

module.exports = router;
