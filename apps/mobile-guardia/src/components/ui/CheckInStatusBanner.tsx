import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CheckInUiStatusView } from '@cosp/portal-core';
import { radius } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';

type Props = {
  view: CheckInUiStatusView;
  /**
   * Destacado en la tarjeta de turno (Hoy). Verde a tiempo / ámbar tarde.
   * Ya no se usa el estilo «texto blanco sobre rojo» del hero viejo.
   */
  onHero?: boolean;
};

const TONE_ICON: Record<CheckInUiStatusView['tone'], keyof typeof Ionicons.glyphMap> = {
  success: 'checkmark-circle',
  warning: 'time',
  danger: 'alert-circle',
  info: 'information-circle',
  neutral: 'ellipse',
};

/**
 * Estado de fichada. Con `onHero` (tarjeta Turno actual) el bloque es más grande
 * y usa fondo tinte + ícono; sobre fondo blanco el contraste es AA.
 */
export function CheckInStatusBanner({ view, onHero }: Props) {
  const { palette } = useTheme();
  if (!view.title || view.status === 'none') return null;

  const tone = (() => {
    switch (view.tone) {
      case 'success':
        return {
          box: {
            backgroundColor: palette.mode === 'core' ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.15)',
            borderColor: palette.success,
          },
          title: { color: palette.mode === 'core' ? '#047857' : palette.successMuted },
          sub: { color: palette.onSurfaceMuted },
          icon: palette.success,
        };
      case 'warning':
        return {
          box: { backgroundColor: palette.warningContainer, borderColor: palette.warning },
          title: { color: palette.mode === 'core' ? '#b45309' : palette.warning },
          sub: { color: palette.onSurfaceMuted },
          icon: palette.warning,
        };
      case 'danger':
        return {
          box: { backgroundColor: palette.errorContainer, borderColor: palette.error },
          title: { color: palette.onError },
          sub: { color: palette.onSurfaceMuted },
          icon: palette.error,
        };
      case 'info':
        return {
          box: {
            backgroundColor: palette.mode === 'core' ? 'rgba(99,102,241,0.1)' : 'rgba(78,222,163,0.1)',
            borderColor: palette.primary,
          },
          title: { color: palette.primary },
          sub: { color: palette.onSurfaceMuted },
          icon: palette.primary,
        };
      default:
        return {
          box: { backgroundColor: palette.inputBg, borderColor: palette.outline },
          title: { color: palette.onSurface },
          sub: { color: palette.onSurfaceMuted },
          icon: palette.onSurfaceMuted,
        };
    }
  })();

  const iconName = TONE_ICON[view.tone];

  return (
    <View
      style={[
        styles.box,
        onHero && styles.boxProminent,
        tone.box,
        { borderLeftColor: tone.icon },
      ]}
    >
      <View style={styles.row}>
        <Ionicons name={iconName} size={onHero ? 22 : 18} color={tone.icon} style={styles.icon} />
        <View style={styles.textCol}>
          <Text style={[styles.title, onHero && styles.titleProminent, tone.title]}>{view.title}</Text>
          {view.subtitle ? <Text style={[styles.sub, tone.sub]}>{view.subtitle}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: 10,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderLeftWidth: 4,
    gap: 4,
  },
  boxProminent: {
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  icon: {
    marginTop: 1,
  },
  textCol: {
    flex: 1,
    gap: 3,
  },
  title: { fontWeight: '800', fontSize: 14 },
  titleProminent: { fontSize: 16, fontWeight: '900' },
  sub: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
});
