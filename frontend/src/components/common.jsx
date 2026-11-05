/**
 * Common, small, reusable presentational components.
 * Grouped in one file to keep the component tree easy to scan.
 */

export function LoadingSpinner({ label = 'Loading…', size = 'md' }) {
  const dims = size === 'sm' ? 'h-4 w-4 border-2' : 'h-8 w-8 border-[3px]';
  return (
    <div className="flex items-center justify-center gap-3 py-8 text-slate" role="status" aria-live="polite">
      <span className={`${dims} rounded-full border-ink/20 border-t-marigold animate-spin`} />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorMessage({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="ticket border-clay/30 px-4 py-3 flex items-start justify-between gap-3">
      <p className="text-clay text-sm">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-sm font-semibold text-ink underline shrink-0">
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="text-center py-14 px-4">
      <h3 className="font-display font-semibold text-lg text-ink">{title}</h3>
      {description && <p className="text-slate text-sm mt-1.5 max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function StatusBadge({ status }) {
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  return <span className={`stamp stamp-${status}`}>{label}</span>;
}

export function StarRating({ rating = 0, size = 'sm', showValue = true }) {
  const full = Math.round(Number(rating));
  const starSize = size === 'lg' ? 'text-xl' : 'text-sm';
  return (
    <span className={`inline-flex items-center gap-1 ${starSize}`} aria-label={`Rated ${rating} out of 5`}>
      <span className="text-marigold tracking-tighter">
        {'★'.repeat(full)}
        <span className="text-ink/15">{'★'.repeat(5 - full)}</span>
      </span>
      {showValue && <span className="font-mono text-xs text-slate">{Number(rating).toFixed(1)}</span>}
    </span>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 border-b border-ink/10 overflow-x-auto no-scrollbar">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`px-4 py-2.5 text-sm font-display font-semibold whitespace-nowrap border-b-2 transition ${
            active === tab.value ? 'border-marigold text-ink' : 'border-transparent text-slate hover:text-ink'
          }`}
        >
          {tab.label}
          {typeof tab.count === 'number' && (
            <span className="ml-1.5 font-mono text-xs text-slate">({tab.count})</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function StatCard({ label, value, sublabel }) {
  return (
    <div className="ticket px-5 py-4">
      <p className="text-xs uppercase tracking-wider text-slate font-medium">{label}</p>
      <p className="font-mono text-2xl font-semibold text-ink mt-1.5">{value}</p>
      {sublabel && <p className="text-xs text-slate mt-1">{sublabel}</p>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-lg w-full sm:max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink/10">
          <h3 className="font-display font-semibold text-lg">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-ink/10 flex gap-3 justify-end">{footer}</div>}
      </div>
    </div>
  );
}
