import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isValidEmail } from '../utils/validators';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setApiError('');
    const validationErrors = {};
    if (!isValidEmail(form.email)) validationErrors.email = 'Enter a valid email address.';
    if (!form.password) validationErrors.password = 'Enter your password.';
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSubmitting(true);
    try {
      const { data } = await login(form);
      navigate(data.user.role === 'provider' ? '/provider/dashboard' : '/');
    } catch (err) {
      setApiError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-10 sm:py-14">
      <h1 className="font-display text-2xl font-bold text-ink">Welcome back</h1>
      <p className="text-slate text-sm mt-1.5">Log in to manage your bookings.</p>

      {apiError && <p className="error-text mt-4">{apiError}</p>}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <label className="label-text" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" value={form.email} onChange={handleChange} className="input-field" />
          {errors.email && <p className="error-text">{errors.email}</p>}
        </div>
        <div>
          <label className="label-text" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            className="input-field"
          />
          {errors.password && <p className="error-text">{errors.password}</p>}
        </div>
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <p className="text-sm text-slate text-center mt-6">
        Don't have an account?{' '}
        <Link to="/signup" className="text-ink font-semibold underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
