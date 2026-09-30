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
import { register } from 'node:module';
import { loadCaseIntoDb, caseFileExists } from './cc-caso-real-snapshot.mjs';

// gapVacancy.ts (y otros módulos de ops-core) importan sin extensión: con
// --experimental-strip-types Node no resuelve el relativo sin este hook.
await register(new URL('./ts-ext-hook.mjs', import.meta.url).href);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const { runAutoCompletarTurnosPass } = requireFn('./lib/scheduling/autoCompletarTurnosCore.js');
const { calcTurnoHoursContrib } = requireFn('./lib/liquidacion/turnoHoursCalc.js');
const { SHIFT_HARD_CAP_MS } = requireFn('./lib/scheduling/shiftClose.js');
const { simulableShiftSkipReason } = requireFn('./lib/common/simulableShift.js');
const { Timestamp, FieldValue } = admin.firestore;

if (!process.env.FIRESTORE_EMULATOR_HOST) process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const projectId = process.env.CC_CASOS_PROJECT || 'demo-cc-casos';
admin.initializeApp({ projectId });
const db = admin.firestore();

const CAPS = 'caps-angelelli-2026-09-26';
const MIN = 60000;

const NUEVO_EDIFICIO = 'nuevo-edificio-2026-09-28';
const ONCOLOGICO = 'h-oncologico-2026-09-27';

/** Licencias de Cejas Mario marcadas presentes por la simulación (25→28/09). */
const CEJAS_V = {
  d25: 'K7gpSv2yZqNaF4kAbNgo',
  d26: '1jZiqRna06TO0917zs90',
  d27: 'jsrIlkjT3yyqRbnkLiSK',
  d28: 'ocEeKfwW46k1vaz6ecBe',
};

const { revertirAusenciaShift, REVERT_ABSENCE_WINDOW_MS } = requireFn('./lib/attendance/revertirAusencia.js');
const { resolverCobertura, findBestCandidate } = requireFn('./lib/coverage/convocatoriasCobertura.js');
const coverageCandidates = await import('../packages/ops-core/src/coverageCandidates.ts');
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

