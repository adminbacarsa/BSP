import type { ReactNode } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import type { ObjectiveLocation, Shift } from '@cosp/portal-types';
import { formatTimeAr } from '@cosp/portal-core';
import { colors, radius, shadow, typography } from '../../theme/tokens';
import { CommandBadge } from './CommandButton';

type Props = {
  headline: string;
  subline: string;
  shift?: Shift;
  objective?: ObjectiveLocation | null;
  empresaNombre?: string;
  footer?: ReactNode;
  statusSlot?: ReactNode;
};

export function HeroShiftPanel({
  headline,
  subline,
  shift,
  objective,
  empresaNombre,
  footer,
  statusSlot,
}: Props) {
  const mapsUrl =
    objective?.lat && objective?.lng
      ? `https://www.google.com/maps?q=${objective.lat},${objective.lng}`
      : objective?.address
        ? `https://www.google.com/maps/search/${encodeURIComponent(objective.address)}`
        : null;

  return (
    <View style={[styles.hero, shadow.hero]}>
      <View style={styles.orbTop} />
      <View style={styles.orbBottom} />
      <View style={styles.inner}>
        <View style={styles.topRow}>
          <Text style={styles.sectionLabel}>Próximo turno</Text>
          {empresaNombre ? (
            <View style={styles.empresaPill}>
              <Text style={styles.empresaText} numberOfLines={1}>
                {empresaNombre}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.headline}>{headline}</Text>
        <Text style={styles.subline}>{subline}</Text>

        {shift && !shift.isFranco ? (
          <View style={styles.chips}>
            <CommandBadge>{objective?.name || shift.objectiveName || 'Objetivo'}</CommandBadge>
            {shift.clientName || objective?.clientName ? (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{shift.clientName || objective?.clientName}</Text>
              </View>
            ) : null}
            {shift.positionName ? (
              <View style={styles.chip}>
                <Text style={styles.chipText}>{shift.positionName}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {shift?.isFranco ? (
          <View style={styles.francoBox}>
            <Text style={styles.francoText}>Franco — día libre</Text>
          </View>
        ) : null}

        {mapsUrl ? (
          <Text style={styles.mapsLink} onPress={() => Linking.openURL(mapsUrl)}>
            Cómo llegar →
          </Text>
        ) : null}

        {statusSlot}
        {footer}
      </View>
    </View>
  );
}

export function formatHeroTimeRange(shift: Shift): string {
  return `${formatTimeAr(shift.startTime)} – ${formatTimeAr(shift.endTime)}`;
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.indigo900,
    borderRadius: radius.xl,
    overflow: 'hidden',
    position: 'relative',
  },
  orbTop: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.06)',
    top: -48,
    right: -48,
  },
  orbBottom: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.05)',
    bottom: -40,
    left: -24,
  },
  inner: { padding: 24, gap: 8, zIndex: 1 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionLabel: {
    ...typography.sectionLabel,
    color: colors.indigo200,
  },
  empresaPill: {
    maxWidth: 140,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  empresaText: { color: colors.indigo200, fontSize: 10, fontWeight: '800' },
  headline: {
    fontSize: 32,
    fontWeight: '900',
    color: colors.white,
    letterSpacing: -0.5,
  },
  subline: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.indigo200,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  chipText: { color: colors.indigo200, fontSize: 12, fontWeight: '700' },
  francoBox: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: 'rgba(16,185,129,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.35)',
  },
  francoText: { color: colors.emerald200, fontWeight: '800', fontSize: 14 },
  mapsLink: {
    marginTop: 8,
    color: '#a5b4fc',
    fontWeight: '800',
    fontSize: 13,
  },
});
