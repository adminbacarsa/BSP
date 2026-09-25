import { StyleSheet, Text, View } from 'react-native';
import type { CheckInUiStatusView } from '@cosp/portal-core';
import { radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

type Props = {
  view: CheckInUiStatusView;
  /** Sobre la tarjeta roja del turno: texto blanco, acento de color solo en el borde. */
  onHero?: boolean;
};

const HERO_ACCENT: Record<CheckInUiStatusView['tone'], string> = {
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#fecaca',
  info: '#ffffff',
  neutral: 'rgba(255,255,255,0.6)',
};

export function CheckInStatusBanner({ view, onHero }: Props) {
  const { palette } = useTheme();
  if (!view.title || view.status === 'none') return null;

  if (onHero) {
    return (
      <View
        style={[
          styles.box,
          styles.heroBox,
          { borderColor: HERO_ACCENT[view.tone], borderLeftColor: HERO_ACCENT[view.tone] },
        ]}
      >
        <Text style={[styles.title, styles.heroTitle]}>{view.title}</Text>
        {view.subtitle ? <Text style={[styles.sub, styles.heroSub]}>{view.subtitle}</Text> : null}
      </View>
    );
  }

  const tone = (() => {
    switch (view.tone) {
      case 'success':
        return {
          box: {
            backgroundColor: palette.mode === 'core' ? 'rgba(16,185,129,0.22)' : 'rgba(16,185,129,0.15)',
            borderColor: palette.success,
          },
          title: { color: palette.successMuted },
          sub: { color: palette.onSurfaceMuted },
        };
      case 'warning':
        return {
          box: { backgroundColor: palette.warningContainer, borderColor: palette.warning },
          title: { color: palette.warning },
          sub: { color: palette.onSurfaceMuted },
        };
      case 'danger':
        return {
          box: { backgroundColor: palette.errorContainer, borderColor: palette.error },
          title: { color: palette.onError },
          sub: { color: palette.onSurfaceMuted },
        };
      case 'info':
        return {
          box: {
            backgroundColor: palette.mode === 'core' ? 'rgba(99,102,241,0.2)' : 'rgba(78,222,163,0.1)',
            borderColor: palette.primary,
          },
          title: { color: palette.primary },
          sub: { color: palette.onSurfaceMuted },
        };
      default:
        return {
          box: { backgroundColor: palette.inputBg, borderColor: palette.outline },
          title: { color: palette.onSurface },
          sub: { color: palette.onSurfaceMuted },
        };
    }
  })();

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
  heroBox: { backgroundColor: 'rgba(0,0,0,0.22)', borderLeftWidth: 5 },
  heroTitle: { color: '#ffffff', fontSize: 16 },
  heroSub: { color: 'rgba(255,255,255,0.9)', fontSize: 13 },
});
