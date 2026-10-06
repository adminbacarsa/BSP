import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { getPortalFirebase } from '../lib/portal';
import { usePortalAuth } from '../context/PortalAuthContext';

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

export function useConsultasDisponibilidad(uid: string | null | undefined) {
  const { db } = getPortalFirebase();
  const { deviceVerified } = usePortalAuth();
  const [items, setItems] = useState<ConsultaInvitacion[]>([]);

  useEffect(() => {
    if (deviceVerified !== true || !uid) {
      setItems([]);
      return;
    }
    const q = query(collection(db, 'consultas_disponibilidad_invitaciones'), where('uid', '==', uid));
    return onSnapshot(q, (snap) => {
      const ahora = Date.now();
      setItems(snap.docs.map((d) => {
        const data = d.data() as Omit<ConsultaInvitacion, 'id'>;
        return {
          id: d.id,
          estado: String(data.estado || ''),
          texto: String(data.texto || ''),
          clientName: data.clientName || null,
          objectiveName: data.objectiveName || null,
          positionName: data.positionName || null,
          venceAtMs: typeof data.venceAtMs === 'number' ? data.venceAtMs : null,
          jornadas: Array.isArray(data.jornadas) ? data.jornadas : [],
        };
      }).filter((i) => i.estado === 'PENDIENTE' && (!i.venceAtMs || i.venceAtMs > ahora)));
    }, () => setItems([]));
  }, [db, deviceVerified, uid]);

  return items;
}
