import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Evento, ServicioEvento, SolicitudEvento } from '@cosp/portal-types';
import {
  createSolicitudEventoGuardia,
  loadEventosByEmpresaRange,
  loadSolicitudesEventoByEmpleado,
  portalEventosDateRange,
  rejectConvocatoriaEvento,
  serviciosDisponiblesPortal,
} from '@cosp/portal-core';
import { getPortalCallables, getPortalFirebase } from '../lib/portal';

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

  const reload = useCallback(async () => {
    if (!empresaId || !empDocId) {
      setEventos([]);
      setSolicitudes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { from, to } = portalEventosDateRange();
    try {
      const [evs, sols] = await Promise.all([
        loadEventosByEmpresaRange(db, empresaId, from, to),
        loadSolicitudesEventoByEmpleado(db, empDocId, empresaId, from, to),
      ]);
      setEventos(evs);
      setSolicitudes(sols);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar eventos');
    } finally {
      setLoading(false);
    }
  }, [db, empresaId, empDocId]);

  useEffect(() => {
    void reload();
  }, [reload]);

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
          message: e instanceof Error ? e.message : 'Error al solicitar',
        };
      } finally {
        setBusyId(null);
      }
    },
    [db, empresaId, empDocId, employeeName],
  );

  const responderConvocatoria = useCallback(
    async (sol: SolicitudEvento, acepta: boolean) => {
      if (!sol.id) {
        return { ok: false as const, message: 'Solicitud inválida' };
      }
      setBusyId(sol.id);
      try {
        if (acepta) {
          const callables = getPortalCallables();
          await callables.respondEventoConvocatoria({
            solicitudId: sol.id,
            accept: true,
            ...(isPreviewMode && empDocId ? { asEmployeeId: empDocId } : {}),
          });
        } else {
          if (isPreviewMode && empDocId) {
            const callables = getPortalCallables();
            await callables.respondEventoConvocatoria({
              solicitudId: sol.id,
              accept: false,
              asEmployeeId: empDocId,
            });
          } else {
            await rejectConvocatoriaEvento(db, sol.id);
          }
        }
        setSolicitudes((prev) =>
          prev.map((s) =>
            s.id === sol.id ? { ...s, status: acepta ? 'aprobada' : 'rechazada' } : s,
          ),
        );
        return {
          ok: true as const,
          message: acepta ? 'Participación confirmada' : 'Convocatoria rechazada',
        };
      } catch (e) {
        return {
          ok: false as const,
          message: e instanceof Error ? e.message : 'Error al responder',
        };
      } finally {
        setBusyId(null);
      }
    },
    [db, empDocId, isPreviewMode],
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
