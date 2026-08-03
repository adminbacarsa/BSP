import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { CommandButton } from '../src/components/ui/CommandButton';
import { CommandCard } from '../src/components/ui/CommandCard';
import { RequireAuth } from '../src/hooks/useRequireAuth';
import { radius, spacing } from '../src/theme/tokens';
import { useTheme } from '../src/theme/ThemeContext';

const ROADMAP = [
  { title: 'Fichada GPS + offline', status: 'Listo', done: true },
  { title: 'Llegada tarde', status: 'Listo', done: true },
  { title: 'Ausencias y licencias', status: 'Formulario activo', done: true },
  { title: 'Adjunto certificado', status: 'Cámara y galería', done: true },
  { title: 'Notificaciones push', status: 'F3 · EAS', done: false },
  { title: 'Permutas', status: 'F4', done: false },
  { title: 'Credencial digital', status: 'F5', done: false },
];

export default function MasScreen() {
  return (
    <RequireAuth>
      <MasScreenContent />
    </RequireAuth>
  );
}

function MasScreenContent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { portalFeatures } = usePortalAuth();
  const { palette, mode, setThemeMode } = useTheme();
  const canNovedad = portalFeatures.reportAbsence || portalFeatures.requestLicense;
  const scrollBottomPad = Math.max(insets.bottom, 12) + 88;

  return (
    <>
      <Stack.Screen options={{ title: 'Servicios' }} />
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={['bottom']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottomPad }]}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.intro, { color: palette.onSurfaceMuted }]}>
            Misma lógica que el portal web del empleado. Los módulos deshabilitados por RRHH no aparecen.
          </Text>

          <CommandCard title="Apariencia">
            <Text style={[styles.cardSub, { color: palette.onSurfaceMuted }]}>
              Core (claro) para uso diurno · Dark Ops para patrullas nocturnas.
            </Text>
            <View style={styles.themeRow}>
              <CommandButton
                label="Core"
                variant={mode === 'core' ? 'primary' : 'secondary'}
                onPress={() => setThemeMode('core')}
                style={styles.themeBtn}
              />
              <CommandButton
                label="Dark Ops"
                variant={mode === 'darkOps' ? 'success' : 'secondary'}
                onPress={() => setThemeMode('darkOps')}
                style={styles.themeBtn}
              />
            </View>
          </CommandCard>

          {canNovedad ? (
            <CommandCard title="Novedades RRHH">
              <Text style={[styles.cardSub, { color: palette.onSurfaceMuted }]}>
                Ausencias, licencias y avisos («Hoy no me presento») con la misma clasificación que el portal web.
              </Text>
              <CommandButton label="Solicitar novedad" onPress={() => router.push('/novedad')} />
            </CommandCard>
          ) : null}

          <CommandCard title="Tu empresa">
            <View style={styles.flagGrid}>
              <Flag label="Fichada GPS" on={portalFeatures.checkIn} />
              <Flag label="Agenda" on={portalFeatures.viewSchedule} />
              <Flag label="Ausencias" on={portalFeatures.reportAbsence} />
              <Flag label="Licencias" on={portalFeatures.requestLicense} />
              <Flag label="Permutas" on={portalFeatures.swapShifts} />
            </View>
          </CommandCard>

          <Text style={[styles.section, { color: palette.primary }]}>Hoja de ruta app nativa</Text>
          {ROADMAP.map((item) => (
            <View
              key={item.title}
              style={[
                styles.row,
                { backgroundColor: palette.card, borderColor: palette.cardBorder },
              ]}
            >
              <Text style={[styles.rowTitle, { color: palette.onSurface }]}>{item.title}</Text>
              <Text
                style={[
                  styles.rowStatus,
                  { color: item.done ? palette.success : palette.primary },
                ]}
              >
                {item.status}
              </Text>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

function Flag({ label, on }: { label: string; on: boolean }) {
  const { palette } = useTheme();
  return (
    <View
      style={[
        styles.flag,
        {
          backgroundColor: on ? 'rgba(16,185,129,0.18)' : palette.inputBg,
          borderColor: on ? palette.success : palette.outline,
        },
      ]}
    >
      <Text
        style={[
          styles.flagText,
          { color: on ? palette.success : palette.onSurfaceMuted },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.container, gap: spacing.md },
  intro: { fontSize: 14, lineHeight: 21 },
  cardSub: { fontSize: 13, marginBottom: 4 },
  themeRow: { flexDirection: 'row', gap: 10 },
  themeBtn: { flex: 1 },
  flagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flag: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1 },
  flagText: { fontSize: 12, fontWeight: '800' },
  section: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  row: {
    borderRadius: radius.md,
    padding: 16,
    borderWidth: 1,
  },
  rowTitle: { fontWeight: '800' },
  rowStatus: { fontSize: 12, marginTop: 4, fontWeight: '600' },
});
