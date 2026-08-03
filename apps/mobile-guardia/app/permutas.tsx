import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDateAr, formatTimeAr } from '@cosp/portal-core';
import type { Shift } from '@cosp/portal-types';
import { usePortalAuth } from '../src/context/PortalAuthContext';
import { useEmployeeShifts } from '../src/hooks/useEmployeeShifts';
import { swapStatusLabel, useSwapRequests, type SwapRequestRow } from '../src/hooks/useSwapRequests';
import { CommandButton } from '../src/components/ui/CommandButton';
import { CommandCard } from '../src/components/ui/CommandCard';
import { RequireAuth } from '../src/hooks/useRequireAuth';
import { getPortalCallables } from '../src/lib/portal';
import { radius, spacing } from '../src/theme/tokens';
import { useTheme } from '../src/theme/ThemeContext';

type SwapCandidate = {
  shiftId: string;
  employeeId?: string;
  employeeName?: string;
  objectiveName?: string;
  clientName?: string;
  positionName?: string;
  startTime?: unknown;
  endTime?: unknown;
  code?: string;
};

export default function PermutasScreen() {
  return (
    <RequireAuth>
      <PermutasScreenContent />
    </RequireAuth>
  );
}

function PermutasScreenContent() {
  const insets = useSafeAreaInsets();
  const { empDocId, portalFeatures, user } = usePortalAuth();
  const { palette } = useTheme();
  const { shifts, loading: shiftsLoading } = useEmployeeShifts(empDocId, user?.uid ?? null);
  const { requests, loading: reqLoading, reload } = useSwapRequests(empDocId);

  const [myShiftId, setMyShiftId] = useState('');
  const [candidates, setCandidates] = useState<SwapCandidate[]>([]);
  const [targetShiftId, setTargetShiftId] = useState('');
  const [busy, setBusy] = useState(false);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  const scrollBottomPad = Math.max(insets.bottom, 12) + 24;

  const mySwappableShifts = useMemo(() => {
    return shifts.filter((s) => {
      const row = s as Shift & { isCompleted?: boolean; isPresent?: boolean; status?: string };
      if (row.isCompleted || row.isPresent) return false;
      if (s.isFranco) return true;
      const code = String(s.code || '').toUpperCase();
      return code && !['COMPLETED'].includes(String(s.status || '').toUpperCase());
    });
  }, [shifts]);

  useEffect(() => {
    if (!myShiftId) {
      setCandidates([]);
      setTargetShiftId('');
      return;
    }
    let cancelled = false;
    setCandidatesLoading(true);
    const callables = getPortalCallables();
    callables
      .getSwapCandidates({ shiftId: myShiftId })
      .then((res) => {
        if (cancelled) return;
        const list = (res.data as { data?: SwapCandidate[] })?.data ?? [];
        setCandidates(list);
      })
      .catch((e) => {
        if (!cancelled) Alert.alert('Error', e instanceof Error ? e.message : 'No se cargaron candidatos');
      })
      .finally(() => {
        if (!cancelled) setCandidatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [myShiftId]);

  const createRequest = useCallback(async () => {
    if (!myShiftId || !targetShiftId) {
      Alert.alert('Permuta', 'Seleccioná tu turno y el turno del compañero.');
      return;
    }
    setBusy(true);
    try {
      const callables = getPortalCallables();
      await callables.createSwapRequest({ myShiftId, targetShiftId });
      Alert.alert('Enviada', 'Tu compañero debe aceptar. Luego confirmás y un supervisor autoriza.');
      setMyShiftId('');
      setTargetShiftId('');
      setCandidates([]);
      await reload();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo crear la solicitud');
    } finally {
      setBusy(false);
    }
  }, [myShiftId, targetShiftId, reload]);

  const respond = useCallback(
    async (requestId: string, accept: boolean) => {
      setBusy(true);
      try {
        const callables = getPortalCallables();
        await callables.respondSwapRequest({ requestId, accept });
        await reload();
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo responder');
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const confirm = useCallback(
    async (requestId: string, confirmAction: boolean) => {
      setBusy(true);
      try {
        const callables = getPortalCallables();
        await callables.confirmSwapRequest({ requestId, confirm: confirmAction });
        await reload();
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo confirmar');
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const cancel = useCallback(
    async (requestId: string) => {
      setBusy(true);
      try {
        const callables = getPortalCallables();
        await callables.cancelSwapRequest({ requestId });
        await reload();
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'No se pudo cancelar');
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  if (!portalFeatures.swapShifts) {
    return (
      <>
        <Stack.Screen options={{ title: 'Permutas' }} />
        <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
          <CommandCard>
            <Text style={{ color: palette.onSurfaceMuted }}>Las permutas no están habilitadas para tu empresa.</Text>
          </CommandCard>
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Permutas' }} />
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: scrollBottomPad }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.intro, { color: palette.onSurfaceMuted }]}>
            Flujo: compañero acepta → vos confirmás → un supervisor autoriza en planificación. Hasta que el supervisor
            aprueba, los turnos no cambian en operaciones.
          </Text>

          <CommandCard title="Nueva permuta">
            {shiftsLoading ? (
              <ActivityIndicator color={palette.primary} />
            ) : (
              <>
                <Text style={[styles.label, { color: palette.primary }]}>Tu turno</Text>
                {mySwappableShifts.map((s) => (
                  <ShiftPick
                    key={s.id}
                    shift={s}
                    selected={myShiftId === s.id}
                    onPress={() => setMyShiftId(s.id)}
                  />
                ))}
                {myShiftId ? (
                  <>
                    <Text style={[styles.label, { color: palette.primary, marginTop: 12 }]}>Turno del compañero</Text>
                    {candidatesLoading ? (
                      <ActivityIndicator color={palette.primary} style={{ marginVertical: 8 }} />
                    ) : candidates.length === 0 ? (
                      <Text style={{ color: palette.onSurfaceMuted, fontSize: 13 }}>Sin candidatos en tu objetivo.</Text>
                    ) : (
                      candidates.map((c) => (
                        <CandidatePick
                          key={c.shiftId}
                          candidate={c}
                          selected={targetShiftId === c.shiftId}
                          onPress={() => setTargetShiftId(c.shiftId)}
                        />
                      ))
                    )}
                  </>
                ) : null}
                <CommandButton
                  label={busy ? 'Enviando…' : 'Enviar solicitud'}
                  onPress={createRequest}
                  disabled={busy || !myShiftId || !targetShiftId}
                  style={{ marginTop: 12 }}
                />
              </>
            )}
          </CommandCard>

          <CommandCard title="Solicitudes">
            {reqLoading ? (
              <ActivityIndicator color={palette.primary} />
            ) : requests.length === 0 ? (
              <Text style={{ color: palette.onSurfaceMuted }}>Sin solicitudes activas.</Text>
            ) : (
              requests.map((r) => (
                <SwapRequestCard
                  key={r.id}
                  row={r}
                  empDocId={empDocId}
                  userUid={user?.uid}
                  busy={busy}
                  onRespond={respond}
                  onConfirm={confirm}
                  onCancel={cancel}
                />
              ))
            )}
          </CommandCard>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

function ShiftPick({
  shift,
  selected,
  onPress,
}: {
  shift: Shift;
  selected: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  return (
    <View
      style={[
        styles.pick,
        {
          borderColor: selected ? palette.primary : palette.cardBorder,
          backgroundColor: selected ? palette.inputBg : palette.card,
        },
      ]}
    >
      <Text style={{ color: palette.onSurface, fontWeight: '700', flex: 1 }}>
        {formatDateAr(shift.startTime)} · {formatTimeAr(shift.startTime)} – {formatTimeAr(shift.endTime)}
      </Text>
      <CommandButton label={selected ? 'Seleccionado' : 'Elegir'} variant="secondary" onPress={onPress} />
    </View>
  );
}

function CandidatePick({
  candidate,
  selected,
  onPress,
}: {
  candidate: SwapCandidate;
  selected: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  return (
    <View
      style={[
        styles.pick,
        {
          borderColor: selected ? palette.success : palette.cardBorder,
          backgroundColor: selected ? palette.inputBg : palette.card,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: palette.onSurface, fontWeight: '800' }}>{candidate.employeeName || 'Compañero'}</Text>
        <Text style={{ color: palette.onSurfaceMuted, fontSize: 12 }}>
          {candidate.startTime ? formatDateAr(candidate.startTime as string) : '—'} ·{' '}
          {candidate.positionName || candidate.code || 'Turno'}
        </Text>
      </View>
      <CommandButton label={selected ? 'OK' : 'Elegir'} variant="secondary" onPress={onPress} />
    </View>
  );
}

function SwapRequestCard({
  row,
  empDocId,
  userUid,
  busy,
  onRespond,
  onConfirm,
  onCancel,
}: {
  row: SwapRequestRow;
  empDocId: string | null;
  userUid?: string;
  busy: boolean;
  onRespond: (id: string, accept: boolean) => void;
  onConfirm: (id: string, confirm: boolean) => void;
  onCancel: (id: string) => void;
}) {
  const { palette } = useTheme();
  const status = String(row.status || '');
  const isTarget = row.targetId === empDocId || row.targetUid === userUid;
  const isRequester = row.requesterId === empDocId || row.requesterUid === userUid;
  const closed = ['APPROVED', 'REJECTED', 'CANCELLED'].includes(status.toUpperCase());

  return (
    <View style={[styles.reqCard, { borderColor: palette.cardBorder, backgroundColor: palette.inputBg }]}>
      <Text style={{ color: palette.onSurface, fontWeight: '800' }}>
        {row.requesterName || 'Solicitante'} ⇄ {row.targetName || 'Compañero'}
      </Text>
      <Text style={{ color: palette.onSurfaceMuted, fontSize: 12, marginTop: 4 }}>
        {row.requesterShiftDate || '—'} · {swapStatusLabel(status)}
      </Text>
      {status === 'PENDING_SUPERVISOR' ? (
        <Text style={{ color: palette.primary, fontSize: 12, marginTop: 6 }}>
          Esperando autorización de un supervisor en planificación.
        </Text>
      ) : null}
      {!closed && status === 'PENDING_PEER' && isTarget ? (
        <View style={styles.rowBtns}>
          <CommandButton label="Aceptar" onPress={() => onRespond(row.id, true)} disabled={busy} />
          <CommandButton label="Rechazar" variant="secondary" onPress={() => onRespond(row.id, false)} disabled={busy} />
        </View>
      ) : null}
      {!closed && status === 'PENDING_REQUESTER' && isRequester ? (
        <View style={styles.rowBtns}>
          <CommandButton label="Confirmar permuta" onPress={() => onConfirm(row.id, true)} disabled={busy} />
          <CommandButton label="Cancelar" variant="secondary" onPress={() => onConfirm(row.id, false)} disabled={busy} />
        </View>
      ) : null}
      {!closed && (isRequester || isTarget) && status !== 'PENDING_SUPERVISOR' ? (
        <CommandButton
          label="Anular solicitud"
          variant="secondary"
          onPress={() => onCancel(row.id)}
          disabled={busy}
          style={{ marginTop: 8 }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: spacing.container, gap: spacing.md },
  intro: { fontSize: 13, lineHeight: 20, marginBottom: 4 },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginBottom: 8, textTransform: 'uppercase' },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: 8,
  },
  reqCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  rowBtns: { flexDirection: 'row', gap: 8, marginTop: 10 },
});
