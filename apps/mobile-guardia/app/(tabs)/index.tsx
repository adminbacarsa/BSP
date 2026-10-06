import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  empresaLabelDeTurno,
  getCheckInTiming,
  isExtendedDutyShift,
  isRecordatorioPendiente,
  isShiftPresent,
  mapsSearchUrl,
  timestampLikeToMillis,
  resolveCheckInUiStatus,
  resolveEvShiftDisplay,
} from '@cosp/portal-core';
import type { ConvocadoEtaMinutes } from '@cosp/portal-core';
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
import { usePendingAaCertificates } from '../../src/hooks/usePendingAaCertificates';
import {
  heroShift,
  isActiveRetentionShift,
  isShiftInProgress,
  shiftStartsToday,
  pickTodayAbsentShift,
} from '../../src/lib/shifts';
import { resolveShiftPlacement } from '../../src/lib/shiftPlacement';
import { appRoutes } from '../../src/lib/appRoutes';
import { firmarAnexoDelTurno } from '../../src/lib/heroShiftCard';
import { getPortalFirebase } from '../../src/lib/portal';
import { CommandButton } from '../../src/components/ui/CommandButton';
import { CommandCard } from '../../src/components/ui/CommandCard';
import { ConvocatoriasBanner } from '../../src/components/ConvocatoriasBanner';
import { ConsultasDisponibilidadBanner } from '../../src/components/ConsultasDisponibilidadBanner';
import { useConsultasDisponibilidad } from '../../src/hooks/useConsultasDisponibilidad';
import { responderConsultaDisponibilidad } from '../../src/lib/responderConsultaDisponibilidad';
import { argsPreviewConsulta, textoRespuestaCerrada } from '../../src/lib/consultasDisponibilidadQuery';
import { CoberturaConvocatoriasBanner } from '../../src/components/CoberturaConvocatoriasBanner';
import { LlegadaTardeVenisBanner } from '../../src/components/LlegadaTardeVenisBanner';
import { RetencionAvisoCard } from '../../src/components/RetencionAvisoCard';
import { isRetencionAviso } from '../../src/lib/avisosCc';
import { ConvocadoRecordatorioBanner } from '../../src/components/ConvocadoRecordatorioBanner';
import { RetentionBanner } from '../../src/components/RetentionBanner';
import { PreviewModeBanner } from '../../src/components/PreviewModeBanner';
import { EnableWebPushButton } from '../../src/components/EnableWebPushButton';
import { PendingAaCertificatesCard } from '../../src/components/PendingAaCertificatesCard';
import {
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
import { appAlert } from '@/lib/appAlert';
import { buildCoberturaRespondFeedback } from '../../src/lib/coberturaRespondFeedback';
import { responderRecordatorioConvocado } from '../../src/lib/responderRecordatorioConvocado';

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
  const params = useLocalSearchParams<{
    focus?: string;
    convocatoriaId?: string;
    etaMinutes?: string;
  }>();
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
    isEventual,
    bolsaCuil,
    eventualLegajos,
    empresasNombres,
  } = usePortalAuth();
  const { shifts, allShifts, loading, error } = useEmployeeShifts(empDocId, user?.uid ?? null);
  const { items: consultasDisponibilidad } = useConsultasDisponibilidad();
  const previewConsulta = argsPreviewConsulta({ isPreviewMode, bolsaCuil, employeeId: empDocId });
  const [consultaBusyId, setConsultaBusyId] = useState<string | null>(null);
  const { objectivesMap } = useObjectivesMap();
  const { pendingCount, pendingShiftIds, busyShiftId, requestCheckInForShift, closeReviewShift, notifyLateArrival, lateEtaByShiftId } =
    useCheckIn();
  const { empresaNombre, empresaColor } = useEmpresaBranding(employee?.empresaId);
  const appVersion = Constants.expoConfig?.version ?? '—';
  const headerTitle = useMemo(() => {
    if (isEventual) return `COSP · Eventual · v${appVersion}`;
    const emp = (empresaNombre || '').trim();
    if (emp) return `COSP · ${emp} · v${appVersion}`;
    return `COSP Guardia · v${appVersion}`;
  }, [empresaNombre, appVersion, isEventual]);
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
    aceptadas,
    busyId: coberturaBusyId,
    responder: responderCobertura,
  } = useConvocatoriasCobertura(empDocId, user?.uid ?? null);
  const { eventosMap } = useEventosMap(employee?.empresaId);
  const { items: inboxItems, unreadCount } = usePortalInbox(user, previewEmpDocId);
  const retencionAvisos = useMemo(
    () => inboxItems.filter((n) => isRetencionAviso(n.type)),
    [inboxItems],
  );
  const avisoBodyById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const n of inboxItems) {
      if (String(n.type || '').toUpperCase() !== 'CONVOCATORIA_COBERTURA') continue;
      const id = String(n.convocatoriaId || '').trim();
      const body = String(n.body || '').trim();
      if (id && body) map[id] = body;
    }
    return map;
  }, [inboxItems]);
  const { db } = getPortalFirebase();
  const {
    items: pendingAaItems,
    uploadingId: aaUploadingId,
    uploadCertificate: uploadAaCertificate,
  } = usePendingAaCertificates({
    db,
    authUid: user?.uid ?? null,
    empDocId,
    enabled: employeeProfileReady && !isPreviewMode,
  });

  const focusCobertura =
    String(params.focus || '').toLowerCase() === 'cobertura' ||
    (!!String(params.convocatoriaId || '').trim() &&
      String(params.focus || '').toLowerCase() !== 'recordatorio');
  const highlightConvocatoriaId = String(params.convocatoriaId || '').trim() || null;
  const focusRecordatorio = String(params.focus || '').toLowerCase() === 'recordatorio';
  const etaFromPush = Number(params.etaMinutes);

  const recordatorios = useMemo(() => {
    const pool = allShifts ?? shifts;
    const checked = (shiftId?: string) => {
      const row = pool.find((s) => s.id === shiftId);
      return !!row && isShiftPresent(row);
    };
    const pending = aceptadas.filter((c) => isRecordatorioPendiente(c, checked(c.shiftId)));
    if (!focusRecordatorio || !highlightConvocatoriaId) return pending;
    if (pending.some((c) => c.id === highlightConvocatoriaId)) return pending;
    const known = aceptadas.find((c) => c.id === highlightConvocatoriaId);
    if (known && checked(known.shiftId)) return pending;
    // Push recibido antes de que el snapshot traiga reminderSentAt / si ya respondió: no lo repite.
    if (known && timestampLikeToMillis(known.convocadoReplyAt) > 0) return pending;
    return [
      {
        ...(known ?? { id: highlightConvocatoriaId, type: 'RET', status: 'ACCEPTED' }),
        reminderSentAt: known?.reminderSentAt ?? new Date(),
        etaMinutes:
          known?.etaMinutes ?? (Number.isFinite(etaFromPush) && etaFromPush > 0 ? etaFromPush : undefined),
      },
      ...pending,
    ];
  }, [aceptadas, allShifts, shifts, focusRecordatorio, highlightConvocatoriaId, etaFromPush]);

  async function onResponderConvocatoria(sol: SolicitudEvento, acepta: boolean) {
    const result = await responderConvocatoria(sol, acepta);
    appAlert(result.ok ? 'Listo' : 'Error', result.message);
  }

  async function onResponderCobertura(c: ConvocatoriaCobertura, acepta: boolean) {
    if (coberturaBusyId) return;
    const response = acepta ? 'ACCEPTED' : 'REJECTED';
    const result = await responderCobertura(c.id, response);
    if (!result.ok) {
      appAlert('Cobertura', result.message);
      return;
    }
    const feedback = buildCoberturaRespondFeedback(response, {
      clientName: c.clientName,
      objectiveName: c.objectiveName,
      positionName: c.positionName,
      startTime: c.startTime,
      endTime: c.endTime,
      shiftCode: c.shiftCode,
    });
    if (acepta) {
      appAlert(feedback.title, feedback.message, [
        {
          text: 'Ver turno',
          onPress: () => {
            router.replace('/(tabs)?focus=cobertura' as never);
          },
        },
      ]);
    } else {
      appAlert(feedback.title, feedback.message);
    }
  }

  async function onSiVoyLlegadaTarde(c: ConvocatoriaCobertura, etaMinutes: number) {
    const result = await responderCobertura(c.id, 'ACCEPTED', { etaMinutes });
    appAlert(
      result.ok ? 'Listo' : 'Error',
      result.ok ? `Avisaste que llegás en ${etaMinutes} min` : result.message,
    );
  }

  async function onRecordatorioOnWay(
    c: { id: string },
    etaMinutes: ConvocadoEtaMinutes,
  ) {
    const result = await responderRecordatorioConvocado({
      convocatoriaId: c.id,
      action: 'ON_WAY',
      etaMinutes,
    });
    appAlert(
      result.ok ? 'En camino' : 'Recordatorio',
      result.ok ? `Avisaste que llegás en ${etaMinutes} min` : result.message,
    );
    if (result.ok) router.replace('/(tabs)' as never);
  }

  async function onRecordatorioProblem(c: { id: string }, note: string) {
    const result = await responderRecordatorioConvocado({
      convocatoriaId: c.id,
      action: 'PROBLEM',
      note,
    });
    appAlert(result.ok ? 'Avisamos a operaciones' : 'Recordatorio', result.ok ? 'Quedó registrado.' : result.message);
    if (result.ok) router.replace('/(tabs)' as never);
  }

  async function onNoVoyLlegadaTarde(c: ConvocatoriaCobertura) {
    const result = await responderCobertura(c.id, 'REJECTED', {
      rejectionReason: 'Tengo un problema',
    });
    appAlert(
      result.ok ? 'Listo' : 'Error',
      result.ok ? 'Avisamos a operaciones que tenés un problema' : result.message,
    );
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
  const hero = heroShift(allShifts ?? shifts, now, { empDocId, authUid: user?.uid ?? null });
  const heroPresent = !!hero && (
    hero.isPresent === true || String(hero.status || '').toUpperCase() === 'PRESENT'
  );
  const todayAbsentShift = heroPresent
    ? undefined
    : pickTodayAbsentShift(allShifts ?? shifts, now);
  const mainShift = todayAbsentShift ? undefined : hero;
  const placement = resolveShiftPlacement(todayAbsentShift || mainShift, objectivesMap);
  const objective = placement.objectiveLocation;
  const labRelaxedCheckIn = isEmulatorMode() && objective?.allowRemoteCheckIn === true;
  const etaOverride =
    mainShift && lateEtaByShiftId[mainShift.id] != null ? lateEtaByShiftId[mainShift.id] : null;
  const timing = mainShift
    ? getCheckInTiming(mainShift, now, {
        relaxWindow: labRelaxedCheckIn && employee?.fichadaRemota !== true,
        etaMinutesOverride: etaOverride,
        fichadaRemota: employee?.fichadaRemota === true,
      })
    : null;
  const heroInProgress = !!mainShift && isShiftInProgress(mainShift, now);
  const isHeroToday = !!mainShift && shiftStartsToday(mainShift, now);
  const isOpsHero =
    !!mainShift && String(mainShift.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE';
  const isRetentionHero = isActiveRetentionShift(mainShift);
  const extendDuty = !!mainShift && isExtendedDutyShift(mainShift as never);
  const heroSectionBase = todayAbsentShift
    ? 'Ausente'
    : isRetentionHero
      ? 'Retenido'
      : isOpsHero
          ? 'Turno asignado'
          : heroInProgress
            ? 'Turno actual'
            : 'Próximo turno';
  // Eventual: cada turno lleva la empresa a la que pertenece.
  const heroEmpresaLabel = isEventual
    ? empresaLabelDeTurno((todayAbsentShift || mainShift || {}) as { empresaId?: string }, eventualLegajos, empresasNombres)
    : null;
  const rawStatus = mainShift?.status || (mainShift?.isPresent ? 'PRESENT' : 'ASSIGNED');
  const isConfirmed =
    !!mainShift && (mainShift.isPresent || rawStatus === 'PRESENT' || rawStatus === 'InProgress');
  const canCloseReview =
    employee?.fichadaRemota === true &&
    isConfirmed &&
    mainShift?.isCompleted !== true &&
    !mainShift?.realEndTime;
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
  const convocadoHero = !!timing?.convocado && !isConfirmed && !todayAbsentShift;
  const convocadoProximo = convocadoHero && timing?.convocadoPhase === 'proximo';
  const canCheckIn =
    portalFeatures.checkIn &&
    !!mainShift &&
    !mainShift.isFranco &&
    !extendDuty &&
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
      employeeIds: eventualLegajos.map((l) => l.employeeId),
      previewAsEmployeeId: isPreviewMode ? String(mainShift.employeeId || '') : null,
      fichadaRemota: employee?.fichadaRemota === true,
      empresaId: employee?.empresaId ?? null,
    });
    appAlert(result.ok ? 'Presente' : 'Fichada', result.message);
  }

  async function onCloseReview() {
    if (!mainShift) return;
    const result = await closeReviewShift(mainShift.id);
    appAlert(result.ok ? 'Turno cerrado' : 'Cierre', result.message);
    if (result.ok) refreshEmployee();
  }

  async function onLate() {
    if (!mainShift) return;
    appAlert('Voy a llegar tarde', '¿Cuántos minutos de demora estimás?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: '10 min',
        onPress: () => {
          void notifyLateArrival(mainShift.id, 10).then((result) =>
            appAlert('Llegada tarde', result.message),
          );
        },
      },
      {
        text: '15 min',
        onPress: () => {
          void notifyLateArrival(mainShift.id, 15).then((result) =>
            appAlert('Llegada tarde', result.message),
          );
        },
      },
      {
        text: '30 min',
        onPress: () => {
          void notifyLateArrival(mainShift.id, 30).then((result) =>
            appAlert('Llegada tarde', result.message),
          );
        },
      },
    ]);
  }

  const mainShiftEv =
    (todayAbsentShift || mainShift) && !(todayAbsentShift || mainShift)?.isFranco
      ? resolveEvShiftDisplay((todayAbsentShift || mainShift) as NonNullable<typeof mainShift>, eventosMap)
      : null;
  const heroMapsUrl =
    mainShiftEv?.mapsUrl ||
    mapsSearchUrl(objective?.lat, objective?.lng, objective?.address) ||
    null;

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

          {!isPreviewMode ? <EnableWebPushButton /> : null}

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
              firstName={employee?.firstName}
              shifts={allShifts ?? shifts}
              objectivesMap={objectivesMap}
              onAccept={(c) => void onResponderCobertura(c, true)}
              onReject={(c) => void onResponderCobertura(c, false)}
            />
          ) : null}

          {recordatorios.length > 0 ? (
            <ConvocadoRecordatorioBanner
              convocatorias={recordatorios}
              busyId={coberturaBusyId}
              onOnWay={(c, eta) => void onRecordatorioOnWay(c, eta)}
              onProblem={(c, note) => void onRecordatorioProblem(c, note)}
            />
          ) : null}

          {retencionAvisos.length > 0 ? (
            <RetencionAvisoCard
              avisos={retencionAvisos}
              shifts={allShifts ?? shifts}
              objectivesMap={objectivesMap}
            />
          ) : null}

          {llegadaTardePendientes.length > 0 ? (
            <LlegadaTardeVenisBanner
              convocatorias={llegadaTardePendientes}
              shifts={allShifts ?? shifts}
              objectivesMap={objectivesMap}
              busyId={coberturaBusyId}
              bodyByConvocatoriaId={avisoBodyById}
              firstName={employee?.firstName}
              onSiVoy={(c, eta) => void onSiVoyLlegadaTarde(c, eta)}
              onNoVoy={(c) => void onNoVoyLlegadaTarde(c)}
            />
          ) : null}

          {consultasDisponibilidad.length > 0 ? (
            <ConsultasDisponibilidadBanner
              items={consultasDisponibilidad}
              busyId={consultaBusyId}
              nowMs={now.getTime()}
              onSi={(item) => {
                void (async () => {
                  setConsultaBusyId(item.id);
                  try {
                    const res = await responderConsultaDisponibilidad(item.id, 'SI', previewConsulta);
                    if (res.ok) appAlert('Listo', res.codigo === 'ASIGNADO' ? 'Quedó tu lugar.' : 'Recibimos tu respuesta.');
                    else appAlert('No se pudo', textoRespuestaCerrada(res.codigo, res.motivo));
                  } catch {
                    appAlert('Error', 'No se pudo enviar la respuesta.');
                  } finally {
                    setConsultaBusyId(null);
                  }
                })();
              }}
              onNo={(item) => {
                void (async () => {
                  setConsultaBusyId(item.id);
                  try {
                    await responderConsultaDisponibilidad(item.id, 'NO', previewConsulta);
                  } catch {
                    appAlert('Error', 'No se pudo enviar la respuesta.');
                  } finally {
                    setConsultaBusyId(null);
                  }
                })();
              }}
            />
          ) : null}

          {portalFeatures.viewEvents && convocatoriasPendientes.length > 0 ? (
            <ConvocatoriasBanner
              convocatorias={convocatoriasPendientes}
              busyId={convocatoriaBusyId}
              firstName={employee?.firstName}
              eventosMap={eventosMap}
              onAccept={(sol) => void onResponderConvocatoria(sol, true)}
              onReject={(sol) => void onResponderConvocatoria(sol, false)}
            />
          ) : null}

          {isRetentionHero && mainShift ? (
            <RetentionBanner objectiveName={placement.objective} />
          ) : null}

          <PendingAaCertificatesCard
            items={pendingAaItems}
            uploadingId={aaUploadingId}
            onUpload={uploadAaCertificate}
          />

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
              shift={todayAbsentShift || mainShift}
              placement={placement}
              isToday={!!todayAbsentShift || isHeroToday}
              timeRange={
                todayAbsentShift
                  ? formatHeroTimeRange(todayAbsentShift)
                  : mainShift && !mainShift.isFranco
                    ? formatHeroTimeRange(mainShift)
                    : null
              }
              ev={todayAbsentShift ? null : mainShiftEv}
              mapsUrl={heroMapsUrl}
              isRetention={isRetentionHero && !todayAbsentShift}
              isConvocado={convocadoHero && !convocadoProximo && !todayAbsentShift}
              empresaLabel={heroEmpresaLabel}
              accentColor={empresaColor}
              sectionLabel={
                todayAbsentShift
                  ? 'Ausente'
                  : convocadoProximo
                    ? 'Próximo turno'
                    : convocadoHero
                      ? 'En camino'
                      : heroSectionBase
              }
              statusSlot={
                todayAbsentShift ? (
                  <Text style={[styles.pendingLine, { color: palette.warning || '#b45309' }]}>
                    No fichar · certificado idealmente hoy (hasta 24:00)
                  </Text>
                ) : (
                  <>
                    <CheckInStatusBanner view={checkInStatusView} onHero />
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
                    {firmarAnexoDelTurno(mainShift).visible ? (
                      <CommandButton
                        label={firmarAnexoDelTurno(mainShift).label}
                        variant="secondary"
                        onPress={() =>
                          router.push({
                            pathname: '/codigo-anexo',
                            params: { contratoId: firmarAnexoDelTurno(mainShift).contratoId },
                          })
                        }
                      />
                    ) : null}
                    {heroMapsUrl ? (
                      <CommandButton
                        label="Cómo llegar"
                        variant="secondary"
                        onPress={() => void Linking.openURL(heroMapsUrl)}
                      />
                    ) : null}
                    {portalFeatures.checkIn && canCheckIn ? (
                      <CommandButton
                        label={checkInStatusView.actionLabel || 'Presente'}
                        variant="success"
                        loading={busyShiftId === mainShift?.id}
                        onPress={onCheckIn}
                      />
                    ) : null}
                    {canCloseReview ? (
                      <CommandButton
                        label="Cerrar turno"
                        variant="secondary"
                        loading={busyShiftId === mainShift?.id}
                        onPress={onCloseReview}
                      />
                    ) : null}
                    {portalFeatures.checkIn && canLate ? (
                      <CommandButton
                        label="Voy a llegar tarde"
                        variant="secondary"
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
