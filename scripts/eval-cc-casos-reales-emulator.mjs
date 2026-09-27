/**
 * E2E Centro de Comando sobre casos REALES (snapshot de prod → emulador, proyecto aislado).
 *
 * 1) Exportar (solo lectura prod, una vez):
 *    node scripts/cc-caso-real-snapshot.mjs export --empresa pruebas_sa --objective "Angelelli" --date 2026-09-26 --shift LplWKivQhBKowL3vVKTj --shift lXLFk2F33HRiAsQpmoqS --name caps-angelelli-2026-09-26
 * 2) Emulador Firestore activo (:8080) + `npm run build` en apps/functions.
 * 3) node --experimental-strip-types scripts/eval-cc-casos-reales-emulator.mjs
 *    (strip-types: importa helpers TS de web2 para validar paridad front/servidor)
 *
 * Cada caso recarga su snapshot en el proyecto `demo-cc-casos` (no toca los datos del lab).
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadCaseIntoDb, caseFileExists } from './cc-caso-real-snapshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const { runAutoCompletarTurnosPass } = requireFn('./lib/scheduling/autoCompletarTurnosCore.js');
const { calcTurnoHoursContrib } = requireFn('./lib/liquidacion/turnoHoursCalc.js');
const { SHIFT_HARD_CAP_MS } = requireFn('./lib/scheduling/shiftClose.js');
const { Timestamp, FieldValue } = admin.firestore;

if (!process.env.FIRESTORE_EMULATOR_HOST) process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const projectId = process.env.CC_CASOS_PROJECT || 'demo-cc-casos';
admin.initializeApp({ projectId });
const db = admin.firestore();

const CAPS = 'caps-angelelli-2026-09-26';
const MIN = 60000;

const { revertirAusenciaShift, REVERT_ABSENCE_WINDOW_MS } = requireFn('./lib/attendance/revertirAusencia.js');
const webRevert = await import('../apps/web2/src/lib/operaciones/revertAbsenceWindow.ts');

const results = [];
function report(caseId, ok, detail) {
  results.push({ caseId, ok, detail });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${caseId}\t${detail}`);
}

async function clearProject() {
  const cols = await db.listCollections();
  for (const col of cols) {
    await db.recursiveDelete(col);
  }
}

async function withCase(name, fn) {
  if (!caseFileExists(name)) {
    report(name, false, `falta scripts/out/cc-casos/${name}.json (correr export)`);
    return;
  }
  await clearProject();
  const meta = await loadCaseIntoDb(db, name);
  await fn(meta);
}

async function shift(id) {
  const s = await db.collection('turnos').doc(id).get();
  return s.exists ? { id: s.id, ...s.data() } : null;
}

/** Hora Argentina (UTC−3) → Timestamp. */
const tsAr = (y, mo, d, h, mi = 0) => Timestamp.fromMillis(Date.UTC(y, mo - 1, d, h + 3, mi));
const fmtAr = (ms) => {
  const d = new Date(ms - 3 * 3600000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

const autoCompleteCtx = {
  isEnabled: () => true,
  shiftEmpresaId: (s) => String(s.empresaId || 'pruebas_sa'),
  sameTenantShift: () => true,
  getEmployeeTokens: async () => [],
};

const DIAZ = 'U8r4xp9303cWemPug1RW';
const QUEVEDO_T = 'LplWKivQhBKowL3vVKTj';
const QUEVEDO_ZOMBIE = '8pO5wLJxCj5CA2WWkE0v';
const BARRIO_COV = 'ops_cov_lXLFk2F33HRiAsQpmoqS_hzHO3PUA0Bo5DwZwHlG2';

/** Deshace el cierre que hizo el navegador/limpieza: vuelve a quedar presente y retenido. */
async function reopenRetained(id) {
  await db.collection('turnos').doc(id).update({
    status: 'PRESENT',
    isPresent: true,
    isCompleted: false,
    isRetention: true,
    realEndTime: FieldValue.delete(),
    completionReason: FieldValue.delete(),
    autoCompletedAt: FieldValue.delete(),
  });
}

/** Estado previo a la convocatoria de Barrionuevo (18:08): titular AA sin cubrir. */
async function dropBarrionuevoCoverage() {
  await db.collection('turnos').doc(BARRIO_COV).delete();
  await db.collection('turnos').doc(QUEVEDO_T).update({
    coverageStatus: FieldValue.delete(),
    coverageDocId: FieldValue.delete(),
    coveredAt: FieldValue.delete(),
    coverageType: FieldValue.delete(),
    operacionallyCovered: FieldValue.delete(),
    coveredBy: FieldValue.delete(),
    coveredByEmployeeId: FieldValue.delete(),
    coveredByEmployeeName: FieldValue.delete(),
    resolvedBy: FieldValue.delete(),
  });
}

const hours = (data) => calcTurnoHoursContrib(data)?.hsReales ?? 0;
const hFmt = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')} h`;

async function run() {
  await withCase(CAPS, async (meta) => {
    const titular = await shift('LplWKivQhBKowL3vVKTj');
    const slaVirtual = await shift('lXLFk2F33HRiAsQpmoqS');
    const vpa = await shift('yDCPQSFsdMlqn6UhRX7J');
    const zombie = await shift('8pO5wLJxCj5CA2WWkE0v');
    const diaz = await shift('U8r4xp9303cWemPug1RW');
    const barrio = await shift('ops_cov_lXLFk2F33HRiAsQpmoqS_hzHO3PUA0Bo5DwZwHlG2');

    report('T0.1', meta.objectiveId === 'uGccyya4SYft29gEeV8z' && !!titular, `snapshot ${meta.name} cargado (objetivo ${meta.objectiveName})`);
    report('T0.2', titular?.isAbsent === true && titular?.startTime instanceof admin.firestore.Timestamp,
      `titular Quevedo AA, Timestamps restaurados`);
    report('T0.3', slaVirtual?.origin === 'SLA_VIRTUAL' && vpa?.origin === 'VACANTE_POR_AUSENCIA',
      'reproduce las 3 representaciones del mismo hueco (AA + SLA_VIRTUAL + VACANTE_POR_AUSENCIA)');
    report('T0.4', zombie?.employeeId === titular?.employeeId,
      'incluye el turno M 20/09 de Quevedo usado como EXTEND de su propia ausencia');
    report('T0.5', diaz?.completionReason === 'AUTO_ZOMBIE_SHIFT_END',
      'DIAZ cerrado por el navegador (AUTO_ZOMBIE_SHIFT_END) a las 17:00');
    report('T0.6', barrio?.realStartTime instanceof admin.firestore.Timestamp && barrio?.code === 'FT',
      'Barrionuevo FT con realStartTime 18:17');
  });

  // P4 — revertir ausencia: la tarjeta muestra VENCIDO con el mismo plazo que el servidor (PAST_T60).
  await withCase(CAPS, async () => {
    const titular = await shift('LplWKivQhBKowL3vVKTj');
    const startMs = titular.startTime.toMillis();
    report('P4.1', webRevert.REVERT_ABSENCE_WINDOW_MS === REVERT_ABSENCE_WINDOW_MS, 'mismo plazo front/servidor (60 min)');
    report('P4.2', !webRevert.isRevertAbsenceExpired(titular, startMs + 45 * MIN),
      'Quevedo 26/09 15:45 (T+45): la tarjeta ofrece revertir (X)');
    report('P4.3', webRevert.isRevertAbsenceExpired(titular, startMs + 61 * MIN),
      'Quevedo 26/09 16:01 (T+61): la tarjeta muestra VENCIDO');
    report('P4.4', webRevert.isRevertAbsenceExpired(titular, startMs + 7 * 60 * MIN)
      && titular.endTime.toMillis() > startMs + 7 * 60 * MIN,
      '22:00 (turno aún en curso): VENCIDO — antes seguía la X hasta las 23:00');

    const res = await revertirAusenciaShift(db, { shiftId: titular.id });
    report('P4.5', res.success === false && res.reason === 'PAST_T60'
      && webRevert.isRevertAbsenceExpired(titular, Date.now()),
      `servidor hoy rechaza (${res.reason}) y la tarjeta coincide (VENCIDO)`);

    for (const offsetMin of [59, 61]) {
      const cloneId = `p4_parity_${offsetMin}`;
      const nowMs = Date.now();
      const clone = {
        ...titular,
        startTime: Timestamp.fromMillis(nowMs - offsetMin * MIN),
        endTime: Timestamp.fromMillis(nowMs - offsetMin * MIN + 8 * 60 * MIN),
      };
      delete clone.id;
      await db.collection('turnos').doc(cloneId).set(clone);
      const expectedExpired = offsetMin > 60;
      const r = await revertirAusenciaShift(db, { shiftId: cloneId });
      const serverExpired = r.reason === 'PAST_T60';
      const frontExpired = webRevert.isRevertAbsenceExpired(clone, Date.now());
      report(`P4.6.${offsetMin}`, serverExpired === expectedExpired && frontExpired === expectedExpired,
        `T+${offsetMin}: servidor ${serverExpired ? 'PAST_T60' : `ok (${r.reason || 'revertida'})`} · tarjeta ${frontExpired ? 'VENCIDO' : 'X'}`);
    }
  });

  // P1 — un solo responsable de cierre (servidor) + tope 12:59 desde el inicio real.
  const diazCapMs = Date.UTC(2026, 8, 26, 10, 12) + SHIFT_HARD_CAP_MS;

  await withCase(CAPS, async () => {
    await reopenRetained(DIAZ);
    await dropBarrionuevoCoverage();
    await runAutoCompletarTurnosPass(db, autoCompleteCtx, tsAr(2026, 9, 26, 17, 0));
    const d = await shift(DIAZ);
    const ok = d?.status === 'PRESENT' && d?.isRetention === true && d?.isCompleted !== true && !d?.realEndTime;
    report('P1.1', ok, ok
      ? 'DIAZ retenido a las 17:00 sigue abierto (el navegador ya no lo cierra)'
      : `st=${d?.status} ret=${d?.isRetention} r=${d?.completionReason}`);
  });

  await withCase(CAPS, async () => {
    await reopenRetained(DIAZ);
    await runAutoCompletarTurnosPass(db, autoCompleteCtx, tsAr(2026, 9, 26, 18, 20));
    const d = await shift(DIAZ);
    const barrio = await shift(BARRIO_COV);
    const realEnd = d?.realEndTime?.toMillis?.() ?? 0;
    const relevoMs = barrio?.realStartTime?.toMillis?.() ?? -1;
    const hs = hours(d);
    const ok =
      d?.status === 'COMPLETED'
      && d?.completionReason === 'RELEVO_PRESENTE'
      && realEnd === relevoMs
      && Number(d?.retentionMinutes) === 197
      && barrio?.relievedOutgoingShiftId === DIAZ
      && hs > 11;
    report('P1.2', ok, ok
      ? `DIAZ cierra con el presente de Barrionuevo (${fmtAr(realEnd)}), retención 197 min, liquida ${hFmt(hs)}`
      : `st=${d?.status} r=${d?.completionReason} end=${realEnd ? fmtAr(realEnd) : '-'} retMin=${d?.retentionMinutes} hs=${hs}`);
  });

  await withCase(CAPS, async () => {
    await reopenRetained(DIAZ);
    await dropBarrionuevoCoverage();
    await runAutoCompletarTurnosPass(db, autoCompleteCtx, tsAr(2026, 9, 26, 20, 15));
    const d = await shift(DIAZ);
    const tit = await shift(QUEVEDO_T);
    const nov = (await db.collection('novedades').doc(`tope_${DIAZ}`).get()).data();
    const realEnd = d?.realEndTime?.toMillis?.() ?? 0;
    const hs = hours(d);
    const ok =
      d?.status === 'COMPLETED'
      && d?.completionReason === 'TOPE_JORNADA'
      && realEnd === diazCapMs
      && d?.requiereRevision !== true
      && nov?.type === 'TOPE_JORNADA'
      && nov?.gapShiftId === QUEVEDO_T
      && tit?.isSinCobertura === true
      && hs > 12.9 && hs < 13;
    report('P1.3', ok, ok
      ? `sin relevo: DIAZ cierra al tope ${fmtAr(realEnd)} (07:12 + 12:59), novedad TOPE_JORNADA, hueco de Quevedo escalado sin cobertura, liquida ${hFmt(hs)}`
      : `st=${d?.status} r=${d?.completionReason} end=${realEnd ? fmtAr(realEnd) : '-'} nov=${nov?.type} gap=${nov?.gapShiftId} sinCob=${tit?.isSinCobertura} hs=${hs}`);
  });

  await withCase(CAPS, async () => {
    await reopenRetained(QUEVEDO_ZOMBIE);
    const zombieCapMs = Date.UTC(2026, 8, 20, 10, 0) + SHIFT_HARD_CAP_MS;
    const now = tsAr(2026, 9, 26, 17, 0);

    const dry = await runAutoCompletarTurnosPass(db, autoCompleteCtx, now, { dryRun: true });
    const act = dry.actions.find((a) => a.shiftId === QUEVEDO_ZOMBIE);
    const untouched = (await shift(QUEVEDO_ZOMBIE))?.status === 'PRESENT';
    const okDry =
      act?.kind === 'CLOSE'
      && act?.reason === 'TOPE_JORNADA_RETROACTIVO'
      && act?.requiereRevision === true
      && act?.realEndMs === zombieCapMs
      && untouched;
    report('P1.4', okDry, okDry
      ? `dryRun lista el zombi de Quevedo (TOPE_JORNADA_RETROACTIVO, fin ${fmtAr(zombieCapMs)}, requiereRevision) sin escribir`
      : `act=${JSON.stringify(act)} untouched=${untouched}`);

    await runAutoCompletarTurnosPass(db, autoCompleteCtx, now);
    const z = await shift(QUEVEDO_ZOMBIE);
    const realEnd = z?.realEndTime?.toMillis?.() ?? 0;
    const hs = hours(z);
    const ok =
      z?.status === 'COMPLETED'
      && z?.completionReason === 'TOPE_JORNADA_RETROACTIVO'
      && z?.requiereRevision === true
      && realEnd === zombieCapMs
      && hs > 12.9 && hs < 13;
    report('P1.5', ok, ok
      ? `zombi retenido del 20/09 cerrado retroactivo en inicio + 12:59 (${fmtAr(realEnd)}), requiereRevision, liquida ${hFmt(hs)}`
      : `st=${z?.status} r=${z?.completionReason} rev=${z?.requiereRevision} end=${realEnd ? fmtAr(realEnd) : '-'} hs=${hs}`);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  if (failed.length) process.exitCode = 1;
}

run().then(() => process.exit(process.exitCode || 0), (e) => {
  console.error(e);
  process.exit(1);
});
