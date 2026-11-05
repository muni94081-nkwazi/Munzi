const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const availabilityModel = require('../models/availabilityModel');
const providerProfileModel = require('../models/providerProfileModel');

/**
 * @route   POST /api/availability
 * @desc    Add a weekly availability window for the logged-in provider.
 * @access  Private (provider)
 * @body    { dayOfWeek (0-6), startTime ("HH:mm"), endTime ("HH:mm"), isAvailable? }
 */
const createAvailability = asyncHandler(async (req, res) => {
  const providerProfile = await providerProfileModel.findByUserId(req.user.id);
  if (!providerProfile) throw new AppError('Provider profile not found.', 404);

  const { dayOfWeek, startTime, endTime, isAvailable } = req.body;

  if (startTime >= endTime) {
    throw new AppError('endTime must be later than startTime.', 400);
  }

  const availability = await availabilityModel.createAvailability({
    providerId: providerProfile.id,
    dayOfWeek,
    startTime,
    endTime,
    isAvailable,
  });

  res.status(201).json({ success: true, data: availability });
});

/**
 * @route   GET /api/availability/provider/:providerId
 * @desc    List all availability windows for a given provider (public - so
 *          customers can see when a provider is bookable).
 * @access  Public
 */
const listByProvider = asyncHandler(async (req, res) => {
  const rows = await availabilityModel.listByProvider(req.params.providerId);
  res.status(200).json({ success: true, data: rows });
});

/**
 * @route   GET /api/availability/me
 * @desc    List the logged-in provider's own availability windows.
 * @access  Private (provider)
 */
const listMine = asyncHandler(async (req, res) => {
  const providerProfile = await providerProfileModel.findByUserId(req.user.id);
  if (!providerProfile) throw new AppError('Provider profile not found.', 404);

  const rows = await availabilityModel.listByProvider(providerProfile.id);
  res.status(200).json({ success: true, data: rows });
});

/**
 * @route   PATCH /api/availability/:id
 * @desc    Update an availability window. Only the owning provider may update it.
 * @access  Private (provider, owner only)
 */
const updateAvailability = asyncHandler(async (req, res) => {
  const existing = await availabilityModel.findById(req.params.id);
  if (!existing) throw new AppError('Availability window not found.', 404);

  const providerProfile = await providerProfileModel.findByUserId(req.user.id);
  if (!providerProfile || existing.provider_id !== providerProfile.id) {
    throw new AppError('You do not have permission to modify this availability window.', 403);
  }

  const fieldMap = {
    dayOfWeek: 'day_of_week',
    startTime: 'start_time',
    endTime: 'end_time',
    isAvailable: 'is_available',
  };
  const fields = {};
  Object.entries(req.body).forEach(([key, val]) => {
    if (fieldMap[key] !== undefined) fields[fieldMap[key]] = val;
  });

  const updated = await availabilityModel.updateAvailability(req.params.id, fields);
  res.status(200).json({ success: true, data: updated });
});

/**
 * @route   DELETE /api/availability/:id
 * @desc    Delete an availability window. Only the owning provider may delete it.
 * @access  Private (provider, owner only)
 */
const deleteAvailability = asyncHandler(async (req, res) => {
  const existing = await availabilityModel.findById(req.params.id);
  if (!existing) throw new AppError('Availability window not found.', 404);

  const providerProfile = await providerProfileModel.findByUserId(req.user.id);
  if (!providerProfile || existing.provider_id !== providerProfile.id) {
    throw new AppError('You do not have permission to delete this availability window.', 403);
  }

  await availabilityModel.deleteAvailability(req.params.id);
  res.status(200).json({ success: true, message: 'Availability window deleted.' });
});

module.exports = { createAvailability, listByProvider, listMine, updateAvailability, deleteAvailability };
