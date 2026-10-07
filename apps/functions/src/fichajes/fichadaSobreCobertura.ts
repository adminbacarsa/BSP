import { FieldValue, type Firestore } from 'firebase-admin/firestore';

const FUENTE = new Set(['REF', 'ESC', 'RET']);

function ms(v: unknown): number {
  return (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
}

/** REF, ESC o RET planificado. El ops_cov que nace de ese turno no es la fuente. */
export function turnoFuenteRefEscRet(shift: Record<string, unknown> | null | undefined): boolean {
  if (!shift) return false;
  const origin = String(shift.origin || '').toUpperCase();
  if (origin === 'OPERATIONS_COVERAGE' || origin === 'EVENTO') return false;
  const code = String(shift.code || shift.shiftCode || '').trim().toUpperCase();
  return FUENTE.has(code);
}

export function mismoHorario(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean {
  if (!a || !b) return false;
  const as = ms(a.startTime);
  const bs = ms(b.startTime);
  if (as <= 0 || bs <= 0) return false;
  return Math.abs(as - bs) <= 60_000 && Math.abs(ms(a.endTime) - ms(b.endTime)) <= 60_000;
}

export function yaFicho(shift: Record<string, unknown> | null | undefined): boolean {
  if (!shift) return false;
  if (shift.isPresent === true) return true;
  if (String(shift.status || '').toUpperCase() === 'PRESENT') return true;
  return ms(shift.checkInAt) > 0 || ms(shift.realStartTime) > 0;
}

/** Reloj de la fichada que hay que pasar al ops_cov. */
export function camposPresencia(shift: Record<string, unknown>): Record<string, unknown> {
  return {
    isPresent: true,
    status: 'PRESENT',
    isAwaitingCoverageCheckIn: false,
    ...(ms(shift.checkInAt) > 0 ? { checkInAt: shift.checkInAt } : {}),
    ...(shift.checkInTime ? { checkInTime: shift.checkInTime } : {}),
    ...(ms(shift.realStartTime) > 0 ? { realStartTime: shift.realStartTime } : {}),
    ...(shift.checkInMethod ? { checkInMethod: shift.checkInMethod } : {}),
    ...(shift.checkInCoords ? { checkInCoords: shift.checkInCoords } : {}),
    ...(shift.checkInRecordedAt ? { checkInRecordedAt: shift.checkInRecordedAt } : {}),
    isLate: shift.isLate === true,
    lateMinutes: Number(shift.lateMinutes) || 0,
  };
}

/**
 * La fuente sale del cómputo: coverageUsed, baja lógica y sin reloj.
 * Las horas quedan solo en el ops_cov.
 */
export function parcheFuenteSinHoras(
  covDocId: string,
  titularShiftId: string,
): Record<string, unknown> {
  const del = FieldValue.delete();
  return {
    coverageUsed: true,
    coverageDocId: covDocId,
    coverageUsedForShiftId: titularShiftId || null,
    isPresent: false,
    isLate: false,
    lateMinutes: 0,
    isDeleted: true,
    status: 'CANCELLED',
    deletedReason: 'CONVERTIDO_EN_COBERTURA',
    convertedToCoverageDocId: covDocId,
    checkInAt: del,
    checkInTime: del,
    realStartTime: del,
    checkInMethod: del,
    checkInCoords: del,
    checkInRecordedAt: del,
  };
}

function coberturaActiva(data: Record<string, unknown>): boolean {
  const origin = String(data.origin || '').toUpperCase();
  if (origin !== 'OPERATIONS_COVERAGE') return false;
  if (data.coverageSuperseded === true || data.isDeleted === true) return false;
  if (String(data.status || '').toUpperCase() === 'CANCELLED') return false;
  const ct = String(data.coverageType || '').toUpperCase();
  return FUENTE.has(ct);
}

export type DestinoFichada = {
  shiftId: string;
  data: Record<string, unknown>;
  yaMovida: boolean;
  fuenteId: string | null;
  covId: string | null;
  titularId: string | null;
};

/** Si el turno que se ficha es la fuente de un ops_cov del mismo horario, la fichada va a la cobertura. */
export async function resolverDestinoFichada(
  db: Firestore,
  shiftId: string,
  shiftData: Record<string, unknown>,
): Promise<DestinoFichada> {
  const mismo: DestinoFichada = {
    shiftId,
    data: shiftData,
    yaMovida: false,
    fuenteId: null,
    covId: null,
    titularId: null,
  };
  if (!turnoFuenteRefEscRet(shiftData)) return mismo;
  const emp = String(shiftData.employeeId || '').trim();
  if (!emp) return mismo;
  const snap = await db.collection('turnos').where('sourceShiftId', '==', shiftId).limit(8).get();
  const cov = snap.docs.find((d) => {
    const data = d.data() as Record<string, unknown>;
    return coberturaActiva(data)
      && String(data.employeeId || '') === emp
      && mismoHorario(shiftData, data);
  });
  if (!cov) return mismo;
  const data = cov.data() as Record<string, unknown>;
  const titularId = String(data.absenceShiftId || data.coveredShiftId || '').trim();
  if (yaFicho(data)) {
    return { shiftId: cov.id, data, yaMovida: true, fuenteId: shiftId, covId: cov.id, titularId };
  }
  if (yaFicho(shiftData)) {
    await cov.ref.set(camposPresencia(shiftData), { merge: true });
    await cov.ref.update({ isAwaitingCoverageCheckIn: false });
    const fresh = await cov.ref.get();
    return {
      shiftId: cov.id,
      data: (fresh.data() || data) as Record<string, unknown>,
      yaMovida: true,
      fuenteId: shiftId,
      covId: cov.id,
      titularId,
    };
  }
  return { shiftId: cov.id, data, yaMovida: false, fuenteId: shiftId, covId: cov.id, titularId };
}

export async function cerrarFuenteSiCorresponde(db: Firestore, destino: DestinoFichada): Promise<void> {
  if (!destino.fuenteId || !destino.covId) return;
  const ref = db.collection('turnos').doc(destino.fuenteId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = snap.data() as Record<string, unknown>;
  if (
    data.coverageUsed === true
    && data.isPresent !== true
    && ms(data.realStartTime) === 0
    && ms(data.checkInAt) === 0
    && data.isDeleted === true
  ) return;
  await ref.update(parcheFuenteSinHoras(destino.covId, destino.titularId || ''));
}

/** ¿Venís? no sale si quien cubre ya fichó en el turno del que salió la cobertura. */
export async function fuenteDeCoberturaYaFicho(
  db: Firestore,
  shift: Record<string, unknown>,
): Promise<boolean> {
  if (String(shift.origin || '').toUpperCase() !== 'OPERATIONS_COVERAGE') return false;
  const ct = String(shift.coverageType || '').toUpperCase();
  if (!FUENTE.has(ct)) return false;
  const sourceId = String(shift.sourceShiftId || '').trim();
  if (!sourceId) return false;
  const src = await db.collection('turnos').doc(sourceId).get();
  if (!src.exists) return false;
  return yaFicho(src.data() as Record<string, unknown>);
}
