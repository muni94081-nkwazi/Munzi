import { useState, useEffect, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import Calendar from '../components/Calendar';
import TimeSlotPicker, { buildSlots } from '../components/TimeSlotPicker';
import { Modal, ErrorMessage } from '../components/common';
import { bookingApi } from '../api/bookings';
import { availabilityApi } from '../api/availability';
import { formatCurrency, formatDuration, formatDate, formatTime } from '../utils/formatters';
import { validateBookingForm } from '../utils/validators';

export default function BookingFlowPage() {
  const { serviceId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();

  const service = state?.service;
  const provider = state?.provider;

  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');

  const [availabilityWindows, setAvailabilityWindows] = useState([]);
  const [bookedSlots, setBookedSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    if (!provider?.id) return;
    availabilityApi.listForProvider(provider.id).then(res => {
      setAvailabilityWindows(res.data || []);
    }).catch(() => {});
  }, [provider?.id]);

  if (!service || !provider) {
    return (
      <div className="max-w-md mx-auto px-4 py-12">
        <ErrorMessage message="We couldn't find that booking. Please start again from the provider's page." />
        <button onClick={() => navigate('/')} className="btn-outline w-full mt-4">
          Back to home
        </button>
      </div>
    );
  }

  const selectedDow = selectedDate ? new Date(selectedDate).getDay() : null;
  
  const slots = useMemo(() => {
    if (selectedDow === null) return [];
    const windows = availabilityWindows.filter(
      (w) => w.day_of_week === selectedDow && w.is_available !== false
    );
    if (windows.length === 0) {
      return buildSlots('09:00', '18:00', 30);
    }
    return windows.flatMap((w) => {
      const start = w.start_time.slice(0, 5); // "HH:mm"
      const end = w.end_time.slice(0, 5);
      return buildSlots(start, end, 30);
    });
  }, [availabilityWindows, selectedDow]);

  const availableDays = useMemo(() => {
    return [...new Set(availabilityWindows.filter(w => w.is_available !== false).map(w => w.day_of_week))];
  }, [availabilityWindows]);

  const handleContinue = (e) => {
    e.preventDefault();
    const validationErrors = validateBookingForm({ date: selectedDate, time: selectedTime });
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setApiError('');
    try {
      const { data } = await bookingApi.create({
        serviceId: service.id,
        bookingDate: selectedDate,
        startTime: selectedTime,
        notes,
      });
      navigate('/booking/confirmed', { state: { booking: data, service, provider } });
    } catch (err) {
      setApiError(err.message);
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-8">
      <h1 className="font-display text-2xl font-bold text-ink">Book {service.title}</h1>
      <p className="text-slate text-sm mt-1">with {provider.business_name}</p>

      <div className="ticket p-4 flex items-center justify-between mt-5">
        <div>
          <p className="font-medium text-ink text-sm">{service.title}</p>
          <p className="text-xs text-slate mt-0.5">{formatDuration(service.duration_minutes)}</p>
        </div>
        <p className="font-mono font-semibold text-ink">{formatCurrency(service.price)}</p>
      </div>

      {apiError && <div className="mt-4"><ErrorMessage message={apiError} /></div>}

      <form onSubmit={handleContinue} className="mt-6 space-y-6">
        <div>
          <h2 className="label-text !mb-2">1. Select a date</h2>
          <Calendar selectedDate={selectedDate} onSelect={setSelectedDate} availableDays={availableDays} />
          {errors.date && <p className="error-text">{errors.date}</p>}
        </div>

        {selectedDate && (
          <div>
            <h2 className="label-text !mb-2">2. Select a time</h2>
            <TimeSlotPicker slots={slots} selected={selectedTime} onSelect={setSelectedTime} />
            {errors.time && <p className="error-text">{errors.time}</p>}
          </div>
        )}

        <div>
          <label className="label-text" htmlFor="notes">
            Special requests (optional)
          </label>
          <textarea
            id="notes"
            rows={3}
            className="input-field"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the provider should know before your appointment?"
          />
        </div>

        <button type="submit" className="btn-primary w-full">
          Review booking
        </button>
      </form>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm your booking"
        footer={
          <>
            <button onClick={() => setConfirmOpen(false)} className="btn-outline">
              Back
            </button>
            <button onClick={handleConfirm} disabled={submitting} className="btn-primary">
              {submitting ? 'Booking…' : 'Confirm booking'}
            </button>
          </>
        }
      >
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate">Provider</dt>
            <dd className="font-medium text-ink">{provider.business_name}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate">Service</dt>
            <dd className="font-medium text-ink">{service.title}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate">Date</dt>
            <dd className="font-medium text-ink">{formatDate(selectedDate)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate">Time</dt>
            <dd className="font-medium text-ink">{formatTime(selectedTime)}</dd>
          </div>
          <div className="flex justify-between pt-2.5 border-t border-ink/10">
            <dt className="text-slate">Total</dt>
            <dd className="font-mono font-semibold text-ink">{formatCurrency(service.price)}</dd>
          </div>
        </dl>
      </Modal>
    </div>
  );
}
