import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AgendaViewMode } from '../../lib/agendaCalendar';
import { radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

const OPTIONS: { id: AgendaViewMode; label: string }[] = [
  { id: 'day', label: 'Día' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
];

type Props = {
  mode: AgendaViewMode;
  onChange: (mode: AgendaViewMode) => void;
};

export function AgendaViewSwitcher({ mode, onChange }: Props) {
  const { palette } = useTheme();

  return (
    <View style={[styles.row, { backgroundColor: palette.inputBg, borderColor: palette.cardBorder }]}>
      {OPTIONS.map((opt) => {
        const active = mode === opt.id;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onChange(opt.id)}
            style={[
              styles.btn,
              active && { backgroundColor: palette.primary },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[
                styles.label,
                { color: active ? palette.onPrimary : palette.onSurfaceMuted },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  label: { fontSize: 13, fontWeight: '800' },
});
