import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { customerApi } from '../api/providers';
import { CONTACT_METHODS } from '../utils/constants';

export default function CustomerProfileSetupPage() {
  const { updateProfile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({ address: '', preferredContact: 'phone' });
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.address.trim()) {
      setApiError('Enter your address so providers know where to reach you.');
      return;
    }
    setApiError('');
    setSubmitting(true);
    try {
      const { data } = await customerApi.updateMe({
        address: form.address,
        preferredContact: form.preferredContact,
      });
      updateProfile(data);
      showToast('You’re all set! Start exploring services near you.');
      navigate('/');
    } catch (err) {
      setApiError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">A few more details</h1>
      <p className="text-slate text-sm mt-1.5">This helps providers reach you and confirm bookings.</p>

      {apiError && <p className="error-text mt-4">{apiError}</p>}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="label-text" htmlFor="address">
            Address
          </label>
          <input
            id="address"
            className="input-field"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            placeholder="Bugolobi, Kampala"
          />
        </div>

        <div>
          <label className="label-text">Preferred contact method</label>
          <div className="grid grid-cols-3 gap-2">
            {CONTACT_METHODS.map((c) => (
              <button
                type="button"
                key={c.value}
                onClick={() => setForm((f) => ({ ...f, preferredContact: c.value }))}
                className={`py-2.5 rounded-md text-sm font-medium border transition ${
                  form.preferredContact === c.value ? 'bg-ink text-white border-ink' : 'border-ink/15 text-ink/70'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="ticket p-4">
          <p className="font-display font-semibold text-sm mb-1">Payment method</p>
          <p className="text-xs text-slate">Payment integration coming soon. Providers will arrange payment directly for now.</p>
        </div>

        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? 'Saving…' : 'Finish setup'}
        </button>
      </form>
    </div>
  );
}
