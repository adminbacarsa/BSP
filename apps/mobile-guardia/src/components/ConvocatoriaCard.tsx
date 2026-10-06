import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CommandButton } from './ui/CommandButton';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import {
  CONVOCATORIA_ACCEPT_LABEL,
  CONVOCATORIA_REJECT_LABEL,
  LLEGADA_TARDE_ETA_OPTIONS,
  lugarLinea,
  remainingLabel,
  type ConvocatoriaCardModel,
  type LlegadaTardeEtaMinutes,
} from '../lib/convocatoriaCard';
import { formatCuandoDesdePartes } from '../lib/fechaTurno';

export type ConvocatoriaCardProps = {
  model: ConvocatoriaCardModel;
  nowMs: number;
  /** Esta tarjeta está enviando. */
  busy?: boolean;
  /** Otra tarjeta está enviando: se bloquea para no responder dos a la vez. */
  disabled?: boolean;
  highlighted?: boolean;
  /** Estado cerrado (Aceptada / Rechazada / Vencida…): reemplaza los botones. */
  closedLabel?: string | null;
  /** Línea chica arriba (p. ej. «Recibida 05/10/2026 15:58»). */
  metaLine?: string | null;
  onAccept?: () => void;
  onReject?: () => void;
  onSiVoy?: (etaMinutes: LlegadaTardeEtaMinutes) => void;
  onNoVoy?: () => void;
  /** Botones extra (Quitar, Ver convocatoria…) debajo de los principales. */
  extraActions?: ReactNode;
  testID?: string;
};

const TONE = {
  COBERTURA: { border: '#D32F2F', pill: '#D32F2F', bg: 'rgba(211, 47, 47, 0.06)' },
  EVENTO: { border: '#d97706', pill: '#d97706', bg: 'rgba(217, 119, 6, 0.08)' },
  VENIS: { border: '#f59e0b', pill: '#b45309', bg: 'rgba(245, 158, 11, 0.08)' },
  RETENCION: { border: '#b91c1c', pill: '#b91c1c', bg: 'rgba(185, 28, 28, 0.06)' },
  DISPONIBILIDAD: { border: '#4f46e5', pill: '#4f46e5', bg: 'rgba(79, 70, 229, 0.08)' },
} as const;

/**
 * Tarjeta única de convocatoria (Hoy y Alertas): cobertura, evento, ¿Venís? y
 * aviso de retenido. Los textos salen de `buildXCardModel` (lib/convocatoriaCard).
 */
export function ConvocatoriaCard({
  model,
  nowMs,
  busy = false,
  disabled = false,
  highlighted = false,
  closedLabel = null,
  metaLine = null,
  onAccept,
  onReject,
  onSiVoy,
  onNoVoy,
  extraActions,
  testID,
}: ConvocatoriaCardProps) {
  const { palette } = useTheme();
  const tone = TONE[model.kind];
  const remain = closedLabel ? '' : remainingLabel(model.timeoutAtMs, nowMs);
  const lugar = lugarLinea({ cliente: model.cliente, objetivo: model.objetivo, puesto: null });
  const cuando =
    formatCuandoDesdePartes(model.fecha, model.horario, new Date(nowMs)) ||
    [model.fecha, model.horario].filter(Boolean).join(' · ');
  const blocked = busy || disabled;

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: highlighted ? tone.bg : palette.card,
          borderColor: highlighted ? tone.border : palette.cardBorder,
        },
      ]}
    >
      <View style={styles.topRow}>
        <View style={styles.kickerRow}>
          <Text style={[styles.kicker, { color: tone.pill }]}>{model.kicker}</Text>
          {model.tipo ? (
            <View style={[styles.typePill, { backgroundColor: tone.pill }]}>
              <Text style={styles.typePillText}>{model.tipo}</Text>
            </View>
          ) : null}
        </View>
        {remain ? <Text style={[styles.remain, { color: palette.warning }]}>{remain}</Text> : null}
      </View>

      {metaLine ? <Text style={[styles.meta, { color: palette.onSurfaceMuted }]}>{metaLine}</Text> : null}

      <Text style={[styles.title, { color: palette.onSurface }]}>{model.title}</Text>
      <Text style={[styles.message, { color: palette.onSurfaceMuted }]}>{model.message}</Text>

      {lugar || model.puesto || cuando || model.codigo ? (
        <View style={[styles.detailBox, { backgroundColor: palette.inputBg, borderColor: palette.cardBorder }]}>
          {lugar ? (
            <Text style={[styles.detailStrong, { color: palette.onSurface }]} numberOfLines={2}>
              {lugar}
            </Text>
          ) : null}
          {model.puesto ? (
            <Text style={[styles.detailLine, { color: palette.onSurface }]}>{model.puesto}</Text>
          ) : null}
          {cuando ? <Text style={[styles.detailLine, { color: palette.onSurface }]}>{cuando}</Text> : null}
          {model.detalle?.map((linea, i) => (
            <Text key={`${i}-${linea}`} style={[styles.detailLine, { color: palette.onSurface }]}>{linea}</Text>
          ))}
          {model.codigo ? (
            <Text style={[styles.detailLine, { color: palette.onSurfaceMuted }]}>Código {model.codigo}</Text>
          ) : null}
        </View>
      ) : null}

      {closedLabel ? (
        <Text style={[styles.closed, { color: palette.onSurface }]}>{closedLabel}</Text>
      ) : model.actions === 'ACCEPT_REJECT' ? (
        <View style={styles.rowBtns}>
          <CommandButton
            label={busy ? 'Enviando…' : (model.acceptLabel || CONVOCATORIA_ACCEPT_LABEL)}
            variant="success"
            onPress={onAccept}
            disabled={blocked || !onAccept}
            loading={busy}
            style={styles.btnFlex}
          />
          <CommandButton
            label={busy ? 'Enviando…' : (model.rejectLabel || CONVOCATORIA_REJECT_LABEL)}
            variant="danger"
            onPress={onReject}
            disabled={blocked || !onReject}
            loading={busy}
            style={styles.btnFlex}
          />
        </View>
      ) : model.actions === 'VENIS' ? (
        <>
          <Text style={[styles.etaLabel, { color: palette.onSurfaceMuted }]}>Sí voy · demora</Text>
          <View style={styles.rowBtns}>
            {LLEGADA_TARDE_ETA_OPTIONS.map((mins) => (
              <CommandButton
                key={mins}
                label={`${mins} min`}
                variant="success"
                onPress={() => onSiVoy?.(mins)}
                disabled={blocked || !onSiVoy}
                loading={busy}
                style={styles.btnFlex}
              />
            ))}
          </View>
          <CommandButton
            label="Tengo un problema"
            variant="secondary"
            onPress={onNoVoy}
            disabled={blocked || !onNoVoy}
          />
        </>
      ) : null}

      {extraActions ? <View style={styles.rowBtns}>{extraActions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  typePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  typePillText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  remain: {
    fontSize: 12,
    fontWeight: '800',
  },
  meta: {
    fontSize: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
  },
  message: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  detailBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
    gap: 2,
  },
  detailStrong: {
    fontSize: 15,
    fontWeight: '800',
  },
  detailLine: {
    fontSize: 14,
    lineHeight: 20,
  },
  closed: {
    fontSize: 14,
    fontWeight: '800',
  },
  etaLabel: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  rowBtns: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  btnFlex: {
    flex: 1,
  },
});
