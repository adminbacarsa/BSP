import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { AR_OFFSET_MS, arYmd } from '../common/arClock';
import { altaConfirmadaDelContrato } from '../arca/altaArcaDenorm';
import {
  eventualesParaHueco,
  type EventualBolsaRow,
  type EventualCandidato,
  type EventualJornadaOcupada,
  type EventualTramo,
} from './eventoCoverage';
import { puntajesPorClave } from '../desempeno/puntajeGuardiaJob';
import { evaluarTopeCuils, jornadasDeTramos, reservarTopeHoras } from '../eventuales/topeHorasEventual';

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
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Códigos que no son jornada trabajada: no cuentan para el cruce 12 h (igual que `turnoAJornada`). */
const CODIGOS_SIN_JORNADA = new Set(['F', 'FF', 'FP', 'V', 'L', 'E', 'A', 'ART', 'AA', 'PG', 'SGS', 'SUS']);

export type EvaluarEventualesServerOpts = {
  empresaId: string;
  /** Uno (hueco del CC) o varios (Planificación multi-día) tramos en ms. */
  tramos: EventualTramo[];
  lat?: number | null;
  lng?: number | null;
  hoyYmd?: string;
  /** Solo estas fichas (asignar / convocar / aceptar evalúan una). Default: toda la bolsa DISPONIBLE. */
  bolsa?: EventualBolsaRow[];
  /** Turnos que no cuentan como ocupados (los del propio eventual que se están reemplazando). */
  excluirTurnoIds?: Set<string>;
  /** true = toda la bolsa con motivo (Planificación). false = solo elegibles + sin marco (CC). */
  incluirNoElegibles?: boolean;
  /**
   * Ventana `scheduleDate` [desde, hasta] para cargar los turnos ocupados (Planificación: ±2 días
   * de las jornadas). Sin ventana se cargan todos los turnos del CUIL (CC, como siempre).
   */
  ventana?: { desde: string; hasta: string } | null;
  /** Hueco de un servicio con cupo por género: solo ese grupo (cascada / CC). */
  generoRequerido?: 'M' | 'F' | null;
};

async function bolsaDisponible(db: admin.firestore.Firestore): Promise<EventualBolsaRow[]> {
  const snap = await db.collection('eventuales_bolsa').where('disponibilidad', '==', 'DISPONIBLE').get();
  return snap.docs.map((d) => {
    const data = d.data() as EventualBolsaRow;
    return { ...data, cuil: String(data.cuil || d.id) };
  });
}

/** Jornadas ya ocupadas de esos CUIL en todo el grupo (sin borradores, francos ni licencias). */
async function jornadasOcupadas(
  db: admin.firestore.Firestore,
  cuils: string[],
  ventana: { desde: string; hasta: string } | null | undefined,
  excluirTurnoIds: Set<string>,
): Promise<EventualJornadaOcupada[]> {
  const otras: EventualJornadaOcupada[] = [];
  for (let i = 0; i < cuils.length; i += 10) {
    const chunk = cuils.slice(i, i + 10);
    if (!chunk.length) continue;
    let q: admin.firestore.Query = db.collection('turnos').where('bolsaCuil', 'in', chunk);
    if (ventana) q = q.where('scheduleDate', '>=', ventana.desde).where('scheduleDate', '<=', ventana.hasta);
    const turns = await q.get();
    for (const doc of turns.docs) {
      if (excluirTurnoIds.has(doc.id)) continue;
      const data = doc.data();
      if (data.draft === true || data.isDeleted === true || data.status === 'INACTIVE' || data.isUnassigned === true) continue;
      if (data.isFranco === true || CODIGOS_SIN_JORNADA.has(String(data.code || '').toUpperCase())) continue;
      const s = msOf(data.startTime);
      const e = msOf(data.endTime);
      if (!s || !e || e <= s) continue;
      otras.push({
        cuil: String(data.bolsaCuil || ''),
        empresaId: String(data.empresaId || ''),
        startMs: s,
        endMs: e,
      });
    }
  }
  return otras;
}

/**
 * Único camino del servidor al motor `eventualesParaHueco` (ops-core / `eventoCoverage.ts`):
 * CC, cascada, convocatoria de evento y Planificación evalúan con los mismos criterios.
 */