/** Deshace un cierre automático: el turno vuelve a quedar presente y abierto. */
async function reopenPresent(id) {
  await db.collection('turnos').doc(id).update({
    status: 'PRESENT',
    isPresent: true,
    isCompleted: false,
    realEndTime: FieldValue.delete(),
    completionReason: FieldValue.delete(),
    autoCompletedAt: FieldValue.delete(),
    requiereRevision: FieldValue.delete(),
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

/** Estado previo a una cobertura EXT/ADV: titular sin cubrir, origen sin ajuste, sin ops_cov. */
async function undoExtAdvCoverage({ titularId, opsCovIds, sourceIds }) {
  for (const id of opsCovIds) await db.collection('turnos').doc(id).delete();
  await db.collection('turnos').doc(titularId).update({
    coverageStatus: FieldValue.delete(),
    coverageDocId: FieldValue.delete(),
    coverageConvocatoriaId: FieldValue.delete(),
    coverageClaimConvocatoriaId: FieldValue.delete(),
    coverageClaimAt: FieldValue.delete(),
    coveredAt: FieldValue.delete(),
    coverageType: FieldValue.delete(),
    operacionallyCovered: FieldValue.delete(),
    coveredBy: FieldValue.delete(),
    coveredByEmployeeId: FieldValue.delete(),
    coveredByEmployeeName: FieldValue.delete(),
    resolvedBy: FieldValue.delete(),
  });
  for (const id of sourceIds) {
    await db.collection('turnos').doc(id).update({
      coverageDocId: FieldValue.delete(),
      isExtended: false,
      extensionEndTime: FieldValue.delete(),
      adjustedEndTime: FieldValue.delete(),
      isEarlyStart: false,
      adjustedStartTime: FieldValue.delete(),
    });
  }
}

/** Acepta la convocatoria del snapshot con el proceso en UTC (como Cloud Functions). */
async function resolveConvInUtc(convId) {
  const snap = await db.collection('convocatorias_cobertura').doc(convId).get();
  const prevTz = process.env.TZ;
  const prevZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  process.env.TZ = 'UTC';
  try {
    await resolverCobertura(db, { id: convId, ...snap.data() });
  } finally {
    process.env.TZ = prevTz || prevZone || 'America/Argentina/Buenos_Aires';
  }
}

const hmAr = (ts) => (ts?.toMillis ? fmtAr(ts.toMillis()).slice(6) : '-');

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
    report('T0.3', titular?.isAbsent === true && slaVirtual?.origin === 'SLA_VIRTUAL' && vpa?.origin === 'VACANTE_POR_AUSENCIA',
      'snapshot histórico: titular AA + hermanos SLA_VIRTUAL/VPA (P3 los marca SUPERSEDED; VAC apunta al titular)');
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

  // P1c.1 — Playa 27/09 (Moreno AA, M 07–15): EXT Lizarraga + ADV Bustamante. En prod salieron 04–08 / 08–12.
  await withCase(NUEVO_EDIFICIO, async () => {
    const titularId = 'W4eC9clqG6qpY9llgj4m';
    const extSrc = '8ONKDv6FzqTfC6DUieCY';
    const advSrc = '81oeHt3N5H2byBVBDv0G';
    const extCov = `ops_cov_${titularId}_hUo6Nmw7rdzVONiCKHgW`;
    const advCov = `ops_cov_${titularId}_6B6w3gYy8kelK3rzN6O8`;
    await undoExtAdvCoverage({ titularId, opsCovIds: [extCov, advCov], sourceIds: [extSrc, advSrc] });
    await db.collection('turnos').doc(extSrc).update({
      isPresent: true,
      isCompleted: false,
      code: 'N',
      startTime: Timestamp.fromMillis(Date.parse('2026-09-26T23:00:00-03:00')),
      endTime: Timestamp.fromMillis(Date.parse('2026-09-27T07:00:00-03:00')),
    });
    await db.collection('turnos').doc(advSrc).update({ isCompleted: false, isPresent: false });
    await resolveConvInUtc('1MqazpSAfyFqCq4k2F6j');
    await resolveConvInUtc('KOGfZyIPq5HT87SA8p5M');
    const e = await shift(extCov);
    const a = await shift(advCov);
    const es = await shift(extSrc);
    const as = await shift(advSrc);
    const t = await shift(titularId);
    const got = `EXT ${hmAr(e?.startTime)}–${hmAr(e?.endTime)} (fin ${hmAr(es?.extensionEndTime)})`
      + ` · ADV ${hmAr(a?.startTime)}–${hmAr(a?.endTime)} (inicio ${hmAr(as?.adjustedStartTime)})`;
    const ok = got === 'EXT 07:00–11:00 (fin 11:00) · ADV 11:00–15:00 (inicio 11:00)' && t?.coverageStatus === 'COVERED';
    report('P1c.1', ok, ok ? `Playa 27/09 en UTC: ${got}` : `${got} st=${t?.coverageStatus}`);
  });

  // P1c.2 — Recepción 1 28/09 (Quiroga AA, M 07–15): ADV Ceballos. En prod salió 08–12.
  await withCase(NUEVO_EDIFICIO, async () => {
    const titularId = 'nPpF1zcL5I4t5z6cx0gi';
    const advSrc = '5Zq2F1J6Dw5VQPFgRG4F';
    const advCov = `ops_cov_${titularId}_F7bYgkiu9m7403dHnGOI`;
    const bunkerCov = 'ops_cov_rMdDJxgdwpibFWC1ESKa_F7bYgkiu9m7403dHnGOI';
    await undoExtAdvCoverage({ titularId, opsCovIds: [advCov, bunkerCov], sourceIds: [advSrc] });
    await resolveConvInUtc('3XGqkSRdVCM229CJnWr3');
    const a = await shift(advCov);
    const as = await shift(advSrc);
    const t = await shift(titularId);
    const got = `ADV ${hmAr(a?.startTime)}–${hmAr(a?.endTime)} (inicio ${hmAr(as?.adjustedStartTime)})`;
    const ok = got === 'ADV 11:00–15:00 (inicio 11:00)' && t?.coverageStatus === 'PARTIAL';
    report('P1c.2', ok, ok ? `Recepción 1 28/09 en UTC: ${got}, titular PARTIAL` : `${got} st=${t?.coverageStatus}`);
  });

  // P1b — H. Oncológico 25→28/09: la simulación marcó presente la licencia (V) de Cejas Mario
  // y el cron la cerró por tope. Con el filtro compartido nada de eso vuelve a pasar.
  await withCase(ONCOLOGICO, async () => {
    const vs = await Promise.all(Object.values(CEJAS_V).map(shift));
    const razones = vs.map((s) => simulableShiftSkipReason(s));
    const franco = simulableShiftSkipReason(await shift('swP15JxecSAnblufQjbE'));
    const nocheReal = simulableShiftSkipReason(await shift('KVVz8sJ6o6HFtTkW4tzB'));
    const okFiltro = vs.every((s) => s?.code === 'V')
      && razones.every((r) => r === 'LICENCIA')
      && franco === 'FRANCO'
      && nocheReal === null;
    report('P1b.1', okFiltro, okFiltro
      ? 'las 4 V de Cejas (25→28/09) y el F de Yulitta quedan fuera de la simulación; el N de Morán sigue simulable'
      : `razones=${razones.join(',')} franco=${franco} noche=${nocheReal}`);

    const v27 = await shift(CEJAS_V.d27);
    const v28 = await shift(CEJAS_V.d28);
    report('P1b.2', v27?.completionReason === 'TOPE_JORNADA_RETROACTIVO' && v28?.status === 'PRESENT',
      `estado de prod: V 27/09 cerrada por tope (${v27?.completionReason}) y V 28/09 todavía PRESENT`);

    await reopenPresent(CEJAS_V.d27);
    const now = tsAr(2026, 9, 29, 8, 0);
    const dry = await runAutoCompletarTurnosPass(db, autoCompleteCtx, now, { dryRun: true });
    const a27 = dry.actions.find((a) => a.shiftId === CEJAS_V.d27);
    const a28 = dry.actions.find((a) => a.shiftId === CEJAS_V.d28);
    const control = dry.actions.find((a) => a.shiftId === 'E4X2EpIU7NZNNTbeq77a');
    const okDry = a27?.kind === 'WAIT' && a27?.reason === 'LICENCIA_PRESENTE'
      && a28?.kind === 'WAIT' && a28?.reason === 'LICENCIA_PRESENTE'
      && control?.kind === 'CLOSE';
    report('P1b.3', okDry, okDry
      ? 'dryRun 29/09 08:00: las dos V presentes quedan en LICENCIA_PRESENTE y el M de Capdevila sí cierra'
      : `v27=${JSON.stringify(a27)} v28=${JSON.stringify(a28)} ctrl=${JSON.stringify(control)}`);

    await runAutoCompletarTurnosPass(db, autoCompleteCtx, now);
    const f27 = await shift(CEJAS_V.d27);
    const f28 = await shift(CEJAS_V.d28);
    const nov = await db.collection('novedades').doc(`tope_${CEJAS_V.d27}`).get();
    const okPass = f27?.status === 'PRESENT' && !f27?.realEndTime && !f27?.completionReason
      && f28?.status === 'PRESENT' && !f28?.realEndTime && !f28?.completionReason
      && !nov.exists;
    report('P1b.4', okPass, okPass
      ? 'tras la pasada real las licencias siguen abiertas, sin realEndTime ni novedad de tope (las corrige RRHH)'
      : `v27=${f27?.status}/${f27?.completionReason} v28=${f28?.status}/${f28?.completionReason} nov=${nov.exists}`);
  });

  await withCase(CAPS, async () => {
    const titular = await shift(QUEVEDO_T);
    const best = await findBestCandidate(db, {
      empresaId: titular.empresaId,
      shiftId: QUEVEDO_T,
      objectiveId: titular.objectiveId,
      positionName: titular.positionName,
      shiftCode: titular.code,
      startTime: titular.startTime,
      endTime: titular.endTime,
    }, 'EXTEND');
    const ok = !best || best.id !== titular.employeeId;
    report('P2.1', ok, ok
      ? `Quevedo no es EXT de su propia vacante${best ? ` (entra ${best.name})` : ''}`
      : `eligió al ausente ${best?.id}`);
  });

  await withCase(NUEVO_EDIFICIO, async () => {
    const quiroga = await shift('nPpF1zcL5I4t5z6cx0gi');
    const ramos = await shift('rMdDJxgdwpibFWC1ESKa');
    const ceb = await shift('5Zq2F1J6Dw5VQPFgRG4F');
    const nowMs = Date.parse('2026-09-28T08:00:00-03:00');
    const asGap = (t) => ({
      titularShiftId: t.id,
      absentEmployeeId: t.employeeId,
      objectiveId: t.objectiveId,
      positionName: t.positionName,
      startMs: t.startTime.toMillis(),
      endMs: t.endTime.toMillis(),
      band: t.code,
    });
    const asShift = (t) => ({
      id: t.id,
      employeeId: t.employeeId,
      employeeName: t.employeeName,
      code: t.code,
      objectiveId: t.objectiveId,
      positionName: t.positionName,
      startMs: t.startTime.toMillis(),
      endMs: t.endTime.toMillis(),
      isPresent: t.isPresent === true,
      isCompleted: t.isCompleted === true,
      isAbsent: t.isAbsent === true,
    });
    const q = coverageCandidates.buildCoverageCandidates({
      nowMs, gap: asGap(quiroga), shifts: [asShift(quiroga), asShift(ceb)],
    });
    const r = coverageCandidates.buildCoverageCandidates({
      nowMs, gap: asGap(ramos), shifts: [asShift(ramos), asShift(ceb)],
    });
    const qRow = q.byType.ADVANCE.find((row) => row.employeeId === ceb.employeeId);
    const rRow = r.byType.ADVANCE.find((row) => row.employeeId === ceb.employeeId);
    const ok = qRow?.eligible === true && qRow.otherPosition === true
      && rRow?.eligible === false && rRow?.rejectReason === 'NO_CONTIGUO';
    report('P2.2', ok, ok
      ? 'Ceballos es ADVANCE de Quiroga (otro puesto) y no de Ramos (no contiguo)'
      : `Q=${qRow?.eligible}/${qRow?.rejectReason} R=${rRow?.eligible}/${rRow?.rejectReason}`);

    await undoExtAdvCoverage({
      titularId: ramos.id,
      opsCovIds: [`ops_cov_${ramos.id}_${ceb.employeeId}`],
      sourceIds: [ceb.id],
    });
    await resolveConvInUtc('wLgfVPdXc2vj3AnMT7V9');
    const conv = (await db.collection('convocatorias_cobertura').doc('wLgfVPdXc2vj3AnMT7V9').get()).data();
    const okReject = conv?.status === 'REJECTED' && conv?.rejectionReason === 'NO_CONTIGUO';
    report('P2.3', okReject, okReject
      ? 'la ADVANCE de Ramos se rechaza al revalidar (NO_CONTIGUO) y la cascada sigue'
      : `st=${conv?.status} reason=${conv?.rejectionReason}`);
  });

  await withCase(CAPS, async () => {
    const titular = await shift('LplWKivQhBKowL3vVKTj');
    const slaVirtual = await shift('lXLFk2F33HRiAsQpmoqS');
    const vpa = await shift('yDCPQSFsdMlqn6UhRX7J');
    const gap = await import('../packages/ops-core/src/gapVacancy.ts');
    const ok = titular?.isAbsent === true
      && String(titular.employeeId || '') !== 'VACANTE'
      && gap.isGapSiblingVacancyDoc(vpa)
      && gap.isGapSiblingVacancyDoc(slaVirtual);
    report('P3.1', ok, ok
      ? 'CAPS 26/09: 1 representación (titular AA); VPA/SLA_VIRTUAL son hermanos'
      : `titAbsent=${titular?.isAbsent} vpaSib=${gap.isGapSiblingVacancyDoc(vpa)}`);
  });

  await withCase(NUEVO_EDIFICIO, async () => {
    const a = await shift('1KpNlPVZkaiMFC6tAnWV');
    const b = await shift('1evQFKo3KVvMpe8MwtOL');
    const gap = await import('../packages/ops-core/src/gapVacancy.ts');
    const ok = gap.isGapSiblingVacancyDoc(a) && gap.isGapSiblingVacancyDoc(b)
      && !!a?.causedByShiftId && !!b?.causedByShiftId;
    report('P3.2', ok, ok
      ? `Nuevo Edificio 28/09: VPA hermanos de ${a.causedByShiftId} y ${b.causedByShiftId}`
      : `a=${a?.origin} b=${b?.origin} cause=${a?.causedByShiftId}/${b?.causedByShiftId}`);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  if (failed.length) process.exitCode = 1;
}

run().then(() => process.exit(process.exitCode || 0), (e) => {
  console.error(e);
  process.exit(1);
});
