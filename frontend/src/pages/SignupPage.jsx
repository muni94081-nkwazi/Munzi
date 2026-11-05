import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { validateSignupForm } from '../utils/validators';

export default function SignupPage() {
  const { signup } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [role, setRole] = useState('customer');
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');

  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setApiError('');
    const validationErrors = validateSignupForm({ ...form, role });
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSubmitting(true);
    try {
      // Role-specific required fields are filled with placeholders here;
      // the dedicated profile-setup pages let the user complete them properly.
      const payload = {
        email: form.email,
        password: form.password,
        role,
        phone: form.phone,
        ...(role === 'provider'
          ? { businessName: form.fullName, category: 'general' }
          : { fullName: form.fullName }),
      };
      await signup(payload);
      showToast('Account created! Let’s finish setting up your profile.');
      navigate(role === 'provider' ? '/provider/setup' : '/customer/setup');
    } catch (err) {
      setApiError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-10 sm:py-14">
      <h1 className="font-display text-2xl font-bold text-ink">Create your account</h1>
      <p className="text-slate text-sm mt-1.5">Join Bulk to book trusted local services, or offer your own.</p>

      {/* Role toggle */}
      <div className="mt-6 grid grid-cols-2 gap-2 p-1 bg-white rounded-md border border-ink/10">
        {['customer', 'provider'].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`py-2.5 rounded-md text-sm font-display font-semibold capitalize transition ${
              role === r ? 'bg-ink text-white' : 'text-ink/70 hover:text-ink'
            }`}
          >
            I'm a {r}
          </button>
        ))}
      </div>

      {apiError && <p className="error-text mt-4">{apiError}</p>}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <label className="label-text" htmlFor="fullName">
            Full name
          </label>
          <input
            id="fullName"
            name="fullName"
            value={form.fullName}
            onChange={handleChange}
            className="input-field"
            placeholder="Jane Nakato"
          />
          {errors.fullName && <p className="error-text">{errors.fullName}</p>}
        </div>

        <div>
          <label className="label-text" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            className="input-field"
            placeholder="you@example.com"
          />
          {errors.email && <p className="error-text">{errors.email}</p>}
        </div>

        <div>
          <label className="label-text" htmlFor="phone">
            Phone number
          </label>
          <input
            id="phone"
            name="phone"
            value={form.phone}
            onChange={handleChange}
            className="input-field"
            placeholder="+256 700 000 000"
          />
          {errors.phone && <p className="error-text">{errors.phone}</p>}
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
            placeholder="At least 8 characters"
          />
          {errors.password && <p className="error-text">{errors.password}</p>}
        </div>

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="text-sm text-slate text-center mt-6">
        Already have an account?{' '}
        <Link to="/login" className="text-ink font-semibold underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
