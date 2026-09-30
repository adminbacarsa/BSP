import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { AR_OFFSET_MS, arYmd } from '../common/arClock';
import {
  eventualesParaHueco,
  type EventualBolsaRow,
  type EventualCandidato,
  type EventualJornadaOcupada,
} from './eventoCoverage';

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
  },
): Promise<EventualCandidato[]> {
  const empresaId = String(shift.empresaId || '').trim();
  const startMs = msOf(shift.startTime);
  const endMs = msOf(shift.endTime);
  if (!empresaId || !startMs || !endMs) return [];

  const snap = await db.collection('eventuales_bolsa').where('disponibilidad', '==', 'DISPONIBLE').get();
  const bolsa: EventualBolsaRow[] = snap.docs.map((d) => {
    const data = d.data() as EventualBolsaRow;
    return { ...data, cuil: String(data.cuil || d.id) };
  });
  const cuils = bolsa.map((b) => b.cuil).filter(Boolean);
  const otras: EventualJornadaOcupada[] = [];
  for (let i = 0; i < cuils.length; i += 10) {
    const chunk = cuils.slice(i, i + 10);
    if (!chunk.length) continue;
    const turns = await db.collection('turnos').where('bolsaCuil', 'in', chunk).get();
    for (const doc of turns.docs) {
      const data = doc.data();
      if (data.draft === true || data.isDeleted === true || data.status === 'INACTIVE') continue;
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

  const lat = Number(shift.lat ?? shift.latitude);
  const lng = Number(shift.lng ?? shift.longitude);
  return eventualesParaHueco({
    bolsa,
    hueco: {
      empresaId,
      startMs,
      endMs,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      hoyYmd: arYmd(Date.now()),
    },
    otrasJornadas: otras,
  });
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

  const envioRef = db.collection('arca_envios').doc();
  batch.set(envioRef, {
    empresaId: opts.empresaId,
    contratoId,
    bolsaCuil: cuil,
    tipo: 'AT',
    estado: 'PENDIENTE',
    canal: 'URGENTE',
    shiftId: opts.shiftId,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(db.collection('turnos').doc(opts.covDocId), {
    esEventual: true,
    eventualAltaArcaConfirmada: false,
    eventualContratoId: contratoId,
    bolsaCuil: cuil,
    arcaEnvioId: envioRef.id,
  });
}
