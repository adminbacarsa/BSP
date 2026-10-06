import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore';
import { getPortalFirebase } from '../lib/portal';
import { usePortalAuth } from '../context/PortalAuthContext';
import {
  consultaSigueAbierta,
  consultasListenKeys,
  type ConsultaListenField,
} from '../lib/consultasDisponibilidadQuery';

export type ConsultaInvitacion = {
  id: string;
  estado: string;
  texto: string;
  clientName: string | null;
  objectiveName: string | null;
  positionName: string | null;
  venceAtMs: number | null;
  jornadas: { fecha?: string; horaInicio?: string; horaFin?: string; code?: string }[];
};

function mapDoc(id: string, data: Record<string, unknown>): ConsultaInvitacion {
  return {
    id,
    estado: String(data.estado || ''),
    texto: String(data.texto || ''),
    clientName: (data.clientName as string) || null,
    objectiveName: (data.objectiveName as string) || null,
    positionName: (data.positionName as string) || null,
    venceAtMs: typeof data.venceAtMs === 'number' ? data.venceAtMs : null,
    jornadas: Array.isArray(data.jornadas) ? data.jornadas : [],
  };
}

/**
 * Invitaciones abiertas de la persona que está usando la app.
 * Vista previa: bolsaCuil / employeeId del previsualizado (el auth es el SuperAdmin).
 * Usuario real: uid, y también bolsaCuil o employeeId por si la invitación se creó sin uid.
 */
export function useConsultasDisponibilidad() {
  const { db } = getPortalFirebase();
  const { user, deviceVerified, isPreviewMode, isEventual, bolsaCuil, empDocId, eventualLegajos } = usePortalAuth();
  const [items, setItems] = useState<ConsultaInvitacion[]>([]);
  const legajosKey = eventualLegajos.map((l) => l.employeeId).join('|');

  useEffect(() => {
    const employeeIds = [empDocId, ...legajosKey.split('|')];
    const keys = consultasListenKeys({
      isPreviewMode,
      authUid: isPreviewMode ? null : user?.uid,
      bolsaCuil: isEventual || isPreviewMode ? bolsaCuil : null,
      employeeIds,
    });
    if (deviceVerified !== true || keys.length === 0) {
      setItems([]);
      return;
    }

    const buckets: Record<string, ConsultaInvitacion[]> = {};
    const unsubs: Unsubscribe[] = [];

    const publish = () => {
      const ahora = Date.now();
      const map = new Map<string, ConsultaInvitacion>();
      for (const list of Object.values(buckets)) {
        for (const item of list) {
          if (consultaSigueAbierta(item.estado, item.venceAtMs, ahora)) map.set(item.id, item);
        }
      }
      setItems([...map.values()]);
    };

    const listen = (field: ConsultaListenField, value: string) => {
      const key = `${field}:${value}`;
      buckets[key] = [];
      const q = query(collection(db, 'consultas_disponibilidad_invitaciones'), where(field, '==', value));
      unsubs.push(onSnapshot(q, (snap) => {
        buckets[key] = snap.docs.map((d) => mapDoc(d.id, d.data() as Record<string, unknown>));
        publish();
      }, () => {
        buckets[key] = [];
        publish();
      }));
    };

    keys.forEach((k) => listen(k.field, k.value));
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [db, deviceVerified, isPreviewMode, isEventual, bolsaCuil, empDocId, legajosKey, user?.uid]);

  return items;
}
