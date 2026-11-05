import { Link } from 'react-router-dom';
import { StarRating } from './common';
import { formatCurrency } from '../utils/formatters';

export default function ProviderCard({ provider }) {
  return (
    <Link
      to={`/providers/${provider.id}`}
      className="ticket p-4 flex gap-4 hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      <img
        src={provider.imageUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(provider.business_name || provider.businessName)}`}
        alt=""
        className="w-20 h-20 rounded-md object-cover shrink-0 bg-linen"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display font-semibold text-ink truncate">
            {provider.business_name || provider.businessName}
          </h3>
          {provider.is_verified && (
            <span className="text-forest text-xs font-semibold shrink-0" title="Verified provider">
              ✓ Verified
            </span>
          )}
        </div>
        <p className="text-sm text-slate capitalize truncate">{provider.category}</p>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <StarRating rating={provider.rating || 0} />
          {provider.location && <span className="text-xs text-slate truncate">📍 {provider.location}</span>}
          {typeof provider.distance === 'number' && (
            <span className="text-xs text-slate">{provider.distance.toFixed(1)} km away</span>
          )}
        </div>
        {provider.hourly_rate && (
          <p className="font-mono text-sm font-semibold text-ink mt-2">
            From {formatCurrency(provider.hourly_rate)}/hr
          </p>
        )}
      </div>
    </Link>
  );
}
