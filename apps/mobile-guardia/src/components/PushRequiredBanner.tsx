import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePushGate } from '../context/PushGateContext';
import {
  PUSH_REQUIRED_BODY,
  PUSH_REQUIRED_BUTTON,
  PUSH_REQUIRED_CHANNEL_BODY,
  PUSH_REQUIRED_TITLE,
} from '../lib/pushPermissionGate';
import { radius, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

/**
 * Banner fijo no descartable (nativo). Sin notificaciones el guardia no recibe
 * convocatorias ni avisos de turno. No bloquea fichada ni ver turnos.
 * Web: no se monta (sigue el botón «Activar notificaciones»).
 */
export function PushRequiredBanner() {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { needsBanner, reason, busy, activateNow } = usePushGate();

  if (Platform.OS === 'web' || !needsBanner) return null;

  const body = reason === 'channel' ? PUSH_REQUIRED_CHANNEL_BODY : PUSH_REQUIRED_BODY;

  return (
    <View
      accessibilityRole="summary"
      style={[
        styles.wrap,
        {
          backgroundColor: '#7f1d1d',
          borderBottomColor: '#fecaca',
          paddingTop: Math.max(insets.top, spacing.sm),
        },
      ]}
    >
      <View style={styles.textCol}>
        <Text style={styles.title}>{PUSH_REQUIRED_TITLE}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={PUSH_REQUIRED_BUTTON}
        disabled={busy}
        onPress={() => void activateNow()}
        style={[styles.btn, busy && styles.btnBusy, { backgroundColor: palette.card }]}
      >
        {busy ? (
          <ActivityIndicator color="#7f1d1d" />
        ) : (
          <Text style={styles.btnText}>{PUSH_REQUIRED_BUTTON}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    gap: 10,
  },
  textCol: {
    gap: 2,
  },
  title: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
  body: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  btn: {
    minHeight: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  btnBusy: { opacity: 0.75 },
  btnText: {
    color: '#7f1d1d',
    fontSize: 15,
    fontWeight: '900',
  },
});
