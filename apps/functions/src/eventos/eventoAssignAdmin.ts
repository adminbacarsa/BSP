import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export type AssignGuardToEventParams = {
  empresaId: string;
  empleadoId: string;
  empleadoNombre: string;
  empleadoObjectiveId?: string;
  empleadoObjectiveName?: string;
  eventoId: string;
  eventoNombre: string;
  clienteId?: string;
  clienteNombre?: string;
  servicioId: string;
  servicioNombre: string;
  servicioFecha: string;
  horaInicio: string;
  horaFin: string;
  horas: number;
  solicitudId?: string;
  respondidoPor?: string;
};

const AR_OFFSET = '-03:00';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD` + `HH:mm` en horario Argentina → Timestamp Firestore. */
function arDateTimeTs(fecha: string, hhmm: string): admin.firestore.Timestamp {
  const time = /^\d{1,2}:\d{2}$/.test(hhmm) ? hhmm : '08:00';
  const [hRaw, mRaw] = time.split(':');
  const iso = `${fecha}T${pad2(Number(hRaw))}:${pad2(Number(mRaw))}:00.000${AR_OFFSET}`;
  return admin.firestore.Timestamp.fromDate(new Date(iso));
}

function arDayBounds(fecha: string): {
  startTs: admin.firestore.Timestamp;
  endTs: admin.firestore.Timestamp;
  startStr: string;
  endStr: string;
} {
  return {
    startTs: admin.firestore.Timestamp.fromDate(new Date(`${fecha}T00:00:00.000${AR_OFFSET}`)),
    endTs: admin.firestore.Timestamp.fromDate(new Date(`${fecha}T23:59:59.999${AR_OFFSET}`)),
    startStr: `${fecha}T00:00:00`,
    endStr: `${fecha}T23:59:59`,
  };
}

function pickExistingTurno(
  docs: admin.firestore.QueryDocumentSnapshot[],
): admin.firestore.QueryDocumentSnapshot | null {
  return (
    docs.find((d) => {
      const c = String(d.data().code || '').toUpperCase();
      return c !== 'EV' && c !== 'F' && c !== 'FF' && c !== 'FP';
    }) ?? null
  );
}

/**
 * Busca turnos del día con startTime Timestamp (malla normal) y string (legado / EV viejo).
 */
async function loadTurnosDelDia(
  db: admin.firestore.Firestore,
  empleadoId: string,
  servicioFecha: string,
  empresaId?: string,
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const { startTs, endTs, startStr, endStr } = arDayBounds(servicioFecha);
  const base = db.collection('turnos').where('employeeId', '==', empleadoId);

  const [tsSnap, strSnap] = await Promise.all([
    base.where('startTime', '>=', startTs).where('startTime', '<=', endTs).get(),
    base.where('startTime', '>=', startStr).where('startTime', '<=', endStr).get(),
  ]);

  const byId = new Map<string, admin.firestore.QueryDocumentSnapshot>();
  for (const d of [...tsSnap.docs, ...strSnap.docs]) {
    if (empresaId && d.data().empresaId && String(d.data().empresaId) !== empresaId) continue;
    byId.set(d.id, d);
  }
  return [...byId.values()];
}

export async function assignGuardToEventAdmin(
  db: admin.firestore.Firestore,
  params: AssignGuardToEventParams,
): Promise<void> {
  const {
    empresaId,
    empleadoId,
    empleadoNombre,
    empleadoObjectiveId,
    empleadoObjectiveName,
    eventoId,
    eventoNombre,
    clienteId,
    clienteNombre,
    servicioId,
    servicioNombre,
    servicioFecha,
    horaInicio,
    horaFin,
    horas,
    solicitudId,
    respondidoPor,
  } = params;

  const dayDocs = await loadTurnosDelDia(db, empleadoId, servicioFecha, empresaId || undefined);
  const existingTurno = pickExistingTurno(dayDocs);

  const originalCode = existingTurno ? String(existingTurno.data().code || '').toUpperCase() : null;

  let originalObjectiveId: string | null =
    existingTurno?.data().objectiveId || empleadoObjectiveId || null;
  let originalObjectiveName: string | null =
    existingTurno?.data().objectiveName || empleadoObjectiveName || null;

  if (!originalObjectiveId) {
    try {
      const empSnap = await db.collection('empleados').doc(empleadoId).get();
      if (empSnap.exists) {
        const empData = empSnap.data() as Record<string, unknown>;
        originalObjectiveId = String(empData.preferredObjectiveId || empData.objectiveId || '') || null;
        originalObjectiveName =
          String(empData.preferredObjectiveName || empData.objectiveName || '') || null;
      }
    } catch {
      /* continuar */
    }
  }

  let startTs = arDateTimeTs(servicioFecha, horaInicio);
  let endTs = arDateTimeTs(servicioFecha, horaFin);
  if (endTs.toMillis() <= startTs.toMillis()) {
    endTs = admin.firestore.Timestamp.fromDate(
      new Date(endTs.toDate().getTime() + 24 * 60 * 60 * 1000),
    );
  }

  const batch = db.batch();

  if (existingTurno) {
    batch.update(existingTurno.ref, {
      code: 'EV',
      origin: 'EVENTO',
      eventoId,
      eventoNombre,
      servicioId,
      servicioNombre,
      startTime: startTs,
      endTime: endTs,
      hours: horas,
      isPresent: false,
      isAbsent: false,
      isCompleted: false,
      draft: false,
      replacedCode: originalCode,
    });
  } else {
    const turnoRef = db.collection('turnos').doc();
    batch.set(turnoRef, {
      empresaId: empresaId || null,
      code: 'EV',
      origin: 'EVENTO',
      employeeId: empleadoId,
      employeeName: empleadoNombre,
      objectiveId: originalObjectiveId,
      objectiveName: originalObjectiveName,
      clientId: clienteId || null,
      clientName: clienteNombre || null,
      eventoId,
      eventoNombre,
      servicioId,
      servicioNombre,
      startTime: startTs,
      endTime: endTs,
      hours: horas,
      isPresent: false,
      isAbsent: false,
      isCompleted: false,
      draft: false,
      replacedCode: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  if (solicitudId) {
    batch.update(db.collection('solicitudes_evento').doc(solicitudId), {
      status: 'aprobada',
      respondidoAt: FieldValue.serverTimestamp(),
      ...(respondidoPor ? { respondidoPor } : {}),
    });
  }

  if (originalObjectiveId) {
    const [y, m, d2] = servicioFecha.split('-');
    const fechaLabel = `${d2}/${m}/${y}`;
    batch.set(db.collection('novedades').doc(), {
      empresaId: empresaId || null,
      type: 'VACANTE_POR_EVENTO',
      status: 'pending',
      viewed: false,
      priority: 'high',
      actionTarget: 'PLANIFICACION',
      title: `Vacante por evento · ${empleadoNombre}`,
      description:
        `${empleadoNombre} sale al evento "${eventoNombre}" el ${fechaLabel}. ` +
        `Queda vacante turno ${originalCode || '—'} en ${originalObjectiveName || originalObjectiveId}.`,
      objectiveId: originalObjectiveId,
      objectiveName: originalObjectiveName,
      fecha: servicioFecha,
      codigoTurnoOriginal: originalCode,
      employeeId: empleadoId,
      employeeName: empleadoNombre,
      eventoId,
      eventoNombre,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
}
