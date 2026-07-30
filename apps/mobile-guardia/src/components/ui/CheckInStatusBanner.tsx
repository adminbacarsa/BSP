import { StyleSheet, Text, View } from 'react-native';
import type { CheckInUiStatusView } from '@cosp/portal-core';
import { colors, radius } from '../../theme/tokens';

type Props = {
  view: CheckInUiStatusView;
};

const toneStyles: Record<
  CheckInUiStatusView['tone'],
  { box: object; title: object; sub: object }
> = {
  neutral: {
    box: { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.12)' },
    title: { color: colors.indigo100 },
    sub: { color: colors.indigo200 },
  },
  info: {
    box: { backgroundColor: 'rgba(99,102,241,0.25)', borderColor: 'rgba(165,180,252,0.35)' },
    title: { color: '#e0e7ff' },
    sub: { color: colors.indigo200 },
  },
  success: {
    box: { backgroundColor: 'rgba(16,185,129,0.22)', borderColor: 'rgba(52,211,153,0.35)' },
    title: { color: colors.emerald200 },
    sub: { color: '#a7f3d0' },
  },
  warning: {
    box: { backgroundColor: 'rgba(245,158,11,0.2)', borderColor: 'rgba(251,191,36,0.4)' },
    title: { color: '#fde68a' },
    sub: { color: '#fcd34d' },
  },
  danger: {
    box: { backgroundColor: 'rgba(239,68,68,0.22)', borderColor: 'rgba(248,113,113,0.4)' },
    title: { color: '#fecaca' },
    sub: { color: '#fca5a5' },
  },
};

export function CheckInStatusBanner({ view }: Props) {
  if (!view.title || view.status === 'none') return null;
  const tone = toneStyles[view.tone];
  return (
    <View style={[styles.box, tone.box]}>
      <Text style={[styles.title, tone.title]}>{view.title}</Text>
      {view.subtitle ? <Text style={[styles.sub, tone.sub]}>{view.subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: 12,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 4,
  },
  title: { fontWeight: '800', fontSize: 14 },
  sub: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
});
