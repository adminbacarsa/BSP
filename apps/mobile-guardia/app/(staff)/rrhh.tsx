import { Redirect } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { canAccessMode } from '@cosp/ops-core';
import { usePortalAuth } from '../../src/context/PortalAuthContext';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { useTheme } from '../../src/theme/ThemeContext';
import { radius, spacing } from '../../src/theme/tokens';
import { useResponsiveLayout } from '../../src/hooks/useResponsiveLayout';

export default function RrhhScreen() {
  const { palette } = useTheme();
  const { contentMaxWidth, horizontalPadding } = useResponsiveLayout();
  const { initializing, user, staffProfile } = usePortalAuth();

  if (initializing) return <LoadingScreen label="Iniciando COSP…" />;
  if (!user) return <Redirect href="/login" />;
  if (!staffProfile || !canAccessMode(staffProfile, 'rrhh')) {
    return <Redirect href="/" />;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={[
        styles.pad,
        {
          paddingHorizontal: horizontalPadding,
          ...(contentMaxWidth ? { maxWidth: contentMaxWidth, alignSelf: 'center', width: '100%' } : {}),
        },
      ]}
    >
      <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.cardBorder }]}>
        <Text style={[styles.title, { color: palette.onSurface }]}>Próximamente</Text>
        <Text style={[styles.body, { color: palette.onSurfaceMuted }]}>
          RRHH móvil (novedades, licencias, aprobaciones) llega en una fase siguiente.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { paddingVertical: spacing.container, gap: 14, paddingBottom: 40 },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    gap: 8,
  },
  title: { fontSize: 18, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 21 },
});
