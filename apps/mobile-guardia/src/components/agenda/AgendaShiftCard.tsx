import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDateAr, formatTimeAr, isEvShift, resolveEvShiftDisplay } from '@cosp/portal-core';
import type { Evento, ObjectiveLocation, Shift } from '@cosp/portal-types';
import {
  isAgendaAbsentShift,
  isAgendaWorkedShift,
  isOpsCoverageShift,
} from '../../lib/agendaCalendar';
import { resolveShiftPlacement } from '../../lib/shiftPlacement';
import { CommandButton } from '../ui/CommandButton';
import { radius, shadow } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

type Props = {
  item: Shift;
  eventosMap: Record<string, Evento>;
  objectivesMap: Record<string, ObjectiveLocation>;
};

export function AgendaShiftCard({ item, eventosMap, objectivesMap }: Props) {
  const { palette } = useTheme();
  const isOps = isOpsCoverageShift(item);
  const isAbsent = isAgendaAbsentShift(item);
  const isWorked = !isAbsent && isAgendaWorkedShift(item);
  const isFranco = !!item.isFranco && !isOps && !item.isFrancoTrabajado && !isAbsent;
  const isFt = !!item.isFrancoTrabajado || String(item.code || '').toUpperCase() === 'FT';
  const ev = resolveEvShiftDisplay(item, eventosMap);
  const isEv = isEvShift(item);
  const placement = resolveShiftPlacement(item, objectivesMap);

  const codeLabel = isAbsent
    ? 'AA'
    : isFranco
      ? 'F'
      : isFt
        ? 'FT'
        : isEv
          ? 'EV'
          : String(item.code || 'T').toUpperCase();

  const title = isAbsent
    ? 'Ausente'
    : isOps
      ? 'Cobertura'
      : isFranco
        ? 'Franco'
        : isFt
          ? 'Franco trabajado'
          : ev?.nombre || placement.objective;

  const timeLine = isFranco
    ? formatDateAr(item.startTime)
    : ev?.horarioBadge
      ? `${formatDateAr(item.startTime)} · ${ev.horarioBadge}`
      : `${formatDateAr(item.startTime)} · ${formatTimeAr(item.startTime)} – ${formatTimeAr(item.endTime)}`;

  const metaLine = isAbsent
    ? `${placement.line} · no corresponde asistir`
    : isOps
      ? `Turno asignado · ${placement.line}`
      : isFranco
        ? 'Día libre programado'
        : isWorked
          ? `${placement.line} · ya trabajado`
          : placement.line;

  const accentColor = isAbsent
    ? '#b45309'
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
            : isEv
              ? palette.inputBg
              : palette.card,
          borderColor: isAbsent
            ? '#f59e0b'
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
      <View style={styles.codeBox}>
        <Text style={[styles.codeText, { color: accentColor }]}>{codeLabel}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: palette.onSurface }]}>{title}</Text>
        <Text style={[styles.rowSub, { color: palette.onSurfaceMuted }]}>{timeLine}</Text>
        <Text
          style={[styles.rowMeta, { color: isFranco ? palette.onSurfaceMuted : accentColor }]}
          numberOfLines={3}
        >
          {metaLine}
        </Text>
        {isAbsent ? (
          <Text style={[styles.certHint, { color: '#92400e' }]}>
            Si corresponde, presentá el certificado a RRHH (idealmente hoy).
          </Text>
        ) : null}
        {ev?.eventoNombre && ev.eventoNombre !== ev.nombre ? (
          <Text style={[styles.rowMeta, { color: palette.warning }]}>{ev.eventoNombre}</Text>
        ) : null}
        {ev?.direccion ? (
          <Text style={[styles.rowAddr, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
            {ev.direccion}
          </Text>
        ) : null}
        {ev?.mapsUrl && !isAbsent ? (
          <CommandButton
            label="Cómo llegar"
            variant="ghost"
            onPress={() => void Linking.openURL(ev.mapsUrl!)}
            style={styles.mapsBtn}
          />
        ) : null}
      </View>
      {isAbsent ? (
        <View style={styles.badgeAbsent}>
          <Text style={styles.badgeAbsentText}>Ausente</Text>
        </View>
      ) : item.isPresent || isWorked ? (
        <View style={styles.badgeOk}>
          <Text style={styles.badgeOkText}>{item.isPresent ? 'Presente' : 'Trabajado'}</Text>
        </View>
      ) : isOps ? (
        <View style={styles.badgeOps}>
          <Text style={styles.badgeOpsText}>Cobertura</Text>
        </View>
      ) : isFranco ? (
        <View style={[styles.badgeFranco, { backgroundColor: palette.inputBg }]}>
          <Text style={[styles.badgeFrancoText, { color: palette.success }]}>Libre</Text>
        </View>
      ) : null}
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
  codeBox: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  codeText: { fontWeight: '900', fontSize: 11 },
  rowBody: { flex: 1, paddingVertical: 14, paddingRight: 8, gap: 4 },
  rowTitle: { fontWeight: '800', fontSize: 16 },
  rowSub: { fontSize: 13, fontWeight: '600' },
  rowMeta: { fontSize: 12, fontWeight: '700' },
  certHint: { fontSize: 11, fontWeight: '700', lineHeight: 15, marginTop: 2 },
  rowAddr: { fontSize: 12, lineHeight: 17 },
  mapsBtn: { alignSelf: 'flex-start', marginTop: 2 },
  badgeOk: {
    alignSelf: 'center',
    marginRight: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: '#d1fae5',
  },
  badgeOkText: { fontWeight: '800', fontSize: 11 },
  badgeAbsent: {
    alignSelf: 'center',
    marginRight: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: '#fef3c7',
  },
  badgeAbsentText: { fontWeight: '800', fontSize: 11, color: '#92400e' },
  badgeOps: {
    alignSelf: 'center',
    marginRight: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: '#ffedd5',
  },
  badgeOpsText: { fontWeight: '800', fontSize: 11, color: '#c2410c' },
  badgeFranco: {
    alignSelf: 'center',
    marginRight: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  badgeFrancoText: { fontWeight: '800', fontSize: 11 },
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
