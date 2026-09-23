import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getCheckInTiming,
  resolveCheckInUiStatus,
  resolveEvShiftDisplay,
} from '@cosp/portal-core';
import { isEmulatorMode } from '../../src/lib/portal';
import { usePortalAuth } from '../../src/context/PortalAuthContext';
import { useEmployeeShifts } from '../../src/hooks/useEmployeeShifts';
import { useObjectivesMap } from '../../src/hooks/useObjectivesMap';
import { useCheckIn } from '../../src/hooks/useCheckIn';
import { useEmpresaBranding } from '../../src/hooks/useEmpresaBranding';
import { useEventosPortal } from '../../src/hooks/useEventosPortal';
import { useEventosMap } from '../../src/hooks/useEventosMap';
import { usePortalInbox } from '../../src/hooks/usePortalInbox';
import { useConvocatoriasCobertura } from '../../src/hooks/useConvocatoriasCobertura';
import {
  heroShift,
  isActiveRetentionShift,
  isShiftInProgress,
  shiftStartsToday,
  pickTodayAbsentShift,
} from '../../src/lib/shifts';
import { resolveShiftPlacement } from '../../src/lib/shiftPlacement';
import { appRoutes } from '../../src/lib/appRoutes';
import { CommandButton } from '../../src/components/ui/CommandButton';
import { CommandCard } from '../../src/components/ui/CommandCard';
import { ConvocatoriasBanner } from '../../src/components/ConvocatoriasBanner';
import { CoberturaConvocatoriasBanner } from '../../src/components/CoberturaConvocatoriasBanner';
import { LlegadaTardeVenisBanner } from '../../src/components/LlegadaTardeVenisBanner';
import { RetentionBanner } from '../../src/components/RetentionBanner';
import { EvShiftDetails } from '../../src/components/EvShiftDetails';
import { PreviewModeBanner } from '../../src/components/PreviewModeBanner';
import {
  formatHeroShiftHeadline,
  formatHeroTimeRange,
  HeroShiftPanel,
} from '../../src/components/ui/HeroShiftPanel';
import { CheckInStatusBanner } from '../../src/components/ui/CheckInStatusBanner';
import { RequireAuth } from '../../src/hooks/useRequireAuth';
import { radius, spacing } from '../../src/theme/tokens';
import { PortalErrorPanel } from '../../src/components/PortalErrorPanel';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { useResponsiveLayout } from '../../src/hooks/useResponsiveLayout';
import { useClockNow } from '../../src/hooks/useClockNow';
import { useTheme } from '../../src/theme/ThemeContext';
import type { SolicitudEvento } from '@cosp/portal-types';
import type { ConvocatoriaCobertura } from '../../src/lib/convocatoriasCobertura';
import Constants from 'expo-constants';

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
  const params = useLocalSearchParams<{ focus?: string; convocatoriaId?: string }>();
  const { palette } = useTheme();
  const { isCompact, contentMaxWidth, horizontalPadding } = useResponsiveLayout();
  const { isOffline } = useNetworkStatus();
  const {
    user,
    employee,
    empDocId,
    portalFeatures,
    refreshEmployee,
    employeeProfileLoading,
    employeeProfileReady,
    employeeProfileError,
    isPreviewMode,
    previewEmpDocId,
  } = usePortalAuth();
  const { shifts, allShifts, loading, error } = useEmployeeShifts(empDocId, user?.uid ?? null);
  const { objectivesMap } = useObjectivesMap();
  const { pendingCount, pendingShiftIds, busyShiftId, requestCheckInForShift, notifyLateArrival, lateEtaByShiftId } =
    useCheckIn();
  const { empresaNombre } = useEmpresaBranding(employee?.empresaId);
  const appVersion = Constants.expoConfig?.version ?? '—';
  const headerTitle = useMemo(() => {
    const emp = (empresaNombre || '').trim();
    if (emp) return `COSP · ${emp} · v${appVersion}`;
    return `COSP Guardia · v${appVersion}`;
  }, [empresaNombre, appVersion]);
  const displayName = useMemo(() => {
    if (employee?.lastName || employee?.firstName) {
      return `${employee.lastName || ''}${employee.lastName && employee.firstName ? ', ' : ''}${employee.firstName || ''}`.trim();
    }
    return user?.email?.split('@')[0] || 'Vigilador';
  }, [employee, user]);
  const { convocatoriasPendientes, busyId: convocatoriaBusyId, responderConvocatoria } = useEventosPortal(
    employee?.empresaId,
    empDocId,
    displayName,
    { isPreviewMode },
  );
  const {
    coberturaPendientes,
    llegadaTardePendientes,
    busyId: coberturaBusyId,
    responder: responderCobertura,
  } = useConvocatoriasCobertura(empDocId, user?.uid ?? null);
  const { eventosMap } = useEventosMap(employee?.empresaId);
  const { unreadCount } = usePortalInbox(user, previewEmpDocId);

  const focusCobertura =
    String(params.focus || '').toLowerCase() === 'cobertura' ||
    !!String(params.convocatoriaId || '').trim();
  const highlightConvocatoriaId = String(params.convocatoriaId || '').trim() || null;

  async function onResponderConvocatoria(sol: SolicitudEvento, acepta: boolean) {
    const result = await responderConvocatoria(sol, acepta);
    Alert.alert(result.ok ? 'Listo' : 'Error', result.message);
  }

  async function onResponderCobertura(c: ConvocatoriaCobertura, acepta: boolean) {
    const result = await responderCobertura(c.id, acepta ? 'ACCEPTED' : 'REJECTED');
    Alert.alert(result.ok ? 'Listo' : 'Error', result.message);
  }

  async function onSiVoyLlegadaTarde(c: ConvocatoriaCobertura, etaMinutes: number) {
    const result = await responderCobertura(c.id, 'ACCEPTED', { etaMinutes });
    Alert.alert(
      result.ok ? 'Listo' : 'Error',
      result.ok ? `Avisaste que llegás en ${etaMinutes} min` : result.message,
    );
  }

  async function onNoVoyLlegadaTarde(c: ConvocatoriaCobertura) {
    const result = await responderCobertura(c.id, 'REJECTED', {
      rejectionReason: 'No voy',
    });
    Alert.alert(result.ok ? 'Listo' : 'Error', result.ok ? 'Marcado como no voy' : result.message);
  }

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
      title: headerTitle,
      headerTitleStyle: { fontSize: 14, fontWeight: '700' },
      headerTitleNumberOfLines: 1,
      headerRight: undefined,
    });
  }, [navigation, headerTitle]);

  const now = useClockNow(30_000);
  const todayAbsentShift = pickTodayAbsentShift(allShifts ?? shifts, now);
  const mainShift = todayAbsentShift
    ? undefined
    : heroShift(shifts, now, { empDocId, authUid: user?.uid ?? null });
  const placement = resolveShiftPlacement(todayAbsentShift || mainShift, objectivesMap);
  const objective = placement.objectiveLocation;
  const labRelaxedCheckIn = isEmulatorMode() && objective?.allowRemoteCheckIn === true;
  const etaOverride =
    mainShift && lateEtaByShiftId[mainShift.id] != null ? lateEtaByShiftId[mainShift.id] : null;
  const timing = mainShift
    ? getCheckInTiming(mainShift, now, {
        relaxWindow: labRelaxedCheckIn,
        etaMinutesOverride: etaOverride,
      })
    : null;
  const heroInProgress = !!mainShift && isShiftInProgress(mainShift, now);
  const isHeroToday = !!mainShift && shiftStartsToday(mainShift, now);
  const isOpsHero =
    !!mainShift && String(mainShift.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE';
  const isRetentionHero = isActiveRetentionShift(mainShift);
  const heroSectionLabel = todayAbsentShift
    ? 'Ausente'
    : isRetentionHero
      ? 'Retenido'
      : isOpsHero
        ? 'Turno asignado'
        : heroInProgress
          ? 'Turno actual'
          : 'Próximo turno';

  const rawStatus = mainShift?.status || (mainShift?.isPresent ? 'PRESENT' : 'ASSIGNED');
  const isConfirmed =
    !!mainShift && (mainShift.isPresent || rawStatus === 'PRESENT' || rawStatus === 'InProgress');
  const hasPendingRequest = !!mainShift?.checkInRequestedAt && !isConfirmed;
  const hasLocalLateEta = !!mainShift && lateEtaByShiftId[mainShift.id] != null;
  const checkInStatusView = resolveCheckInUiStatus(
    mainShift
      ? ({
          ...mainShift,
          ...(hasLocalLateEta && !mainShift.lateArrivalAt
            ? { lateArrivalAt: new Date().toISOString(), etaMinutes: lateEtaByShiftId[mainShift.id] }
            : hasLocalLateEta
              ? { etaMinutes: lateEtaByShiftId[mainShift.id] }
              : {}),
        } as typeof mainShift)
      : mainShift,
    timing,
    {
      offlinePendingForShift: !!mainShift && pendingShiftIds.includes(mainShift.id),
    },
  );
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
    !isOpsHero &&
    !isRetentionHero &&
    !!timing?.canNotifyLate &&
    !hasPendingRequest &&
    !isConfirmed &&
    !mainShift.lateArrivalAt &&
    !(mainShift as { lateArrivalConfirmed?: boolean }).lateArrivalConfirmed &&
    !hasLocalLateEta;

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
    Alert.alert('Voy a llegar tarde', '¿Cuántos minutos de demora estimás?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: '15 min',
        onPress: () => {
          void notifyLateArrival(mainShift.id, 15).then((result) =>
            Alert.alert('Llegada tarde', result.message),
          );
        },
      },
      {
        text: '30 min',
        onPress: () => {
          void notifyLateArrival(mainShift.id, 30).then((result) =>
            Alert.alert('Llegada tarde', result.message),
          );
        },
      },
      {
        text: '60 min',
        onPress: () => {
          void notifyLateArrival(mainShift.id, 60).then((result) =>
            Alert.alert('Llegada tarde', result.message),
          );
        },
      },
    ]);
  }

  const heroSub =
    todayAbsentShift
      ? 'Hoy estuviste ausente. Recordá presentar el certificado a RRHH — tenés tiempo hasta las 24:00 de hoy.'
      : isRetentionHero
        ? `Estás retenido en ${placement.objective} · esperá al relevo`
        : mainShift?.isFranco
          ? 'Día de descanso programado'
          : mainShift
            ? formatHeroTimeRange(mainShift)
            : 'No hay turnos en el mes actual';

  const mainShiftEv =
    mainShift && !mainShift.isFranco ? resolveEvShiftDisplay(mainShift, eventosMap) : null;

  return (
    <>
      <PreviewModeBanner />
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={[]}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              paddingHorizontal: horizontalPadding,
              ...(contentMaxWidth
                ? { maxWidth: contentMaxWidth, alignSelf: 'center' as const, width: '100%' }
                : {}),
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
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

          {coberturaPendientes.length > 0 ? (
            <CoberturaConvocatoriasBanner
              convocatorias={coberturaPendientes}
              busyId={coberturaBusyId}
              highlightedId={
                focusCobertura ? highlightConvocatoriaId || coberturaPendientes[0]?.id : null
              }
              onAccept={(c) => void onResponderCobertura(c, true)}
              onReject={(c) => void onResponderCobertura(c, false)}
            />
          ) : null}

          {llegadaTardePendientes.length > 0 ? (
            <LlegadaTardeVenisBanner
              convocatorias={llegadaTardePendientes}
              busyId={coberturaBusyId}
              onSiVoy={(c, eta) => void onSiVoyLlegadaTarde(c, eta)}
              onNoVoy={(c) => void onNoVoyLlegadaTarde(c)}
            />
          ) : null}

          {portalFeatures.viewEvents && convocatoriasPendientes.length > 0 ? (
            <ConvocatoriasBanner
              convocatorias={convocatoriasPendientes}
              busyId={convocatoriaBusyId}
              onAccept={(sol) => void onResponderConvocatoria(sol, true)}
              onReject={(sol) => void onResponderConvocatoria(sol, false)}
            />
          ) : null}

          {isRetentionHero && mainShift ? (
            <RetentionBanner objectiveName={placement.objective} />
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
          ) : shifts.length === 0 && !todayAbsentShift && !loading ? (
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
              headline={
                todayAbsentShift
                  ? 'HOY'
                  : formatHeroShiftHeadline(mainShift, { isToday: isHeroToday, now })
              }
              subline={
                todayAbsentShift
                  ? `${formatHeroTimeRange(todayAbsentShift)}\nHoy estuviste ausente. Recordá presentar el certificado a RRHH — tenés hasta las 24:00 de hoy.`
                  : heroSub
              }
              shift={todayAbsentShift || mainShift}
              placement={placement}
              empresaNombre={empresaNombre || 'Tu empresa'}
              sectionLabel={heroSectionLabel}
              statusSlot={
                todayAbsentShift ? (
                  <Text style={[styles.pendingLine, { color: palette.warning || '#b45309' }]}>
                    No fichar · certificado idealmente hoy (hasta 24:00)
                  </Text>
                ) : (
                  <>
                    <CheckInStatusBanner view={checkInStatusView} />
                    {mainShiftEv ? <EvShiftDetails ev={mainShiftEv} compact /> : null}
                    {pendingCount > 0 && !pendingShiftIds.includes(mainShift?.id ?? '') ? (
                      <Text style={styles.pendingLine}>
                        {pendingCount} fichada(s) pendientes de sincronizar (otros turnos)
                      </Text>
                    ) : null}
                  </>
                )
              }
              footer={
                todayAbsentShift ? null : (
                  <View style={styles.heroActions}>
                    {portalFeatures.checkIn && canCheckIn ? (
                      <CommandButton
                        label={isOpsHero ? 'Presente en cobertura (GPS)' : 'Marcar presente (GPS)'}
                        variant="success"
                        loading={busyShiftId === mainShift?.id}
                        onPress={onCheckIn}
                      />
                    ) : null}
                    {portalFeatures.checkIn && canLate ? (
                      <CommandButton
                        label="Voy a llegar tarde"
                        variant="ghost"
                        loading={busyShiftId === mainShift?.id}
                        onPress={onLate}
                      />
                    ) : null}
                  </View>
                )
              }
            />
          )}

          <View style={[styles.quickRow, isCompact && styles.quickRowStack]}>
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
  scroll: { paddingVertical: spacing.container, gap: spacing.lg, paddingBottom: 24 },
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
  quickRowStack: { flexDirection: 'column' },
  quickHalf: { flex: 1, gap: 8 },
  quickTitle: { fontSize: 16, fontWeight: '800' },
  quickSub: { fontSize: 12, marginBottom: 4, minHeight: 32 },
});
