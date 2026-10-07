import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { CommandButton } from './ui/CommandButton';
import { aMs, horaAr } from '../lib/retencionTarjeta';

type Props = {
  texto: string;
  acuseAt?: unknown;
  busy?: boolean;
  onEntendido: () => void;
};

/** Retención viva del turno. No se rechaza. */
export function RetencionAvisoCard({ texto, acuseAt, busy, onEntendido }: Props) {
  const { palette } = useTheme();
  const acuseMs = aMs(acuseAt);

  return (
    <View style={[styles.wrap, { backgroundColor: palette.card, borderColor: '#b91c1c' }]} testID="retencion-turno-card">
      <Text style={[styles.kicker, { color: '#b91c1c' }]}>Retención</Text>
      <Text style={[styles.body, { color: palette.onSurface }]}>{texto}</Text>
      {acuseMs > 0 ? (
        <Text style={[styles.acuse, { color: palette.onSurfaceMuted }]} testID="retencion-acuse">
          Entendido · {horaAr(acuseMs)}
        </Text>
      ) : (
        <CommandButton
          label="Entendido"
          variant="secondary"
          loading={busy}
          disabled={busy}
          onPress={onEntendido}
          testID="retencion-entendido"
        />
      )}
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
  body: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
  },
  acuse: {
    fontSize: 13,
    fontWeight: '600',
  },
});
