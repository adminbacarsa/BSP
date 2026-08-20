import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getCheckInTiming,
  resolveCheckInUiStatus,
  resolveEvShiftDisplay,
  isEvShift,
} from '@cosp/portal-core';
import { isEmulatorMode } from '../../src/lib/portal';
import { usePortalAuth } from '../../src/context/PortalAuthContext';
import { useEmployeeShifts } from '../../src/hooks/useEmployeeShifts';
import { useObjectivesMap } from '../../src/hooks/useObjectivesMap';
import { useCheckIn } from '../../src/hooks/useCheckIn';
import { useEmpresaBranding } from '../../src/hooks/useEmpresaBranding';
import { useConvocatoriasPendientes } from '../../src/hooks/useConvocatoriasPendientes';
import { useEventosMap } from '../../src/hooks/useEventosMap';
import { usePortalInbox } from '../../src/hooks/usePortalInbox';
import { heroShift, pickTodayShiftAny } from '../../src/lib/shifts';
import { resolveShiftPlacement } from '../../src/lib/shiftPlacement';
import { appRoutes } from '../../src/lib/appRoutes';
import { CommandButton } from '../../src/components/ui/CommandButton';
import { CommandCard } from '../../src/components/ui/CommandCard';
import { ConvocatoriasBanner } from '../../src/components/ConvocatoriasBanner';
import { EvShiftDetails } from '../../src/components/EvShiftDetails';
import { PreviewModeBanner } from '../../src/components/PreviewModeBanner';
import { formatHeroTimeRange, HeroShiftPanel } from '../../src/components/ui/HeroShiftPanel';
import { CheckInStatusBanner } from '../../src/components/ui/CheckInStatusBanner';
import { RequireAuth } from '../../src/hooks/useRequireAuth';
import { radius, spacing } from '../../src/theme/tokens';
import { PortalErrorPanel } from '../../src/components/PortalErrorPanel';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { useTheme } from '../../src/theme/ThemeContext';

function heroHeadline(todayAny: ReturnType<typeof pickTodayShiftAny>, hasNext: boolean): string {
  if (todayAny) return 'HOY';
  if (hasNext) return 'PRÓXIMO';
  return 'SIN TURNO';
}

export default function HoyScreen() {
  return (
    <RequireAuth>
      <HoyScreenContent />
    </RequireAuth>
  );
}

