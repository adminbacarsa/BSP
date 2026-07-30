import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/tokens';

export function LoadingScreen({ label = 'Cargando…' }: { label?: string }) {
  return (
    <LinearGradient colors={[colors.slate950, colors.indigo950]} style={styles.wrap}>
      <ActivityIndicator size="large" color={colors.indigo200} />
      <Text style={styles.label}>{label}</Text>
    </LinearGradient>
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
    color: colors.indigo200,
    fontSize: 14,
    fontWeight: '600',
  },
});
