import { StyleSheet, Text, View } from 'react-native';
import type { ObjectiveLocation, Shift } from '@cosp/portal-types';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import type { ConvocatoriaCobertura } from '../lib/convocatoriasCobertura';
import { buildVenisCardModel, type LlegadaTardeEtaMinutes } from '../lib/convocatoriaCard';
import { ConvocatoriaCard } from './ConvocatoriaCard';

export { LLEGADA_TARDE_ETA_OPTIONS, type LlegadaTardeEtaMinutes } from '../lib/convocatoriaCard';

type Props = {
  convocatorias: ConvocatoriaCobertura[];
  shifts?: Shift[];
  objectivesMap?: Record<string, ObjectiveLocation>;
  busyId?: string | null;
  bodyByConvocatoriaId?: Record<string, string>;
  firstName?: string | null;
  onSiVoy: (c: ConvocatoriaCobertura, etaMinutes: LlegadaTardeEtaMinutes) => void;
  onNoVoy: (c: ConvocatoriaCobertura) => void;
};

/**
 * «¿Venís?» para convocatoria LLEGADA_TARDE (aviso ENTRANTE del CC).
 * 10 / 15 / 30 min → ACCEPTED. Tengo un problema → REJECTED (el CC lo ve).
 */
export function LlegadaTardeVenisBanner({
  convocatorias,
  shifts = [],
  objectivesMap = {},
  busyId,
  bodyByConvocatoriaId = {},
  firstName,
  onSiVoy,
  onNoVoy,
}: Props) {
  const { palette } = useTheme();
  if (convocatorias.length === 0) return null;
  const nowMs = Date.now();

  return (
    <View style={[styles.wrap, { backgroundColor: palette.card, borderColor: '#f59e0b' }]}>
      <Text style={[styles.kicker, { color: '#b45309' }]}>Llegada tarde</Text>
      <Text style={[styles.hint, { color: palette.onSurfaceMuted }]}>
        Respondé en 10, 15 o 30 min, o avisá si tenés un problema. Operaciones lo ve en el momento.
      </Text>

      {convocatorias.map((c) => (
        <ConvocatoriaCard
          key={c.id}
          model={buildVenisCardModel({
            conv: c,
            firstName,
            shifts,
            objectivesMap,
            body: bodyByConvocatoriaId[c.id],
          })}
          nowMs={nowMs}
          busy={busyId === c.id}
          disabled={!!busyId}
          highlighted
          onSiVoy={(mins) => onSiVoy(c, mins)}
          onNoVoy={() => onNoVoy(c)}
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
  hint: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
