export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPhone(phone) {
  return /^\+?[0-9\s-]{7,15}$/.test(phone);
}

export function validateSignupForm({ email, password, fullName, phone, role }) {
  const errors = {};
  if (!fullName || fullName.trim().length < 2) errors.fullName = 'Enter your full name.';
  if (!email || !isValidEmail(email)) errors.email = 'Enter a valid email address.';
  if (!password || password.length < 8) errors.password = 'Password must be at least 8 characters.';
  if (phone && !isValidPhone(phone)) errors.phone = 'Enter a valid phone number.';
  if (!role) errors.role = 'Select whether you are a provider or a customer.';
  return errors;
}

export function validateServiceForm({ title, price, duration }) {
  const errors = {};
  if (!title || title.trim().length < 2) errors.title = 'Enter a service title.';
  if (!price || Number(price) <= 0) errors.price = 'Enter a price greater than 0.';
  if (!duration || Number(duration) <= 0) errors.duration = 'Enter a duration in minutes.';
  return errors;
}

export function validateBookingForm({ date, time }) {
  const errors = {};
  if (!date) errors.date = 'Select a date.';
  if (!time) errors.time = 'Select a time slot.';
  return errors;
}
