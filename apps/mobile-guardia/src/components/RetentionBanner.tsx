import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  objectiveName: string;
};

/** Aviso fijo: retenido en puesto esperando relevo (sin contador). */
export function RetentionBanner({ objectiveName }: Props) {
  const { palette } = useTheme();
  const place = (objectiveName || '').trim() || 'tu puesto';

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: 'rgba(234, 88, 12, 0.1)',
          borderColor: '#fdba74',
        },
      ]}
    >
      <Text style={[styles.kicker, { color: '#c2410c' }]}>Retención</Text>
      <Text style={[styles.title, { color: palette.onSurface }]}>
        Estás retenido en {place} · esperá al relevo
      </Text>
      <Text style={[styles.sub, { color: palette.onSurfaceMuted }]}>
        No podés rechazar la retención. Operaciones te liberará cuando llegue el relevo.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: 6,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 22,
  },
  sub: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
