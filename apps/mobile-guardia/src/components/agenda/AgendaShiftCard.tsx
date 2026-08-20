import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDateAr, formatTimeAr, isEvShift, resolveEvShiftDisplay } from '@cosp/portal-core';
import type { Evento, ObjectiveLocation, Shift } from '@cosp/portal-types';
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
  const isFranco = item.isFranco;
  const ev = resolveEvShiftDisplay(item, eventosMap);
  const isEv = isEvShift(item);
  const placement = resolveShiftPlacement(item, objectivesMap);

  const title = isFranco ? 'Franco' : ev?.nombre || placement.objective;

  const timeLine = isFranco
    ? formatDateAr(item.startTime)
    : ev?.horarioBadge
      ? `${formatDateAr(item.startTime)} · ${ev.horarioBadge}`
      : `${formatDateAr(item.startTime)} · ${formatTimeAr(item.startTime)} – ${formatTimeAr(item.endTime)}`;

  return (
    <View
      style={[
        styles.row,
        palette.useCardShadow && shadow.card,
        {
          backgroundColor: isEv ? palette.inputBg : palette.card,
          borderColor: isEv ? palette.warning : palette.cardBorder,
        },
      ]}
    >
      <View style={[styles.rowAccent, { backgroundColor: isEv ? palette.warning : palette.primary }]} />
      <View style={styles.codeBox}>
        <Text style={[styles.codeText, { color: isEv ? palette.warning : palette.primary }]}>
          {isFranco ? 'F' : isEv ? 'EV' : String(item.code || 'T').toUpperCase()}
        </Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: palette.onSurface }]}>{title}</Text>
        <Text style={[styles.rowSub, { color: palette.onSurfaceMuted }]}>{timeLine}</Text>
        {!isFranco ? (
          <Text style={[styles.rowMeta, { color: palette.primary }]} numberOfLines={3}>
            {placement.line}
          </Text>
        ) : (
          <Text style={[styles.rowMeta, { color: palette.onSurfaceMuted }]}>Día libre programado</Text>
        )}
        {ev?.eventoNombre && ev.eventoNombre !== ev.nombre ? (
          <Text style={[styles.rowMeta, { color: palette.warning }]}>{ev.eventoNombre}</Text>
        ) : null}
        {ev?.direccion ? (
          <Text style={[styles.rowAddr, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
            {ev.direccion}
          </Text>
        ) : null}
        {ev?.mapsUrl ? (
          <CommandButton
            label="Cómo llegar"
            variant="ghost"
            onPress={() => void Linking.openURL(ev.mapsUrl!)}
            style={styles.mapsBtn}
          />
        ) : null}
      </View>
      {item.isPresent ? (
        <View style={styles.badgeOk}>
          <Text style={styles.badgeOkText}>Presente</Text>
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
