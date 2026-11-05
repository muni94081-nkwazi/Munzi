import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius } from '../theme/theme';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function Calendar({
  selectedDate,
  onSelect,
}: {
  selectedDate: string | null;
  onSelect: (dateKey: string) => void;
}) {
  const { colors } = useTheme();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [viewDate, setViewDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const startOffset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));

  return (
    <View style={{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
        <TouchableOpacity onPress={() => setViewDate(new Date(year, month - 1, 1))} style={{ padding: 8 }}>
          <Text style={{ color: colors.ink, fontSize: 16 }}>‹</Text>
        </TouchableOpacity>
        <Text style={{ color: colors.ink, fontWeight: '700' }}>
          {MONTH_NAMES[month]} {year}
        </Text>
        <TouchableOpacity onPress={() => setViewDate(new Date(year, month + 1, 1))} style={{ padding: 8 }}>
          <Text style={{ color: colors.ink, fontSize: 16 }}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row' }}>
        {WEEKDAY_LABELS.map((d, i) => (
          <Text key={i} style={{ flex: 1, textAlign: 'center', color: colors.slate, fontSize: 11 }}>
            {d}
          </Text>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
        {cells.map((date, i) => {
          if (!date) return <View key={i} style={{ width: '14.28%', height: 36 }} />;
          const key = toDateKey(date);
          const isPast = date < today;
          const isSelected = key === selectedDate;
          return (
            <TouchableOpacity
              key={key}
              disabled={isPast}
              onPress={() => onSelect(key)}
              style={{
                width: '14.28%',
                height: 36,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                backgroundColor: isSelected ? colors.marigold : 'transparent',
              }}
            >
              <Text style={{ color: isPast ? colors.border : isSelected ? colors.ink : colors.ink, fontSize: 13, fontWeight: isSelected ? '700' : '400' }}>
                {date.getDate()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
