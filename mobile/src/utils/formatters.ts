export function formatCurrency(amount?: number): string {
  const value = Number(amount) || 0;
  return `UGX ${value.toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatTime(timeStr?: string): string {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = Number(h);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${m} ${period}`;
}

export function formatDuration(minutes?: number): string {
  const mins = Number(minutes) || 0;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}
