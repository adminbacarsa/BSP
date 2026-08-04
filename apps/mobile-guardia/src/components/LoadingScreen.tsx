import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export function LoadingScreen({ label = 'Cargando…' }: { label?: string }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: palette.background }]}>
      <ActivityIndicator size="large" color={palette.primary} />
      <Text style={[styles.label, { color: palette.onSurfaceMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
});
