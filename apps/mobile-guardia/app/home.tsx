import { useMemo } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getObjectiveForShift, getCheckInTiming } from '@cosp/portal-core';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { useEmployeeShifts } from '../src/hooks/useEmployeeShifts';
import { useObjectivesMap } from '../src/hooks/useObjectivesMap';
import { useCheckIn } from '../src/hooks/useCheckIn';
import { useEmpresaBranding } from '../src/hooks/useEmpresaBranding';
import { heroShift, pickTodayShiftAny } from '../src/lib/shifts';
import { CommandButton } from '../src/components/ui/CommandButton';
import { CommandCard } from '../src/components/ui/CommandCard';
import { formatHeroTimeRange, HeroShiftPanel } from '../src/components/ui/HeroShiftPanel';
import { colors, radius } from '../src/theme/tokens';

function heroHeadline(todayAny: ReturnType<typeof pickTodayShiftAny>, hasNext: boolean): string {
  if (todayAny) return 'HOY';
  if (hasNext) return 'PRÓXIMO';
  return 'SIN TURNO';
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, employee, empDocId, portalFeatures, signOut } = usePortalAuth();
  const { shifts, loading, error } = useEmployeeShifts(empDocId);
  const { objectivesMap } = useObjectivesMap();
  const { pendingCount, busyShiftId, requestCheckInForShift, notifyLateArrival } = useCheckIn();
  const { empresaNombre } = useEmpresaBranding(employee?.empresaId);

  const displayName = useMemo(() => {
    if (employee?.lastName || employee?.firstName) {
      return `${employee.lastName || ''}${employee.lastName && employee.firstName ? ', ' : ''}${employee.firstName || ''}`.trim();
    }
    return user?.email?.split('@')[0] || 'Vigilador';
  }, [employee, user]);

  const now = new Date();
  const todayAny = pickTodayShiftAny(shifts, now);
  const mainShift = heroShift(shifts, now);
  const timing = mainShift ? getCheckInTiming(mainShift, now) : null;
  const objective = mainShift
    ? getObjectiveForShift(objectivesMap, mainShift.objectiveId, mainShift.objectiveName)
    : null;

  const rawStatus = mainShift?.status || (mainShift?.isPresent ? 'PRESENT' : 'ASSIGNED');
  const isConfirmed =
    !!mainShift &&
    (mainShift.isPresent || rawStatus === 'PRESENT' || rawStatus === 'InProgress');
  const hasPendingRequest = !!mainShift?.checkInRequestedAt && !isConfirmed;
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
    const result = await requestCheckInForShift(mainShift, objectivesMap);
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
      : mainShift
        ? formatHeroTimeRange(mainShift)
        : 'No hay turnos en el mes actual';

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Centro de comando',
          headerRight: () => (
            <Text style={styles.headerAction} onPress={() => signOut().then(() => router.replace('/login'))}>
              Salir
            </Text>
          ),
        }}
      />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.welcome}>
            <Text style={styles.welcomeLabel}>Portal del vigilador</Text>
            <Text style={styles.welcomeName}>{displayName}</Text>
            {employee?.fileNumber ? (
              <Text style={styles.welcomeMeta}>Legajo {employee.fileNumber}</Text>
            ) : null}
          </View>

          {loading ? (
            <ActivityIndicator size="large" color={colors.indigo600} style={styles.loader} />
          ) : error ? (
            <CommandCard title="Cronograma">
              <Text style={styles.error}>{error}</Text>
            </CommandCard>
          ) : (
            <HeroShiftPanel
              headline={heroHeadline(todayAny, !!mainShift && !todayAny)}
              subline={heroSub}
              shift={mainShift}
              objective={objective}
              empresaNombre={empresaNombre || 'Grupo Bacar'}
              statusSlot={
                <>
                  {isConfirmed ? (
                    <View style={styles.presentBox}>
                      <Text style={styles.presentText}>✓ Presente registrado</Text>
                    </View>
                  ) : null}
                  {hasPendingRequest ? (
                    <Text style={styles.pendingLine}>Solicitud de presente en revisión</Text>
                  ) : null}
                  {pendingCount > 0 ? (
                    <Text style={styles.pendingLine}>
                      {pendingCount} fichada(s) pendientes de sincronizar
                    </Text>
                  ) : null}
                  {timing?.tooEarly ? (
                    <Text style={styles.hintLine}>Podés fichar desde 15 min antes del inicio</Text>
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

          <View style={styles.quickGrid}>
            {portalFeatures.viewSchedule ? (
              <CommandCard style={styles.quickCard}>
                <Text style={styles.quickTitle}>Agenda</Text>
                <Text style={styles.quickSub}>{shifts.length} turnos este mes</Text>
                <CommandButton
                  label="Ver cronograma"
                  variant="secondary"
                  onPress={() => router.push('/agenda')}
                />
              </CommandCard>
            ) : null}
            <CommandCard style={styles.quickCard}>
              <Text style={styles.quickTitle}>Más servicios</Text>
              <Text style={styles.quickSub}>Ausencias, permutas, credencial</Text>
              <CommandButton label="Abrir" variant="secondary" onPress={() => router.push('/mas')} />
            </CommandCard>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.slate50 },
  scroll: { padding: 20, gap: 20, paddingBottom: 36 },
  welcome: { gap: 4 },
  welcomeLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.indigo600,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  welcomeName: { fontSize: 26, fontWeight: '900', color: colors.slate950 },
  welcomeMeta: { fontSize: 14, color: colors.slate500, fontWeight: '600' },
  loader: { marginVertical: 40 },
  error: { color: colors.amber600 },
  presentBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: 'rgba(16,185,129,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.35)',
  },
  presentText: { color: colors.emerald200, fontWeight: '800', fontSize: 14 },
  pendingLine: { color: '#fcd34d', fontSize: 12, fontWeight: '700', marginTop: 8 },
  hintLine: { color: colors.indigo200, fontSize: 12, marginTop: 6, opacity: 0.9 },
  heroActions: { gap: 10, marginTop: 16 },
  quickGrid: { gap: 14 },
  quickCard: { gap: 8 },
  quickTitle: { fontSize: 17, fontWeight: '800', color: colors.indigo900 },
  quickSub: { fontSize: 13, color: colors.slate500, marginBottom: 4 },
  headerAction: { color: colors.white, fontWeight: '800', marginRight: 12, fontSize: 14 },
});