function HoyScreenContent() {
  const router = useRouter();
  const navigation = useNavigation();
  const { palette } = useTheme();
  const { isOffline } = useNetworkStatus();
  const {
    user,
    employee,
    empDocId,
    portalFeatures,
    signOut,
    refreshEmployee,
    employeeProfileLoading,
    employeeProfileReady,
    employeeProfileError,
  } = usePortalAuth();
  const { shifts, loading, error } = useEmployeeShifts(empDocId, user?.uid ?? null);
  const { objectivesMap } = useObjectivesMap();
  const { pendingCount, pendingShiftIds, busyShiftId, requestCheckInForShift, notifyLateArrival } =
    useCheckIn();
  const { empresaNombre } = useEmpresaBranding(employee?.empresaId);
  const { convocatoriasPendientes } = useConvocatoriasPendientes(employee?.empresaId, empDocId);
  const { eventosMap } = useEventosMap(employee?.empresaId);
  const { unreadCount } = usePortalInbox(user);

  const profileMissing = employeeProfileReady && !employee && !empDocId && !!user;
  const profileStale = employeeProfileReady && !employee && !!empDocId && !!user;

  const profileRetried = useRef(false);

  useEffect(() => {
    if (user && !employee && employeeProfileReady && !employeeProfileLoading && !profileRetried.current) {
      profileRetried.current = true;
      void refreshEmployee();
    }
  }, [user, employee, employeeProfileReady, employeeProfileLoading, refreshEmployee]);

  useEffect(() => {
    navigation.setOptions({
      title: 'Hoy',
      headerRight: () => (
        <Text
          style={[styles.headerAction, { color: palette.headerTint }]}
          onPress={() => signOut().then(() => router.replace('/login'))}
        >
          Salir
        </Text>
      ),
    });
  }, [navigation, palette.headerTint, router, signOut]);

  const displayName = useMemo(() => {
    if (employee?.lastName || employee?.firstName) {
      return `${employee.lastName || ''}${employee.lastName && employee.firstName ? ', ' : ''}${employee.firstName || ''}`.trim();
    }
    return user?.email?.split('@')[0] || 'Vigilador';
  }, [employee, user]);

  const now = new Date();
  const todayAny = pickTodayShiftAny(shifts, now);
  const mainShift = heroShift(shifts, now, { empDocId, authUid: user?.uid ?? null });
  const placement = resolveShiftPlacement(mainShift, objectivesMap);
  const objective = placement.objectiveLocation;
  const labRelaxedCheckIn = isEmulatorMode() && objective?.allowRemoteCheckIn === true;
  const timing = mainShift ? getCheckInTiming(mainShift, now, { relaxWindow: labRelaxedCheckIn }) : null;

  const rawStatus = mainShift?.status || (mainShift?.isPresent ? 'PRESENT' : 'ASSIGNED');
  const isConfirmed =
    !!mainShift && (mainShift.isPresent || rawStatus === 'PRESENT' || rawStatus === 'InProgress');
  const hasPendingRequest = !!mainShift?.checkInRequestedAt && !isConfirmed;
  const checkInStatusView = resolveCheckInUiStatus(mainShift, timing, {
    offlinePendingForShift: !!mainShift && pendingShiftIds.includes(mainShift.id),
  });
  const canCheckIn =
    portalFeatures.checkIn &&
    !!mainShift &&
    !mainShift.isFranco &&
    timing?.canCheckIn &&
    !hasPendingRequest &&
    !isConfirmed;
  const canLate =
    portalFeatures.checkIn &&
    !!mainShift &&
    !mainShift.isFranco &&
    timing?.lateWindow &&
    !hasPendingRequest &&
    !isConfirmed &&
    !mainShift.lateArrivalAt;

  async function onCheckIn() {
    if (!mainShift) return;
    const result = await requestCheckInForShift(mainShift, objectivesMap, {
      empDocId,
      authUid: user?.uid ?? null,
    });
    Alert.alert(result.ok ? 'Presente' : 'Fichada', result.message);
  }

  async function onLate() {
    if (!mainShift) return;
    const result = await notifyLateArrival(mainShift.id);
    Alert.alert('Llegada tarde', result.message);
  }

  const heroSub =
    todayAny?.isFranco || mainShift?.isFranco
      ? 'Día de descanso programado'
      : mainShift && isEvShift(mainShift)
        ? resolveEvShiftDisplay(mainShift, eventosMap)?.nombre || formatHeroTimeRange(mainShift)
        : mainShift
          ? formatHeroTimeRange(mainShift)
          : 'No hay turnos en el mes actual';

  const mainShiftEv =
    mainShift && !mainShift.isFranco ? resolveEvShiftDisplay(mainShift, eventosMap) : null;

  return (
    <>
      <PreviewModeBanner />
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={[]}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.welcome}>
            <Text style={[styles.welcomeLabel, { color: palette.primary }]}>Portal del vigilador</Text>
            <Text style={[styles.welcomeName, { color: palette.onSurface }]}>{displayName}</Text>
            {employee?.fileNumber ? (
              <Text style={[styles.welcomeMeta, { color: palette.onSurfaceMuted }]}>
                Legajo {employee.fileNumber}
              </Text>
            ) : employeeProfileLoading ? (
              <Text style={[styles.welcomeMeta, { color: palette.onSurfaceMuted }]}>Cargando legajo…</Text>
            ) : profileStale ? (
              <View style={styles.profileWarnBox}>
                <Text style={[styles.welcomeWarn, { color: palette.warning }]}>
                  No se pudo leer el legajo (red lenta). Tocá reintentar.
                </Text>
                <CommandButton label="Reintentar legajo" variant="ghost" onPress={() => refreshEmployee()} />
              </View>
            ) : profileMissing ? (
              <View style={styles.profileWarnBox}>
                <Text style={[styles.welcomeWarn, { color: palette.warning }]}>
                  {employeeProfileError ||
                    (isEmulatorMode()
                      ? 'Sin legajo en Firestore. En la PC: npm run emulators y npm run seed.'
                      : 'Sin legajo asociado a esta cuenta. Contactá a RRHH.')}
                </Text>
                <CommandButton label="Reintentar legajo" variant="ghost" onPress={() => refreshEmployee()} />
              </View>
            ) : employeeProfileError && !employee ? (
              <View style={styles.profileWarnBox}>
                <Text style={[styles.welcomeWarn, { color: palette.warning }]}>{employeeProfileError}</Text>
                <CommandButton label="Reintentar legajo" variant="ghost" onPress={() => refreshEmployee()} />
              </View>
            ) : null}
          </View>

          {unreadCount > 0 ? (
            <Pressable
              onPress={() => router.push(appRoutes.alertas)}
              style={[
                styles.alertChip,
                { backgroundColor: palette.warningContainer, borderColor: palette.warning },
              ]}
            >
              <Text style={[styles.alertChipText, { color: palette.warning }]}>
                {unreadCount} alerta{unreadCount === 1 ? '' : 's'} sin leer · ver bandeja
              </Text>
            </Pressable>
          ) : null}

          {portalFeatures.viewEvents && convocatoriasPendientes.length > 0 ? (
            <ConvocatoriasBanner
              convocatorias={convocatoriasPendientes}
              onOpenEventos={() => router.push('/eventos')}
            />
          ) : null}

          {loading ? (
            <ActivityIndicator size="large" color={palette.primary} style={styles.loader} />
          ) : error ? (
            <PortalErrorPanel
              title="Cronograma"
              message={
                isOffline
                  ? 'Sin red: no se pueden actualizar turnos en tiempo real. Revisa Wi‑Fi o datos y reintenta.'
                  : error
              }
              onRetry={() => refreshEmployee()}
            />
          ) : shifts.length === 0 && !loading ? (
            <CommandCard title="Sin turnos este mes">
              <Text style={[styles.emptyShifts, { color: palette.onSurfaceMuted }]}>
                {isEmulatorMode()
                  ? 'Si recién configuraste el lab, ejecutá npm run seed en la PC y reiniciá sesión.'
                  : 'Cuando Planificación publique tu malla, vas a ver el turno de hoy acá.'}
              </Text>
              <CommandButton label="Reintentar carga" variant="secondary" onPress={() => refreshEmployee()} />
            </CommandCard>
          ) : (
            <HeroShiftPanel
              headline={heroHeadline(todayAny, !!mainShift && !todayAny)}
              subline={heroSub}
              shift={mainShift}
              placement={placement}
              empresaNombre={empresaNombre || 'Grupo Bacar'}
              statusSlot={
                <>
                  <CheckInStatusBanner view={checkInStatusView} />
                  {mainShiftEv ? <EvShiftDetails ev={mainShiftEv} compact /> : null}
                  {pendingCount > 0 && !pendingShiftIds.includes(mainShift?.id ?? '') ? (
                    <Text style={styles.pendingLine}>
                      {pendingCount} fichada(s) pendientes de sincronizar (otros turnos)
                    </Text>
                  ) : null}
                </>
              }
              footer={
                <View style={styles.heroActions}>
                  {portalFeatures.checkIn && canCheckIn ? (
                    <CommandButton
                      label="Marcar presente (GPS)"
                      variant="success"
                      loading={busyShiftId === mainShift?.id}
                      onPress={onCheckIn}
                    />
                  ) : null}
                  {portalFeatures.checkIn && canLate ? (
                    <CommandButton
                      label="Avisar llegada tarde"
                      variant="ghost"
                      loading={busyShiftId === mainShift?.id}
                      onPress={onLate}
                    />
                  ) : null}
                </View>
              }
            />
          )}

          <View style={styles.quickRow}>
            {portalFeatures.viewEvents ? (
              <CommandCard style={styles.quickHalf}>
                <Text style={[styles.quickTitle, { color: palette.onSurface }]}>Eventos</Text>
                <Text style={[styles.quickSub, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
                  {convocatoriasPendientes.length > 0
                    ? `${convocatoriasPendientes.length} pendiente(s)`
                    : 'Servicios EV'}
                </Text>
                <CommandButton label="Abrir" variant="secondary" onPress={() => router.push('/eventos')} />
              </CommandCard>
            ) : null}
            <CommandCard style={styles.quickHalf}>
              <Text style={[styles.quickTitle, { color: palette.onSurface }]}>Credencial</Text>
              <Text style={[styles.quickSub, { color: palette.onSurfaceMuted }]} numberOfLines={2}>
                QR y verificación
              </Text>
              <CommandButton
                label="Abrir"
                variant="secondary"
                onPress={() => router.push('/credencial')}
              />
            </CommandCard>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.container, gap: spacing.lg, paddingBottom: 24 },
  welcome: { gap: 4 },
  welcomeLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  welcomeName: { fontSize: 26, fontWeight: '900' },
  welcomeMeta: { fontSize: 14, fontWeight: '600' },
  welcomeWarn: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  profileWarnBox: { marginTop: 6, gap: 8 },
  alertChip: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  alertChipText: { fontSize: 13, fontWeight: '800' },
  loader: { marginVertical: 40 },
  emptyShifts: { fontSize: 14, lineHeight: 22 },
  pendingLine: { fontSize: 12, fontWeight: '700', marginTop: 8 },
  heroActions: { gap: 10, marginTop: 16 },
  quickRow: { flexDirection: 'row', gap: 12 },
  quickHalf: { flex: 1, gap: 8 },
  quickTitle: { fontSize: 16, fontWeight: '800' },
  quickSub: { fontSize: 12, marginBottom: 4, minHeight: 32 },
  headerAction: { fontWeight: '800', marginRight: 12, fontSize: 14 },
});
