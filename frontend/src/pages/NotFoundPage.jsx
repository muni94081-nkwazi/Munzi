import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="max-w-md mx-auto px-4 py-20 text-center">
      <p className="font-mono text-5xl font-bold text-ink/10">404</p>
      <h1 className="font-display text-xl font-bold text-ink mt-3">Page not found</h1>
      <p className="text-slate text-sm mt-2">The page you're looking for doesn't exist or has moved.</p>
      <Link to="/" className="btn-primary inline-block mt-6">
        Back to home
      </Link>
    </div>
  );
}
