import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import type { Evento, ServicioEvento, SolicitudEvento } from '@cosp/portal-types';
import {
  createSolicitudEventoGuardia,
  loadEventosByEmpresaRange,
  portalEventosDateRange,
  serviciosDisponiblesPortal,
} from '@cosp/portal-core';
import { getPortalCallables, getPortalFirebase } from '../lib/portal';
import { mapPortalCallableError } from '../lib/mapPortalCallableError';

function todayKeyAr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function useEventosPortal(
  empresaId: string | undefined,
  empDocId: string | null,
  employeeName: string,
  opts?: { isPreviewMode?: boolean },
) {
  const { db } = getPortalFirebase();
  const isPreviewMode = !!opts?.isPreviewMode;
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [solicitudes, setSolicitudes] = useState<SolicitudEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadEventos = useCallback(async () => {
    if (!empresaId) {
      setEventos([]);
      return;
    }
    const { from, to } = portalEventosDateRange();
    try {
      const evs = await loadEventosByEmpresaRange(db, empresaId, from, to);
      setEventos(evs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar eventos');
    }
  }, [db, empresaId]);

  useEffect(() => {
    if (!empresaId || !empDocId) {
      setSolicitudes([]);
      setEventos([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    void reloadEventos().finally(() => setLoading(false));

    const { from, to } = portalEventosDateRange();
    const q = query(
      collection(db, 'solicitudes_evento'),
      where('empresaId', '==', empresaId),
      where('empleadoId', '==', empDocId),
      where('servicioFecha', '>=', from),
      where('servicioFecha', '<=', to),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setSolicitudes(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SolicitudEvento));
        setLoading(false);
      },
      (err) => {
        setError(err.message || 'No se pudieron escuchar convocatorias');
        setSolicitudes([]);
        setLoading(false);
      },
    );

    return () => unsub();
  }, [db, empresaId, empDocId, reloadEventos]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    await reloadEventos();
    setLoading(false);
  }, [reloadEventos]);

  const disponibles = useMemo(
    () => serviciosDisponiblesPortal(eventos, todayKeyAr()),
    [eventos],
  );

  const convocatoriasPendientes = useMemo(
    () => solicitudes.filter((s) => s.tipo === 'admin_convoca' && s.status === 'convocado'),
    [solicitudes],
  );

  const solicitar = useCallback(
    async (evento: Evento, servicio: ServicioEvento) => {
      if (!empresaId || !empDocId) return { ok: false as const, message: 'Sin legajo' };
      if (isPreviewMode) {
        return {
          ok: false as const,
          message:
            'En preview SuperAdmin no se puede solicitar cupo (queda a nombre del admin). Entrá con el login del vigilador o pedí convocatoria desde el panel.',
        };
      }
      setBusyId(servicio.id);
      try {
        const id = await createSolicitudEventoGuardia(db, {
          empresaId,
          eventoId: evento.id!,
          eventoNombre: evento.nombre,
          servicioId: servicio.id,
          servicioNombre: servicio.nombre,
          servicioFecha: servicio.fecha,
          empleadoId: empDocId,
          empleadoNombre: employeeName,
        });
        setSolicitudes((prev) => [
          ...prev,
          {
            id,
            empresaId,
            eventoId: evento.id!,
            eventoNombre: evento.nombre,
            servicioId: servicio.id,
            servicioNombre: servicio.nombre,
            servicioFecha: servicio.fecha,
            empleadoId: empDocId,
            empleadoNombre: employeeName,
            tipo: 'guardia_solicita',
            status: 'pendiente',
          },
        ]);
        return { ok: true as const, message: 'Solicitud enviada' };
      } catch (e) {
        return {
          ok: false as const,
          message: mapPortalCallableError(e),
        };
      } finally {
        setBusyId(null);
      }
    },
    [db, empresaId, empDocId, employeeName, isPreviewMode],
  );

  const responderConvocatoria = useCallback(
    async (sol: SolicitudEvento, acepta: boolean) => {
      if (!sol.id) {
        return { ok: false as const, message: 'Solicitud inválida' };
      }
      if (isPreviewMode && !empDocId) {
        return {
          ok: false as const,
          message: 'Preview sin legajo. Elegí un vigilador en Preview y reintentá.',
        };
      }
      setBusyId(sol.id);
      try {
        const callables = getPortalCallables();
        await callables.respondEventoConvocatoria({
          solicitudId: sol.id,
          accept: acepta,
          ...(isPreviewMode && empDocId ? { asEmployeeId: empDocId } : {}),
        });
        return {
          ok: true as const,
          message: acepta ? 'Participación confirmada' : 'Convocatoria rechazada',
        };
      } catch (e) {
        const mapped = mapPortalCallableError(e);
        if (
          isPreviewMode &&
          (/perfil de vigilador|sesión superadmin|asemployeeid/i.test(mapped) ||
            mapped.toLowerCase().includes('preview'))
        ) {
          return {
            ok: false as const,
            message:
              'Preview SuperAdmin: hace falta APK ≥ 1.1.2 (envía asEmployeeId) o login del vigilador. Si ya tenés 1.1.2+, salí y volvé a entrar al preview del legajo.',
          };
        }
        return {
          ok: false as const,
          message: mapped,
        };
      } finally {
        setBusyId(null);
      }
    },
    [empDocId, isPreviewMode],
  );

  return {
    eventos,
    solicitudes,
    disponibles,
    convocatoriasPendientes,
    loading,
    busyId,
    error,
    reload,
    solicitar,
    responderConvocatoria,
  };
}
