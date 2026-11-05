import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';

export default function Navbar() {
  const { user, logout, isAuthenticated } = useAuth();
  const { totalUnread } = useChat();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    setMenuOpen(false);
    navigate('/');
  };

  const navLinks = isAuthenticated
    ? user.role === 'provider'
      ? [
          { to: '/provider/dashboard', label: 'Dashboard' },
          { to: '/bookings', label: 'Bookings' },
          { to: '/messages', label: 'Messages', badge: totalUnread },
          { to: '/profile', label: 'Profile' },
        ]
      : [
          { to: '/', label: 'Home' },
          { to: '/bookings', label: 'My Bookings' },
          { to: '/messages', label: 'Messages', badge: totalUnread },
          { to: '/profile', label: 'Profile' },
        ]
    : [];

  return (
    <header className="sticky top-0 z-40 bg-linen/95 backdrop-blur border-b border-ink/10">
      <nav className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" className="font-display font-bold text-xl text-ink tracking-tight">
          Bulk<span className="text-marigold">.</span>
        </Link>

        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="relative text-sm font-medium text-ink/80 hover:text-ink transition"
            >
              {link.label}
              {!!link.badge && (
                <span className="absolute -top-2 -right-3.5 min-w-[16px] h-4 px-1 rounded-full bg-clay text-white text-[10px] font-semibold flex items-center justify-center">
                  {link.badge > 9 ? '9+' : link.badge}
                </span>
              )}
            </Link>
          ))}
          {isAuthenticated ? (
            <button onClick={handleLogout} className="btn-outline text-sm px-4 py-2">
              Log out
            </button>
          ) : (
            <>
              <Link to="/login" className="text-sm font-medium text-ink/80 hover:text-ink">
                Log in
              </Link>
              <Link to="/signup" className="btn-primary text-sm px-4 py-2">
                Sign up
              </Link>
            </>
          )}
        </div>

        <button
          className="md:hidden text-ink"
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </nav>

      {menuOpen && (
        <div className="md:hidden border-t border-ink/10 bg-linen px-4 py-3 flex flex-col gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={() => setMenuOpen(false)}
              className="py-2.5 text-sm font-medium text-ink/80 hover:text-ink flex items-center gap-2"
            >
              {link.label}
              {!!link.badge && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-clay text-white text-[10px] font-semibold flex items-center justify-center">
                  {link.badge > 9 ? '9+' : link.badge}
                </span>
              )}
            </Link>
          ))}
          {isAuthenticated ? (
            <button onClick={handleLogout} className="py-2.5 text-left text-sm font-medium text-clay">
              Log out
            </button>
          ) : (
            <>
              <Link to="/login" onClick={() => setMenuOpen(false)} className="py-2.5 text-sm font-medium text-ink/80">
                Log in
              </Link>
              <Link to="/signup" onClick={() => setMenuOpen(false)} className="py-2.5 text-sm font-semibold text-ink">
                Sign up
              </Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}
