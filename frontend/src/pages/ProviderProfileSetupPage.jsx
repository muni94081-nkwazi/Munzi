import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { providerApi } from '../api/providers';
import { serviceApi } from '../api/services';
import { availabilityApi } from '../api/availability';
import { CATEGORIES, DAYS_OF_WEEK } from '../utils/constants';
import { validateServiceForm } from '../utils/validators';

const emptyService = { title: '', price: '', duration: '' };
const emptyWindow = { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' };

export default function ProviderProfileSetupPage() {
  const { updateProfile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');

  const [business, setBusiness] = useState({ businessName: '', category: CATEGORIES[0].value, description: '' });
  const [imagePreview, setImagePreview] = useState(null);
  const [services, setServices] = useState([{ ...emptyService }]);
  const [serviceErrors, setServiceErrors] = useState([]);
  const [windows, setWindows] = useState([{ ...emptyWindow }]);

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (file) setImagePreview(URL.createObjectURL(file));
  };

  const updateService = (index, field, value) => {
    setServices((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };
  const addService = () => setServices((prev) => [...prev, { ...emptyService }]);
  const removeService = (index) => setServices((prev) => prev.filter((_, i) => i !== index));

  const updateWindow = (index, field, value) => {
    setWindows((prev) => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)));
  };
  const addWindow = () => setWindows((prev) => [...prev, { ...emptyWindow }]);
  const removeWindow = (index) => setWindows((prev) => prev.filter((_, i) => i !== index));

  const goToServices = (e) => {
    e.preventDefault();
    if (!business.businessName.trim()) {
      setApiError('Enter your business name to continue.');
      return;
    }
    setApiError('');
    setStep(2);
  };

  const goToAvailability = (e) => {
    e.preventDefault();
    const errs = services.map((s) => validateServiceForm(s));
    setServiceErrors(errs);
    if (errs.some((e2) => Object.keys(e2).length > 0)) return;
    setStep(3);
  };

  const handleFinish = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setApiError('');
    try {
      const { data } = await providerApi.updateMe(business);
      updateProfile(data);

      for (const s of services) {
        if (s.title.trim()) {
          await serviceApi.create({
            title: s.title,
            price: Number(s.price),
            durationMinutes: Number(s.duration),
          });
        }
      }

      for (const w of windows) {
        await availabilityApi.create({
          dayOfWeek: Number(w.dayOfWeek),
          startTime: w.startTime,
          endTime: w.endTime,
        });
      }

      showToast('Your provider profile is ready!');
      navigate('/provider/dashboard');
    } catch (err) {
      setApiError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const steps = ['Business info', 'Services', 'Availability'];

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Set up your provider profile</h1>
      <p className="text-slate text-sm mt-1.5">Customers will see this when they search for services near them.</p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mt-6 mb-8">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2 flex-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-semibold shrink-0 ${
                step > i + 1 ? 'bg-forest text-white' : step === i + 1 ? 'bg-marigold text-ink' : 'bg-white border border-ink/15 text-slate'
              }`}
            >
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span className="text-xs text-slate hidden sm:inline">{label}</span>
            {i < steps.length - 1 && <div className="flex-1 h-px bg-ink/10" />}
          </div>
        ))}
      </div>

      {apiError && <p className="error-text mb-4">{apiError}</p>}

      {step === 1 && (
        <form onSubmit={goToServices} className="space-y-4">
          <div>
            <label className="label-text">Profile photo</label>
            <div className="flex items-center gap-4">
              <img
                src={imagePreview || 'https://api.dicebear.com/7.x/initials/svg?seed=Provider'}
                alt=""
                className="w-16 h-16 rounded-full object-cover bg-linen border border-ink/10"
              />
              <label className="btn-outline text-sm cursor-pointer">
                Upload photo
                <input type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
              </label>
            </div>
          </div>

          <div>
            <label className="label-text" htmlFor="businessName">
              Business name
            </label>
            <input
              id="businessName"
              className="input-field"
              value={business.businessName}
              onChange={(e) => setBusiness((b) => ({ ...b, businessName: e.target.value }))}
              placeholder="Jane's Beauty Studio"
            />
          </div>

          <div>
            <label className="label-text" htmlFor="category">
              Category
            </label>
            <select
              id="category"
              className="input-field"
              value={business.category}
              onChange={(e) => setBusiness((b) => ({ ...b, category: e.target.value }))}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-text" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              rows={4}
              className="input-field"
              value={business.description}
              onChange={(e) => setBusiness((b) => ({ ...b, description: e.target.value }))}
              placeholder="Tell customers what makes your service great."
            />
          </div>

          <button type="submit" className="btn-primary w-full">
            Continue to services
          </button>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={goToServices ? goToAvailability : undefined} className="space-y-5">
          {services.map((s, i) => (
            <div key={i} className="ticket p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-display font-semibold text-sm">Service {i + 1}</span>
                {services.length > 1 && (
                  <button type="button" onClick={() => removeService(i)} className="text-clay text-sm">
                    Remove
                  </button>
                )}
              </div>
              <div>
                <label className="label-text">Title</label>
                <input
                  className="input-field"
                  value={s.title}
                  onChange={(e) => updateService(i, 'title', e.target.value)}
                  placeholder="Haircut & Styling"
                />
                {serviceErrors[i]?.title && <p className="error-text">{serviceErrors[i].title}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text">Price (UGX)</label>
                  <input
                    type="number"
                    min="0"
                    className="input-field"
                    value={s.price}
                    onChange={(e) => updateService(i, 'price', e.target.value)}
                    placeholder="30000"
                  />
                  {serviceErrors[i]?.price && <p className="error-text">{serviceErrors[i].price}</p>}
                </div>
                <div>
                  <label className="label-text">Duration (min)</label>
                  <input
                    type="number"
                    min="0"
                    className="input-field"
                    value={s.duration}
                    onChange={(e) => updateService(i, 'duration', e.target.value)}
                    placeholder="60"
                  />
                  {serviceErrors[i]?.duration && <p className="error-text">{serviceErrors[i].duration}</p>}
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addService} className="btn-outline w-full text-sm">
            + Add another service
          </button>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(1)} className="btn-outline flex-1">
              Back
            </button>
            <button type="button" onClick={goToAvailability} className="btn-primary flex-1">
              Continue to availability
            </button>
          </div>
        </form>
      )}

      {step === 3 && (
        <form onSubmit={handleFinish} className="space-y-5">
          {windows.map((w, i) => (
            <div key={i} className="ticket p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-display font-semibold text-sm">Availability {i + 1}</span>
                {windows.length > 1 && (
                  <button type="button" onClick={() => removeWindow(i)} className="text-clay text-sm">
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label-text">Day</label>
                  <select
                    className="input-field"
                    value={w.dayOfWeek}
                    onChange={(e) => updateWindow(i, 'dayOfWeek', e.target.value)}
                  >
                    {DAYS_OF_WEEK.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label-text">From</label>
                  <input
                    type="time"
                    className="input-field"
                    value={w.startTime}
                    onChange={(e) => updateWindow(i, 'startTime', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label-text">To</label>
                  <input
                    type="time"
                    className="input-field"
                    value={w.endTime}
                    onChange={(e) => updateWindow(i, 'endTime', e.target.value)}
                  />
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addWindow} className="btn-outline w-full text-sm">
            + Add another time window
          </button>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(2)} className="btn-outline flex-1">
              Back
            </button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1">
              {submitting ? 'Saving…' : 'Finish setup'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
