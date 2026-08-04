import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useTheme } from '../theme/ThemeContext';

export function OfflineBanner() {
  const { isOffline, checked } = useNetworkStatus();
  const { palette, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  if (!checked || !isOffline) return null;

  return (
    <View
      style={[
        styles.banner,
        {
          paddingTop: Math.max(insets.top, 8),
          backgroundColor: isDark ? '#7f1d1d' : '#fef3c7',
          borderColor: isDark ? '#b91c1c' : '#f59e0b',
        },
      ]}
    >
      <Text style={[styles.title, { color: isDark ? '#fecaca' : '#92400e' }]}>
        Sin conexión
      </Text>
      <Text style={[styles.body, { color: isDark ? '#fde68a' : '#78350f' }]}>
        Podés ver agenda y credencial guardada. Las fichadas se encolan hasta recuperar red.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  title: { fontSize: 12, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase' },
  body: { fontSize: 12, marginTop: 4, lineHeight: 17 },
});