export async function evaluarEventualesServer(
  db: admin.firestore.Firestore,
  opts: EvaluarEventualesServerOpts,
): Promise<EventualCandidato[]> {
  const empresaId = String(opts.empresaId || '').trim();
  const tramos = (opts.tramos || []).filter((t) => t.startMs && t.endMs && t.endMs > t.startMs);
  if (!empresaId || !tramos.length) return [];
  const bolsa = opts.bolsa ?? await bolsaDisponible(db);
  const cuils = bolsa.map((b) => String(b.cuil || '').trim()).filter(Boolean);
  const otras = await jornadasOcupadas(db, cuils, opts.ventana, opts.excluirTurnoIds || new Set());

  const scores = await puntajesPorClave(db, cuils);
  for (const row of bolsa) {
    const n = scores.get(String(row.cuil || ''));
    if (typeof n === 'number') row.puntaje = n;
  }

  const jornadasTope = jornadasDeTramos(tramos);
  if (jornadasTope.length) {
    const bolsas = new Map(bolsa.map((row) => {
      const raw = row as EventualBolsaRow & { topeHorasExcepcion?: Record<string, { horas?: number; motivo?: string }>; topeHorasReservas?: unknown[] };
      return [String(row.cuil || ''), { topeHorasExcepcion: raw.topeHorasExcepcion, topeHorasReservas: raw.topeHorasReservas }] as const;
    }));
    const topes = await evaluarTopeCuils(db, {
      empresaId,
      cuils,
      jornadas: jornadasTope,
      bolsas,
      excluirTurnoIds: opts.excluirTurnoIds,
    });
    for (const row of bolsa) {
      const ev = topes.get(String(row.cuil || ''));
      if (ev) row.topeHoras = { usadas: ev.usadas, tope: ev.tope, horasTurno: ev.horasTurno };
    }
  }

  const lat = Number(opts.lat);
  const lng = Number(opts.lng);
  const startMs = Math.min(...tramos.map((t) => t.startMs));
  const endMs = Math.max(...tramos.map((t) => t.endMs));
  return eventualesParaHueco({
    bolsa,
    hueco: {
      empresaId,
      startMs,
      endMs,
      jornadas: tramos,
      lat: opts.lat != null && Number.isFinite(lat) ? lat : null,
      lng: opts.lng != null && Number.isFinite(lng) ? lng : null,
      hoyYmd: opts.hoyYmd || arYmd(Date.now()),
      generoRequerido: opts.generoRequerido === 'M' || opts.generoRequerido === 'F' ? opts.generoRequerido : null,
    },
    otrasJornadas: otras,
    incluirNoElegibles: opts.incluirNoElegibles === true,
  });
}

/** Hueco del CC / cascada: elegibles de toda la bolsa para ese turno. */
export async function loadEventualesParaHueco(
  db: admin.firestore.Firestore,
  shift: {
    empresaId?: string;
    startTime?: unknown;
    endTime?: unknown;
    lat?: unknown;
    lng?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    /** Turno EV de un servicio con cupo por género: el hueco es de ese grupo. */
    cupoGrupo?: unknown;
    generoRequerido?: unknown;
    hours?: unknown;
    scheduleDate?: unknown;
  },
): Promise<EventualCandidato[]> {
  const empresaId = String(shift.empresaId || '').trim();
  const startMs = msOf(shift.startTime);
  const endMs = msOf(shift.endTime);
  if (!empresaId || !startMs || !endMs) return [];
  const lat = Number(shift.lat ?? shift.latitude);
  const lng = Number(shift.lng ?? shift.longitude);
  const grupo = String(shift.generoRequerido ?? shift.cupoGrupo ?? '').toUpperCase();
  const horas = Number(shift.hours);
  const pool = await evaluarEventualesServer(db, {
    empresaId,
    tramos: [{
      startMs,
      endMs,
      ...(horas > 0 ? { horas } : {}),
      ...(/^\d{4}-\d{2}-\d{2}$/.test(String(shift.scheduleDate || '')) ? { fecha: String(shift.scheduleDate) } : {}),
    }],
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    generoRequerido: grupo === 'M' || grupo === 'F' ? grupo : null,
  });
  return pool.filter((row) => row.elegible !== false);
}

