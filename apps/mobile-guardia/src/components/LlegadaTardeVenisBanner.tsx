import { StyleSheet, Text, View } from 'react-native';
import { formatTimeAr } from '@cosp/portal-core';
import type { ObjectiveLocation, Shift } from '@cosp/portal-types';
import { CommandButton } from './ui/CommandButton';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import type { ConvocatoriaCobertura } from '../lib/convocatoriasCobertura';
import { llegadaTardePlaceLabel } from '../lib/llegadaTardePlace';
import { avisoEntranteTexto } from '../lib/avisosCc';

export const LLEGADA_TARDE_ETA_OPTIONS = [10, 15, 30] as const;
export type LlegadaTardeEtaMinutes = (typeof LLEGADA_TARDE_ETA_OPTIONS)[number];

type Props = {
  convocatorias: ConvocatoriaCobertura[];
  shifts?: Shift[];
  objectivesMap?: Record<string, ObjectiveLocation>;
  busyId?: string | null;
  bodyByConvocatoriaId?: Record<string, string>;
  onSiVoy: (c: ConvocatoriaCobertura, etaMinutes: LlegadaTardeEtaMinutes) => void;
  onNoVoy: (c: ConvocatoriaCobertura) => void;
};

/**
 * Tarjeta «¿Venís?» para convocatoria LLEGADA_TARDE (aviso ENTRANTE del CC).
 * 10 / 15 / 30 min → ACCEPTED. Tengo un problema → REJECTED (el CC lo ve).
 */
export function LlegadaTardeVenisBanner({
  convocatorias,
  shifts = [],
  objectivesMap = {},
  busyId,
  bodyByConvocatoriaId = {},
  onSiVoy,
  onNoVoy,
}: Props) {
  const { palette } = useTheme();
  if (convocatorias.length === 0) return null;

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: palette.card,
          borderColor: '#f59e0b',
        },
      ]}
    >
      <Text style={[styles.kicker, { color: '#b45309' }]}>Llegada tarde</Text>
      <Text style={[styles.headline, { color: palette.onSurface }]}>¿Venís?</Text>
      <Text style={[styles.hint, { color: palette.onSurfaceMuted }]}>
        Respondé en 10, 15 o 30 min, o avisá si tenés un problema. Operaciones lo ve en el momento.
      </Text>

      {convocatorias.map((c) => {
        const busy = busyId === c.id;
        const obj = llegadaTardePlaceLabel(c, shifts, objectivesMap);
        const start = formatTimeAr(c.startTime);

        return (
          <View
            key={c.id}
            style={[styles.item, { borderColor: '#fcd34d', backgroundColor: 'rgba(245, 158, 11, 0.08)' }]}
          >
            <Text style={[styles.title, { color: palette.onSurface }]} numberOfLines={4}>
              {avisoEntranteTexto({
                body: bodyByConvocatoriaId[c.id],
                objectiveName: obj,
              })}
            </Text>
            {start ? (
              <Text style={[styles.sub, { color: palette.onSurfaceMuted }]}>Inicio {start}</Text>
            ) : null}

            <Text style={[styles.etaLabel, { color: palette.onSurfaceMuted }]}>Sí voy · demora</Text>
            <View style={styles.etaRow}>
              {LLEGADA_TARDE_ETA_OPTIONS.map((mins) => (
                <CommandButton
                  key={mins}
                  label={`${mins} min`}
                  variant="success"
                  onPress={() => onSiVoy(c, mins)}
                  disabled={busy}
                  loading={busy}
                  style={styles.etaBtn}
                />
              ))}
            </View>
            <CommandButton
              label="Tengo un problema"
              variant="secondary"
              onPress={() => onNoVoy(c)}
              disabled={busy}
              style={styles.noBtn}
            />
          </View>
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
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headline: {
    fontSize: 22,
    fontWeight: '900',
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  item: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
  },
  sub: {
    fontSize: 13,
    fontWeight: '600',
  },
  etaLabel: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 2,
  },
  etaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  etaBtn: {
    flex: 1,
  },
  noBtn: {
    marginTop: 2,
  },
});
