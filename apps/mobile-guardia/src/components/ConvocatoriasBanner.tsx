import { StyleSheet, Text, View } from 'react-native';
import type { Evento, SolicitudEvento } from '@cosp/portal-types';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { buildEventoCardModel } from '../lib/convocatoriaCard';
import { ConvocatoriaCard } from './ConvocatoriaCard';

type Props = {
  convocatorias: SolicitudEvento[];
  busyId?: string | null;
  firstName?: string | null;
  eventosMap?: Record<string, Evento>;
  onAccept: (sol: SolicitudEvento) => void;
  onReject: (sol: SolicitudEvento) => void;
};

/** Convocatorias a eventos pendientes en Hoy: una `ConvocatoriaCard` por cada una. */
export function ConvocatoriasBanner({ convocatorias, busyId, firstName, eventosMap = {}, onAccept, onReject }: Props) {
  const { palette } = useTheme();
  if (convocatorias.length === 0) return null;
  const nowMs = Date.now();

  return (
    <View style={[styles.wrap, { backgroundColor: palette.card, borderColor: palette.warning }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.kicker, { color: palette.warning }]}>Convocatorias</Text>
        <View style={[styles.countPill, { backgroundColor: palette.warning }]}>
          <Text style={styles.countText}>{convocatorias.length}</Text>
        </View>
      </View>

      {convocatorias.map((sol) => {
        const model = buildEventoCardModel({ sol, firstName, eventosMap });
        return (
          <ConvocatoriaCard
            key={model.id}
            model={model}
            nowMs={nowMs}
            busy={busyId === sol.id}
            disabled={!!busyId}
            onAccept={() => onAccept(sol)}
            onReject={() => onReject(sol)}
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
    color: '#422006',
    fontSize: 11,
    fontWeight: '900',
  },
});
