import type { ReactNode } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Shift } from '@cosp/portal-types';
import { formatTimeAr } from '@cosp/portal-core';
import { radius, shadow, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { CommandBadge } from './CommandButton';
import type { ShiftPlacement } from '../../lib/shiftPlacement';
import { resolveShiftPlacement } from '../../lib/shiftPlacement';

type Props = {
  headline: string;
  subline: string;
  shift?: Shift;
  /** Preferido: Cliente · Objetivo · Puesto ya resuelto */
  placement?: ShiftPlacement;
  /** @deprecated usar placement */
  objective?: ShiftPlacement['objectiveLocation'];
  empresaNombre?: string;
  footer?: ReactNode;
  statusSlot?: ReactNode;
};

export function HeroShiftPanel({
  headline,
  subline,
  shift,
  placement: placementProp,
  objective,
  empresaNombre,
  footer,
  statusSlot,
}: Props) {
  const { palette, isDark } = useTheme();
  const placement =
    placementProp ||
    resolveShiftPlacement(shift, objective ? { [objective.name]: objective } : {});
  const mapsTarget = placement.objectiveLocation || objective || null;
  const mapsUrl =
    mapsTarget?.lat && mapsTarget?.lng
      ? `https://www.google.com/maps?q=${mapsTarget.lat},${mapsTarget.lng}`
      : mapsTarget?.address
        ? `https://www.google.com/maps/search/${encodeURIComponent(mapsTarget.address)}`
        : null;

  const inner = (
    <>
      <View style={styles.topRow}>
        <Text style={[styles.sectionLabel, { color: palette.heroSubtext }]}>Próximo turno</Text>
        {empresaNombre ? (
          <View style={[styles.empresaPill, { borderColor: palette.chipBg }]}>
            <Text style={[styles.empresaText, { color: palette.heroSubtext }]} numberOfLines={1}>
              {empresaNombre}
            </Text>
          </View>
        ) : null}
      </View>
      {isDark ? (
        <View style={styles.darkStatusRow}>
          <View style={[styles.statusDot, { backgroundColor: palette.success }]} />
          <Text style={[styles.sectionLabel, { color: palette.success }]}>OPERATIVO</Text>
        </View>
      ) : null}
      <Text style={[styles.headline, { color: palette.heroText }]}>{headline}</Text>
      <Text style={[styles.subline, { color: palette.heroSubtext }]}>{subline}</Text>

      {shift && !shift.isFranco ? (
        <View style={styles.chips}>
          <CommandBadge>{placement.client}</CommandBadge>
          <View style={[styles.chip, { backgroundColor: palette.chipBg }]}>
            <Text style={[styles.chipText, { color: palette.chipText }]}>{placement.objective}</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: palette.chipBg }]}>
            <Text style={[styles.chipText, { color: palette.chipText }]}>{placement.position}</Text>
          </View>
        </View>
      ) : null}

      {shift?.isFranco ? (
        <View
          style={[
            styles.francoBox,
            {
              backgroundColor: isDark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.22)',
              borderColor: palette.success,
            },
          ]}
        >
          <Text style={[styles.francoText, { color: palette.successMuted }]}>Franco — día libre</Text>
        </View>
      ) : null}

      {mapsUrl ? (
        <Text style={[styles.mapsLink, { color: palette.heroSubtext }]} onPress={() => Linking.openURL(mapsUrl)}>
          Cómo llegar →
        </Text>
      ) : null}

      {statusSlot}
      {footer}
    </>
  );

  if (isDark) {
    return (
      <View
        style={[
          styles.heroDark,
          shadow.hero,
          {
            backgroundColor: palette.card,
            borderColor: palette.heroBorderAccent ?? palette.cardBorder,
          },
        ]}
      >
        <View style={styles.inner}>{inner}</View>
      </View>
    );
  }

  return (
    <LinearGradient colors={palette.heroGradient} style={[styles.hero, shadow.hero]}>
      <View style={styles.orbTop} />
      <View style={styles.orbBottom} />
      <View style={styles.inner}>{inner}</View>
    </LinearGradient>
  );
}

export function formatHeroTimeRange(shift: Shift): string {
  return `${formatTimeAr(shift.startTime)} – ${formatTimeAr(shift.endTime)}`;
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    position: 'relative',
  },
  heroDark: {
    borderRadius: radius.xl,
    borderWidth: 1,
    overflow: 'hidden',
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
  darkStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  sectionLabel: {
    ...typography.sectionLabel,
  },
  empresaPill: {
    maxWidth: 140,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
  },
  empresaText: { fontSize: 10, fontWeight: '800' },
  headline: {
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  subline: {
    fontSize: 18,
    fontWeight: '700',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  chipText: { fontSize: 12, fontWeight: '700' },
  francoBox: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  francoText: { fontWeight: '800', fontSize: 14 },
  mapsLink: {
    marginTop: 8,
    fontWeight: '800',
    fontSize: 13,
  },
});
