import { useLocation, useNavigate, Link } from 'react-router-dom';
import { formatCurrency, formatDate, formatTime } from '../utils/formatters';

export default function BookingConfirmationPage() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const booking = state?.booking;
  const service = state?.service;
  const provider = state?.provider;

  if (!booking) {
    return (
      <div className="max-w-md mx-auto px-4 py-14 text-center">
        <p className="text-slate">No booking to show.</p>
        <button onClick={() => navigate('/')} className="btn-primary mt-4">
          Back to home
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-14 text-center">
      <div className="w-16 h-16 rounded-full bg-forest/10 text-forest flex items-center justify-center text-3xl mx-auto">
        ✓
      </div>
      <h1 className="font-display text-2xl font-bold text-ink mt-5">Booking requested!</h1>
      <p className="text-slate text-sm mt-2">
        {provider?.business_name} will confirm your appointment shortly. You'll see it under "My Bookings".
      </p>

      <div className="ticket p-5 mt-6 text-left space-y-2.5">
        <div className="flex justify-between text-sm">
          <span className="text-slate">Service</span>
          <span className="font-medium text-ink">{service?.title}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate">Date</span>
          <span className="font-medium text-ink">{formatDate(booking.booking_date)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate">Time</span>
          <span className="font-medium text-ink">{formatTime(booking.start_time)}</span>
        </div>
        <div className="flex justify-between text-sm pt-2.5 border-t border-ink/10">
          <span className="text-slate">Total</span>
          <span className="font-mono font-semibold text-ink">{formatCurrency(service?.price)}</span>
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <Link to="/" className="btn-outline flex-1">
          Back home
        </Link>
        <Link to="/bookings" className="btn-primary flex-1">
          View my bookings
        </Link>
      </div>
    </div>
  );
}
