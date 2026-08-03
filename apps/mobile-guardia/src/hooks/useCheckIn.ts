import { useCallback, useEffect, useState } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import type { Shift, ObjectiveLocation } from '@cosp/portal-types';
import {
  buildCheckInPayload,
  flushPendingCheckins,
  getObjectiveForShift,
  validateCheckInDistance,
  type PendingCheckInItem,
} from '@cosp/portal-core';
import { getPortalCallables, getPortalFirebase } from '../lib/portal';
import { mapPortalCallableError } from '../lib/mapPortalCallableError';
import { enqueuePendingCheckin, loadPendingCheckins, savePendingCheckins } from '../lib/pendingCheckins';

async function getCurrentCoords(): Promise<{ latitude: number; longitude: number }> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Permiso de ubicación denegado. Activá GPS en ajustes.');
  }
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
}

export function useCheckIn() {
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingShiftIds, setPendingShiftIds] = useState<string[]>([]);
  const [busyShiftId, setBusyShiftId] = useState<string | null>(null);

  const refreshPendingCount = useCallback(async () => {
    const list = await loadPendingCheckins();
    setPendingCount(list.length);
    setPendingShiftIds(list.map((item) => item.shiftId));
  }, []);

  const invokeCheckIn = useCallback(async (payload: ReturnType<typeof buildCheckInPayload>) => {
    const { auth } = getPortalFirebase();
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Sesión expirada. Volvé a iniciar sesión.');
    }
    await user.getIdToken(true);
    const { requestCheckIn } = getPortalCallables();
    await requestCheckIn(payload);
  }, []);

  const flushQueue = useCallback(async () => {
    const net = await NetInfo.fetch();
    if (!net.isConnected) return;
    const list = await loadPendingCheckins();
    if (list.length === 0) return;
    const remaining = await flushPendingCheckins(list, async (item) => {
      await invokeCheckIn({
        shiftId: item.shiftId,
        coords: item.coords,
        offline: true,
        recordedAt: item.recordedAt,
        idempotencyKey: item.idempotencyKey,
      });
    });
    await savePendingCheckins(remaining);
    setPendingCount(remaining.length);
    return remaining.length;
  }, [invokeCheckIn]);

  useEffect(() => {
    refreshPendingCount();
    flushQueue();
    const unsub = NetInfo.addEventListener((state: NetInfoState) => {
      if (state.isConnected) flushQueue();
    });
    return () => unsub();
  }, [flushQueue, refreshPendingCount]);

  const requestCheckInForShift = useCallback(
    async (
      shift: Shift,
      objectivesMap: Record<string, ObjectiveLocation>,
      owner?: { empDocId: string | null; authUid: string | null },
    ): Promise<{ ok: true; message: string } | { ok: false; message: string }> => {
      setBusyShiftId(shift.id);
      try {
        const shiftEmp = String(shift.employeeId ?? '').trim();
        const empDocId = owner?.empDocId?.trim() ?? '';
        const authUid = owner?.authUid?.trim() ?? '';
        const owns =
          !shiftEmp ||
          (empDocId && shiftEmp === empDocId) ||
          (authUid && shiftEmp === authUid);
        if (!owns) {
          return {
            ok: false,
            message:
              'Este turno no está asignado a tu legajo. Cerrá sesión, entrá de nuevo (tras npm run seed) y probá el turno Planta Bacar Lab.',
          };
        }

        const objective = getObjectiveForShift(
          objectivesMap,
          shift.objectiveId,
          shift.objectiveName,
        );
        const remoteAllowed = objective?.allowRemoteCheckIn === true;
        let coords: { latitude: number; longitude: number } | null = null;
        if (!remoteAllowed) {
          coords = await getCurrentCoords();
        } else {
          try {
            coords = await getCurrentCoords();
          } catch {
            coords = null;
          }
        }
        const validation = validateCheckInDistance(objective, coords);
        if (!validation.ok) {
          return { ok: false, message: validation.message };
        }

        const payload = buildCheckInPayload(shift.id, coords, false);
        const net = await NetInfo.fetch();
        if (!net.isConnected) {
          const pending: PendingCheckInItem = {
            ...payload,
            offline: true,
            createdAt: payload.recordedAt,
          };
          await enqueuePendingCheckin(pending);
          await refreshPendingCount();
          return { ok: true, message: 'Sin conexión. Presente guardado y se enviará al reconectar.' };
        }

        await invokeCheckIn(payload);
        return { ok: true, message: 'Solicitud de presente enviada' };
      } catch (e) {
        return { ok: false, message: mapPortalCallableError(e) };
      } finally {
        setBusyShiftId(null);
      }
    },
    [invokeCheckIn, refreshPendingCount],
  );

  const notifyLateArrival = useCallback(async (shiftId: string) => {
    setBusyShiftId(shiftId);
    try {
      const { notificarLlegadaTarde } = getPortalCallables();
      await notificarLlegadaTarde({ shiftId });
      return { ok: true as const, message: 'Llegada tarde notificada' };
    } catch (e) {
      return { ok: false as const, message: mapPortalCallableError(e) };
    } finally {
      setBusyShiftId(null);
    }
  }, []);

  return {
    pendingCount,
    pendingShiftIds,
    busyShiftId,
    requestCheckInForShift,
    notifyLateArrival,
    flushQueue,
  };
}
