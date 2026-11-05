import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { providerApi, customerApi } from '../api/providers';
import { passwordApi } from '../api/password';
import { CATEGORIES, CONTACT_METHODS } from '../utils/constants';
import { Tabs } from '../components/common';

export default function ProfilePage() {
  const { user, profile, updateProfile, logout } = useAuth();
  const { showToast } = useToast();
  const isProvider = user?.role === 'provider';

  const [tab, setTab] = useState('profile');

  const [providerForm, setProviderForm] = useState({
    businessName: profile?.business_name || '',
    category: profile?.category || CATEGORIES[0].value,
    description: profile?.description || '',
    location: profile?.location || '',
  });
  const [customerForm, setCustomerForm] = useState({
    address: profile?.address || '',
    preferredContact: profile?.preferred_contact || 'phone',
  });

  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [passwordError, setPasswordError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const [notifications, setNotifications] = useState({ email: true, sms: true });

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const { data } = isProvider
        ? await providerApi.updateMe(providerForm)
        : await customerApi.updateMe(customerForm);
      updateProfile(data);
      showToast('Profile updated.');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    if (passwordForm.next.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setSavingPassword(true);
    try {
      await passwordApi.changePassword({
        oldPassword: passwordForm.current,
        newPassword: passwordForm.next,
      });
      setPasswordForm({ current: '', next: '', confirm: '' });
      showToast('Password updated.');
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="font-display text-2xl font-bold text-ink mb-1">Your profile</h1>
      <p className="text-slate text-sm mb-5">{user?.email}</p>

      <Tabs
        tabs={[
          { value: 'profile', label: 'Profile' },
          { value: 'password', label: 'Password' },
          { value: 'settings', label: 'Settings' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-6">
        {tab === 'profile' && (
          <form onSubmit={handleSaveProfile} className="space-y-4">
            {isProvider ? (
              <>
                <div>
                  <label className="label-text">Business name</label>
                  <input
                    className="input-field"
                    value={providerForm.businessName}
                    onChange={(e) => setProviderForm((f) => ({ ...f, businessName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label-text">Category</label>
                  <select
                    className="input-field"
                    value={providerForm.category}
                    onChange={(e) => setProviderForm((f) => ({ ...f, category: e.target.value }))}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label-text">Location</label>
                  <input
                    className="input-field"
                    value={providerForm.location}
                    onChange={(e) => setProviderForm((f) => ({ ...f, location: e.target.value }))}
                    placeholder="Kampala, Kololo"
                  />
                </div>
                <div>
                  <label className="label-text">Description</label>
                  <textarea
                    rows={4}
                    className="input-field"
                    value={providerForm.description}
                    onChange={(e) => setProviderForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="label-text">Address</label>
                  <input
                    className="input-field"
                    value={customerForm.address}
                    onChange={(e) => setCustomerForm((f) => ({ ...f, address: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label-text">Preferred contact method</label>
                  <div className="grid grid-cols-3 gap-2">
                    {CONTACT_METHODS.map((c) => (
                      <button
                        type="button"
                        key={c.value}
                        onClick={() => setCustomerForm((f) => ({ ...f, preferredContact: c.value }))}
                        className={`py-2.5 rounded-md text-sm font-medium border transition ${
                          customerForm.preferredContact === c.value
                            ? 'bg-ink text-white border-ink'
                            : 'border-ink/15 text-ink/70'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <button type="submit" disabled={savingProfile} className="btn-primary w-full">
              {savingProfile ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        )}

        {tab === 'password' && (
          <form onSubmit={handleChangePassword} className="space-y-4">
            {passwordError && <p className="error-text">{passwordError}</p>}
            <div>
              <label className="label-text">Current password</label>
              <input
                type="password"
                className="input-field"
                value={passwordForm.current}
                onChange={(e) => setPasswordForm((f) => ({ ...f, current: e.target.value }))}
              />
            </div>
            <div>
              <label className="label-text">New password</label>
              <input
                type="password"
                className="input-field"
                value={passwordForm.next}
                onChange={(e) => setPasswordForm((f) => ({ ...f, next: e.target.value }))}
              />
            </div>
            <div>
              <label className="label-text">Confirm new password</label>
              <input
                type="password"
                className="input-field"
                value={passwordForm.confirm}
                onChange={(e) => setPasswordForm((f) => ({ ...f, confirm: e.target.value }))}
              />
            </div>
            <button type="submit" disabled={savingPassword} className="btn-primary w-full">
              {savingPassword ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}

        {tab === 'settings' && (
          <div className="space-y-4">
            <div className="ticket p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-sm text-ink">Email notifications</p>
                <p className="text-xs text-slate mt-0.5">Booking updates and receipts</p>
              </div>
              <input
                type="checkbox"
                checked={notifications.email}
                onChange={(e) => setNotifications((n) => ({ ...n, email: e.target.checked }))}
                className="w-5 h-5 accent-marigold"
              />
            </div>
            <div className="ticket p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-sm text-ink">SMS notifications</p>
                <p className="text-xs text-slate mt-0.5">Reminders for upcoming bookings</p>
              </div>
              <input
                type="checkbox"
                checked={notifications.sms}
                onChange={(e) => setNotifications((n) => ({ ...n, sms: e.target.checked }))}
                className="w-5 h-5 accent-marigold"
              />
            </div>
            <button onClick={logout} className="btn-outline w-full text-clay">
              Log out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
