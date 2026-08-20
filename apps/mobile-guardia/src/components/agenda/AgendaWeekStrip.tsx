import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AGENDA_WEEKDAY_LABELS, toDateKey, type MonthCell } from '../../lib/agendaCalendar';
import { radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

type Props = {
  days: Date[];
  cellsByKey: Record<string, MonthCell | undefined>;
  selectedKey: string;
  onSelectDay: (key: string) => void;
};

export function AgendaWeekStrip({ days, cellsByKey, selectedKey, onSelectDay }: Props) {
  const { palette } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {days.map((date, idx) => {
        const key = toDateKey(date);
        const cell = cellsByKey[key];
        const selected = key === selectedKey;
        const codes = cell?.codes ?? [];
        const accent = cell?.hasEv
          ? palette.warning
          : cell?.hasWork
            ? palette.primary
            : cell?.hasFranco
              ? palette.success
              : palette.outline;

        return (
          <Pressable
            key={key}
            onPress={() => onSelectDay(key)}
            style={[
              styles.dayCard,
              {
                backgroundColor: selected ? palette.primary : palette.card,
                borderColor: selected ? palette.primary : palette.cardBorder,
              },
            ]}
          >
            <Text
              style={[
                styles.weekday,
                { color: selected ? palette.onPrimary : palette.onSurfaceMuted },
              ]}
            >
              {AGENDA_WEEKDAY_LABELS[idx]}
            </Text>
            <Text
              style={[
                styles.dayNum,
                { color: selected ? palette.onPrimary : palette.onSurface },
              ]}
            >
              {date.getDate()}
            </Text>
            <Text
              style={[styles.codes, { color: selected ? palette.onPrimary : accent }]}
              numberOfLines={1}
            >
              {codes.length > 0 ? codes.join(' ') : '—'}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 4, paddingRight: 8 },
  dayCard: {
    width: 72,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 4,
  },
  weekday: { fontSize: 11, fontWeight: '800' },
  dayNum: { fontSize: 20, fontWeight: '900' },
  codes: { fontSize: 10, fontWeight: '800' },
});
