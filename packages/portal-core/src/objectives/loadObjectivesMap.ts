import { collection, getDocs, type Firestore } from 'firebase/firestore';
import type { ObjectiveLocation } from '@cosp/portal-types';

export async function loadObjectivesMap(db: Firestore): Promise<Record<string, ObjectiveLocation>> {
  const map: Record<string, ObjectiveLocation> = {};

  const addEntry = (key: string, entry: ObjectiveLocation) => {
    if (!key) return;
    map[key] = entry;
  };

  try {
    const snap = await getDocs(collection(db, 'objetivos'));
    snap.forEach((d) => {
      const data = d.data();
      const entry: ObjectiveLocation = {
        lat: data.lat || data.latitude || 0,
        lng: data.lng || data.longitude || 0,
        name: data.name || data.nombre || d.id,
        clientName: data.clientName || data.nombreCliente || '',
        address: data.address || data.direccion || '',
        allowRemoteCheckIn: !!data.allowRemoteCheckIn,
      };
      addEntry(d.id, entry);
      if (data.name) addEntry(data.name, entry);
      if (data.nombre) addEntry(data.nombre, entry);
      if (data.id) addEntry(String(data.id), entry);
    });
  } catch {
    /* emulador vacío */
  }

  try {
    const clientsSnap = await getDocs(collection(db, 'clients'));
    clientsSnap.forEach((cd) => {
      const cdata = cd.data();
      const clientName = cdata.name || cdata.nombre || cdata.razonSocial || '';
      (cdata.objetivos || []).forEach((o: Record<string, unknown>) => {
        const entry: ObjectiveLocation = {
          lat: Number(o.lat || o.latitude || 0),
          lng: Number(o.lng || o.longitude || 0),
          name: String(o.name || o.nombre || o.id || ''),
          clientName: String(o.clientName || clientName),
          address: String(o.address || o.direccion || ''),
          allowRemoteCheckIn: !!o.allowRemoteCheckIn,
        };
        if (o.id) addEntry(String(o.id), entry);
        if (o.name) addEntry(String(o.name), entry);
        if (o.nombre) addEntry(String(o.nombre), entry);
      });
    });
  } catch {
    /* sin clients */
  }

  return map;
}

export function getObjectiveForShift(
  objectivesMap: Record<string, ObjectiveLocation>,
  objectiveId?: string,
  objectiveName?: string,
): ObjectiveLocation | null {
  if (objectiveId && objectivesMap[objectiveId]) return objectivesMap[objectiveId];
  if (objectiveName && objectivesMap[objectiveName]) return objectivesMap[objectiveName];
  return null;
}
