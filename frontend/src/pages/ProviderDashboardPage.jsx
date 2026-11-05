import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { bookingApi } from '../api/bookings';
import { StatCard, LoadingSpinner, ErrorMessage, EmptyState, StatusBadge } from '../components/common';
import { formatCurrency, formatDate, formatTime } from '../utils/formatters';

export default function ProviderDashboardPage() {
  const { profile } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const stats = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const thisMonth = new Date().getMonth();

    const todaysBookings = bookings.filter((b) => b.booking_date?.slice(0, 10) === todayKey);
    const newRequests = bookings.filter((b) => b.status === 'pending');
    const earningsThisMonth = bookings
      .filter((b) => b.status === 'completed' && new Date(b.booking_date).getMonth() === thisMonth)
      .reduce((sum, b) => sum + Number(b.total_price || b.service_price || 0), 0);

    return {
      today: todaysBookings.length,
      requests: newRequests.length,
      earnings: earningsThisMonth,
    };
  }, [bookings]);

  const upcoming = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return bookings
      .filter((b) => ['pending', 'confirmed'].includes(b.status) && new Date(b.booking_date) >= today)
      .sort((a, b) => new Date(a.booking_date) - new Date(b.booking_date))
      .slice(0, 6);
  }, [bookings]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="font-display text-2xl font-bold text-ink">
        Welcome back{profile?.business_name ? `, ${profile.business_name}` : ''}
      </h1>
      <p className="text-slate text-sm mt-1">Here's how things are looking today.</p>

      {loading && <LoadingSpinner label="Loading your dashboard…" />}
      {!loading && error && <ErrorMessage message={error} onRetry={load} />}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            <StatCard label="Today's bookings" value={stats.today} />
            <StatCard label="New requests" value={stats.requests} />
            <StatCard label="Earnings this month" value={formatCurrency(stats.earnings)} />
            <StatCard label="Rating" value={profile?.rating ? Number(profile.rating).toFixed(1) : '—'} sublabel="out of 5" />
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-3 mt-6">
            <Link to="/bookings" className="btn-outline text-sm">
              View calendar
            </Link>
            <Link to="/provider/setup" className="btn-outline text-sm">
              + Add service
            </Link>
            <Link to="/bookings" className="btn-outline text-sm">
              View all bookings
            </Link>
          </div>

          {/* Upcoming bookings */}
          <section className="mt-8">
            <h2 className="font-display text-lg font-semibold text-ink mb-3">Upcoming bookings</h2>
            {upcoming.length === 0 ? (
              <EmptyState title="No upcoming bookings" description="New requests will show up here." />
            ) : (
              <div className="space-y-3">
                {upcoming.map((b) => (
                  <div key={b.id} className="ticket p-4 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="font-medium text-ink">{b.service_title}</p>
                      <p className="text-sm text-slate mt-0.5">Customer: {b.customer_name}</p>
                      <p className="text-xs text-slate mt-1 font-mono">
                        {formatDate(b.booking_date)} · {formatTime(b.start_time)}
                      </p>
                    </div>
                    <StatusBadge status={b.status} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
