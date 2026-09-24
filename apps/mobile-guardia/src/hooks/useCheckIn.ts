import { useCallback, useEffect, useState } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
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
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (!window.isSecureContext) {
      throw new Error(
        'La ubicación en el navegador requiere HTTPS (o localhost). Abrí https://comtroldata.web.app/app/',
      );
    }
    if (!('geolocation' in navigator)) {
      throw new Error('Este navegador no soporta geolocalización. Probá Chrome o Safari actualizado.');
    }
  }

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error(
      Platform.OS === 'web'
        ? 'Permiso de ubicación denegado. En el candado de la barra de direcciones, permití «Ubicación» para este sitio y reintentá.'
        : 'Permiso de ubicación denegado. Activá GPS en ajustes.',
    );
  }
  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (Platform.OS === 'web') {
      throw new Error(
        msg.includes('denied') || msg.includes('Permission')
          ? 'No se pudo leer el GPS: permiso denegado o bloqueado por el navegador. Permití ubicación y reintentá.'
          : 'No se pudo obtener la ubicación. Verificá que el GPS esté activo y que el sitio tenga permiso.',
      );
    }
    throw err;
  }
}

export function useCheckIn() {
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingShiftIds, setPendingShiftIds] = useState<string[]>([]);
  const [busyShiftId, setBusyShiftId] = useState<string | null>(null);
  /** ETA local hasta que Firestore refleje etaMinutes del backend. */
  const [lateEtaByShiftId, setLateEtaByShiftId] = useState<Record<string, number>>({});

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
        const hasCoords =
          !!objective &&
          objective.lat != null &&
          objective.lng != null &&
          Number(objective.lat) !== 0 &&
          Number(objective.lng) !== 0;
        let coords: { latitude: number; longitude: number } | null = null;
        if (!remoteAllowed && hasCoords) {
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

  const notifyLateArrival = useCallback(async (shiftId: string, etaMinutes: number) => {
    setBusyShiftId(shiftId);
    try {
      const { notificarLlegadaTarde } = getPortalCallables();
      await notificarLlegadaTarde({ shiftId, etaMinutes });
      setLateEtaByShiftId((prev) => ({ ...prev, [shiftId]: etaMinutes }));
      return { ok: true as const, message: `Llegada tarde avisada · demora ${etaMinutes} min` };
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
    lateEtaByShiftId,
    requestCheckInForShift,
    notifyLateArrival,
    flushQueue,
  };
}
