const cron = require('node-cron');
const pool = require('../config/db');
const { notifyBookingReminder } = require('./bookingNotifications');

/**
 * Runs every 5 minutes, looking for confirmed bookings whose start time
 * falls 55-65 minutes from now that haven't been reminded yet. The 10-minute
 * window (rather than an exact 60-minute mark) exists so a booking is never
 * missed just because it landed between two 5-minute cron ticks.
 *
 * `reminder_sent` is flipped to true in the same query that selects the
 * rows (via a CTE + UPDATE ... RETURNING) so two overlapping runs can't both
 * pick up and double-send the same booking.
 */
function startBookingReminderScheduler() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const { rows } = await pool.query(`
        WITH due AS (
          SELECT b.id
          FROM bookings b
          WHERE b.status = 'confirmed'
            AND b.reminder_sent = false
            AND (b.booking_date + b.start_time) BETWEEN (NOW() + INTERVAL '55 minutes')
                                                      AND (NOW() + INTERVAL '65 minutes')
        )
        UPDATE bookings b
        SET reminder_sent = true
        FROM due
        WHERE b.id = due.id
        RETURNING b.id, b.provider_id, b.customer_id, b.start_time,
                  (SELECT title FROM services WHERE id = b.service_id) AS service_title
      `);

      for (const booking of rows) {
        await notifyBookingReminder({
          providerId: booking.provider_id,
          customerId: booking.customer_id,
          serviceTitle: booking.service_title,
          bookingTime: String(booking.start_time).slice(0, 5),
          bookingId: booking.id,
        }).catch((err) => console.error(`Failed to send reminder for booking ${booking.id}:`, err));
      }

      if (rows.length > 0) {
        console.log(`Sent ${rows.length} booking reminder(s).`);
      }
    } catch (err) {
      console.error('Booking reminder scan failed:', err.message);
    }
  });

  console.log('Booking reminder scheduler started (runs every 5 minutes).');
}

module.exports = { startBookingReminderScheduler };
