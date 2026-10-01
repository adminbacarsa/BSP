import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

type Aviso = { id: string; title?: string; body?: string };

type Props = {
  avisos: Aviso[];
};

/** RETENCION_AVISO: el CC avisa que seguís retenido. No se responde. */
export function RetencionAvisoCard({ avisos }: Props) {
  const { palette } = useTheme();
  if (avisos.length === 0) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: palette.card, borderColor: '#b91c1c' }]}>
      <Text style={[styles.kicker, { color: '#b91c1c' }]}>Retención</Text>
      {avisos.map((n) => (
        <View
          key={n.id}
          style={[styles.item, { borderColor: '#fecaca', backgroundColor: 'rgba(185, 28, 28, 0.06)' }]}
        >
          <Text style={[styles.title, { color: palette.onSurface }]}>
            {n.title || 'Seguís retenido'}
          </Text>
          {n.body ? (
            <Text style={[styles.body, { color: palette.onSurfaceMuted }]}>{n.body}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: 10,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  item: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
    gap: 6,
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
});
