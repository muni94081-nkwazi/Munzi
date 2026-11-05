const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const availabilityRoutes = require('./routes/availabilityRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const chatRoutes = require('./routes/chatRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// ─── Global middleware ──────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ─── Health check ───────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Bulk API is running.' });
});

// ─── API routes ──────────────────────────────────────────────────────
// Auth: /api/auth/signup, /api/auth/login, /api/auth/me
app.use('/api/auth', authRoutes);

// Profiles: /api/providers/*, /api/customers/*
app.use('/api', profileRoutes);

// Services: /api/services/*
app.use('/api/services', serviceRoutes);

// Availability: /api/availability/*
app.use('/api/availability', availabilityRoutes);

// Bookings: /api/bookings/*
app.use('/api/bookings', bookingRoutes);

// Reviews: /api/reviews/*
app.use('/api/reviews', reviewRoutes);

// Chats: /api/chats/* (real-time send/typing/read happen over Socket.io - see socket/index.js)
app.use('/api/chats', chatRoutes);

// ─── 404 + error handling (must be last) ────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
