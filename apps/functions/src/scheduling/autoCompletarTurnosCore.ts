import * as admin from 'firebase-admin';
import { Timestamp, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
  loadPositionHasContinuity,
  nextBandSlotsFromSlaDoc,
  positionHasContinuityFromSlaDoc,
} from '../coverage/positionHasContinuity';
import { retainOutgoingForGap } from '../coverage/coverageRetention';
import { handoffAtEnd } from '../coverage/handoffContinuity';
import { ObjectiveOperationCache } from '../common/simulableShift';
import { loadObjectiveIdsExcluidos, turnoFueraDeCentroDeControl } from '../common/excluirDeOperacion';
import { isOpsCoverageHoursOnSourceDoc } from '../coverage/coverageTraceShift';
import { isLicenseShiftCode } from '../common/simulableShift';
import { isExtraNonReliefShift, isReliefEligibleShift } from '../common/reliefEligibility';
import {
  isRecognizedSeriesCode,
  keepsNextBandSlot,
  relieverFor,
  seriesCodeOf,
  seriesHandoffKind,
} from '../common/shiftSeries';
import { rosterIfSameSecond } from '../fichajes/relevoOutgoingMatch';
import { escalarVacanteSinCobertura } from '../coverage/escalarVacanteSinCobertura';
import { retentionPendingReason } from './retentionPendingReason';
import { guardFirstName } from '../common/pushGreeting';
import { isEventoShift } from '../eventos/eventoCoverage';
import {
  finTurnoCopy,
  finTurnoDocId,
  type FinTurnoKind,
} from '../fichajes/relevoNotifications';
import {
  buildAutoClosePatch,
  clearRetentionOnReliefClose,
  shiftHardCapAtMs,
  shiftWorkStartMs,
  STALE_CAP_GRACE_MS,
} from './shiftClose';

const RELEVO_WINDOW_AFTER_MS = 2 * 60 * 60 * 1000;
const RELEVO_ALIGN_MS = 30 * 60 * 1000;

export type AutoCompleteContext = {
  /**
   * Centro de Control prendido. Con CC apagado el cierre corre igual en modo silencioso:
   * solo relevo / sin continuidad / tope, sin retener, sin novedades, sin escalar, sin push.
   */
  isEnabled: (empresaId: unknown) => boolean;
  shiftEmpresaId: (shift: FirebaseFirestore.DocumentData) => string;
  sameTenantShift: (
    a: FirebaseFirestore.DocumentData,
    b: FirebaseFirestore.DocumentData,
  ) => boolean;
  getEmployeeTokens: (db: Firestore, employeeId: string) => Promise<string[]>;
  /** Demo: no avisar a guardias reales. Igual que los avisos de llegada (P5b). */
  isDemo?: (empresaId: unknown) => boolean;
};

export type AutoCompleteActionKind = 'CLOSE' | 'RETAIN' | 'RETAIN_QUIET' | 'LINK_RELIEF' | 'WAIT';

export type AutoCompleteAction = {
  shiftId: string;
  kind: AutoCompleteActionKind;
  reason: string;
  empresaId: string;
  employeeName: string;
  objectiveName: string;
  positionName: string;
  code: string;
  startMs: number;
  endMs: number;
  workStartMs: number;
  wasRetention: boolean;
  realEndMs?: number;
  requiereRevision?: boolean;
  gapShiftId?: string | null;
  /** Empresa con Centro de Control apagado (pase silencioso). */
  ccOff: boolean;
};

export type AutoCompletePassResult = {
  completed: number;
  alertedNoRelief: number;
  actions: AutoCompleteAction[];
};

function shiftEndMs(data: FirebaseFirestore.DocumentData): number {
  return data.endTime?.toMillis?.() ?? 0;
}

function shiftStartMs(data: FirebaseFirestore.DocumentData): number {
  return data.startTime?.toMillis?.() ?? 0;
}

/**
 * Relevo válido: turno que toma la franja del puesto (no ESC/REF/RET ni francos/licencias),
 * mismo puesto, start en [end−30m, end+2h], no compañero en curso (empezó antes de end−30m).
 */
export function isValidReliefForOutgoing(
  incoming: FirebaseFirestore.DocumentData,
  outgoingEndMs: number,
  outgoing?: FirebaseFirestore.DocumentData,
): boolean {
  if (!isReliefEligibleShift(incoming as Record<string, unknown>)) return false;
  const st = shiftStartMs(incoming);
  if (!st) return false;
  if (st < outgoingEndMs - RELEVO_ALIGN_MS) return false;
  if (st > outgoingEndMs + RELEVO_WINDOW_AFTER_MS) return false;
  if (outgoing && seriesHandoffKind(seriesCodeOf(outgoing), seriesCodeOf(incoming)) === 'REJECT') return false;
  return true;
}

/**
 * Relevo de la serie para este saliente. `peers` = los otros salientes de la misma franja
 * (FIFO: el que más tiempo lleva en el puesto se lleva al primer entrante que fichó).
 */
