const Joi = require('joi');
const AppError = require('../utils/AppError');

/**
 * validate(schema, source)
 * Generic validation middleware factory. Validates req[source] against
 * a Joi schema and returns a 400 with all error messages if invalid.
 *
 * Usage: router.post('/', validate(schemas.createService), controller.create)
 */
const validate = (schema, source = 'body') => (req, res, next) => {
  const { error, value } = schema.validate(req[source], {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const message = error.details.map((d) => d.message).join('; ');
    return next(new AppError(`Validation error: ${message}`, 400));
  }

  req[source] = value;
  next();
};

// ─── Auth schemas ───────────────────────────────────────────────────
const signupSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  role: Joi.string().valid('provider', 'customer').required(),
  // Provider fields
  businessName: Joi.string().when('role', { is: 'provider', then: Joi.required() }),
  category: Joi.string().when('role', { is: 'provider', then: Joi.optional() }),
  // Customer fields
  fullName: Joi.string().when('role', { is: 'customer', then: Joi.required() }),
  phone: Joi.string().optional().allow(''),
  address: Joi.string().optional().allow(''),
  description: Joi.string().optional().allow(''),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

// ─── Profile schemas ────────────────────────────────────────────────
const updateProviderProfileSchema = Joi.object({
  businessName: Joi.string().optional(),
  description: Joi.string().optional().allow(''),
  phone: Joi.string().optional().allow(''),
  address: Joi.string().optional().allow(''),
  category: Joi.string().optional().allow(''),
}).min(1);

const updateCustomerProfileSchema = Joi.object({
  fullName: Joi.string().optional(),
  phone: Joi.string().optional().allow(''),
  address: Joi.string().optional().allow(''),
}).min(1);

// ─── Service schemas ────────────────────────────────────────────────
const createServiceSchema = Joi.object({
  title: Joi.string().min(2).max(255).required(),
  description: Joi.string().allow('').optional(),
  category: Joi.string().allow('').optional(),
  price: Joi.number().min(0).required(),
  durationMinutes: Joi.number().integer().min(1).required(),
  isActive: Joi.boolean().optional(),
});

const updateServiceSchema = Joi.object({
  title: Joi.string().min(2).max(255).optional(),
  description: Joi.string().allow('').optional(),
  category: Joi.string().allow('').optional(),
  price: Joi.number().min(0).optional(),
  durationMinutes: Joi.number().integer().min(1).optional(),
  isActive: Joi.boolean().optional(),
}).min(1);

// ─── Availability schemas ───────────────────────────────────────────
const createAvailabilitySchema = Joi.object({
  dayOfWeek: Joi.number().integer().min(0).max(6).required(),
  startTime: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .required()
    .messages({ 'string.pattern.base': 'startTime must be in HH:mm format' }),
  endTime: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .required()
    .messages({ 'string.pattern.base': 'endTime must be in HH:mm format' }),
  isAvailable: Joi.boolean().optional(),
});

const updateAvailabilitySchema = Joi.object({
  dayOfWeek: Joi.number().integer().min(0).max(6).optional(),
  startTime: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
  endTime: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
  isAvailable: Joi.boolean().optional(),
}).min(1);

// ─── Booking schemas ────────────────────────────────────────────────
const createBookingSchema = Joi.object({
  providerId: Joi.string().uuid().required(),
  serviceId: Joi.string().uuid().required(),
  bookingDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required()
    .messages({ 'string.pattern.base': 'bookingDate must be in YYYY-MM-DD format' }),
  bookingTime: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .required()
    .messages({ 'string.pattern.base': 'bookingTime must be in HH:mm format' }),
  notes: Joi.string().allow('').max(1000).optional(),
});

const updateBookingStatusSchema = Joi.object({
  status: Joi.string().valid('pending', 'confirmed', 'completed', 'cancelled').required(),
});

// ─── Review schemas ─────────────────────────────────────────────────
const createReviewSchema = Joi.object({
  bookingId: Joi.string().uuid().required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().allow('').optional(),
});

// ─── Password schemas ───────────────────────────────────────────────
const changePasswordSchema = Joi.object({
  oldPassword: Joi.string().required(),
  newPassword: Joi.string().min(8).required(),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  newPassword: Joi.string().min(8).required(),
});

module.exports = {
  validate,
  schemas: {
    signupSchema,
    loginSchema,
    updateProviderProfileSchema,
    updateCustomerProfileSchema,
    createServiceSchema,
    updateServiceSchema,
    createAvailabilitySchema,
    updateAvailabilitySchema,
    createBookingSchema,
    updateBookingStatusSchema,
    createReviewSchema,
    changePasswordSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
  },
};
