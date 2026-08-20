import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  AGENDA_WEEKDAY_LABELS,
  type MonthCell,
} from '../../lib/agendaCalendar';
import { radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

type Props = {
  cells: MonthCell[];
  selectedKey: string;
  onSelectDay: (key: string) => void;
};

export function AgendaMonthGrid({ cells, selectedKey, onSelectDay }: Props) {
  const { palette } = useTheme();

  return (
    <View style={[styles.wrap, { backgroundColor: palette.card, borderColor: palette.cardBorder }]}>
      <View style={styles.weekHeader}>
        {AGENDA_WEEKDAY_LABELS.map((label) => (
          <Text key={label} style={[styles.weekHeaderText, { color: palette.onSurfaceMuted }]}>
            {label}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((cell) => {
          const selected = cell.key === selectedKey;
          const accent = cell.hasEv
            ? palette.warning
            : cell.hasWork
              ? palette.primary
              : cell.hasFranco
                ? palette.success
                : 'transparent';

          return (
            <Pressable
              key={cell.key}
              onPress={() => onSelectDay(cell.key)}
              style={[
                styles.cell,
                selected && {
                  backgroundColor: palette.primaryContainer,
                  borderColor: palette.primary,
                },
                cell.isToday && !selected && { borderColor: palette.primary },
              ]}
            >
              <Text
                style={[
                  styles.dayNum,
                  {
                    color: !cell.inCurrentMonth
                      ? palette.outline
                      : selected
                        ? palette.onPrimary
                        : palette.onSurface,
                    fontWeight: cell.isToday || selected ? '900' : '700',
                  },
                ]}
              >
                {cell.date.getDate()}
              </Text>
              <View style={styles.codesRow}>
                {cell.codes.length > 0 ? (
                  cell.codes.map((code) => (
                    <Text
                      key={`${cell.key}-${code}`}
                      style={[
                        styles.code,
                        {
                          color: selected ? palette.onPrimary : accent !== 'transparent' ? accent : palette.onSurfaceMuted,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {code}
                    </Text>
                  ))
                ) : (
                  <View style={styles.codePlaceholder} />
                )}
              </View>
              {(cell.hasWork || cell.hasFranco || cell.hasEv) && !selected ? (
                <View style={[styles.dot, { backgroundColor: accent }]} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 10,
    marginBottom: 12,
  },
  weekHeader: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  weekHeaderText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '800',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    minHeight: 54,
    paddingVertical: 4,
    paddingHorizontal: 2,
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayNum: { fontSize: 13 },
  codesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 2,
    minHeight: 14,
    marginTop: 2,
  },
  code: { fontSize: 8, fontWeight: '900' },
  codePlaceholder: { height: 10 },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 2,
  },
});
