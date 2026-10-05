import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Shift } from '@cosp/portal-types';
import { Ionicons } from '@expo/vector-icons';
import { radius, shadow, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import type { ShiftPlacement } from '../../lib/shiftPlacement';
import { resolveShiftPlacement } from '../../lib/shiftPlacement';
import { useResponsiveLayout } from '../../hooks/useResponsiveLayout';
import {
  buildHeroShiftCardModel,
  HERO_FILETE,
  resolveHeroAccentColor,
  type HeroEvDisplay,
  type HeroShiftCardModel,
} from '../../lib/heroShiftCard';

const TZ = 'America/Argentina/Buenos_Aires';

function toDateLocal(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
  if (typeof val === 'object') {
    const o = val as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof o.toDate === 'function') return o.toDate();
    const seconds = o.seconds ?? o._seconds;
    if (typeof seconds === 'number') return new Date(seconds * 1000);
  }
  if (typeof val === 'number' || typeof val === 'string') {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatTimeArLocal(val: unknown): string {
  const d = toDateLocal(val);
  return d
    ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ })
    : '-';
}

function formatDateArLocal(val: unknown): string {
  const d = toDateLocal(val);
  return d ? d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ }) : '-';
}

type Props = {
  /** @deprecated el kicker sale del modelo; se usa como sectionBase. */
  headline?: string;
  /** @deprecated el horario sale de timeRange / modelo. */
  subline?: string;
  shift?: Shift;
  placement?: ShiftPlacement;
  objective?: ShiftPlacement['objectiveLocation'];
  sectionLabel?: string;
  isToday?: boolean;
  timeRange?: string | null;
  ev?: HeroEvDisplay | null;
  mapsUrl?: string | null;
  isRetention?: boolean;
  isConvocado?: boolean;
  empresaLabel?: string | null;
  /** Color de empresa (filete); si es claro se oscurece para AA. */
  accentColor?: string | null;
  footer?: ReactNode;
  statusSlot?: ReactNode;
};

function fileteColor(model: HeroShiftCardModel, accent: string): string {
  if (model.fileteTone === 'active') return accent;
  return HERO_FILETE[model.fileteTone] || accent;
}

/**
 * Tarjeta «Turno actual» de Hoy: fondo blanco (o card dark), filete de empresa,
 * horario grande, lugar una sola vez, estado de fichada destacado. Sin chips
 * repetidos ni «Cómo llegar» duplicado (el botón va en `footer`).
 */
