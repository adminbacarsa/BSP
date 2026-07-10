/**
 * S3 — Detectar si el servicio es nuevo o tiene cronograma parcial.
 *
 * Consulta Firestore para determinar si ya existen turnos publicados
 * en el período, y devuelve cuántos empleados/puestos están cubiertos.
 * Si no hay turnos → esNuevo=true → activar modo generación.
 * Si los hay → esNuevo=false → activar modo incorporación.
 */

import * as admin from 'firebase-admin';
import { EstadoServicio } from '../types';

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * @param db          Instancia de Firestore (firebase-admin)
 * @param objetivoId  ID del objetivo / puesto
 * @param yearMonth   Período a evaluar, formato YYYY-MM
 */
export async function detectarEstadoServicio(
  db: admin.firestore.Firestore,
  objetivoId: string,
  yearMonth: string,
): Promise<EstadoServicio> {
  // Traer turnos del objetivo. Filtramos en memoria por yearMonth porque
  // startTime es un string ISO y Firestore no indexa prefijos de string.
  const snap = await db.collection('turnos')
    .where('objectiveId', '==', objetivoId)
    .where('draft', '!=', true)
    .get();

  const turnosMes = snap.docs.filter(d => {
    const st = d.data().startTime as unknown;
    return typeof st === 'string' && st.startsWith(yearMonth);
  });

  const empleadosSet = new Set<string>();
  const posicionesSet = new Set<string>();
  let ultimaFecha: string | undefined;

  for (const doc of turnosMes) {
    const data = doc.data();
    if (data.employeeId) empleadosSet.add(data.employeeId as string);
    if (data.positionName) posicionesSet.add(data.positionName as string);
    const fecha = typeof data.startTime === 'string' ? data.startTime.slice(0, 10) : undefined;
    if (fecha && (!ultimaFecha || fecha > ultimaFecha)) ultimaFecha = fecha;
  }

  return {
    esNuevo: turnosMes.length === 0,
    turnosExistentes: turnosMes.length,
    empleadosAsignados: [...empleadosSet],
    posicionesCubiertas: [...posicionesSet],
    ultimaFechaGeneracion: ultimaFecha,
  };
}

// ─── Variante lightweight (sin Firestore, para tests / frontend) ──────────────

/**
 * Detecta el estado a partir de turnos ya cargados en memoria.
 * Útil en el motor frontend donde los turnos ya están disponibles.
 */
export function detectarEstadoDesdeMemoria(
  turnos: Array<{ objectiveId: string; startTime: string; draft?: boolean; employeeId?: string; positionName?: string }>,
  objetivoId: string,
  yearMonth: string,
): EstadoServicio {
  const turnosMes = turnos.filter(
    t => t.objectiveId === objetivoId && !t.draft && t.startTime.startsWith(yearMonth),
  );

  const empleadosSet = new Set<string>();
  const posicionesSet = new Set<string>();
  let ultimaFecha: string | undefined;

  for (const t of turnosMes) {
    if (t.employeeId) empleadosSet.add(t.employeeId);
    if (t.positionName) posicionesSet.add(t.positionName);
    const fecha = t.startTime.slice(0, 10);
    if (!ultimaFecha || fecha > ultimaFecha) ultimaFecha = fecha;
  }

  return {
    esNuevo: turnosMes.length === 0,
    turnosExistentes: turnosMes.length,
    empleadosAsignados: [...empleadosSet],
    posicionesCubiertas: [...posicionesSet],
    ultimaFechaGeneracion: ultimaFecha,
  };
}
