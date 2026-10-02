import { useCallback, useEffect, useState } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import type { Shift, ObjectiveLocation } from '@cosp/portal-types';
import {
  buildCheckInPayload,
  firestoreObjectiveReader,
  flushPendingCheckins,
  resolveObjectiveLocationForShift,
  validateCheckInDistance,
  OBJECTIVE_NOT_FOUND_MESSAGE,
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

  const invokeCheckIn = useCallback(async (payload: ReturnType<typeof buildCheckInPayload>, asEmployeeId?: string) => {
    const { auth } = getPortalFirebase();
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Sesión expirada. Volvé a iniciar sesión.');
    }
    await user.getIdToken(true);
    const { requestCheckIn } = getPortalCallables();
    await requestCheckIn(asEmployeeId ? { ...payload, asEmployeeId } : payload);
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
      owner?: {
        empDocId: string | null;
        authUid: string | null;
        employeeIds?: string[];
        /** Preview SuperAdmin: el turno se ficha a nombre de este legajo. */
        previewAsEmployeeId?: string | null;
        /** Legajo con fichadaRemota: sin radio de 80 m. */
        fichadaRemota?: boolean;
        /** Empresa del legajo: último recurso para buscar el objetivo en `clients`. */
        empresaId?: string | null;
      },
    ): Promise<{ ok: true; message: string } | { ok: false; message: string }> => {
      setBusyShiftId(shift.id);
      try {
        const shiftEmp = String(shift.employeeId ?? '').trim();
        const empDocId = owner?.empDocId?.trim() ?? '';
        const authUid = owner?.authUid?.trim() ?? '';
        // Eventual: el turno es del legajo de la empresa de ese turno, no del principal.
        const extraIds = (owner?.employeeIds ?? []).map((id) => id.trim()).filter(Boolean);
        const owns =
          !shiftEmp ||
          (empDocId && shiftEmp === empDocId) ||
          (authUid && shiftEmp === authUid) ||
          extraIds.includes(shiftEmp);
        if (!owns) {
          return {
            ok: false,
            message:
              'Este turno no está asignado a tu legajo. Cerrá sesión, entrá de nuevo (tras npm run seed) y probá el turno Planta Bacar Lab.',
          };
        }

        // El mapa puede venir incompleto (reglas, red): el objetivo del turno se resuelve
        // leyendo solo su cliente / su doc. Un error de lectura se informa como tal.
        const { db } = getPortalFirebase();
        const lookup = await resolveObjectiveLocationForShift(
          firestoreObjectiveReader(db),
          {
            objectiveId: shift.objectiveId,
            objectiveName: shift.objectiveName,
            clientId: shift.clientId,
            empresaId: shift.empresaId || owner?.empresaId || null,
          },
          objectivesMap,
        );
        if (lookup.status === 'error') {
          lookup.errors.forEach((err) =>
            console.warn('[checkIn] objetivo', shift.objectiveId, err instanceof Error ? err.message : String(err)),
          );
          if (owner?.fichadaRemota !== true) {
            return { ok: false, message: lookup.message };
          }
        }
        const objective = lookup.status === 'found' ? lookup.location : null;
        if (!objective && lookup.status === 'not_found' && owner?.fichadaRemota !== true) {
          console.warn('[checkIn] objetivo no encontrado', shift.objectiveId, shift.objectiveName, shift.clientId);
          return { ok: false, message: OBJECTIVE_NOT_FOUND_MESSAGE };
        }
        const remoteAllowed = objective?.allowRemoteCheckIn === true || owner?.fichadaRemota === true;
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
        const validation = validateCheckInDistance(objective, coords, {
          fichadaRemota: owner?.fichadaRemota === true,
        });
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

        await invokeCheckIn(payload, owner?.previewAsEmployeeId?.trim() || undefined);
        return { ok: true, message: 'Solicitud de presente enviada' };
      } catch (e) {
        return { ok: false, message: mapPortalCallableError(e) };
      } finally {
        setBusyShiftId(null);
      }
    },
    [invokeCheckIn, refreshPendingCount],
  );

  const closeReviewShift = useCallback(async (shiftId: string) => {
    setBusyShiftId(shiftId);
    try {
      const { cerrarTurnoPortal } = getPortalCallables();
      await cerrarTurnoPortal({ shiftId });
      return { ok: true as const, message: 'Turno cerrado' };
    } catch (e) {
      return { ok: false as const, message: mapPortalCallableError(e) };
    } finally {
      setBusyShiftId(null);
    }
  }, []);

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
    closeReviewShift,
    notifyLateArrival,
    flushQueue,
  };
}
