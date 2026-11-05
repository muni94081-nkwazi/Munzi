require('dotenv').config();
const http = require('http');
const app = require('./app');
const pool = require('./config/db');
const { startBookingReminderScheduler } = require('./utils/reminderScheduler');
const { initSocket } = require('./socket');

const PORT = process.env.PORT || 5000;

// Fail fast if critical env vars are missing.
if (!process.env.JWT_SECRET) {
  console.error('❌ Missing JWT_SECRET in environment. Copy .env.example to .env and set it.');
  process.exit(1);
}

// Socket.io needs a raw http.Server to attach to - app.listen() creates one
// internally but doesn't expose it, so we create it explicitly here and use
// it for both Express and Socket.io.
const httpServer = http.createServer(app);
initSocket(httpServer, process.env.CORS_ORIGIN);

const server = httpServer.listen(PORT, () => {
  console.log(`🚀 Bulk API listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  console.log(`💬 Socket.io chat server attached on the same port.`);
  startBookingReminderScheduler();
});

// Graceful shutdown
async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    await pool.end();
    console.log('Closed out remaining connections.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION 💥', err);
});
