import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePortalAuth } from '../../src/context/PortalAuthContext';
import { CommandButton } from '../../src/components/ui/CommandButton';
import { CommandCard } from '../../src/components/ui/CommandCard';
import { RequireAuth } from '../../src/hooks/useRequireAuth';
import { radius, spacing } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/ThemeContext';
import { useConvocatoriasPendientes } from '../../src/hooks/useConvocatoriasPendientes';
import { checkAndApplyAppUpdate, getAppVersionLabel } from '../../src/lib/appUpdate';

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
  const { portalFeatures, signOut, employee, empDocId } = usePortalAuth();
  const { palette, mode, setThemeMode } = useTheme();
  const { convocatoriasPendientes } = useConvocatoriasPendientes(employee?.empresaId, empDocId);
  const canNovedad = portalFeatures.reportAbsence || portalFeatures.requestLicense;
  const scrollBottomPad = Math.max(insets.bottom, 12) + 16;
  const [updateBusy, setUpdateBusy] = useState(false);

  const onCheckUpdate = useCallback(async () => {
    setUpdateBusy(true);
    try {
      const result = await checkAndApplyAppUpdate({ apply: true });
      if (result.reloading) return;
      Alert.alert('Actualización', result.message);
    } finally {
      setUpdateBusy(false);
    }
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={[]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottomPad }]}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.intro, { color: palette.onSurfaceMuted }]}>
          Servicios del portal. Los módulos deshabilitados por RRHH no aparecen. Las alertas están el
          tab Alertas.
        </Text>

        <CommandCard title="Actualización de la app">
          <Text style={[styles.cardSub, { color: palette.onSurfaceMuted }]}>
            Descarga mejoras sin desinstalar. Después de descargar, cerrá la app por completo
            (recientes) y volvé a abrirla. No reinicia sola (evita pantalla gris en Android).
          </Text>
          <Text style={[styles.versionLine, { color: palette.onSurface }]}>{getAppVersionLabel()}</Text>
          <CommandButton
            label={updateBusy ? 'Descargando…' : 'Descargar actualización'}
            variant="primary"
            loading={updateBusy}
            onPress={onCheckUpdate}
            disabled={updateBusy}
          />
        </CommandCard>

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

        <CommandCard title="Credencial digital">
          <Text style={[styles.cardSub, { color: palette.onSurfaceMuted }]}>
            Foto, legajo, QR y código de verificación (misma lógica que el portal web).
          </Text>
          <CommandButton label="Ver credencial" onPress={() => router.push('/credencial')} />
        </CommandCard>

        {portalFeatures.viewEvents ? (
          <CommandCard title="Eventos (EV)">
            <Text style={[styles.cardSub, { color: palette.onSurfaceMuted }]}>
              Servicios especiales: solicitá cupo o respondé convocatorias del administrador.
              {convocatoriasPendientes.length > 0
                ? ` · ${convocatoriasPendientes.length} convocatoria(s) pendiente(s)`
                : ''}
            </Text>
            <CommandButton
              label={
                convocatoriasPendientes.length > 0
                  ? `Responder (${convocatoriasPendientes.length})`
                  : 'Eventos y convocatorias'
              }
              variant={convocatoriasPendientes.length > 0 ? 'primary' : 'secondary'}
              onPress={() => router.push('/eventos')}
            />
          </CommandCard>
        ) : null}

        {portalFeatures.swapShifts ? (
          <CommandCard title="Permutas de turno">
            <Text style={[styles.cardSub, { color: palette.onSurfaceMuted }]}>
              Pedí cambio con un compañero del mismo objetivo. Tras tu confirmación, un supervisor
              debe autorizar.
            </Text>
            <CommandButton label="Gestionar permutas" onPress={() => router.push('/permutas')} />
          </CommandCard>
        ) : null}

        {canNovedad ? (
          <CommandCard title="Novedades RRHH">
            <Text style={[styles.cardSub, { color: palette.onSurfaceMuted }]}>
              Ausencias, licencias y avisos («Hoy no me presento») con la misma clasificación que el
              portal web.
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

        <CommandCard title="Sesión">
          <CommandButton label="Cerrar sesión" variant="secondary" onPress={() => signOut()} />
        </CommandCard>
      </ScrollView>
    </SafeAreaView>
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
      <Text style={[styles.flagText, { color: on ? palette.success : palette.onSurfaceMuted }]}>
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
  versionLine: { fontSize: 12, fontWeight: '800', marginBottom: 10 },
  themeRow: { flexDirection: 'row', gap: 10 },
  themeBtn: { flex: 1 },
  flagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flag: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1 },
  flagText: { fontSize: 12, fontWeight: '800' },
});
