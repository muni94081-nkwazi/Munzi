import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { bookingApi } from '../api/bookings';
import { reviewApi } from '../api/reviews';
import { Tabs, LoadingSpinner, ErrorMessage, EmptyState, StatusBadge, Modal } from '../components/common';
import { formatCurrency, formatDate, formatTime } from '../utils/formatters';

export default function MyBookingsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const isProvider = user?.role === 'provider';

  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('upcoming');

  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewForm, setReviewForm] = useState({ rating: 5, comment: '' });
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await bookingApi.listMine();
      setBookings(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = bookings.filter(
      (b) => ['pending', 'confirmed'].includes(b.status) && new Date(b.booking_date) >= today
    );
    const past = bookings.filter(
      (b) => b.status === 'completed' || (['pending', 'confirmed'].includes(b.status) && new Date(b.booking_date) < today)
    );
    const cancelled = bookings.filter((b) => b.status === 'cancelled');
    return { upcoming, past, cancelled };
  }, [bookings]);

  const tabs = [
    { value: 'upcoming', label: 'Upcoming', count: grouped.upcoming.length },
    { value: 'past', label: 'Past', count: grouped.past.length },
    { value: 'cancelled', label: 'Cancelled', count: grouped.cancelled.length },
  ];

  const handleCancel = async (booking) => {
    try {
      await bookingApi.updateStatus(booking.id, 'cancelled');
      showToast('Booking cancelled.');
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleConfirm = async (booking) => {
    try {
      await bookingApi.updateStatus(booking.id, 'confirmed');
      showToast('Booking confirmed.');
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleComplete = async (booking) => {
    try {
      await bookingApi.updateStatus(booking.id, 'completed');
      showToast('Marked as completed.');
      load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const openReview = (booking) => {
    setReviewTarget(booking);
    setReviewForm({ rating: 5, comment: '' });
  };

  const submitReview = async () => {
    setReviewSubmitting(true);
    try {
      await reviewApi.create({
        bookingId: reviewTarget.id,
        rating: reviewForm.rating,
        comment: reviewForm.comment,
      });
      showToast('Thanks for your review!');
      setReviewTarget(null);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const list = grouped[activeTab];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="font-display text-2xl font-bold text-ink mb-5">My Bookings</h1>

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <div className="mt-5">
        {loading && <LoadingSpinner label="Loading your bookings…" />}
        {!loading && error && <ErrorMessage message={error} onRetry={load} />}
        {!loading && !error && list.length === 0 && (
          <EmptyState title={`No ${activeTab} bookings`} description="They'll show up here once you have some." />
        )}

        {!loading && !error && list.length > 0 && (
          <div className="space-y-3">
            {list.map((b) => (
              <div key={b.id} className="ticket p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-medium text-ink">{b.service_title}</p>
                    <p className="text-sm text-slate mt-0.5">
                      {isProvider ? `Customer: ${b.customer_name}` : `Provider: ${b.provider_name}`}
                    </p>
                    <p className="text-xs text-slate mt-1 font-mono">
                      {formatDate(b.booking_date)} · {formatTime(b.start_time)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <StatusBadge status={b.status} />
                    {b.service_price && (
                      <p className="font-mono text-sm font-semibold text-ink mt-2">{formatCurrency(b.service_price)}</p>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 mt-3 flex-wrap">
                  {b.status === 'pending' && isProvider && (
                    <button onClick={() => handleConfirm(b)} className="btn-secondary text-xs px-3 py-1.5">
                      Confirm
                    </button>
                  )}
                  {b.status === 'confirmed' && isProvider && (
                    <button onClick={() => handleComplete(b)} className="btn-secondary text-xs px-3 py-1.5">
                      Mark completed
                    </button>
                  )}
                  {['pending', 'confirmed'].includes(b.status) && (
                    <button onClick={() => handleCancel(b)} className="btn-outline text-xs px-3 py-1.5 text-clay">
                      Cancel
                    </button>
                  )}
                  {b.status === 'completed' && !isProvider && (
                    <button onClick={() => openReview(b)} className="btn-outline text-xs px-3 py-1.5">
                      Leave a review
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={!!reviewTarget}
        onClose={() => setReviewTarget(null)}
        title="Leave a review"
        footer={
          <>
            <button onClick={() => setReviewTarget(null)} className="btn-outline">
              Cancel
            </button>
            <button onClick={submitReview} disabled={reviewSubmitting} className="btn-primary">
              {reviewSubmitting ? 'Submitting…' : 'Submit review'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label-text">Rating</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setReviewForm((f) => ({ ...f, rating: n }))}
                  className={`text-2xl ${n <= reviewForm.rating ? 'text-marigold' : 'text-ink/15'}`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label-text" htmlFor="comment">
              Comment
            </label>
            <textarea
              id="comment"
              rows={3}
              className="input-field"
              value={reviewForm.comment}
              onChange={(e) => setReviewForm((f) => ({ ...f, comment: e.target.value }))}
              placeholder="How was your experience?"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
