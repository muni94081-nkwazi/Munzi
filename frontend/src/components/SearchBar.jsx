import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CATEGORIES } from '../utils/constants';

/**
 * SearchBar
 * Suggests matching categories (and, when `suggestionsSource` is passed,
 * matching provider names) as the user types. Pressing Enter or clicking a
 * suggestion navigates to /search?q=...
 */
export default function SearchBar({ suggestionsSource = [], placeholder = 'Search for a service or provider…' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const categoryMatches = CATEGORIES.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));
  const providerMatches = suggestionsSource.filter((p) =>
    (p.business_name || p.businessName || '').toLowerCase().includes(query.toLowerCase())
  );
  const showSuggestions = open && query.length > 0 && (categoryMatches.length > 0 || providerMatches.length > 0);

  const goToSearch = (q) => {
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) goToSearch(query.trim());
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="input-field flex-1"
          aria-label="Search"
          autoComplete="off"
        />
        <button type="submit" className="btn-primary shrink-0">
          Search
        </button>
      </form>

      {showSuggestions && (
        <ul className="absolute z-30 mt-1.5 w-full bg-white border border-ink/10 rounded-md shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {categoryMatches.map((c) => (
            <li key={c.value}>
              <button
                onClick={() => goToSearch(c.label)}
                className="w-full text-left px-4 py-2.5 hover:bg-linen text-sm flex items-center gap-2"
              >
                <span>{c.emoji}</span> {c.label}
                <span className="text-xs text-slate ml-auto">Category</span>
              </button>
            </li>
          ))}
          {providerMatches.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => goToSearch(p.business_name || p.businessName)}
                className="w-full text-left px-4 py-2.5 hover:bg-linen text-sm flex items-center gap-2"
              >
                {p.business_name || p.businessName}
                <span className="text-xs text-slate ml-auto">Provider</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
