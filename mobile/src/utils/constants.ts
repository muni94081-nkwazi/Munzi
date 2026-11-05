export const CATEGORIES = [
  { value: 'cleaning', label: 'Cleaning', emoji: '🧹' },
  { value: 'plumbing', label: 'Plumbing', emoji: '🔧' },
  { value: 'tutoring', label: 'Tutoring', emoji: '📚' },
  { value: 'beauty', label: 'Beauty & Salon', emoji: '💇' },
  { value: 'electrical', label: 'Electrical', emoji: '💡' },
  { value: 'home-repair', label: 'Home Repair', emoji: '🛠️' },
  { value: 'fitness', label: 'Fitness Training', emoji: '🏋️' },
  { value: 'photography', label: 'Photography', emoji: '📷' },
] as const;

export const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
] as const;

export function buildSlots(startTime: string, endTime: string, stepMinutes = 30): string[] {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  const slots: string[] = [];
  for (let t = start; t + stepMinutes <= end; t += stepMinutes) {
    const h = String(Math.floor(t / 60)).padStart(2, '0');
    const m = String(t % 60).padStart(2, '0');
    slots.push(`${h}:${m}`);
  }
  return slots;
}
