import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { CommandButton } from '../src/components/ui/CommandButton';
import { CommandCard } from '../src/components/ui/CommandCard';
import { RequireAuth } from '../src/hooks/useRequireAuth';
import { radius, spacing } from '../src/theme/tokens';
import { useTheme } from '../src/theme/ThemeContext';
import { usePortalInbox, type PortalInboxItem } from '../src/hooks/usePortalInbox';
import { getPortalCallables } from '../src/lib/portal';

const ROADMAP = [
  { title: 'Fichada GPS + offline', status: 'Listo', done: true },
  { title: 'Llegada tarde', status: 'Listo', done: true },
  { title: 'Ausencias y licencias', status: 'Formulario activo', done: true },
  { title: 'Adjunto certificado', status: 'Cámara y galería', done: true },
  { title: 'Notificaciones push', status: 'Auto al login', done: true },
  { title: 'Eventos EV', status: 'Convocatorias + solicitud', done: true },
  { title: 'Permutas', status: 'Con supervisor', done: true },
  { title: 'Credencial digital', status: 'QR + verificación', done: true },
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
  const { portalFeatures, user, signOut } = usePortalAuth();
  const { palette, mode, setThemeMode } = useTheme();
  const { items, loading: inboxLoading, unreadCount, markRead, markAllUnreadRead } = usePortalInbox(user);
  const [testBusy, setTestBusy] = useState(false);
  const canNovedad = portalFeatures.reportAbsence || portalFeatures.requestLicense;
  const scrollBottomPad = Math.max(insets.bottom, 12) + 88;

  const sendTestPush = useCallback(async () => {
    if (!user) return;
    setTestBusy(true);
    try {
      const callables = getPortalCallables();
      await callables.sendTestNotification({
        title: 'Prueba COSP Guardia',
        body: 'Si ves esto, FCM y la app nativa están alineados.',
      });
      Alert.alert('Enviada', 'Revisá la bandeja del sistema si la app está en segundo plano.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo enviar la prueba';
      Alert.alert('Error', msg);
    } finally {
      setTestBusy(false);
    }
  }, [user]);

  const openInboxItem = useCallback(
    (n: PortalInboxItem) => {
      if (!n.read) void markRead(n.id);
      if (n.type === 'CONVOCATORIA_EVENTO' || n.type === 'SWAP_REQUEST') {
        router.push(n.type === 'CONVOCATORIA_EVENTO' ? '/eventos' : '/permutas');
        return;
      }
    },
    [markRead, router],
  );

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

          <CommandCard title="Bandeja de alertas">
            <Text style={[styles.cardSub, { color: palette.onSurfaceMuted }]}>
              Las notificaciones push se activan automáticamente al iniciar sesión (permiso del sistema). Aquí ves el
              mismo historial que en el portal web.
              {unreadCount > 0 ? ` · ${unreadCount} sin leer` : ''}
            </Text>
            {__DEV__ ? (
              <CommandButton
                label={testBusy ? 'Enviando…' : 'Prueba FCM (dev)'}
                variant="secondary"
                onPress={sendTestPush}
                disabled={testBusy}
                style={{ marginBottom: 8 }}
              />
            ) : null}
            {unreadCount > 0 ? (
              <CommandButton label="Marcar todas leídas" variant="secondary" onPress={() => markAllUnreadRead()} />
            ) : null}
            {inboxLoading ? (
              <ActivityIndicator color={palette.primary} style={styles.inboxLoader} />
            ) : items.length === 0 ? (
              <Text style={[styles.cardSub, { color: palette.onSurfaceMuted }]}>Sin novedades en bandeja.</Text>
            ) : (
              items.slice(0, 6).map((n) => (
                <View
                  key={n.id}
                  style={[
                    styles.inboxItem,
                    {
                      backgroundColor: n.read ? palette.inputBg : palette.card,
                      borderColor: palette.cardBorder,
                    },
                  ]}
                >
                  <Text style={[styles.inboxTitle, { color: palette.onSurface }]}>
                    {n.title || 'Alerta'}
                    {!n.read ? ' · nueva' : ''}
                  </Text>
                  {n.body ? (
                    <Text style={[styles.inboxBody, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
                      {n.body}
                    </Text>
                  ) : null}
                  {n.type === 'CONVOCATORIA_EVENTO' ? (
                    <CommandButton
                      label="Ver convocatoria"
                      variant="primary"
                      onPress={() => openInboxItem(n)}
                      style={styles.markReadBtn}
                    />
                  ) : n.type === 'SWAP_REQUEST' ? (
                    <CommandButton
                      label="Ver permutas"
                      variant="secondary"
                      onPress={() => openInboxItem(n)}
                      style={styles.markReadBtn}
                    />
                  ) : !n.read ? (
                    <CommandButton
                      label="Marcar leída"
                      variant="secondary"
                      onPress={() => markRead(n.id)}
                      style={styles.markReadBtn}
                    />
                  ) : null}
                </View>
              ))
            )}
          </CommandCard>

          <CommandCard title="Credencial digital">
            <Text style={[styles.cardSub, { color: palette.onSurfaceMuted }]}>
              Foto, legajo, QR y código de verificación (misma lógica que el portal web).
            </Text>
            <CommandButton label="Ver credencial" onPress={() => router.push('/credencial')} />
          </CommandCard>

          {portalFeatures.viewEvents ? (
            <CommandCard title="Eventos (EV)">
              <Text style={[styles.cardSub, { color: palette.onSurfaceMuted }]}>
                Servicios especiales: solicitá cupo o respondé convocatorias del administrador (misma lógica que el
                portal web).
              </Text>
              <CommandButton label="Eventos y convocatorias" onPress={() => router.push('/eventos')} />
            </CommandCard>
          ) : null}

          {portalFeatures.swapShifts ? (
            <CommandCard title="Permutas de turno">
              <Text style={[styles.cardSub, { color: palette.onSurfaceMuted }]}>
                Pedí cambio con un compañero del mismo objetivo. Tras tu confirmación, un supervisor debe autorizar.
              </Text>
              <CommandButton label="Gestionar permutas" onPress={() => router.push('/permutas')} />
            </CommandCard>
          ) : null}

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
              <Flag label="Eventos" on={portalFeatures.viewEvents} />
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

          <CommandCard title="Sesión">
            <CommandButton label="Cerrar sesión" variant="secondary" onPress={() => signOut()} />
          </CommandCard>
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
  inboxLoader: { marginVertical: 12 },
  inboxItem: {
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  inboxTitle: { fontWeight: '800', fontSize: 14 },
  inboxBody: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  markReadBtn: { marginTop: 8 },
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
