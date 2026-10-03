/**
 * Recalcula guardia_puntaje desde las colecciones. Idempotente.
 * Los triggers solo marcan guardia_puntaje_dirty; el scheduler de 10 min y el diario lo escriben.
 * Escritura solo Admin SDK. El guardia no lee esta colección (reglas: tenant admin, sin publicar).
 */
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  ausenciaSinEfecto,
  calcularPuntajeDeFuentes,
  tiempoMs,
  type FuenteAusencia,
  type FuenteConvocatoria,
  type FuenteDesempenoEvento,
  type FuenteSolicitudEvento,
  type FuenteTurno,
  type FuentesDesempeno,
} from './puntajeGuardia';

export interface ClavePuntaje {
  empresaId: string;
  empleadoId?: string | null;
  bolsaCuil?: string | null;
  esEventual?: boolean;
}

function dbDefault(): Firestore {
  return admin.firestore();
}

export function claveDoc(clave: ClavePuntaje): string {
  return String(clave.empleadoId || clave.bolsaCuil || '').trim();
}

function avisoLlegada(data: Record<string, unknown>): boolean {
  return !!(data.lateArrivalAt || data.lateArrivalConfirmed === true || data.lateETA || data.earlyRetentionAlertAt);
}

async function leerIgual(db: Firestore, col: string, campo: string, valor: string): Promise<Array<Record<string, unknown> & { id: string }>> {
  if (!valor) return [];
  const snap = await db.collection(col).where(campo, '==', valor).limit(800).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

export async function fuentesDePersona(db: Firestore, clave: ClavePuntaje, desdeMs: number): Promise<FuentesDesempeno> {
  const empleadoId = String(clave.empleadoId || '').trim();
  const cuil = String(clave.bolsaCuil || '').trim();
  const turnosRaw = empleadoId ? await leerIgual(db, 'turnos', 'employeeId', empleadoId) : [];
  const ausRaw = empleadoId ? await leerIgual(db, 'ausencias', 'employeeId', empleadoId) : [];
  const convRaw = [
    ...(empleadoId ? await leerIgual(db, 'convocatorias_cobertura', 'candidateEmployeeId', empleadoId) : []),
    ...(cuil ? await leerIgual(db, 'convocatorias_cobertura', 'bolsaCuil', cuil) : []),
  ];
  const solRaw = empleadoId ? await leerIgual(db, 'solicitudes_evento', 'empleadoId', empleadoId) : [];
  const evRaw = [
    ...(empleadoId ? await leerIgual(db, 'guardia_desempeno_eventos', 'empleadoId', empleadoId) : []),
    ...(cuil ? await leerIgual(db, 'guardia_desempeno_eventos', 'bolsaCuil', cuil) : []),
  ];

  const enVentana = (ms: number) => ms >= desdeMs;
  const turnos: FuenteTurno[] = turnosRaw.flatMap((row) => {
    const startMs = tiempoMs(row.startTime);
    if (!enVentana(startMs)) return [];
    return [{
      id: String(row.id),
      employeeId: empleadoId,
      bolsaCuil: row.bolsaCuil ? String(row.bolsaCuil) : null,
      esEventual: row.esEventual === true,
      startMs,
      code: row.code ? String(row.code) : null,
      isAbsent: row.isAbsent === true,
      isPresent: row.isPresent === true,
      draft: row.draft === true,
      lateMinutes: typeof row.lateMinutes === 'number' ? row.lateMinutes : null,
      checkInMs: tiempoMs(row.checkInAt || row.checkInTime) || null,
      avisoLlegada: avisoLlegada(row),
      completionReason: row.completionReason ? String(row.completionReason) : null,
      earlyWithdrawReason: row.earlyWithdrawReason ? String(row.earlyWithdrawReason) : null,
      absenceReverted: !!row.absenceRevertedAt,
    }];
  });
  const ausencias: FuenteAusencia[] = ausRaw.flatMap((row) => {
    const fechaMs = tiempoMs(row.date || row.startDate || row.createdAt || row.fecha);
    if (!enVentana(fechaMs)) return [];
    return [{
      id: String(row.id),
      employeeId: empleadoId,
      shiftId: row.shiftId ? String(row.shiftId) : null,
      esEventual: row.esEventual === true,
      code: row.code ? String(row.code) : row.type ? String(row.type) : null,
      origin: row.origin ? String(row.origin) : null,
      fechaMs,
      reverted: ausenciaSinEfecto(row),
    }];
  });
  const vistos = new Set<string>();
  const convocatorias: FuenteConvocatoria[] = convRaw.flatMap((row) => {
    if (vistos.has(String(row.id))) return [];
    vistos.add(String(row.id));
    const fechaMs = tiempoMs(row.respondedAt || row.createdAt || row.timeoutAt);
    if (!enVentana(fechaMs) && !enVentana(tiempoMs(row.startTime))) return [];
    return [{
      id: String(row.id),
      employeeId: row.candidateEmployeeId ? String(row.candidateEmployeeId) : empleadoId,
      bolsaCuil: row.bolsaCuil ? String(row.bolsaCuil) : null,
      tipo: row.type ? String(row.type) : row.coverageType ? String(row.coverageType) : null,
      status: row.status ? String(row.status) : null,
      fechaMs: fechaMs || tiempoMs(row.startTime),
      startMs: tiempoMs(row.gapStart || row.startTime) || null,
      acceptedAtMs: tiempoMs(row.acceptedAt) || null,
      cancelledAtMs: tiempoMs(row.cancelledAt) || null,
      eventoId: row.eventoId ? String(row.eventoId) : null,
      respondedBy: row.respondedBy ? String(row.respondedBy) : null,
      esEventual: row.esEventual === true || !!row.bolsaCuil,
    }];
  });
  const solicitudesEvento: FuenteSolicitudEvento[] = solRaw.flatMap((row) => {
    const fechaMs = tiempoMs(row.respondidoAt || row.createdAt);
    if (!enVentana(fechaMs)) return [];
    return [{
      id: String(row.id),
      empleadoId,
      status: row.status ? String(row.status) : null,
      fechaMs,
      eventoId: row.eventoId ? String(row.eventoId) : null,
    }];
  });
  const evVistos = new Set<string>();
  const eventos: FuenteDesempenoEvento[] = evRaw.flatMap((row) => {
    if (evVistos.has(String(row.id))) return [];
    evVistos.add(String(row.id));
    const fechaMs = tiempoMs(row.fecha || row.createdAt);
    if (!enVentana(fechaMs)) return [];
    return [{
      id: String(row.id),
      empleadoId: row.empleadoId ? String(row.empleadoId) : null,
      bolsaCuil: row.bolsaCuil ? String(row.bolsaCuil) : null,
      tipo: row.tipo ? String(row.tipo) : null,
      fechaMs,
      turnoId: row.turnoId ? String(row.turnoId) : null,
      eventoId: row.eventoId ? String(row.eventoId) : null,
      esEventual: row.esEventual === true || !!row.bolsaCuil,
    }];
  });
  return { turnos, ausencias, convocatorias, solicitudesEvento, eventos };
}

export async function recalcularPuntajePersona(db: Firestore, clave: ClavePuntaje, ahora = new Date()): Promise<string | null> {
  const id = claveDoc(clave);
  const empresaId = String(clave.empresaId || '').trim();
  if (!id || !empresaId) return null;
  const ahoraMs = ahora.getTime();
  const desdeMs = ahoraMs - 90 * 24 * 60 * 60 * 1000;
  const fuentes = await fuentesDePersona(db, clave, desdeMs);
  const puntaje = calcularPuntajeDeFuentes(fuentes, ahoraMs);
  await db.collection('guardia_puntaje').doc(id).set({
    empresaId,
    empleadoId: clave.empleadoId || null,
    bolsaCuil: clave.bolsaCuil || null,
    esEventual: clave.esEventual === true || !!clave.bolsaCuil,
    ...puntaje,
    calculadoEn: admin.firestore.FieldValue.serverTimestamp(),
    calculadoEnMs: ahoraMs,
  });
  return id;
}

export async function marcarPuntajeDirty(db: Firestore, clave: ClavePuntaje): Promise<void> {
  const id = claveDoc(clave);
  if (!id || !clave.empresaId) return;
  await db.collection('guardia_puntaje_dirty').doc(id).set({
    empresaId: clave.empresaId,
    empleadoId: clave.empleadoId || null,
    bolsaCuil: clave.bolsaCuil || null,
    esEventual: clave.esEventual === true || !!clave.bolsaCuil,
    dueAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function claveDeDoc(data: Record<string, unknown> | undefined, camposEmpleado: string[]): ClavePuntaje | null {
  if (!data) return null;
  const empresaId = String(data.empresaId || '').trim();
  const empleadoId = camposEmpleado.map((c) => String(data[c] || '').trim()).find(Boolean) || null;
  const bolsaCuil = data.bolsaCuil ? String(data.bolsaCuil) : null;
  if (!empresaId || (!empleadoId && !bolsaCuil)) return null;
  return { empresaId, empleadoId, bolsaCuil, esEventual: data.esEventual === true || !!bolsaCuil };
}

export async function touchPuntajeDesdeDoc(
  db: Firestore,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  camposEmpleado: string[],
): Promise<void> {
  const claves = [claveDeDoc(before, camposEmpleado), claveDeDoc(after, camposEmpleado)].filter((c): c is ClavePuntaje => !!c);
  const vistos = new Set<string>();
  for (const clave of claves) {
    const id = claveDoc(clave);
    if (vistos.has(id)) continue;
    vistos.add(id);
    await marcarPuntajeDirty(db, clave);
  }
}

export async function procesarPuntajeDirty(db: Firestore, limit = 40, ahora = new Date()): Promise<number> {
  const snap = await db.collection('guardia_puntaje_dirty').limit(limit).get();
  let n = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const id = await recalcularPuntajePersona(db, {
      empresaId: String(data.empresaId || ''),
      empleadoId: data.empleadoId ? String(data.empleadoId) : doc.id,
      bolsaCuil: data.bolsaCuil ? String(data.bolsaCuil) : null,
      esEventual: data.esEventual === true,
    }, ahora);
    if (id) {
      await doc.ref.delete();
      n += 1;
    }
  }
  return n;
}

/** Ventana que se corre: vuelve a calcular a quien ya tiene puntaje o un turno en los 90 días. */
export async function runPuntajeDiario(db: Firestore, ahora = new Date(), maxPorEmpresa = 250): Promise<{ empresas: number; personas: number }> {
  const empresas = await db.collection('empresas').get();
  let personas = 0;
  for (const emp of empresas.docs) {
    const empresaId = emp.id;
    const ids = new Map<string, ClavePuntaje>();
    const previos = await db.collection('guardia_puntaje').where('empresaId', '==', empresaId).limit(maxPorEmpresa).get();
    for (const doc of previos.docs) {
      const data = doc.data();
      ids.set(doc.id, {
        empresaId,
        empleadoId: data.empleadoId ? String(data.empleadoId) : doc.id,
        bolsaCuil: data.bolsaCuil ? String(data.bolsaCuil) : null,
        esEventual: data.esEventual === true,
      });
    }
    const eventos = await db.collection('guardia_desempeno_eventos').where('empresaId', '==', empresaId).limit(400).get();
    for (const doc of eventos.docs) {
      const clave = claveDeDoc(doc.data(), ['empleadoId']);
      if (!clave) continue;
      ids.set(claveDoc(clave), clave);
    }
    let n = 0;
    for (const clave of ids.values()) {
      if (n >= maxPorEmpresa) break;
      await recalcularPuntajePersona(db, clave, ahora);
      n += 1;
    }
    personas += n;
  }
  return { empresas: empresas.size, personas };
}

/** Totales para desempatar candidatos. Clave = id de doc, empleadoId o CUIL. */
export async function puntajesPorClave(db: Firestore, claves: string[]): Promise<Map<string, number>> {
  const unicos = [...new Set(claves.map((c) => String(c || '').trim()).filter(Boolean))];
  const out = new Map<string, number>();
  for (let i = 0; i < unicos.length; i += 40) {
    const refs = unicos.slice(i, i + 40).map((id) => db.collection('guardia_puntaje').doc(id));
    if (!refs.length) continue;
    const docs = await db.getAll(...refs);
    for (const doc of docs) {
      if (!doc.exists) continue;
      const data = doc.data() || {};
      const total = typeof data.total === 'number' ? data.total : null;
      if (total == null) continue;
      out.set(doc.id, total);
      if (data.empleadoId) out.set(String(data.empleadoId), total);
      if (data.bolsaCuil) out.set(String(data.bolsaCuil), total);
    }
  }
  return out;
}

export async function handlePuntajeDirtyEvent(event: { data?: { before?: { exists?: boolean; data: () => Record<string, unknown> | undefined }; after?: { exists?: boolean; data: () => Record<string, unknown> | undefined } } }, campos: string[]): Promise<void> {
  const read = (snap?: { exists?: boolean; data: () => Record<string, unknown> | undefined }) => {
    if (!snap || snap.exists === false) return undefined;
    return snap.data();
  };
  await touchPuntajeDesdeDoc(dbDefault(), read(event.data?.before), read(event.data?.after), campos);
}
