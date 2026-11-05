import { useEffect, useState } from 'react';
import SearchBar from '../components/SearchBar';
import CategoryGrid from '../components/CategoryGrid';
import ProviderCard from '../components/ProviderCard';
import { LoadingSpinner, ErrorMessage, EmptyState } from '../components/common';
import { providerApi } from '../api/providers';

export default function HomePage() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadFeatured = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await providerApi.list({ limit: 6 });
      setProviders(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeatured();
  }, []);

  return (
    <div>
      {/* Hero */}
      <section className="bg-ink text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <h1 className="font-display text-3xl sm:text-5xl font-bold max-w-2xl leading-tight">
            Trusted local help, booked in minutes.
          </h1>
          <p className="text-white/70 mt-4 max-w-lg">
            From haircuts to home repairs — find verified providers near you and book a real time slot, not just a phone number.
          </p>
          <div className="mt-8 max-w-xl">
            <SearchBar suggestionsSource={providers} />
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-12">
        {/* Categories */}
        <section>
          <h2 className="font-display text-xl font-semibold text-ink mb-4">Browse by category</h2>
          <CategoryGrid />
        </section>

        {/* Featured providers */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-semibold text-ink">Featured providers</h2>
          </div>

          {loading && <LoadingSpinner label="Finding great providers…" />}
          {!loading && error && <ErrorMessage message={error} onRetry={loadFeatured} />}
          {!loading && !error && providers.length === 0 && (
            <EmptyState title="No providers yet" description="Check back soon as more providers join Bulk." />
          )}
          {!loading && !error && providers.length > 0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {providers.map((p) => (
                <ProviderCard key={p.id} provider={p} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