/**
 * Al aceptar, el turno queda en la empresa del hueco, el contrato CONFIRMADO
 * y el AT en canal URGENTE. Sin nro de transacción el turno no puede fichar.
 */
export async function registrarAsignacionEventualEnBatch(
  db: admin.firestore.Firestore,
  batch: admin.firestore.WriteBatch,
  opts: {
    empresaId: string;
    cuil: string;
    employeeId: string;
    employeeName: string;
    startMs: number;
    endMs: number;
    shiftId: string;
    covDocId: string;
  },
): Promise<void> {
  const cuil = String(opts.cuil || '').trim();
  const bolsaSnap = await db.collection('eventuales_bolsa').doc(cuil).get();
  if (!bolsaSnap.exists) throw new Error('EVENTUAL_SIN_BOLSA');
  const horasTurno = Math.round(((opts.endMs - opts.startMs) / 3600000) * 100) / 100;
  const reserva = await reservarTopeHoras(db, {
    empresaId: opts.empresaId,
    cuil,
    jornadas: [{ fecha: arYmd(opts.startMs), horaInicio: hmAr(opts.startMs), horas: horasTurno }],
  });
  if (reserva.ok === false) throw new Error(reserva.mensaje);
  const pool = await loadEventualesParaHueco(db, {
    empresaId: opts.empresaId,
    startTime: Timestamp.fromMillis(opts.startMs),
    endTime: Timestamp.fromMillis(opts.endMs),
  });
  if (!pool.some((p) => p.cuil === cuil)) throw new Error('EVENTUAL_CRUCE_BLOQUEADO');

  const fecha = arYmd(opts.startMs);
  const fechaBaja = arYmd(opts.endMs);
  const jornada = {
    fecha,
    horaInicio: hmAr(opts.startMs),
    horaFin: hmAr(opts.endMs),
    horas: Math.round(((opts.endMs - opts.startMs) / 3600000) * 100) / 100,
    empresaId: opts.empresaId,
  };

  const previos = await db.collection('contratos_eventuales').where('bolsaCuil', '==', cuil).get();
  const abierto = previos.docs.find((d) => {
    const data = d.data();
    return data.empresaId === opts.empresaId && data.status === 'ACTIVE' && data.estado === 'CONFIRMADO';
  });

  let contratoId: string;
  if (abierto) {
    contratoId = abierto.id;
    const prev = (abierto.data().jornadas as unknown[]) || [];
    batch.update(abierto.ref, {
      jornadas: [...prev, jornada],
      fechaBaja,
      employeeId: opts.employeeId,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    const ref = db.collection('contratos_eventuales').doc();
    contratoId = ref.id;
    batch.set(ref, {
      empresaId: opts.empresaId,
      bolsaCuil: cuil,
      employeeId: opts.employeeId,
      employeeName: opts.employeeName,
      estado: 'CONFIRMADO',
      origen: 'CENTRO_CONTROL',
      fechaAlta: fecha,
      fechaBaja,
      jornadas: [jornada],
      status: 'ACTIVE',
      causa: 'COBERTURA_CC',
      shiftId: opts.shiftId,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  const altaPrevia = abierto ? await altaConfirmadaDelContrato(db, contratoId) : { confirmada: false, nroTransaccion: null as string | null };
  const envioRef = db.collection('arca_envios').doc();
  if (!altaPrevia.confirmada) {
    batch.set(envioRef, {
      empresaId: opts.empresaId,
      contratoId,
      contratoIds: [contratoId],
      bolsaCuil: cuil,
      tipo: 'AT',
      estado: 'PENDIENTE',
      canal: 'URGENTE',
      shiftId: opts.shiftId,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  batch.update(db.collection('turnos').doc(opts.covDocId), {
    esEventual: true,
    eventualAltaArcaConfirmada: altaPrevia.confirmada,
    // Switch de pruebas «Exigir alta ARCA para fichar» (ausente = true), denormalizado para el gate de fichada.
    eventualExigirAltaArca: bolsaSnap.data()?.exigirAltaArca !== false,
    eventualContratoId: contratoId,
    bolsaCuil: cuil,
    ...(altaPrevia.confirmada && altaPrevia.nroTransaccion ? { nroTransaccion: altaPrevia.nroTransaccion } : {}),
    ...(!altaPrevia.confirmada ? { arcaEnvioId: envioRef.id } : {}),
  });
}
