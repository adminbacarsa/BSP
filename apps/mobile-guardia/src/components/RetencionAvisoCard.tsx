import { StyleSheet, Text, View } from 'react-native';
import type { ObjectiveLocation, Shift } from '@cosp/portal-types';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { buildRetencionCardModel, type RetencionCardInput } from '../lib/convocatoriaCard';
import { ConvocatoriaCard } from './ConvocatoriaCard';

type Props = {
  avisos: RetencionCardInput['aviso'][];
  shifts?: Shift[];
  objectivesMap?: Record<string, ObjectiveLocation>;
};

/** RETENCION_AVISO: el CC avisa que seguís retenido. No se responde. */
export function RetencionAvisoCard({ avisos, shifts = [], objectivesMap = {} }: Props) {
  const { palette } = useTheme();
  if (avisos.length === 0) return null;
  const nowMs = Date.now();

  return (
    <View style={[styles.wrap, { backgroundColor: palette.card, borderColor: '#b91c1c' }]}>
      <Text style={[styles.kicker, { color: '#b91c1c' }]}>Retención</Text>
      {avisos.map((n) => (
        <ConvocatoriaCard
          key={n.id}
          model={buildRetencionCardModel({ aviso: n, shifts, objectivesMap })}
          nowMs={nowMs}
          highlighted
        />
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
});
