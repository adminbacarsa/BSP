import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { estadoNovedadEnPalabras, rangoDias } from '@cosp/portal-core';
import { usePortalAuth } from '../../src/context/PortalAuthContext';
import { useMisNovedades } from '../../src/hooks/useMisNovedades';
import { CommandCard } from '../../src/components/ui/CommandCard';
import { radius } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/ThemeContext';

export default function MisNovedadesScreen() {
  const router = useRouter();
  const { user, initializing, isPreviewMode } = usePortalAuth();
  const { rows, loading } = useMisNovedades();
  const { palette } = useTheme();

  if (initializing) return null;
  if (!user) return <Redirect href="/login" />;

  return (
    <>
      <Stack.Screen options={{ title: 'Mis novedades' }} />
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {isPreviewMode ? (
            <Text style={[styles.preview, { color: palette.onSurfaceMuted }]}>Vista previa</Text>
          ) : null}
          {loading ? (
            <Text style={[styles.empty, { color: palette.onSurfaceMuted }]}>Cargando…</Text>
          ) : rows.length === 0 ? (
            <Text style={[styles.empty, { color: palette.onSurfaceMuted }]}>
              Todavía no hay novedades. Las que avises y las que cargue RRHH aparecen acá.
            </Text>
          ) : (
            rows.map((row) => (
              <Pressable key={row.id} onPress={() => router.push(`/mis-novedades/${row.id}`)}>
                <CommandCard>
                  <Text style={[styles.tipo, { color: palette.onSurface }]}>{String(row.type || 'Novedad')}</Text>
                  <Text style={[styles.dias, { color: palette.onSurfaceMuted }]}>{rangoDias(row) || 'Sin fechas'}</Text>
                  {row.reason ? (
                    <Text style={[styles.motivo, { color: palette.onSurface }]} numberOfLines={2}>
                      {String(row.reason)}
                    </Text>
                  ) : null}
                  <View style={[styles.estado, { borderColor: palette.outline }]}>
                    <Text style={[styles.estadoTexto, { color: palette.primary }]}>{estadoNovedadEnPalabras(row)}</Text>
                  </View>
                </CommandCard>
              </Pressable>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, gap: 12 },
  preview: { fontSize: 13 },
  empty: { fontSize: 15, lineHeight: 22 },
  tipo: { fontSize: 16, fontWeight: '700' },
  dias: { fontSize: 14 },
  motivo: { fontSize: 14, lineHeight: 20 },
  estado: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  estadoTexto: { fontSize: 13, fontWeight: '700' },
});
