import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { evaluateServerCheckInWindow, type CheckInWindowResult } from './checkInWindow';
import { resolveCheckInPayClock } from './checkInPay';
import { isExcluidoDeOperacion } from '../common/excluirDeOperacion';
import { tramosDeTurnoCortado, bloquesDeTurnoCortado, type PlanFichadaTramo } from '../common/turnoCortado';

type TramoFichable = Extract<PlanFichadaTramo, { tipo: 'tramo' }>;

/**
 * El turno tal como lo ve la ventana de fichada del tramo N: inicio y fin del tramo,
 * sin presencia ni avisos de llegada tarde del tramo anterior.
 */
export function turnoVirtualDeTramo(
  shiftData: Record<string, unknown>,
  plan: TramoFichable,
): Record<string, unknown> {
  return {
    ...shiftData,
    startTime: Timestamp.fromMillis(plan.startMs),
    endTime: Timestamp.fromMillis(plan.endMs),
    isPresent: false,
    status: 'PENDING',
    isEarlyStart: false,
    adjustedStartTime: null,
    lateArrivalAt: null,
    lateArrivalEtaAt: null,
    lateArrivalConfirmed: false,
  };
}

export function evaluarVentanaTramo(
  shiftData: Record<string, unknown>,
  plan: TramoFichable,
  nowMs: number,
  opts: { source: string; fichadaRemota: boolean },
): CheckInWindowResult {
  return evaluateServerCheckInWindow(turnoVirtualDeTramo(shiftData, plan), nowMs, opts);
}

/**
 * Ingreso en el tramo N (≥ 2) de un turno cortado. La presencia vive en `presenciaBloques.bN`
 * y el turno vuelve a PRESENT con su fin corrido al fin de ese tramo (igual que el CC), para que
 * el cierre automático no lo complete en el corte. No releva a nadie: el relevo es del tramo 1.
 */
export async function registrarPresenciaTramo(
  db: FirebaseFirestore.Firestore,
  input: {
    shiftId: string;
    plan: TramoFichable;
    empId: string;
    coords?: { lat?: number; lng?: number } | null;
    recordedAt?: string | null;
    source: 'PORTAL_GPS' | 'OPERATIONS';
    fichadaRemota: boolean;
    window: CheckInWindowResult;
  },
): Promise<{ success: true; alreadyPresent?: boolean }> {
  const { shiftId, plan, empId, coords, recordedAt, source, window } = input;
  const shiftRef = db.collection('turnos').doc(shiftId);
  const snap = await shiftRef.get();
  if (!snap.exists) throw new Error('TURNO_NOT_FOUND');
  const shiftData = snap.data() as Record<string, unknown>;
  const n = plan.tramo;

  const pbPrevio = (shiftData.presenciaBloques || {}) as Record<string, { realStartTime?: unknown } | undefined>;
  if (pbPrevio[`b${n}`]?.realStartTime) return { success: true, alreadyPresent: true };

  const nowMs = recordedAt ? new Date(recordedAt).getTime() : Date.now();
  const pay = resolveCheckInPayClock({
    nowMs,
    plannedStartMs: plan.startMs,
    windowLateMinutes: window.lateMinutes ?? 0,
  });
  const realStart = pay.isLate ? Timestamp.fromMillis(pay.realStartMs) : Timestamp.fromMillis(plan.startMs);

  const patch: Record<string, unknown> = {
    status: 'PRESENT',
    isPresent: true,
    isCompleted: false,
    isAbsent: false,
    [`presenciaBloques.b${n}.realStartTime`]: realStart,
    [`presenciaBloques.b${n}.checkInSource`]: source,
    [`presenciaBloques.b${n}.checkInAt`]: Timestamp.fromMillis(pay.checkInAtMs),
    [`presenciaBloques.b${n}.checkInCoords`]: coords || null,
    [`presenciaBloques.b${n}.isLate`]: pay.isLate,
    [`presenciaBloques.b${n}.lateMinutes`]: pay.lateMinutes,
    presenciaSource: source,
    presenciaAt: FieldValue.serverTimestamp(),
  };

  // Si el corte ya había cerrado el turno, los tramos anteriores quedan cerrados.
  const yaCerrado = String(shiftData.status || '').toUpperCase() === 'COMPLETED' || shiftData.isCompleted === true;
  if (yaCerrado) {
    for (let k = 1; k < n; k += 1) {
      patch[`presenciaBloques.b${k}.cerrado`] = true;
      if (k === 1 && shiftData.realEndTime) patch['presenciaBloques.b1.realEndTime'] = shiftData.realEndTime;
    }
  }

  const bloques = bloquesDeTurnoCortado(shiftData);
  const startMs = (shiftData.startTime as Timestamp | undefined)?.toMillis?.() ?? 0;
  if (bloques && startMs) {
    const tr = tramosDeTurnoCortado(startMs, bloques)[n - 1];
    const finActual = (shiftData.endTime as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (tr && tr.endMs > finActual) patch.endTime = Timestamp.fromMillis(tr.endMs);
  }

  await shiftRef.update(patch);

  const fueraDeCc = isExcluidoDeOperacion(shiftData);
  if (!fueraDeCc) {
    void db
      .collection('novedades')
      .add({
        type: 'INGRESO_AUTOREGISTRO',
        shiftId,
        bloque: n,
        employeeId: empId,
        employeeName: shiftData.employeeName || '',
        objectiveId: shiftData.objectiveId || '',
        objectiveName: shiftData.objectiveName || '',
        clientName: shiftData.clientName || '',
        empresaId: shiftData.empresaId || null,
        coords: coords || null,
        source,
        description: `Ingreso tramo ${n} (${source}): ${shiftData.employeeName || empId}`,
        createdAt: FieldValue.serverTimestamp(),
        status: 'unread',
        viewed: false,
      })
      .catch((e) => console.warn('[registrarPresenciaTramo] novedad:', (e as Error)?.message));
  }

  void db
    .collection('audit_logs')
    .add({
      action: pay.isLate ? 'LLEGADA_TARDE' : 'PRESENTE',
      module: source === 'OPERATIONS' ? 'OPERACIONES' : 'PORTAL',
      actorName: source,
      timestamp: FieldValue.serverTimestamp(),
      employeeId: empId,
      employeeName: shiftData.employeeName || '',
      objectiveId: shiftData.objectiveId || '',
      objectiveName: shiftData.objectiveName || '',
      shiftId,
      empresaId: shiftData.empresaId || null,
      details: `${shiftData.employeeName || empId} ingresó al tramo ${n}${pay.isLate ? ' tarde' : ''} (${source}).`,
    })
    .catch(() => undefined);

  return { success: true };
}
