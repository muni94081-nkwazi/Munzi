import { useState } from 'react';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Calendar
 * @param {string} selectedDate - "YYYY-MM-DD" or null
 * @param {(dateKey: string) => void} onSelect
 * @param {number[]} availableDays - day-of-week indices (0=Sun..6=Sat) that are bookable;
 *                                   if omitted, every day is selectable.
 * @param {boolean} disablePast - disable dates before today (default true)
 */
export default function Calendar({ selectedDate, onSelect, availableDays, disablePast = true }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [viewDate, setViewDate] = useState(() => {
    const d = selectedDate ? new Date(selectedDate) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const startOffset = firstDayOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));

  const goPrevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const goNextMonth = () => setViewDate(new Date(year, month + 1, 1));

  return (
    <div className="ticket p-4 select-none">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={goPrevMonth}
          aria-label="Previous month"
          className="w-8 h-8 rounded-md hover:bg-linen flex items-center justify-center text-ink"
        >
          ‹
        </button>
        <span className="font-display font-semibold text-sm">
          {MONTH_NAMES[month]} {year}
        </span>
        <button
          onClick={goNextMonth}
          aria-label="Next month"
          className="w-8 h-8 rounded-md hover:bg-linen flex items-center justify-center text-ink"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate mb-1.5">
        {WEEKDAY_LABELS.map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const key = toDateKey(date);
          const isPast = disablePast && date < today;
          const isAvailableDay = !availableDays || availableDays.includes(date.getDay());
          const isDisabled = isPast || !isAvailableDay;
          const isSelected = key === selectedDate;

          return (
            <button
              key={key}
              disabled={isDisabled}
              onClick={() => onSelect(key)}
              className={`h-9 rounded-md text-sm font-mono transition ${
                isSelected
                  ? 'bg-marigold text-ink font-semibold'
                  : isDisabled
                  ? 'text-ink/20 cursor-not-allowed'
                  : 'hover:bg-linen text-ink'
              }`}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