function pickSeriesRelief(
  outgoingId: string,
  outgoing: FirebaseFirestore.DocumentData,
  endTimeMs: number,
  docs: QueryDocumentSnapshot[],
  pred: (d: QueryDocumentSnapshot) => boolean,
  peers: readonly Record<string, unknown>[] = [],
  roster: readonly Record<string, unknown>[] = [],
): QueryDocumentSnapshot | undefined {
  const valid = docs.filter((d) => isValidReliefForOutgoing(d.data(), endTimeMs, outgoing));
  if (!valid.length) return undefined;
  const self = {
    id: outgoingId,
    ...(outgoing as Record<string, unknown>),
    startMs: shiftStartMs(outgoing),
    endMs: endTimeMs,
  };
  const opts = {
    earliestIncomingMs: endTimeMs - RELEVO_ALIGN_MS,
    latestIncomingMs: endTimeMs + RELEVO_WINDOW_AFTER_MS,
    peers: peers.filter((p) => String(p.id || '') !== outgoingId),
    roster,
  };
  const asRows = (list: QueryDocumentSnapshot[]) => list.map((d) => ({
    id: d.id,
    ...(d.data() as Record<string, unknown>),
    startMs: shiftStartMs(d.data()),
    endMs: shiftEndMs(d.data()),
  }));
  // El emparejamiento se hace sobre todos los entrantes válidos (presentes, pendientes y
  // ausentes) para que cada saliente vea al que realmente le toca; `pred` dice qué estado
  // se está consultando. Si el que le toca no lo cumple, se busca solo entre los que sí.
  const paired = relieverFor(self, asRows(valid), opts);
  const pairedDoc = paired?.id ? valid.find((d) => d.id === String(paired.id)) : undefined;
  if (pairedDoc && pred(pairedDoc)) return pairedDoc;
  const hits = valid.filter(pred);
  if (!hits.length) return undefined;
  const winner = relieverFor(self, asRows(hits), opts);
  if (!winner?.id) return undefined;
  return hits.find((d) => d.id === String(winner.id));
}

/** Limpia un relevo programado que dejó de ser válido (serie, ventana o el entrante ya no está). */
export function staleProgrammedReliefPatch(shift: FirebaseFirestore.DocumentData): Record<string, unknown> {
  return {
    relievedBy: null,
    relievedByName: null,
    relieveScheduledAt: null,
    relievedEarly: false,
    staleReliefInvalidatedAt: Timestamp.now(),
    staleReliefPrevious: {
      relievedBy: shift.relievedBy ?? null,
      relievedByName: shift.relievedByName ?? null,
      relieveScheduledAt: shift.relieveScheduledAt ?? null,
    },
  };
}

export function isReliefPresent(incoming: FirebaseFirestore.DocumentData): boolean {
  if (incoming.isCompleted === true) return false;
  const st = String(incoming.status || '').toUpperCase();
  return st === 'PRESENT' && incoming.isPresent !== false;
}

function isReliefPending(incoming: FirebaseFirestore.DocumentData): boolean {
  if (!incoming.employeeId || incoming.employeeId === 'VACANTE') return false;
  if (incoming.isUnassigned === true) return false;
  const st = String(incoming.status || '').toUpperCase();
  return st === 'PENDING' || st === 'PLAN' || st === '' || !st;
}

function isReliefAbsent(incoming: FirebaseFirestore.DocumentData): boolean {
  return incoming.isAbsent === true || String(incoming.status || '').toUpperCase() === 'ABSENT';
}

function isGapCovered(data: FirebaseFirestore.DocumentData): boolean {
  return data.operacionallyCovered === true || String(data.coverageStatus || '').toUpperCase() === 'COVERED';
}

function shiftEndDate(data: FirebaseFirestore.DocumentData): Date | null {
  const ms = shiftEndMs(data);
  return ms ? new Date(ms) : null;
}

export type AutoCompletarTurnosPassOpts = {
  /** Emulador/E2E: procesar solo este turno saliente (evita escanear miles de docs de lab). */
  onlyOutgoingShiftId?: string | null;
  /** Solo lista las acciones que haría (no escribe, no notifica). */
  dryRun?: boolean;
  /** Limita la pasada a las empresas que devuelvan true (dryRun por empresa). */
  empresaFilter?: (empresaId: string) => boolean;
  /**
   * Pasada puntual (scheduler de 1 min): solo turnos cuyo fin cayó en esta ventana
   * y no tienen continuidad (sin franja, fin de servicio o evento). El resto lo cierra el cron de 5 min.
   */
  recentEndMs?: number;
};

type CapEscalation = {
  shiftId: string;
  shift: FirebaseFirestore.DocumentData;
  capAtMs: number;
  gapShiftId: string | null;
  gapCovered: boolean;
};