export function HeroShiftPanel({
  headline,
  subline,
  shift,
  placement: placementProp,
  objective,
  sectionLabel = 'Turno actual',
  isToday = false,
  timeRange: timeRangeProp,
  ev = null,
  mapsUrl = null,
  isRetention = false,
  isConvocado = false,
  empresaLabel = null,
  accentColor = null,
  footer,
  statusSlot,
}: Props) {
  const { palette, isDark } = useTheme();
  const { isCompact } = useResponsiveLayout();
  const placement =
    placementProp ||
    resolveShiftPlacement(shift, objective ? { [objective.name]: objective } : {});

  const isAbsentHero = sectionLabel === 'Ausente';

  const timeRange =
    timeRangeProp ??
    (shift && !shift.isFranco ? formatHeroTimeRange(shift) : null) ??
    (typeof subline === 'string' && /^\d{1,2}:\d{2}/.test(subline) ? subline.split('\n')[0] : null);

  const model = buildHeroShiftCardModel({
    sectionBase: sectionLabel || 'Turno actual',
    isToday: isToday || headline === 'HOY',
    timeRange,
    placement,
    ev,
    mapsUrl,
    isFranco: !!shift?.isFranco && !isAbsentHero,
    isAbsent: isAbsentHero,
    isRetention,
    isConvocado,
    empresaLabel,
  });

  const accent = resolveHeroAccentColor(accentColor, palette.primary);
  const filete = fileteColor(model, accent);

  return (
    <View
      style={[
        styles.card,
        shadow.hero,
        {
          backgroundColor: palette.card,
          borderColor: isDark ? palette.cardBorder : '#eceef1',
        },
      ]}
    >
      <View style={[styles.filete, { backgroundColor: filete }]} />
      <View style={[styles.inner, isCompact && styles.innerCompact]}>
        <Text style={[styles.kicker, { color: palette.onSurfaceMuted }]}>{model.kicker}</Text>

        {model.timeRange ? (
          <Text
            style={[
              styles.time,
              isCompact && styles.timeCompact,
              { color: palette.onSurface },
            ]}
          >
            {model.timeRange}
          </Text>
        ) : null}

        {model.whereTitle ? (
          <Text style={[styles.whereTitle, { color: palette.onSurface }]} numberOfLines={3}>
            {model.whereTitle}
          </Text>
        ) : null}

        {model.wherePlace ? (
          <View style={styles.placeRow}>
            <Ionicons name="location-outline" size={16} color={palette.onSurfaceMuted} />
            <Text style={[styles.wherePlace, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
              {model.wherePlace}
            </Text>
          </View>
        ) : null}

        {model.note ? (
          <Text style={[styles.note, { color: palette.onSurfaceMuted }]} numberOfLines={3}>
            {model.note}
          </Text>
        ) : null}

        {model.kind === 'ausente' ? (
          <View style={[styles.hintBox, { backgroundColor: '#fff7ed', borderColor: '#fdba74' }]}>
            <Text style={[styles.hintText, { color: '#9a3412' }]}>
              Presentá el certificado a RRHH — tenés hasta las 24:00 de hoy.
            </Text>
          </View>
        ) : null}

        {model.kind === 'franco' ? (
          <View
            style={[
              styles.hintBox,
              {
                backgroundColor: isDark ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.1)',
                borderColor: palette.success,
              },
            ]}
          >
            <Text style={[styles.hintText, { color: palette.success }]}>Franco — día libre</Text>
          </View>
        ) : null}

        {statusSlot}
        {footer}
      </View>
    </View>
  );
}

export function formatHeroTimeRange(shift: Shift): string {
  return `${formatTimeArLocal(shift.startTime)}–${formatTimeArLocal(shift.endTime)}`;
}

/** Fecha + rango horario (ej. 22/08/2026 · 08:00–16:00). */
export function formatHeroDateTimeRange(shift: Shift): string {
  return `${formatDateArLocal(shift.startTime)} · ${formatHeroTimeRange(shift)}`;
}

/**
 * Título legacy (HOY / fecha). El kicker nuevo sale de `buildHeroShiftCardModel`.
 */
export function formatHeroShiftHeadline(
  shift: Shift | undefined,
  opts: { isToday: boolean; now?: Date },
): string {
  if (opts.isToday) return 'HOY';
  if (!shift) return 'SIN TURNO';
  const d = toDateLocal(shift.startTime);
  if (!d) return 'SIN FECHA';
  const weekday = d.toLocaleDateString('es-AR', { weekday: 'short', timeZone: TZ });
  return `${weekday} ${formatDateArLocal(shift.startTime)} · ${formatTimeArLocal(shift.startTime)}`;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  filete: {
    width: 5,
  },
  inner: {
    flex: 1,
    paddingVertical: 20,
    paddingHorizontal: 18,
    gap: 8,
  },
  innerCompact: {
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  kicker: {
    ...typography.sectionLabel,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  time: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.6,
    marginTop: 2,
  },
  timeCompact: {
    fontSize: 26,
  },
  whereTitle: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
    marginTop: 2,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  wherePlace: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  note: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    marginTop: 2,
  },
  hintBox: {
    marginTop: 4,
    alignSelf: 'stretch',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  hintText: {
    fontWeight: '800',
    fontSize: 13,
    lineHeight: 18,
  },
});
