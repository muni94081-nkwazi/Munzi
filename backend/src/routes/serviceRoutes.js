const express = require('express');
const router = express.Router();

const serviceController = require('../controllers/serviceController');
const { protect } = require('../middleware/auth');
const { restrictTo } = require('../middleware/roleCheck');
const { validate, schemas } = require('../middleware/validate');

// GET /api/services - public listing/browsing (filters: providerId, category)
router.get('/', serviceController.listServices);

// GET /api/services/:id - view a single service
router.get('/:id', serviceController.getService);

// POST /api/services - create a service (provider only)
router.post(
  '/',
  protect,
  restrictTo('provider'),
  validate(schemas.createServiceSchema),
  serviceController.createService
);

// PATCH /api/services/:id - update a service (owning provider only)
router.patch(
  '/:id',
  protect,
  restrictTo('provider'),
  validate(schemas.updateServiceSchema),
  serviceController.updateService
);

// DELETE /api/services/:id - delete a service (owning provider only)
router.delete('/:id', protect, restrictTo('provider'), serviceController.deleteService);

module.exports = router;
