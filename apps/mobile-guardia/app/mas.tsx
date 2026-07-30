import { StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { CommandButton } from '../src/components/ui/CommandButton';
import { CommandCard } from '../src/components/ui/CommandCard';
import { colors, radius } from '../src/theme/tokens';

const ROADMAP = [
  { title: 'Fichada GPS + offline', status: 'Listo', done: true },
  { title: 'Llegada tarde', status: 'Listo', done: true },
  { title: 'Ausencias y licencias', status: 'Formulario activo', done: true },
  { title: 'Adjunto certificado', status: 'F3-03', done: false },
  { title: 'Notificaciones push', status: 'F3 · EAS', done: false },
  { title: 'Permutas', status: 'F4', done: false },
  { title: 'Credencial digital', status: 'F5', done: false },
];

export default function MasScreen() {
  const router = useRouter();
  const { portalFeatures } = usePortalAuth();
  const canNovedad = portalFeatures.reportAbsence || portalFeatures.requestLicense;

  return (
    <>
      <Stack.Screen options={{ title: 'Servicios' }} />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.container}>
          <Text style={styles.intro}>
            Misma lógica que el portal web del empleado. Los módulos deshabilitados por RRHH no aparecen.
          </Text>

          {canNovedad ? (
            <CommandCard title="Novedades RRHH">
              <Text style={styles.cardSub}>Ausencias, licencias y avisos con la misma clasificación que el portal web.</Text>
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
          <Text style={styles.section}>Hoja de ruta app nativa</Text>
          {ROADMAP.map((item) => (
            <View key={item.title} style={styles.row}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={[styles.rowStatus, item.done ? styles.done : styles.pending]}>{item.status}</Text>
            </View>
          ))}
        </View>
      </SafeAreaView>
    </>
  );
}

function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <View style={[styles.flag, on ? styles.flagOn : styles.flagOff]}>
      <Text style={[styles.flagText, on ? styles.flagTextOn : styles.flagTextOff]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.slate50 },
  container: { padding: 20, gap: 14 },
  intro: { color: colors.slate500, fontSize: 14, lineHeight: 21 },
  cardSub: { fontSize: 13, color: colors.slate500, marginBottom: 4 },
  flagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flag: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1 },
  flagOn: { backgroundColor: '#d1fae5', borderColor: '#6ee7b7' },
  flagOff: { backgroundColor: colors.slate100, borderColor: colors.slate200 },
  flagText: { fontSize: 12, fontWeight: '800' },
  flagTextOn: { color: colors.emerald600 },
  flagTextOff: { color: colors.slate500 },
  section: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.indigo600,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  row: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.slate200,
  },
  rowTitle: { fontWeight: '800', color: colors.slate950 },
  rowStatus: { fontSize: 12, marginTop: 4, fontWeight: '600' },
  done: { color: colors.emerald600 },
  pending: { color: colors.indigo600 },
});
