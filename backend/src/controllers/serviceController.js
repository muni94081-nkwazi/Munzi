const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const serviceModel = require('../models/serviceModel');
const providerProfileModel = require('../models/providerProfileModel');

/**
 * @route   POST /api/services
 * @desc    Create a new service. Only providers may create services;
 *          the service is automatically linked to the logged-in provider's profile.
 * @access  Private (provider)
 * @body    { title, description?, category?, price, durationMinutes }
 */
const createService = asyncHandler(async (req, res) => {
  const providerProfile = await providerProfileModel.findByUserId(req.user.id);
  if (!providerProfile) throw new AppError('Provider profile not found.', 404);

  const { title, description, category, price, durationMinutes } = req.body;
  const service = await serviceModel.createService({
    providerId: providerProfile.id,
    title,
    description,
    category,
    price,
    durationMinutes,
  });

  res.status(201).json({ success: true, data: service });
});

/**
 * @route   GET /api/services
 * @desc    List/browse services (public). Supports ?providerId, ?category, pagination.
 * @access  Public
 * @query   providerId?, category?, page?, limit?
 */
const listServices = asyncHandler(async (req, res) => {
  const { providerId, category, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const services = await serviceModel.listServices({
    providerId,
    category,
    activeOnly: true,
    limit: Number(limit),
    offset,
  });
  res.status(200).json({ success: true, data: services });
});

/**
 * @route   GET /api/services/:id
 * @desc    Get a single service by id.
 * @access  Public
 */
const getService = asyncHandler(async (req, res) => {
  const service = await serviceModel.findById(req.params.id);
  if (!service) throw new AppError('Service not found.', 404);
  res.status(200).json({ success: true, data: service });
});

/**
 * @route   PATCH /api/services/:id
 * @desc    Update a service. Only the owning provider may update it.
 * @access  Private (provider, owner only)
 * @body    { title?, description?, category?, price?, durationMinutes?, isActive? }
 */
const updateService = asyncHandler(async (req, res) => {
  const service = await serviceModel.findById(req.params.id);
  if (!service) throw new AppError('Service not found.', 404);

  const providerProfile = await providerProfileModel.findByUserId(req.user.id);
  if (!providerProfile || service.provider_id !== providerProfile.id) {
    throw new AppError('You do not have permission to modify this service.', 403);
  }

  const fieldMap = {
    title: 'title',
    description: 'description',
    category: 'category',
    price: 'price',
    durationMinutes: 'duration_minutes',
    isActive: 'is_active',
  };
  const fields = {};
  Object.entries(req.body).forEach(([key, val]) => {
    if (fieldMap[key] !== undefined) fields[fieldMap[key]] = val;
  });

  const updated = await serviceModel.updateService(req.params.id, fields);
  res.status(200).json({ success: true, data: updated });
});

/**
 * @route   DELETE /api/services/:id
 * @desc    Delete a service. Only the owning provider may delete it.
 * @access  Private (provider, owner only)
 */
const deleteService = asyncHandler(async (req, res) => {
  const service = await serviceModel.findById(req.params.id);
  if (!service) throw new AppError('Service not found.', 404);

  const providerProfile = await providerProfileModel.findByUserId(req.user.id);
  if (!providerProfile || service.provider_id !== providerProfile.id) {
    throw new AppError('You do not have permission to delete this service.', 403);
  }

  await serviceModel.deleteService(req.params.id);
  res.status(200).json({ success: true, message: 'Service deleted.' });
});

module.exports = { createService, listServices, getService, updateService, deleteService };
