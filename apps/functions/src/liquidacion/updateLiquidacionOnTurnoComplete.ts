import * as admin from 'firebase-admin';
import { calcTurnoHoursContrib } from './turnoHoursCalc';

let holidaysCache: { at: number; set: Set<string> } | null = null;

async function loadHolidays(db: FirebaseFirestore.Firestore): Promise<Set<string>> {
  const now = Date.now();
  if (holidaysCache && now - holidaysCache.at < 60 * 60 * 1000) {
    return holidaysCache.set;
  }
  const set = new Set<string>();
  const snap = await db.collection('feriados').limit(400).get();
  snap.forEach((d) => {
    const v = d.data()?.date;
    if (typeof v === 'string') set.add(v);
  });
  holidaysCache = { at: now, set };
  return set;
}

/**
 * Incrementa agregados mensuales al completar un turno (idempotente por turnoId).
 */
export async function updateLiquidacionOnTurnoComplete(
  db: FirebaseFirestore.Firestore,
  turnoId: string,
  after: FirebaseFirestore.DocumentData | null,
  before: FirebaseFirestore.DocumentData | null,
): Promise<void> {
  if (!after) return;
  if (before?.isCompleted === true && after.isCompleted === true) return;
  if (after.isCompleted !== true) return;

  const holidays = await loadHolidays(db);
  const contrib = calcTurnoHoursContrib(after as Record<string, unknown>, holidays);
  if (!contrib) return;

  const empresaId = String(after.empresaId ?? 'bacarsa').trim() || 'bacarsa';
  const employeeId = String(after.employeeId ?? '').trim();
  if (!employeeId || employeeId === 'VACANTE') return;

  const contribRef = db.collection('liquidacion_turno_contrib').doc(turnoId);
  const existing = await contribRef.get();
  if (existing.exists) return;

  const monthDocId = `${empresaId}_${contrib.monthKey}`;
  const monthRef = db.collection('liquidacion_mensual').doc(monthDocId);
  const empRef = monthRef.collection('empleados').doc(employeeId);
  const inc = admin.firestore.FieldValue.increment;

  const batch = db.batch();

  batch.set(contribRef, {
    turnoId,
    empresaId,
    employeeId,
    monthKey: contrib.monthKey,
    hsTeoricas: contrib.hsTeoricas,
    hsReales: contrib.hsReales,
    diurnas: contrib.diurnas,
    nocturnas: contrib.nocturnas,
    al100FT: contrib.al100FT,
    plusFeriado: contrib.plusFeriado,
    isFT: contrib.isFT,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  batch.set(monthRef, {
    empresaId,
    monthKey: contrib.monthKey,
    hsTeoricas: inc(contrib.hsTeoricas),
    hsReales: inc(contrib.hsReales),
    diurnas: inc(contrib.diurnas),
    nocturnas: inc(contrib.nocturnas),
    al100FT: inc(contrib.al100FT),
    plusFeriado: inc(contrib.plusFeriado),
    turnosCompletados: inc(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  batch.set(empRef, {
    employeeId,
    employeeName: after.employeeName || '',
    hsTeoricas: inc(contrib.hsTeoricas),
    hsReales: inc(contrib.hsReales),
    diurnas: inc(contrib.diurnas),
    nocturnas: inc(contrib.nocturnas),
    al100FT: inc(contrib.al100FT),
    plusFeriado: inc(contrib.plusFeriado),
    turnosCompletados: inc(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await batch.commit();
}
