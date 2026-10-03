/**
 * Tope de horas del eventual por empresa. La cuenta y el texto viven en `topeHoras.mjs`.
 * `reservarTopeHoras` corre en una transacción: lee la config, la excepción y los turnos del
 * período, y deja una reserva de 2 min para que dos aceptaciones a la vez no se pisen.
 */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { AR_OFFSET_MS, arYmd } from '../common/arClock';

export type JornadaTope = { fecha: string; horaInicio: string; horaFin?: string; horas: number };

export type EvalTope = {
  usadas: number;
  tope: number;
  margen: number;
  horasTurno: number;
  supera: boolean;
  /** Las usadas ya están dentro del margen: no se ofrece ni se acepta. */
  cerca: boolean;
  alcanzado: boolean;
  oculto: boolean;
  aviso: boolean;
  texto: string;
  chip: 'Tope alcanzado' | 'Cerca del tope' | null;
  motivo: string | null;
  desde?: string;
  hasta?: string;
  excepcion: boolean;
  motivoExcepcion: string | null;
  topeEmpresa: number;
  periodo: string;
};

type LibTope = {
  TOPE_HORAS_DEFAULT: number;
  RESERVA_TOPE_MS: number;
  PERIODO_CALENDARIO: string;
  PERIODO_CICLO: string;
  rangoPeriodo: (fecha: string, periodo: string) => { desde: string; hasta: string; clave: string } | null;
  topeEfectivo: (empresa: unknown, excepcion: unknown) => { tope: number; periodo: string; excepcion: boolean; motivo: string | null; topeEmpresa: number; margen: number };
  horasDeTurnoEventual: (turno: unknown) => number;
  evaluarJornadasContraTope: (input: Record<string, unknown>) => (EvalTope & { desde: string; hasta: string }) | null;
  reservasVigentes: (reservas: unknown[], ahoraMs: number) => { empresaId?: string; fecha?: string; horaInicio?: string; horas?: number; venceAtMs?: number }[];
  normalizarPeriodo: (valor: unknown) => string;
  normalizarTope: (valor: unknown, fallback?: number | null) => number | null;
  textoHorasMes: (usadas: number, tope: number) => string;
};

let cache: LibTope | null = null;
async function lib(): Promise<LibTope> {
  if (!cache) cache = await import('../eventuales-shared/topeHoras.mjs') as unknown as LibTope;
  return cache;
}