export async function runAutoCompletarTurnosPass(
  db: Firestore,
  ctx: AutoCompleteContext,
  now: Timestamp = Timestamp.now(),
  passOpts?: AutoCompletarTurnosPassOpts,
): Promise<AutoCompletePassResult> {
  const nowMs = now.toMillis();
  const cutoff = Timestamp.fromMillis(nowMs);
  const onlyOutId = String(passOpts?.onlyOutgoingShiftId || '').trim();
  const dryRun = passOpts?.dryRun === true;
  const recentEndMs = !onlyOutId && passOpts?.recentEndMs && passOpts.recentEndMs > 0
    ? passOpts.recentEndMs
    : 0;

  let snap: FirebaseFirestore.QuerySnapshot;
  if (onlyOutId) {
    const direct = await db.collection('turnos').doc(onlyOutId).get();
    snap = direct.exists
      ? ({ empty: false, docs: [direct] } as FirebaseFirestore.QuerySnapshot)
      : ({ empty: true, docs: [] } as FirebaseFirestore.QuerySnapshot);
  } else {
    let q = db
      .collection('turnos')
      .where('status', '==', 'PRESENT')
      .where('endTime', '<=', cutoff);
    if (recentEndMs) {
      q = q.where('endTime', '>=', Timestamp.fromMillis(nowMs - recentEndMs));
    }
    snap = await q.get();
  }

  const actions: AutoCompleteAction[] = [];
  if (snap.empty) return { completed: 0, alertedNoRelief: 0, actions };

  const completeBatch = db.batch();
  let batchOps = 0;
  let completed = 0;
  let alertedNoRelief = 0;

  const slaCache = new Map<string, FirebaseFirestore.DocumentData[]>();
  const opCache = new ObjectiveOperationCache();
  const excludedObjectives = await loadObjectiveIdsExcluidos(db);
  const reliefIncomingClaimed = new Set<string>();
  const reliefPendingClaimed = new Set<string>();
  const capEscalations: CapEscalation[] = [];
  const FIN_SIN_RELEVO = new Set([
    'SIN_CONTINUIDAD_SLA',
    'FIN_SERVICIO_SIN_CRONOGRAMA',
    'FIN_TURNO_EXTRA',
    'FIN_HUECO_SIN_CONTINUIDAD',
    'SIN_LUGAR_FRANJA',
  ]);
  const pendingCloses: {
    ref: FirebaseFirestore.DocumentReference;
    patch: Record<string, unknown>;
    aviso: {
      kind: FinTurnoKind;
      employeeId: string;
      employeeName: string;
      incomingName?: string;
      place: string;
      hm?: string;
      empresaId: string | null;
    } | null;
  }[] = [];

  const describe = (
    id: string,
    shift: FirebaseFirestore.DocumentData,
    kind: AutoCompleteActionKind,
    reason: string,
    extra: Partial<AutoCompleteAction> = {},
  ): AutoCompleteAction => ({
    shiftId: id,
    kind,
    reason,
    empresaId: ctx.shiftEmpresaId(shift),
    employeeName: String(shift.employeeName || shift.employeeId || ''),
    objectiveName: String(shift.objectiveName || shift.objectiveId || ''),
    positionName: String(shift.positionName || ''),
    code: String(shift.code || ''),
    startMs: shiftStartMs(shift),
    endMs: shiftEndMs(shift),
    workStartMs: shiftWorkStartMs(shift as Record<string, unknown>),
    wasRetention: shift.isRetention === true,
    ccOff: !ctx.isEnabled(shift.empresaId),
    ...extra,
  });

  const update = (ref: FirebaseFirestore.DocumentReference, patch: Record<string, unknown>) => {
    if (!dryRun) {
      completeBatch.update(ref, patch);
      batchOps += 1;
    }
  };

  const close = (
    docSnap: FirebaseFirestore.DocumentSnapshot,
    shift: FirebaseFirestore.DocumentData,
    realEndMs: number,
    reason: string,
    extra?: Record<string, unknown>,
    gapShiftId?: string | null,
    incomingName?: string,
  ) => {
    const patch = buildAutoClosePatch(shift as Record<string, unknown>, { realEndMs, reason, now, extra });
    if (reason === 'RELEVO_PRESENTE' || reason === 'RELEVO_PROGRAMADO') {
      clearRetentionOnReliefClose(patch);
    }
    const silent = !ctx.isEnabled(shift.empresaId) || ctx.isDemo?.(shift.empresaId) === true;
    const empId = String(shift.employeeId || '').trim();
    const endMs = (patch.realEndTime as Timestamp).toMillis();
    let kind: FinTurnoKind | null = null;
    if (reason === 'TOPE_JORNADA') kind = 'TOPE';
    else if (reason === 'RELEVO_PRESENTE' || reason === 'RELEVO_PROGRAMADO') kind = 'RELIEVO';
    else if (FIN_SIN_RELEVO.has(reason)) kind = 'FIN';
    const aviso = !dryRun && !silent && !shift.finTurnoAvisoAt && empId && empId !== 'VACANTE' && kind
      ? {
          kind,
          employeeId: empId,
          employeeName: String(shift.employeeName || ''),
          incomingName: kind === 'RELIEVO' ? (incomingName || 'tu relevo') : undefined,
          place: isEventoShift(shift) 
            ? (String(shift.eventoNombre || shift.objectiveName || '').trim() || 'el evento')
            : (String(shift.objectiveName || '').trim() || 'el puesto'),
          hm: kind === 'FIN' ? fmtArHm(endMs) : undefined,
          empresaId: ctx.shiftEmpresaId(shift) || null,
        }
      : null;
    if (!dryRun) pendingCloses.push({ ref: docSnap.ref, patch, aviso });
    actions.push(describe(docSnap.id, shift, 'CLOSE', reason, {
      realEndMs: (patch.realEndTime as Timestamp).toMillis(),
      requiereRevision: patch.requiereRevision === true,
      gapShiftId: gapShiftId ?? null,
    }));
    completed++;
  };

  async function slasFor(oid: string): Promise<FirebaseFirestore.DocumentData[]> {
    if (!slaCache.has(oid)) {
      // Un objetivo puede tener varios contratos "active" (uno por mes): vale el vigente en la fecha.
      const slaSnap = await db
        .collection('servicios_sla')
        .where('objectiveId', '==', oid)
        .where('status', '==', 'active')
        .get();
      slaCache.set(oid, slaSnap.docs.map((d) => ({ ...d.data(), id: d.id })));
    }
    return slaCache.get(oid) || [];
  }

  async function hasContinuity(shift: FirebaseFirestore.DocumentData): Promise<boolean> {
    const oid = String(shift.objectiveId || '');
    const end = shiftEndDate(shift);
    if (!oid || !end) return false;
    return (await slasFor(oid)).some((sla) =>
      positionHasContinuityFromSlaDoc(sla, shift.positionName || '', end, seriesCodeOf(shift)),
    );
  }

  /**
   * Retenido por un hueco (`retentionAbsenceShiftId`) que ya terminó: si a esa hora el puesto
   * no tiene franja siguiente, devuelve el fin del hueco para cerrar ahí. Si el hueco sigue
   * abierto, no se conoce, o hay continuidad (otra franja arranca ±30 min), devuelve null y
   * el retenido sigue esperando relevo o tope.
   */
  async function retainedGapEndedWithoutContinuity(
    shift: FirebaseFirestore.DocumentData,
    relieveDocs: QueryDocumentSnapshot[],
  ): Promise<{ gapId: string; gapEndMs: number } | null> {
    const gapId = String(shift.retentionAbsenceShiftId || '').trim();
    const oid = String(shift.objectiveId || '');
    if (!gapId || !oid) return null;
    const inWindow = relieveDocs.find((d) => d.id === gapId);
    const gapData = inWindow
      ? inWindow.data()
      : ((await db.collection('turnos').doc(gapId).get()).data() ?? null);
    if (!gapData) return null;
    const gapEndMs = shiftEndMs(gapData);
    if (!gapEndMs || nowMs < gapEndMs) return null;
    const gapEnd = new Date(gapEndMs);
    const continuous = (await slasFor(oid)).some((sla) =>
      positionHasContinuityFromSlaDoc(sla, shift.positionName || '', gapEnd, seriesCodeOf(gapData as Record<string, unknown>)),
    );
    if (continuous) return null;
    return { gapId, gapEndMs };
  }

  async function nextBandSlots(shift: FirebaseFirestore.DocumentData): Promise<number | null> {
    const oid = String(shift.objectiveId || '');
    const end = shiftEndDate(shift);
    if (!oid || !end) return null;
    for (const sla of await slasFor(oid)) {
      const slots = nextBandSlotsFromSlaDoc(sla, shift.positionName || '', end, seriesCodeOf(shift));
      if (slots != null) return slots;
    }
    return null;
  }

  /** Salientes de la misma franja (mismo puesto, mismo fin ±30 y misma serie) que trabajaron. */
  async function handoffSiblings(
    outId: string,
    shift: FirebaseFirestore.DocumentData,
    endTimeMs: number,
  ): Promise<Record<string, unknown>[]> {
    const snap = await db
      .collection('turnos')
      .where('objectiveId', '==', shift.objectiveId)
      .where('positionName', '==', shift.positionName)
      .where('startTime', '>=', Timestamp.fromMillis(endTimeMs - 13 * 60 * 60 * 1000))
      .where('startTime', '<=', Timestamp.fromMillis(endTimeMs))
      .get();
    const outCode = seriesCodeOf(shift as Record<string, unknown>);
    return snap.docs
      .filter((d) => {
        if (d.id === outId) return true;
        const data = d.data() as Record<string, unknown>;
        if (!ctx.sameTenantShift(shift, data)) return false;
        if (isOpsCoverageHoursOnSourceDoc(data) || !isReliefEligibleShift(data)) return false;
        if (data.isAbsent === true || String(data.status || '').toUpperCase() === 'ABSENT') return false;
        const eid = String(data.employeeId || '').trim();
        if (!eid || eid === 'VACANTE') return false;
        const worked = data.isPresent === true
          || !!(data.realStartTime || data.checkInAt || data.checkInTime);
        if (!worked) return false;
        const en = shiftEndMs(data);
        if (!en || Math.abs(en - endTimeMs) > RELEVO_ALIGN_MS) return false;
        const code = seriesCodeOf(data);
        if (isRecognizedSeriesCode(outCode) && isRecognizedSeriesCode(code) && code !== outCode) return false;
        return true;
      })
      .map((d) => ({
        id: d.id,
        ...(d.data() as Record<string, unknown>),
        startMs: shiftStartMs(d.data()),
        endMs: shiftEndMs(d.data()),
      }));
  }

  const outgoingDocs = [...snap.docs].sort(
    (a, b) => shiftWorkStartMs(a.data()) - shiftWorkStartMs(b.data()),
  );

  // Entrantes que ya relevan a otro saliente (fichada anticipada → relievedBy en el saliente):
  // no pueden volver a usarse como relevo de un segundo saliente (1:1).
  const reservedReliefKey = (objectiveId: unknown, employeeId: unknown) => `${String(objectiveId || '')}|${String(employeeId || '')}`;
  const reservedRelief = new Map<string, string>();
  for (const d of outgoingDocs) {
    const rb = String(d.data().relievedBy || '').trim();
    if (rb) reservedRelief.set(reservedReliefKey(d.data().objectiveId, rb), d.id);
  }
  const reliefBusyForOther = (incoming: FirebaseFirestore.DocumentData, outgoingId: string): boolean => {
    const linked = String(incoming.relievedOutgoingShiftId || '').trim();
    if (linked && linked !== outgoingId) return true;
    const owner = reservedRelief.get(reservedReliefKey(incoming.objectiveId, incoming.employeeId));
    return !!owner && owner !== outgoingId;
  };

  for (const docSnap of outgoingDocs) {
    if (onlyOutId && docSnap.id !== onlyOutId) continue;
    if (onlyOutId) {
      const endMs = shiftEndMs(docSnap.data());
      if (!endMs || endMs > cutoff.toMillis()) continue;
    }
    const shift = docSnap.data();
    if (turnoFueraDeCentroDeControl(shift, excludedObjectives)) continue;
    if (passOpts?.empresaFilter && !passOpts.empresaFilter(ctx.shiftEmpresaId(shift))) continue;
    const ccOff = !ctx.isEnabled(shift.empresaId);
    if (isOpsCoverageHoursOnSourceDoc(shift as Record<string, unknown>)) continue;
    if ((shift.status || '') === 'INTERRUPTED') continue;

    // Una licencia no es jornada: si quedó PRESENT (simulación vieja, carga manual) se deja
    // abierta para que RRHH la corrija, nunca se cierra por tope ni se le inventa realEndTime.
    if (isLicenseShiftCode(shift.code)) {
      actions.push(describe(docSnap.id, shift, 'WAIT', 'LICENCIA_PRESENTE'));
      continue;
    }

    const endTimeMs = shiftEndMs(shift);
    if (!endTimeMs) continue;

    if (recentEndMs) {
      const event = isEventoShift(shift as Record<string, unknown>);
      const handoffEarly = await handoffAtEnd(
        db,
        shift as Record<string, unknown>,
        new Date(endTimeMs),
        await slasFor(String(shift.objectiveId || '')),
        opCache,
      );
      const inScope = event || handoffEarly === 'FIN_SERVICIO' || !(await hasContinuity(shift));
      if (!inScope) continue;
    }
    const capAtMs = shiftHardCapAtMs(shift as Record<string, unknown>);
    const capReached = capAtMs > 0 && nowMs >= capAtMs;

    const relievedBy = String(shift.relievedBy || '').trim();
    const relieveSchedMs =
      (shift.relieveScheduledAt as { toMillis?: () => number } | undefined)?.toMillis?.()
      ?? (relievedBy ? endTimeMs : 0);

    // Turnos que pasaron el tope hace rato (cron caído / abiertos de días anteriores).
    if (capAtMs > 0 && nowMs >= capAtMs + STALE_CAP_GRACE_MS) {
      const retained = shift.isRetention === true;
      close(docSnap, shift, retained ? capAtMs : endTimeMs, 'TOPE_JORNADA_RETROACTIVO', {
        requiereRevision: true,
      });
      continue;
    }

    // ESC/REF/RET son sobreturnos: no ocupan la franja del puesto, así que no esperan
    // relevo ni se retienen. Cierran en su fin planificado (acotado al tope).
    if (isExtraNonReliefShift(shift as Record<string, unknown>)) {
      const cappedEnd = capAtMs > 0 ? Math.min(endTimeMs, capAtMs) : endTimeMs;
      close(docSnap, shift, cappedEnd, cappedEnd < endTimeMs ? 'TOPE_JORNADA' : 'FIN_TURNO_EXTRA');
      continue;
    }

    const handoff = await handoffAtEnd(db, shift as Record<string, unknown>, new Date(endTimeMs), await slasFor(String(shift.objectiveId || '')), opCache);
    if (handoff === 'FIN_SERVICIO') {
      close(docSnap, shift, endTimeMs, 'FIN_SERVICIO_SIN_CRONOGRAMA', { isRetention: false });
      continue;
    }

    const manualExtended =
      !ccOff
      && shift.isRetention === true
      && shift.manualRetentionType === 'extended'
      && Number(shift.manualRetentionHours || 0) > 0;
    if (manualExtended) {
      const extH = Number(shift.manualRetentionHours);
      const baseMs = shift.manualRetentionStartedAt?.toMillis?.() ?? endTimeMs;
      const elapsedAt = baseMs + extH * 3600000;
      if (capReached) {
        close(docSnap, shift, capAtMs, 'TOPE_JORNADA');
        capEscalations.push({ shiftId: docSnap.id, shift, capAtMs, gapShiftId: null, gapCovered: false });
      } else if (nowMs >= elapsedAt) {
        close(docSnap, shift, elapsedAt, 'MANUAL_EXTENSION_ELAPSED');
      }
      continue;
    }

    const windowStart = Timestamp.fromMillis(endTimeMs - RELEVO_WINDOW_AFTER_MS);
    const windowEnd = Timestamp.fromMillis(endTimeMs + RELEVO_WINDOW_AFTER_MS);

    // Sin objetivo o puesto no hay relevo identificable; un undefined en el where corta toda la pasada.
    const relieveSnap = shift.objectiveId && shift.positionName
      ? await db
        .collection('turnos')
        .where('objectiveId', '==', shift.objectiveId)
        .where('positionName', '==', shift.positionName)
        .where('startTime', '>=', windowStart)
        .where('startTime', '<=', windowEnd)
        .get()
      : { docs: [] as QueryDocumentSnapshot[] };

    const relieveDocs = relieveSnap.docs.filter(
      (d) =>
        d.id !== docSnap.id
        && ctx.sameTenantShift(shift, d.data())
        && !isOpsCoverageHoursOnSourceDoc(d.data() as Record<string, unknown>),
    );

    // El relevo programado se revalida al cerrar: el entrante tiene que seguir presente,
    // ser de la serie y arrancar en la ventana del fin. Un compañero del mismo horario
    // (M junto a M2) o un relevo que después faltó no cierran al saliente: se ignora el
    // `relieveScheduledAt` viejo y sigue la lógica actual (retener / cerrar).
    const programmedIncoming = relievedBy
      ? relieveDocs.find((d) => String(d.data().employeeId || '').trim() === relievedBy
        && isReliefPresent(d.data())
        && isValidReliefForOutgoing(d.data(), endTimeMs, shift))
      : undefined;
    if (relievedBy && !programmedIncoming && relieveSchedMs > 0 && nowMs >= relieveSchedMs) {
      const stale = staleProgrammedReliefPatch(shift);
      if (!dryRun) await docSnap.ref.update(stale).catch(() => undefined);
      Object.assign(shift, stale);
      const rk = reservedReliefKey(shift.objectiveId, relievedBy);
      if (reservedRelief.get(rk) === docSnap.id) reservedRelief.delete(rk);
      actions.push(describe(docSnap.id, shift, 'WAIT', 'RELEVO_PROGRAMADO_INVALIDO'));
    }
    if (programmedIncoming && relieveSchedMs > 0 && nowMs >= relieveSchedMs) {
      const incomingName = String(shift.relievedByName || programmedIncoming.data().employeeName || 'relevo').trim();
      close(docSnap, shift, relieveSchedMs, 'RELEVO_PROGRAMADO', undefined, undefined, incomingName);
      continue;
    }

    // Salientes de la misma franja (FIFO del relevo y cupo de la franja siguiente).
    const siblings = shift.objectiveId && shift.positionName
      ? await handoffSiblings(docSnap.id, shift, endTimeMs)
      : [];
    // Los que ya cerraron (relevados antes) no compiten por los entrantes que quedan.
    const peers = siblings.filter((s) => String(s.id || '') !== docSnap.id && s.isCompleted !== true && !s.realEndTime);
    const roster = await rosterIfSameSecond(
      db,
      [{ id: docSnap.id, ...(shift as Record<string, unknown>) }, ...peers],
      endTimeMs,
    );

    // Franja siguiente con menos lugares: se quedan los de menos tiempo en el puesto;
    // el resto se va a su horario, sin retención y sin tomar el relevo de otro.
    if (!shift.manualRetentionType && shift.objectiveId && shift.positionName) {
      const slots = await nextBandSlots(shift);
      if (slots != null) {
        const self = {
          id: docSnap.id,
          ...(shift as Record<string, unknown>),
          startMs: shiftStartMs(shift),
          endMs: endTimeMs,
        };
        if (!keepsNextBandSlot(self, siblings, slots)) {
          close(docSnap, shift, endTimeMs, 'SIN_LUGAR_FRANJA');
          continue;
        }
      }
    }

    const relievePresent = pickSeriesRelief(docSnap.id, shift, endTimeMs, relieveDocs, (d) => {
      if (reliefIncomingClaimed.has(d.id)) return false;
      if (reliefBusyForOther(d.data(), docSnap.id)) return false;
      return isReliefPresent(d.data());
    }, peers, roster);

    const relievePending =
      pickSeriesRelief(docSnap.id, shift, endTimeMs, relieveDocs, (d) =>
        !reliefPendingClaimed.has(d.id) && isReliefPending(d.data()), peers, roster)
      ?? pickSeriesRelief(docSnap.id, shift, endTimeMs, relieveDocs, (d) => isReliefPending(d.data()), peers, roster);
    if (relievePending) reliefPendingClaimed.add(relievePending.id);

    const relieveAbsent = pickSeriesRelief(docSnap.id, shift, endTimeMs, relieveDocs, (d) =>
      isReliefAbsent(d.data()), peers, roster);

    if (relievePresent) {
      reliefIncomingClaimed.add(relievePresent.id);
      update(relievePresent.ref, { relievedOutgoingShiftId: docSnap.id });
      const relData = relievePresent.data();
      const plannedIn = shiftStartMs(relData) || endTimeMs;
      const handoffMs = Math.max(plannedIn, endTimeMs);
      if (nowMs < handoffMs) {
        update(docSnap.ref, {
          relievedBy: String(relData.employeeId || '').trim() || null,
          relievedByName: String(relData.employeeName || 'relevo').trim(),
          relieveScheduledAt: Timestamp.fromMillis(handoffMs),
          relievedEarly: true,
          autoRelevo: true,
        });
        actions.push(describe(docSnap.id, shift, 'WAIT', 'RELEVO_PROGRAMADO'));
        continue;
      }
      const punchMs =
        relData.checkInAt?.toMillis?.() ??
        relData.checkInTime?.toMillis?.() ??
        nowMs;
      const relCheckMs = Math.max(handoffMs, Math.min(punchMs, nowMs));
      const closeMs = relCheckMs;
      const overCap = capAtMs > 0 && closeMs > capAtMs;
      const incomingName = String(relData.employeeName || 'tu relevo').trim();
      close(docSnap, shift, closeMs, overCap ? 'TOPE_JORNADA' : 'RELEVO_PRESENTE', undefined, undefined, incomingName);
      continue;
    }

    if (capReached) {
      const linkedGapId = String(shift.retentionAbsenceShiftId || '').trim();
      let gapData: FirebaseFirestore.DocumentData | null = null;
      if (linkedGapId) {
        const inWindow = relieveDocs.find((d) => d.id === linkedGapId);
        gapData = inWindow ? inWindow.data() : ((await db.collection('turnos').doc(linkedGapId).get()).data() ?? null);
      } else {
        gapData = (relieveAbsent ?? relievePending)?.data() ?? null;
      }
      const gapShiftId = linkedGapId || (relieveAbsent ?? relievePending)?.id || null;
      const gapCovered = gapData ? isGapCovered(gapData) : false;
      close(docSnap, shift, capAtMs, 'TOPE_JORNADA', undefined, gapShiftId);
      if (!ccOff) capEscalations.push({ shiftId: docSnap.id, shift, capAtMs, gapShiftId, gapCovered });
      continue;
    }

    if (ccOff && shift.isRetention === true) {
      actions.push(describe(docSnap.id, shift, 'WAIT', 'CC_OFF_ESPERA_TOPE'));
      continue;
    }

    if (shift.isRetention === true) {
      // El hueco que motivó la retención ya terminó y el puesto no sigue (sin franja siguiente
      // ±30 min): el retenido cierra al fin del hueco. Auditoría 29/09: FARIAS (Peaje, M3 12–16)
      // retenido por VENENCIA (T3 16–17) siguió "retenido" hasta el checkout manual de las 20:28.
      const gapEnded = await retainedGapEndedWithoutContinuity(shift, relieveDocs);
      if (gapEnded) {
        close(docSnap, shift, gapEnded.gapEndMs, 'FIN_HUECO_SIN_CONTINUIDAD', undefined, gapEnded.gapId);
        continue;
      }
      if (relievePending) {
        const pendingData = relievePending.data();
        const nextReason = retentionPendingReason({
          nowMs,
          reliefStartMs: shiftStartMs(pendingData),
          employeeName: String(pendingData.employeeName || 'relevo'),
        });
        if (String(shift.retentionReason || '') !== nextReason) {
          update(docSnap.ref, { retentionReason: nextReason });
        }
      }
      // Retenido dentro del tope y sin relevo presente: sigue retenido.
      const linkTarget = relieveAbsent ?? relievePending;
      if (!shift.retentionAbsenceShiftId && linkTarget) {
        update(docSnap.ref, { retentionAbsenceShiftId: linkTarget.id });
        actions.push(describe(docSnap.id, shift, 'LINK_RELIEF', 'RETENIDO_VINCULA_RELEVO', { gapShiftId: linkTarget.id }));
      }
      continue;
    }

    const continuous = await hasContinuity(shift);

    if (ccOff) {
      // CC apagado: sin retención ni avisos; con continuidad queda abierto hasta relevo o tope.
      if (continuous) actions.push(describe(docSnap.id, shift, 'WAIT', 'CC_OFF_ESPERA_TOPE'));
      else close(docSnap, shift, endTimeMs, 'SIN_CONTINUIDAD_SLA');
      continue;
    }

    if (relievePending || relieveAbsent) {
      const retentionUntilMs =
        (shift.retentionExpectedUntil as { toMillis?: () => number } | undefined)?.toMillis?.()
        ?? (shift.lateReliefEtaAt as { toMillis?: () => number } | undefined)?.toMillis?.()
        ?? 0;
      if (retentionUntilMs > 0 && nowMs < retentionUntilMs) {
        actions.push(describe(docSnap.id, shift, 'WAIT', 'ESPERA_ETA_RELEVO'));
        continue;
      }
      if (!continuous) {
        close(docSnap, shift, endTimeMs, 'SIN_CONTINUIDAD_SLA');
        continue;
      }
      if (relieveAbsent) {
        const absentData = relieveAbsent.data();
        if (isGapCovered(absentData)) {
          // Hueco ya cubierto (cubridor en camino): espera sin re-notificar la retención.
          update(docSnap.ref, {
            isRetention: true,
            retentionReason: 'ESPERA_CUBRIDOR',
            retentionKind: 'AUSENCIA_RELEVO',
            retentionAbsenceShiftId: relieveAbsent.id,
            retentionStartedAt: Timestamp.fromMillis(endTimeMs),
            autoRetentionAt: Timestamp.fromMillis(endTimeMs),
          });
          actions.push(describe(docSnap.id, shift, 'RETAIN_QUIET', 'ESPERA_CUBRIDOR', { gapShiftId: relieveAbsent.id }));
        } else {
          if (!dryRun) {
            await retainOutgoingForGap(
              db,
              { ...absentData, id: relieveAbsent.id },
              { sendPush: true, reportedBy: 'AUTO' },
            );
          }
          actions.push(describe(docSnap.id, shift, 'RETAIN', 'AUSENCIA_RELEVO', { gapShiftId: relieveAbsent.id }));
        }
      } else if (relievePending) {
        const pendingData = relievePending.data();
        update(docSnap.ref, {
          isRetention: true,
          retentionReason: retentionPendingReason({
            nowMs,
            reliefStartMs: shiftStartMs(pendingData),
            employeeName: String(pendingData.employeeName || 'relevo'),
          }),
          retentionAbsenceShiftId: relievePending.id,
          retentionStartedAt: Timestamp.fromMillis(endTimeMs),
          autoRetentionAt: Timestamp.fromMillis(endTimeMs),
        });
        actions.push(describe(docSnap.id, shift, 'RETAIN', 'RELEVO_NO_PRESENTADO', { gapShiftId: relievePending.id }));
      }
      alertedNoRelief++;
    } else if (!continuous) {
      const retentionUntilMs =
        (shift.retentionExpectedUntil as { toMillis?: () => number } | undefined)?.toMillis?.()
        ?? (shift.lateReliefEtaAt as { toMillis?: () => number } | undefined)?.toMillis?.()
        ?? 0;
      if (retentionUntilMs > 0 && nowMs < retentionUntilMs) {
        actions.push(describe(docSnap.id, shift, 'WAIT', 'ESPERA_ETA_RELEVO'));
        continue;
      }
      close(docSnap, shift, endTimeMs, 'SIN_CONTINUIDAD_SLA');
    } else {
      update(docSnap.ref, {
        isRetention: true,
        retentionReason: 'SIN_RELEVO_CONTINUIDAD',
        retentionStartedAt: Timestamp.fromMillis(endTimeMs),
        autoRetentionAt: Timestamp.fromMillis(endTimeMs),
      });
      actions.push(describe(docSnap.id, shift, 'RETAIN', 'SIN_RELEVO_CONTINUIDAD'));
      alertedNoRelief++;
    }
  }

  if (dryRun) return { completed, alertedNoRelief, actions };

  if (batchOps) await completeBatch.commit();

  for (const c of pendingCloses) {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(c.ref);
      if (!snap.exists || snap.data()?.isCompleted === true) return;
      const already = !!snap.data()?.finTurnoAvisoAt;
      const aviso = !already ? c.aviso : null;
      let uid: string | null = null;
      let name = '';
      if (aviso) {
        const emp = await tx.get(db.collection('empleados').doc(aviso.employeeId));
        const row = emp.data() || {};
        uid = row.uid ? String(row.uid) : null;
        name = guardFirstName({ firstName: row.firstName, employeeName: aviso.employeeName || row.nombre });
      }
      tx.update(c.ref, aviso ? { ...c.patch, finTurnoAvisoAt: now } : c.patch);
      if (!aviso) return;
      const msg = finTurnoCopy({
        kind: aviso.kind,
        name,
        place: aviso.place,
        incomingName: aviso.incomingName,
        hm: aviso.hm,
      });
      tx.set(db.collection('user_notifications').doc(finTurnoDocId(c.ref.id)), {
        uid,
        employeeId: aviso.employeeId,
        userId: aviso.employeeId,
        title: msg.title,
        body: msg.body,
        type: msg.type,
        target: 'employee',
        turnoId: c.ref.id,
        shiftId: c.ref.id,
        empresaId: aviso.empresaId,
        read: false,
        readAt: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }).catch((e) => console.warn('[autoCompletarTurnos] cierre:', (e as Error)?.message));
  }

  for (const esc of capEscalations) {
    await escalateCapClose(db, ctx, esc, now).catch((e) =>
      console.warn('[autoCompletarTurnos] TOPE_JORNADA escalado:', (e as Error)?.message),
    );
  }

  return { completed, alertedNoRelief, actions };
}

