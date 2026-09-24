/**
 * Eval estados llegada tarde del monitor CC (sin emulador).
 *   npx tsx apps/web2/scripts/eval-ops-late-arrival-monitor.ts
 */
import {
  computeOpsLateArrivalMonitorState,
} from '../src/lib/operaciones/opsLateArrivalMonitor';

function arDate(isoLocal: string): number {
  return new Date(isoLocal).getTime();
}

function report(id: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'OK' : 'FALLA'}\t${id}\t${detail}`);
  if (!ok) process.exitCode = 1;
}

const eligible = true;

// Caso 1: aviso antes del inicio (14:52 → turno 15:00, eta 30)
{
  const startMs = arDate('2026-09-24T15:00:00-03:00');
  const nowMs = arDate('2026-09-24T14:52:00-03:00');
  const shift = {
    lateArrivalAt: { seconds: Math.floor(nowMs / 1000) },
    lateArrivalEtaMinutes: 30,
    lateArrivalEtaAt: { seconds: Math.floor(startMs / 1000) + 30 * 60 },
  };
  const st = computeOpsLateArrivalMonitorState({ shift, startMs, nowMs, eligible });
  report(
    '1-aviso-pre-inicio',
    st.isLateNotified && !st.isPotentialAbsence && !st.isLateUnnotified,
    JSON.stringify(st),
  );
}

// Caso 2: eta 60 a T+45 — sigue TARDE AVISADA hasta T+60
{
  const startMs = arDate('2026-09-24T15:00:00-03:00');
  const nowMs = arDate('2026-09-24T15:45:00-03:00');
  const shift = {
    lateArrivalAt: { seconds: Math.floor(arDate('2026-09-24T14:55:00-03:00') / 1000) },
    lateArrivalEtaMinutes: 60,
    lateArrivalEtaAt: { seconds: Math.floor(startMs / 1000) + 60 * 60 },
  };
  const st = computeOpsLateArrivalMonitorState({ shift, startMs, nowMs, eligible });
  report(
    '2-eta60-T+45',
    st.isLateNotified && !st.isPotentialAbsence && !st.isLateUnnotified,
    JSON.stringify(st),
  );
}

// Caso 3: sin aviso, T+31 → posible ausencia
{
  const startMs = arDate('2026-09-24T15:00:00-03:00');
  const nowMs = arDate('2026-09-24T15:31:00-03:00');
  const shift = {};
  const st = computeOpsLateArrivalMonitorState({ shift, startMs, nowMs, eligible });
  report(
    '3-sin-eta-T+31',
    st.isPotentialAbsence && !st.isLateNotified && !st.isLateUnnotified,
    JSON.stringify(st),
  );
}

// Caso 4: minutesRemainingLate contra ETA (no T+30 fijo)
{
  const startMs = arDate('2026-09-24T15:00:00-03:00');
  const nowMs = arDate('2026-09-24T15:10:00-03:00');
  const shift = {
    lateArrivalAt: { seconds: Math.floor(arDate('2026-09-24T14:58:00-03:00') / 1000) },
    lateArrivalEtaMinutes: 30,
    lateArrivalEtaAt: { seconds: Math.floor(startMs / 1000) + 30 * 60 },
  };
  const st = computeOpsLateArrivalMonitorState({ shift, startMs, nowMs, eligible });
  report(
    '4-minutos-restantes-eta',
    st.minutesRemainingLate === 20,
    `remaining=${st.minutesRemainingLate}`,
  );
}

console.log('\nFin eval ops late arrival monitor');