function msOf(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === 'object' && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value && typeof value === 'object' && typeof (value as { seconds?: number }).seconds === 'number') {
    return (value as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function hmAr(ms: number): string {
  const d = new Date(ms - AR_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function normalizarTurno(id: string, data: Record<string, unknown>) {
  const startMs = msOf(data.startTime);
  return {
    id,
    empresaId: String(data.empresaId || ''),
    scheduleDate: String(data.scheduleDate || '').slice(0, 10),
    hours: Number(data.hours ?? data.horas) || 0,
    horaInicio: startMs ? hmAr(startMs) : String(data.horaInicio || ''),
    horaFin: '',
    code: data.code,
    origin: data.origin,
    esEventual: data.esEventual === true,
    isAbsent: data.isAbsent === true,
    pagaJornada: data.pagaJornada,
    noSePresento: data.noSePresento === true,
    isUnassigned: data.isUnassigned === true,
    isDeleted: data.isDeleted === true,
    isFranco: data.isFranco === true,
    status: data.status,
    draft: data.draft === true,
  };
}

function rangoDe(jornadas: JornadaTope[], periodo: string, rangoPeriodo: LibTope['rangoPeriodo']) {
  let desde = '9999-99-99';
  let hasta = '0000-00-00';
  for (const jornada of jornadas) {
    const rango = rangoPeriodo(jornada.fecha, periodo);
    if (!rango) continue;
    if (rango.desde < desde) desde = rango.desde;
    if (rango.hasta > hasta) hasta = rango.hasta;
  }
  return desde <= hasta ? { desde, hasta } : null;
}

async function turnosDeCuils(
  db: admin.firestore.Firestore,
  cuils: string[],
  desde: string,
  hasta: string,
  tx?: admin.firestore.Transaction,
) {
  const out: { cuil: string; turno: ReturnType<typeof normalizarTurno> }[] = [];
  for (let i = 0; i < cuils.length; i += 10) {
    const chunk = cuils.slice(i, i + 10).filter(Boolean);
    if (!chunk.length) continue;
    const q = chunk.length === 1
      ? db.collection('turnos').where('bolsaCuil', '==', chunk[0]).where('scheduleDate', '>=', desde).where('scheduleDate', '<=', hasta)
      : db.collection('turnos').where('bolsaCuil', 'in', chunk).where('scheduleDate', '>=', desde).where('scheduleDate', '<=', hasta);
    const snap = tx ? await tx.get(q) : await q.get();
    for (const doc of snap.docs) {
      out.push({ cuil: String(doc.data().bolsaCuil || ''), turno: normalizarTurno(doc.id, doc.data()) });
    }
  }
  return out;
}

type BolsaTope = { topeHorasExcepcion?: Record<string, { horas?: number; motivo?: string }>; topeHorasReservas?: unknown[] };

/**
 * Evaluación del tope para cada CUIL en el período de las jornadas nuevas.
 * `bolsas` trae la excepción y las reservas ya leídas (en la transacción, la bolsa se lee ahí).
 */
export async function evaluarTopeCuils(
  db: admin.firestore.Firestore,
  p: {
    empresaId: string;
    cuils: string[];
    jornadas: JornadaTope[];
    bolsas?: Map<string, BolsaTope>;
    excluirTurnoIds?: Set<string>;
    ahoraMs?: number;
    tx?: admin.firestore.Transaction;
    empresa?: Record<string, unknown> | null;
  },
): Promise<Map<string, EvalTope>> {
  const reglas = await lib();
  const empresaId = String(p.empresaId || '');
  const empresa = p.empresa ?? (p.tx
    ? (await p.tx.get(db.collection('empresas').doc(empresaId))).data() || {}
    : (await db.collection('empresas').doc(empresaId).get()).data() || {});
  const base = reglas.topeEfectivo(empresa, null);
  const rango = rangoDe(p.jornadas, base.periodo, reglas.rangoPeriodo);
  const ahoraMs = p.ahoraMs ?? Date.now();
  const filas = rango ? await turnosDeCuils(db, p.cuils, rango.desde, rango.hasta, p.tx) : [];
  const porCuil = new Map<string, ReturnType<typeof normalizarTurno>[]>();
  for (const fila of filas) {
    const lista = porCuil.get(fila.cuil) || [];
    lista.push(fila.turno);
    porCuil.set(fila.cuil, lista);
  }
  const out = new Map<string, EvalTope>();
  for (const cuil of p.cuils) {
    const bolsa = p.bolsas?.get(cuil);
    const efectivo = reglas.topeEfectivo(empresa, bolsa?.topeHorasExcepcion?.[empresaId]);
    const ev = reglas.evaluarJornadasContraTope({
      turnos: porCuil.get(cuil) || [],
      reservas: reglas.reservasVigentes(bolsa?.topeHorasReservas || [], ahoraMs),
      empresaId,
      jornadas: p.jornadas,
      periodo: efectivo.periodo,
      tope: efectivo.tope,
      margen: efectivo.margen,
      excluirIds: p.excluirTurnoIds,
      ahoraMs,
    });
    const vacio: EvalTope = {
      usadas: 0, tope: efectivo.tope, margen: efectivo.margen, horasTurno: 0, supera: false, cerca: false, alcanzado: false, oculto: false,
      aviso: false, texto: reglas.textoHorasMes(0, efectivo.tope), chip: null, motivo: null,
      excepcion: efectivo.excepcion, motivoExcepcion: efectivo.motivo, topeEmpresa: efectivo.topeEmpresa, periodo: efectivo.periodo,
    };
    out.set(cuil, ev ? {
      ...vacio,
      ...ev,
      excepcion: efectivo.excepcion,
      motivoExcepcion: efectivo.motivo,
      topeEmpresa: efectivo.topeEmpresa,
      periodo: efectivo.periodo,
    } : vacio);
  }
  return out;
}

/** Jornadas de los tramos del motor (ms → día AR y horas del turno). */
export function jornadasDeTramos(tramos: { startMs: number; endMs: number; horas?: number; fecha?: string }[]): JornadaTope[] {
  return tramos.filter((t) => t.startMs && t.endMs && t.endMs > t.startMs).map((t) => ({
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(t.fecha || '')) ? String(t.fecha) : arYmd(t.startMs),
    horaInicio: hmAr(t.startMs),
    horas: Number(t.horas) > 0 ? Number(t.horas) : Math.round(((t.endMs - t.startMs) / 3600000) * 100) / 100,
  }));
}

/**
 * Reserva las horas de estas jornadas si no pasan el tope. Dos aceptaciones simultáneas
 * del mismo eventual chocan en el doc de la bolsa y la segunda vuelve a contar.
 */
export async function reservarTopeHoras(
  db: admin.firestore.Firestore,
  p: { empresaId: string; cuil: string; jornadas: JornadaTope[]; excluirTurnoIds?: Set<string> },
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const reglas = await lib();
  const cuil = String(p.cuil || '').replace(/\D/g, '');
  const empresaId = String(p.empresaId || '');
  const jornadas = (p.jornadas || []).filter((j) => /^\d{4}-\d{2}-\d{2}$/.test(j.fecha));
  if (!cuil || !empresaId || !jornadas.length) return { ok: true };
  const ahoraMs = Date.now();
  return db.runTransaction(async (tx) => {
    const bolsaRef = db.collection('eventuales_bolsa').doc(cuil);
    const [bolsaSnap, empresaSnap] = await Promise.all([
      tx.get(bolsaRef),
      tx.get(db.collection('empresas').doc(empresaId)),
    ]);
    const data = (bolsaSnap.data() || {}) as BolsaTope;
    const evals = await evaluarTopeCuils(db, {
      empresaId,
      cuils: [cuil],
      jornadas,
      bolsas: new Map([[cuil, data]]),
      excluirTurnoIds: p.excluirTurnoIds,
      ahoraMs,
      tx,
      empresa: empresaSnap.data() || {},
    });
    const ev = evals.get(cuil);
    if (ev?.oculto) return { ok: false, mensaje: ev.motivo || 'Supera el tope mensual.' };
    const vigentes = reglas.reservasVigentes(data.topeHorasReservas || [], ahoraMs)
      .filter((r) => !jornadas.some((j) => j.fecha === r.fecha && j.horaInicio === r.horaInicio));
    const nuevas = jornadas.map((j) => ({
      empresaId,
      fecha: j.fecha,
      horaInicio: j.horaInicio,
      horas: Number(j.horas) > 0 ? Number(j.horas) : reglas.horasDeTurnoEventual(j),
      venceAtMs: ahoraMs + reglas.RESERVA_TOPE_MS,
    }));
    tx.set(bolsaRef, { topeHorasReservas: [...vigentes, ...nuevas] }, { merge: true });
    return { ok: true };
  });
}
