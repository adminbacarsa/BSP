import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ObjectiveLocation, Shift } from '@cosp/portal-types';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import type { ConvocatoriaCobertura } from '../lib/convocatoriasCobertura';
import { resolveAlertaCard } from '../lib/alertaCardState';
import { buildCoberturaCardModel } from '../lib/convocatoriaCard';
import { ConvocatoriaCard } from './ConvocatoriaCard';

type Props = {
  convocatorias: ConvocatoriaCobertura[];
  busyId?: string | null;
  highlightedId?: string | null;
  /** Primer nombre del guardia para el mensaje («Laura, ¿nos das una mano?…»). */
  firstName?: string | null;
  shifts?: Shift[];
  objectivesMap?: Record<string, ObjectiveLocation>;
  onAccept: (c: ConvocatoriaCobertura) => void;
  onReject: (c: ConvocatoriaCobertura) => void;
};

/** Convocatorias de cobertura pendientes en Hoy: una `ConvocatoriaCard` por cada una. */
export function CoberturaConvocatoriasBanner({
  convocatorias,
  busyId,
  highlightedId,
  firstName,
  shifts = [],
  objectivesMap = {},
  onAccept,
  onReject,
}: Props) {
  const { palette } = useTheme();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (convocatorias.length === 0) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: palette.card, borderColor: palette.primary }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.kicker, { color: palette.primary }]}>Cobertura</Text>
        <View style={[styles.countPill, { backgroundColor: palette.primary }]}>
          <Text style={styles.countText}>{convocatorias.length}</Text>
        </View>
      </View>

      {convocatorias.map((c) => {
        const card = resolveAlertaCard({
          type: 'CONVOCATORIA_COBERTURA',
          conv: c,
          endTime: c.endTime,
          timeoutAt: c.timeoutAt,
          nowMs: now.getTime(),
        });
        const model = buildCoberturaCardModel({ conv: c, firstName, shifts, objectivesMap });
        return (
          <ConvocatoriaCard
            key={c.id}
            model={model}
            nowMs={now.getTime()}
            busy={busyId === c.id}
            disabled={!!busyId}
            highlighted={highlightedId === c.id}
            closedLabel={card.showCoverageButtons ? null : card.label || 'Vencida'}
            onAccept={() => onAccept(c)}
            onReject={() => onReject(c)}
          />
        );
      })}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  countPill: {
    minWidth: 22,
    height: 22,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
});
