import { formatTime } from '../utils/formatters';

/**
 * Builds slots (e.g. every `stepMinutes`) between startTime and endTime.
 * Times are "HH:mm" strings, e.g. "09:00".
 */
export function buildSlots(startTime, endTime, stepMinutes = 30) {
  if (!startTime || !endTime) return [];
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  const slots = [];
  for (let t = start; t + stepMinutes <= end; t += stepMinutes) {
    const h = String(Math.floor(t / 60)).padStart(2, '0');
    const m = String(t % 60).padStart(2, '0');
    slots.push(`${h}:${m}`);
  }
  return slots;
}

/**
 * TimeSlotPicker
 * @param {string[]} slots - "HH:mm" values available for the selected date
 * @param {string[]} bookedSlots - "HH:mm" values already taken
 * @param {string} selected
 * @param {(slot: string) => void} onSelect
 */
export default function TimeSlotPicker({ slots, bookedSlots = [], selected, onSelect }) {
  if (!slots || slots.length === 0) {
    return <p className="text-sm text-slate">No time slots available for this date. Try another day.</p>;
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {slots.map((slot) => {
        const isBooked = bookedSlots.includes(slot);
        const isSelected = selected === slot;
        return (
          <button
            key={slot}
            disabled={isBooked}
            onClick={() => onSelect(slot)}
            className={`font-mono text-sm py-2 rounded-md border transition ${
              isSelected
                ? 'bg-marigold border-marigold text-ink font-semibold'
                : isBooked
                ? 'border-ink/10 text-ink/20 cursor-not-allowed line-through'
                : 'border-ink/15 hover:border-ink/40 text-ink'
            }`}
          >
            {formatTime(slot)}
          </button>
        );
      })}
    </div>
  );
}