function fmtArHm(ms: number): string {
  const d = new Date(ms - 3 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Al tope el guardia se retira aunque no llegue el relevo: el puesto queda vacante. */
async function escalateCapClose(
  db: Firestore,
  ctx: AutoCompleteContext,
  esc: CapEscalation,
  now: Timestamp,
): Promise<void> {
  const { shift, shiftId, capAtMs, gapShiftId, gapCovered } = esc;
  const empresaId = ctx.shiftEmpresaId(shift) || null;
  const who = String(shift.employeeName || 'Guardia');
  const where = `${shift.objectiveName || 'objetivo'} (${shift.positionName || 'puesto'})`;
  const gapTxt = !gapShiftId
    ? 'sin relevo planificado: el puesto queda vacante.'
    : gapCovered
      ? 'el cubridor asignado todavía no se presentó.'
      : 'el relevo no está cubierto: el puesto queda vacante.';

  const safeId = shiftId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  await db.collection('novedades').doc(`tope_${safeId}`).set({
    type: 'TOPE_JORNADA',
    status: 'PENDIENTE',
    shiftId,
    gapShiftId: gapShiftId || null,
    objectiveId: shift.objectiveId || null,
    objectiveName: shift.objectiveName || '',
    positionName: shift.positionName || '',
    employeeId: shift.employeeId || null,
    employeeName: who,
    empresaId,
    description: `${who} cerró a las ${fmtArHm(capAtMs)} por tope de jornada (12:59) en ${where}; ${gapTxt}`,
    createdAt: now,
    source: 'SYSTEM_SCHEDULER',
  }, { merge: true });

  if (gapShiftId && !gapCovered) {
    await escalarVacanteSinCobertura(db as admin.firestore.Firestore, {
      shiftId: gapShiftId,
      empresaId,
      objectiveId: String(shift.objectiveId || '') || null,
      objectiveName: String(shift.objectiveName || ''),
      positionName: String(shift.positionName || ''),
      attemptRetention: false,
      source: 'TOPE_JORNADA',
      message: `Tope de jornada: ${who} se retiró a las ${fmtArHm(capAtMs)} y el puesto ${where} quedó sin cobertura.`,
    });
  }

}

export { loadPositionHasContinuity };
