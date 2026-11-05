const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const providerProfileModel = require('../models/providerProfileModel');
const customerProfileModel = require('../models/customerProfileModel');

/**
 * @route   GET /api/providers
 * @desc    List/browse provider profiles (public directory). Supports ?category & pagination.
 * @access  Public
 * @query   category?, page?, limit?
 */
const listProviders = asyncHandler(async (req, res) => {
  const { category, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  const providers = await providerProfileModel.listProviders({ category, limit: Number(limit), offset });
  res.status(200).json({ success: true, data: providers });
});

/**
 * @route   GET /api/providers/:id
 * @desc    Get a single provider's public profile.
 * @access  Public
 */
const getProvider = asyncHandler(async (req, res) => {
  const provider = await providerProfileModel.findById(req.params.id);
  if (!provider) throw new AppError('Provider not found.', 404);
  res.status(200).json({ success: true, data: provider });
});

/**
 * @route   PATCH /api/providers/me
 * @desc    Update the logged-in provider's own profile.
 * @access  Private (provider)
 * @body    { businessName?, description?, phone?, address?, category? }
 */
const updateMyProviderProfile = asyncHandler(async (req, res) => {
  const fieldMap = {
    businessName: 'business_name',
    description: 'description',
    phone: 'phone',
    address: 'address',
    category: 'category',
  };
  const fields = {};
  Object.entries(req.body).forEach(([key, val]) => {
    if (fieldMap[key]) fields[fieldMap[key]] = val;
  });

  const updated = await providerProfileModel.updateProviderProfile(req.user.id, fields);
  if (!updated) throw new AppError('Provider profile not found.', 404);
  res.status(200).json({ success: true, data: updated });
});

/**
 * @route   PATCH /api/customers/me
 * @desc    Update the logged-in customer's own profile.
 * @access  Private (customer)
 * @body    { fullName?, phone?, address? }
 */
const updateMyCustomerProfile = asyncHandler(async (req, res) => {
  const fieldMap = { fullName: 'full_name', phone: 'phone', address: 'address' };
  const fields = {};
  Object.entries(req.body).forEach(([key, val]) => {
    if (fieldMap[key]) fields[fieldMap[key]] = val;
  });

  const updated = await customerProfileModel.updateCustomerProfile(req.user.id, fields);
  if (!updated) throw new AppError('Customer profile not found.', 404);
  res.status(200).json({ success: true, data: updated });
});

module.exports = { listProviders, getProvider, updateMyProviderProfile, updateMyCustomerProfile };
