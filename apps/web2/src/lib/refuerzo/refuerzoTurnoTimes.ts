import { calcRefuerzoPactadaHours } from '@/lib/refuerzo/refuerzoDisplay';
import { isTuraContiguousToParent } from '@/lib/refuerzo/turaContiguity';
import type { SolicitudRefuerzo } from '@/services/solicitudRefuerzoService';

export function buildRefuerzoTurnoIsoRange(sol: Pick<SolicitudRefuerzo, 'fecha' | 'startTime' | 'endTime'>): {
  startISO: string;
  endISO: string;
  fechaFin: string;
  horasPactadas: number;
} {
  const nextDayDate = (dateStr: string) => {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  };
  const fecha = String(sol.fecha || '').slice(0, 10);
  const startTime = String(sol.startTime || '').slice(0, 5);
  const endTime = String(sol.endTime || '').slice(0, 5);
  const isOvernight = endTime < startTime;
  const fechaFin = isOvernight ? nextDayDate(fecha) : fecha;
  const startISO = `${fecha}T${startTime}:00`;
  const endISO = `${fechaFin}T${endTime}:00`;
  const horasPactadas = calcRefuerzoPactadaHours(startTime, endTime);
  return { startISO, endISO, fechaFin, horasPactadas };
}

export async function buildTuraContiguousFlag(
  parentShiftId: string | undefined,
  sol: Pick<SolicitudRefuerzo, 'fecha' | 'startTime' | 'endTime'>,
  getParent?: (id: string) => Promise<Record<string, unknown> | null>,
): Promise<boolean | undefined> {
  if (!parentShiftId) return undefined;
  try {
    const { getDoc, doc } = await import('firebase/firestore');
    const { db } = await import('@/lib/firebase');
    const pdata = getParent
      ? await getParent(parentShiftId)
      : (await getDoc(doc(db, 'turnos', parentShiftId))).data();
    if (!pdata) return undefined;
    const { startISO, endISO } = buildRefuerzoTurnoIsoRange(sol);
    return isTuraContiguousToParent(
      { ...pdata, fecha: sol.fecha },
      { startTime: startISO, endTime: endISO, fecha: sol.fecha },
    );
  } catch {
    return undefined;
  }
}
