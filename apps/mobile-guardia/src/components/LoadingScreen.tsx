import { StyleSheet, Text, View } from 'react-native';
import { BacarLoadingMark } from './ui/BacarLoadingMark';
import { useTheme } from '../theme/ThemeContext';

export function LoadingScreen({ label = 'Cargando…' }: { label?: string }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: palette.background }]}>
      <BacarLoadingMark size={128} markSize={56} />
      <Text style={[styles.label, { color: palette.onSurfaceMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
});
