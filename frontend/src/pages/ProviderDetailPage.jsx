import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LoadingSpinner, ErrorMessage, StarRating, EmptyState } from '../components/common';
import { providerApi } from '../api/providers';
import { serviceApi } from '../api/services';
import { availabilityApi } from '../api/availability';
import { reviewApi } from '../api/reviews';
import { formatCurrency, formatDuration, formatDate } from '../utils/formatters';
import { DAYS_OF_WEEK } from '../utils/constants';

export default function ProviderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [provider, setProvider] = useState(null);
  const [services, setServices] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [providerRes, servicesRes, availabilityRes, reviewsRes] = await Promise.all([
        providerApi.get(id),
        serviceApi.list({ providerId: id }),
        availabilityApi.listForProvider(id),
        reviewApi.listForProvider(id),
      ]);
      setProvider(providerRes.data);
      setServices(servicesRes.data);
      setAvailability(availabilityRes.data);
      setReviews(reviewsRes.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <LoadingSpinner label="Loading provider…" />;
  if (error) return <div className="max-w-3xl mx-auto px-4 py-8"><ErrorMessage message={error} onRetry={load} /></div>;
  if (!provider) return null;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-5">
        <img
          src={provider.imageUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(provider.business_name)}`}
          alt=""
          className="w-24 h-24 rounded-lg object-cover bg-linen shrink-0"
        />
        <div className="flex-1">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <h1 className="font-display text-2xl font-bold text-ink">{provider.business_name}</h1>
            {provider.is_verified && <span className="text-forest text-sm font-semibold">✓ Verified</span>}
          </div>
          <p className="text-slate capitalize mt-0.5">{provider.category}</p>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <StarRating rating={provider.rating || 0} size="lg" />
            <span className="text-sm text-slate">({reviews.length} reviews)</span>
            {provider.location && <span className="text-sm text-slate">📍 {provider.location}</span>}
          </div>
          {provider.description && <p className="text-sm text-ink/80 mt-3">{provider.description}</p>}
        </div>
      </div>

      {/* Services */}
      <section>
        <h2 className="font-display text-lg font-semibold text-ink mb-3">Services</h2>
        {services.length === 0 ? (
          <EmptyState title="No services listed yet" />
        ) : (
          <div className="space-y-3">
            {services.map((s) => (
              <div key={s.id} className="ticket p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-ink">{s.title}</p>
                  {s.description && <p className="text-sm text-slate mt-0.5">{s.description}</p>}
                  <p className="text-xs text-slate mt-1">{formatDuration(s.duration_minutes)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono font-semibold text-ink">{formatCurrency(s.price)}</p>
                  <button
                    onClick={() => navigate(`/book/${s.id}`, { state: { service: s, provider } })}
                    className="btn-primary text-sm px-4 py-2 mt-2"
                  >
                    Book now
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Availability */}
      <section>
        <h2 className="font-display text-lg font-semibold text-ink mb-3">Weekly availability</h2>
        {availability.length === 0 ? (
          <EmptyState title="No availability set yet" />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {DAYS_OF_WEEK.map((day) => {
              const windows = availability.filter((a) => a.day_of_week === day.value && a.is_available);
              return (
                <div key={day.value} className="card p-3 text-center">
                  <p className="text-xs font-semibold text-ink">{day.short}</p>
                  {windows.length === 0 ? (
                    <p className="text-xs text-ink/30 mt-1">Closed</p>
                  ) : (
                    windows.map((w) => (
                      <p key={w.id} className="text-xs font-mono text-slate mt-1">
                        {w.start_time.slice(0, 5)}–{w.end_time.slice(0, 5)}
                      </p>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Reviews */}
      <section>
        <h2 className="font-display text-lg font-semibold text-ink mb-3">Reviews</h2>
        {reviews.length === 0 ? (
          <EmptyState title="No reviews yet" description="Be the first to book and leave a review." />
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <div key={r.id} className="card p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm text-ink">{r.customer_name}</p>
                  <StarRating rating={r.rating} />
                </div>
                {r.comment && <p className="text-sm text-slate mt-2">{r.comment}</p>}
                <p className="text-xs text-slate/70 mt-2 font-mono">{formatDate(r.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
