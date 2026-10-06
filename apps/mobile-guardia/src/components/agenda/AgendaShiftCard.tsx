import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { isEvShift, resolveEvShiftDisplay } from '@cosp/portal-core';
import type { Evento, ObjectiveLocation, Shift } from '@cosp/portal-types';
import {
  isAgendaAbsentShift,
  isAgendaRetentionShift,
  isAgendaWorkedShift,
  isOpsCoverageShift,
} from '../../lib/agendaCalendar';
import { resolveShiftPlacement } from '../../lib/shiftPlacement';
import { firmarAnexoDelTurno } from '../../lib/heroShiftCard';
import { buildAgendaShiftView, type AgendaEstadoChip } from '../../lib/agendaShiftCard';
import { arYmd, etiquetaDiaYmd, formatCuandoTurno, toDateTurno } from '../../lib/fechaTurno';
import { CommandButton } from '../ui/CommandButton';
import { radius, shadow } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

type Props = {
  item: Shift;
  eventosMap: Record<string, Evento>;
  objectivesMap: Record<string, ObjectiveLocation>;
  /** Eventual: empresa dueña del turno (se muestra como etiqueta). */
  empresaLabel?: string | null;
};

export function AgendaShiftCard({ item, eventosMap, objectivesMap, empresaLabel }: Props) {
  const { palette } = useTheme();
  const router = useRouter();
  const firmarAnexo = firmarAnexoDelTurno(item);
  const isOps = isOpsCoverageShift(item);
  const isAbsent = isAgendaAbsentShift(item);
  const isRetention = !isAbsent && isAgendaRetentionShift(item);
  const isWorked = !isAbsent && !isRetention && isAgendaWorkedShift(item);
  const isFranco = !!item.isFranco && !isOps && !item.isFrancoTrabajado && !isAbsent;
  const isFt = !!item.isFrancoTrabajado || String(item.code || '').toUpperCase() === 'FT';
  const ev = resolveEvShiftDisplay(item, eventosMap);
  const isEv = isEvShift(item);
  const placement = resolveShiftPlacement(item, objectivesMap);

  const start = toDateTurno(item.startTime);
  const cuando = isFranco
    ? (start ? etiquetaDiaYmd(arYmd(start)) : null)
    : formatCuandoTurno(item.startTime, item.endTime);
  const view = buildAgendaShiftView({
    cuando,
    placement,
    ev: isEv ? ev : null,
    isFranco,
    isAbsent,
    isRetention,
    isWorked,
    isFt,
  });

  const accentColor = isAbsent
    ? '#b45309'
    : isRetention
      ? '#ea580c'
      : isOps
        ? '#ea580c'
        : isWorked
          ? '#64748b'
          : isEv
            ? palette.warning
            : palette.primary;

  return (
    <View
      style={[
        styles.row,
        palette.useCardShadow && shadow.card,
        {
          backgroundColor: isAbsent
            ? 'rgba(180, 83, 9, 0.08)'
            : isRetention
              ? 'rgba(234, 88, 12, 0.08)'
              : isEv
                ? palette.inputBg
                : palette.card,
          borderColor: isAbsent
            ? '#f59e0b'
            : isRetention
              ? '#fdba74'
              : isOps
                ? '#fdba74'
                : isWorked
                  ? '#cbd5e1'
                  : isEv
                    ? palette.warning
                    : palette.cardBorder,
          opacity: isWorked && !isAbsent ? 0.92 : 1,
        },
      ]}
    >
      <View style={[styles.rowAccent, { backgroundColor: accentColor }]} />
      <View style={styles.rowBody}>
        {empresaLabel ? (
          <View style={[styles.empresaBadge, { backgroundColor: palette.inputBg, borderColor: palette.cardBorder }]}>
            <Text style={[styles.empresaBadgeText, { color: palette.primary }]} numberOfLines={1}>
              {empresaLabel}
            </Text>
          </View>
        ) : null}
        {view.cuando ? (
          <Text style={[styles.rowTitle, { color: palette.onSurface }]}>{view.cuando}</Text>
        ) : null}
        {view.whereTitle ? (
          <Text style={[styles.rowSub, { color: palette.onSurface }]} numberOfLines={2}>
            {view.whereTitle}
          </Text>
        ) : null}
        {view.wherePlace ? (
          <Text style={[styles.rowAddr, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
            {view.wherePlace}
          </Text>
        ) : null}
        {view.note ? (
          <Text style={[styles.rowMeta, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
            {view.note}
          </Text>
        ) : null}
        {isAbsent ? (
          <Text style={[styles.certHint, { color: '#92400e' }]}>
            Si corresponde, presentá el certificado a RRHH (idealmente hoy).
          </Text>
        ) : null}
        {view.permiteAcciones && firmarAnexo.visible ? (
          <CommandButton
            label={firmarAnexo.label}
            variant="secondary"
            onPress={() => router.push({ pathname: '/codigo-anexo', params: { contratoId: firmarAnexo.contratoId } })}
            style={styles.mapsBtn}
          />
        ) : null}
      </View>
      <View style={[styles.badge, { backgroundColor: badgeBg(view.estado, palette.inputBg) }]}>
        <Text style={[styles.badgeText, { color: badgeFg(view.estado, palette.success) }]}>{view.estado}</Text>
      </View>
    </View>
  );
}

type EmptyProps = {
  message: string;
};

export function AgendaEmptyDay({ message }: EmptyProps) {
  const { palette } = useTheme();
  return (
    <View style={[styles.empty, { borderColor: palette.cardBorder, backgroundColor: palette.card }]}>
      <Text style={{ color: palette.onSurfaceMuted, textAlign: 'center', fontWeight: '600' }}>
        {message}
      </Text>
    </View>
  );
}

type NavProps = {
  title: string;
  onPrev: () => void;
  onNext: () => void;
  onToday?: () => void;
};

export function AgendaPeriodNav({ title, onPrev, onNext, onToday }: NavProps) {
  const { palette } = useTheme();
  return (
    <View style={styles.navRow}>
      <Pressable
        onPress={onPrev}
        style={[styles.navBtn, { backgroundColor: palette.inputBg, borderColor: palette.cardBorder }]}
        hitSlop={8}
      >
        <Text style={[styles.navBtnText, { color: palette.primary }]}>‹</Text>
      </Pressable>
      <Pressable onPress={onToday} style={styles.navTitleWrap} disabled={!onToday}>
        <Text style={[styles.navTitle, { color: palette.onSurface }]} numberOfLines={2}>
          {title}
        </Text>
      </Pressable>
      <Pressable
        onPress={onNext}
        style={[styles.navBtn, { backgroundColor: palette.inputBg, borderColor: palette.cardBorder }]}
        hitSlop={8}
      >
        <Text style={[styles.navBtnText, { color: palette.primary }]}>›</Text>
      </Pressable>
    </View>
  );
}

function badgeBg(estado: AgendaEstadoChip, francoBg: string): string {
  if (estado === 'Trabajado') return '#d1fae5';
  if (estado === 'Ausente') return '#fef3c7';
  if (estado === 'Retenido') return '#ffedd5';
  if (estado === 'Franco') return francoBg;
  return '#e0e7ff';
}

function badgeFg(estado: AgendaEstadoChip, francoFg: string): string {
  if (estado === 'Ausente') return '#92400e';
  if (estado === 'Retenido') return '#c2410c';
  if (estado === 'Franco') return francoFg;
  if (estado === 'Próximo') return '#3730a3';
  return '#065f46';
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: radius.lg,
    marginBottom: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  rowAccent: { width: 4 },
  rowBody: { flex: 1, paddingVertical: 14, paddingRight: 8, gap: 4 },
  rowTitle: { fontWeight: '800', fontSize: 16 },
  empresaBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginBottom: 2,
  },
  empresaBadgeText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  rowSub: { fontSize: 13, fontWeight: '600' },
  rowMeta: { fontSize: 12, fontWeight: '500' },
  certHint: { fontSize: 11, fontWeight: '700', lineHeight: 15, marginTop: 2 },
  rowAddr: { fontSize: 12, lineHeight: 17 },
  mapsBtn: { alignSelf: 'flex-start', marginTop: 2 },
  badge: {
    alignSelf: 'center',
    marginRight: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  badgeText: { fontWeight: '800', fontSize: 11 },
  empty: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 20,
    marginBottom: 8,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnText: { fontSize: 22, fontWeight: '800', marginTop: -2 },
  navTitleWrap: { flex: 1 },
  navTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center', textTransform: 'capitalize' },
});
