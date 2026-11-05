import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ProviderCard from '../components/ProviderCard';
import { LoadingSpinner, ErrorMessage, EmptyState } from '../components/common';
import { providerApi } from '../api/providers';
import { CATEGORIES } from '../utils/constants';

const SORT_OPTIONS = [
  { value: 'rating', label: 'Highest rated' },
  { value: 'price_low', label: 'Price: low to high' },
  { value: 'price_high', label: 'Price: high to low' },
  { value: 'distance', label: 'Nearest' },
];

export default function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const initialCategory = searchParams.get('category') || '';

  const [allProviders, setAllProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [category, setCategory] = useState(initialCategory);
  const [maxPrice, setMaxPrice] = useState(200000);
  const [minRating, setMinRating] = useState(0);
  const [location, setLocation] = useState('');
  const [sortBy, setSortBy] = useState('rating');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await providerApi.list({ category: category || undefined, limit: 50 });
      setAllProviders(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const results = useMemo(() => {
    let list = [...allProviders];

    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (p) =>
          (p.business_name || p.businessName || '').toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q)
      );
    }
    if (location) {
      list = list.filter((p) => (p.location || '').toLowerCase().includes(location.toLowerCase()));
    }
    list = list.filter((p) => Number(p.hourly_rate || 0) <= maxPrice);
    list = list.filter((p) => Number(p.rating || 0) >= minRating);

    switch (sortBy) {
      case 'price_low':
        list.sort((a, b) => (a.hourly_rate || 0) - (b.hourly_rate || 0));
        break;
      case 'price_high':
        list.sort((a, b) => (b.hourly_rate || 0) - (a.hourly_rate || 0));
        break;
      case 'distance':
        list.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
        break;
      default:
        list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }
    return list;
  }, [allProviders, query, location, maxPrice, minRating, sortBy]);

  const FilterPanel = (
    <div className="space-y-6">
      <div>
        <h3 className="font-display font-semibold text-sm mb-2">Category</h3>
        <select
          className="input-field"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              if (e.target.value) next.set('category', e.target.value);
              else next.delete('category');
              return next;
            });
          }}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <h3 className="font-display font-semibold text-sm mb-2">Max price / hr</h3>
        <input
          type="range"
          min="0"
          max="200000"
          step="5000"
          value={maxPrice}
          onChange={(e) => setMaxPrice(Number(e.target.value))}
          className="w-full accent-marigold"
        />
        <p className="font-mono text-xs text-slate mt-1">Up to UGX {maxPrice.toLocaleString()}</p>
      </div>

      <div>
        <h3 className="font-display font-semibold text-sm mb-2">Minimum rating</h3>
        <div className="flex gap-2">
          {[0, 3, 4, 4.5].map((r) => (
            <button
              key={r}
              onClick={() => setMinRating(r)}
              className={`px-3 py-1.5 rounded-md text-xs font-mono border ${
                minRating === r ? 'bg-ink text-white border-ink' : 'border-ink/15 text-ink/70'
              }`}
            >
              {r === 0 ? 'Any' : `${r}+`}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-display font-semibold text-sm mb-2">Location</h3>
        <input
          className="input-field"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Kampala, Ntinda"
        />
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-xl font-bold text-ink">
            {query ? `Results for “${query}”` : 'Browse providers'}
          </h1>
          <p className="text-sm text-slate mt-0.5">{results.length} providers found</p>
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="input-field w-auto text-sm py-2"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              Sort: {o.label}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={() => setFiltersOpen((o) => !o)}
        className="md:hidden btn-outline w-full mb-4 text-sm"
      >
        {filtersOpen ? 'Hide filters' : 'Show filters'}
      </button>

      <div className="grid md:grid-cols-[240px_1fr] gap-6">
        <aside className={`${filtersOpen ? 'block' : 'hidden'} md:block`}>
          <div className="card p-4 md:sticky md:top-20">{FilterPanel}</div>
        </aside>

        <div>
          {loading && <LoadingSpinner label="Searching providers…" />}
          {!loading && error && <ErrorMessage message={error} onRetry={load} />}
          {!loading && !error && results.length === 0 && (
            <EmptyState
              title="No providers match your filters"
              description="Try widening your price range or clearing a filter."
            />
          )}
          {!loading && !error && results.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-4">
              {results.map((p) => (
                <ProviderCard key={p.id} provider={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
