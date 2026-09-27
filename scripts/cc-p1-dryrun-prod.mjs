/**
 * P1 — dryRun del cierre automático contra PRODUCCIÓN (solo lectura, ADC).
 *
 * Lista qué cerraría/retendría `runAutoCompletarTurnosPass` si P1 se publicara ahora, en especial
 * los cierres TOPE_JORNADA_RETROACTIVO (turnos abiertos que pasaron el tope hace > 2 h).
 * Además lista presentes vencidos que el cron no ve (isPresent sin status PRESENT) y los de empresas
 * con Centro de Control apagado (el cron los saltea).
 *
 * Requisitos: `npm run build` en apps/functions; `gcloud auth application-default login`.
 *   node scripts/cc-p1-dryrun-prod.mjs [--now 2026-09-26T20:00:00-03:00] [--empresa pruebas_sa]
 *
 * Cualquier intento de escritura aborta el proceso (guard sobre DocumentReference / WriteBatch).
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const { runAutoCompletarTurnosPass } = requireFn('./lib/scheduling/autoCompletarTurnosCore.js');
const { shiftWorkStartMs, shiftHardCapAtMs, STALE_CAP_GRACE_MS } = requireFn('./lib/scheduling/shiftClose.js');
const { loadCentroControlState } = requireFn('./lib/ops/centroControlGuard.js');

const PROD_PROJECT = 'comtroldata';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[k] = v;
    }
  }
  return out;
}

function installWriteGuard() {
  const { DocumentReference, WriteBatch, CollectionReference, Firestore } = admin.firestore;
  const deny = (what) => function denied() {
    throw new Error(`[dryrun-prod] escritura bloqueada (${what}): este script es solo lectura`);
  };
  for (const m of ['set', 'update', 'delete', 'create']) DocumentReference.prototype[m] = deny(`doc.${m}`);
  CollectionReference.prototype.add = deny('collection.add');
  WriteBatch.prototype.commit = deny('batch.commit');
  Firestore.prototype.runTransaction = deny('runTransaction');
  Firestore.prototype.recursiveDelete = deny('recursiveDelete');
}

const fmtAr = (ms) => {
  if (!ms) return '-';
  const d = new Date(ms - 3 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};
const tsMs = (v) => v?.toMillis?.() ?? 0;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.GCLOUD_PROJECT;
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROD_PROJECT });
  installWriteGuard();
  const db = admin.firestore();

  const now = args.now ? admin.firestore.Timestamp.fromDate(new Date(args.now)) : admin.firestore.Timestamp.now();
  const nowMs = now.toMillis();
  const onlyEmpresa = args.empresa ? String(args.empresa) : null;

  const cc = await loadCentroControlState(db);
  const ctx = {
    isEnabled: (eid) => cc.isEnabled(String(eid ?? '')) && (!onlyEmpresa || String(eid ?? '') === onlyEmpresa),
    shiftEmpresaId: (s) => String(s.empresaId ?? '').trim(),
    sameTenantShift: (a, b) => {
      const ae = String(a.empresaId ?? '').trim();
      const be = String(b.empresaId ?? '').trim();
      if (ae && be) return ae === be;
      if (ae && !be) return false;
      return true;
    },
    getEmployeeTokens: async () => [],
  };

  const pass = await runAutoCompletarTurnosPass(db, ctx, now, { dryRun: true });

  // Presentes vencidos fuera del alcance del cron: status distinto de PRESENT o CC apagado.
  const presentSnap = await db.collection('turnos').where('isPresent', '==', true).get();
  const cutoff = nowMs - 5 * 60 * 1000;
  const outOfScope = [];
  const ccDisabled = [];
  for (const d of presentSnap.docs) {
    const s = d.data();
    if (s.isCompleted === true) continue;
    const endMs = tsMs(s.endTime);
    if (!endMs || endMs > cutoff) continue;
    const eid = String(s.empresaId ?? '').trim();
    if (onlyEmpresa && eid !== onlyEmpresa) continue;
    const row = {
      shiftId: d.id,
      empresaId: eid || null,
      objectiveName: s.objectiveName || s.objectiveId || '',
      positionName: s.positionName || '',
      employeeName: s.employeeName || s.employeeId || '',
      code: s.code || '',
      status: s.status ?? null,
      origin: s.origin ?? null,
      isRetention: s.isRetention === true,
      workStart: fmtAr(shiftWorkStartMs(s)),
      plannedEnd: fmtAr(endMs),
      capAt: fmtAr(shiftHardCapAtMs(s)),
      staleCap: shiftHardCapAtMs(s) > 0 && nowMs >= shiftHardCapAtMs(s) + STALE_CAP_GRACE_MS,
    };
    if (String(s.status || '') !== 'PRESENT') outOfScope.push(row);
    else if (!cc.isEnabled(eid)) ccDisabled.push(row);
  }

  const byKindReason = {};
  for (const a of pass.actions) {
    const k = `${a.kind} ${a.reason}`;
    byKindReason[k] = (byKindReason[k] || 0) + 1;
  }

  const retro = pass.actions
    .filter((a) => a.reason === 'TOPE_JORNADA_RETROACTIVO')
    .sort((a, b) => String(a.empresaId).localeCompare(String(b.empresaId)) || a.endMs - b.endMs)
    .map((a) => ({
      shiftId: a.shiftId,
      empresaId: a.empresaId,
      objectiveName: a.objectiveName,
      positionName: a.positionName,
      employeeName: a.employeeName,
      code: a.code,
      retenido: a.wasRetention,
      inicioReal: fmtAr(a.workStartMs),
      finPlanificado: fmtAr(a.endMs),
      cierrePropuesto: fmtAr(a.realEndMs),
      horasPropuestas: a.realEndMs && a.workStartMs ? Math.round(((a.realEndMs - a.workStartMs) / 3600000) * 100) / 100 : null,
    }));

  const other = pass.actions
    .filter((a) => a.reason !== 'TOPE_JORNADA_RETROACTIVO')
    .map((a) => ({
      shiftId: a.shiftId,
      kind: a.kind,
      reason: a.reason,
      empresaId: a.empresaId,
      objectiveName: a.objectiveName,
      positionName: a.positionName,
      employeeName: a.employeeName,
      code: a.code,
      retenido: a.wasRetention,
      inicioReal: fmtAr(a.workStartMs),
      finPlanificado: fmtAr(a.endMs),
      cierrePropuesto: a.realEndMs ? fmtAr(a.realEndMs) : null,
      gapShiftId: a.gapShiftId ?? null,
    }));

  const report = {
    generatedAt: new Date().toISOString(),
    now: fmtAr(nowMs),
    empresa: onlyEmpresa,
    summary: byKindReason,
    retroactivos: retro,
    otrasAcciones: other,
    presentesFueraDelCron: outOfScope,
    presentesCentroControlApagado: ccDisabled,
  };

  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date(nowMs - 3 * 3600000).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const outFile = path.join(outDir, `cc-p1-dryrun-prod-${onlyEmpresa || 'todas'}-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

  console.log(`dryRun P1 @ ${report.now} (${onlyEmpresa || 'todas las empresas'})`);
  console.log('Resumen:', byKindReason);
  console.log(`\nTOPE_JORNADA_RETROACTIVO (${retro.length}):`);
  for (const r of retro) {
    console.log(`  ${r.empresaId}\t${r.objectiveName} / ${r.positionName}\t${r.employeeName} (${r.code})\tret=${r.retenido ? 'sí' : 'no'}\tinicio ${r.inicioReal}\tfin plan ${r.finPlanificado}\t→ cierre ${r.cierrePropuesto} (${r.horasPropuestas} h)\t${r.shiftId}`);
  }
  console.log(`\nOtras acciones (${other.length}):`);
  for (const r of other) {
    console.log(`  ${r.kind} ${r.reason}\t${r.empresaId}\t${r.objectiveName} / ${r.positionName}\t${r.employeeName} (${r.code})\tfin plan ${r.finPlanificado}${r.cierrePropuesto ? ` → ${r.cierrePropuesto}` : ''}\t${r.shiftId}`);
  }
  console.log(`\nPresentes vencidos que el cron no ve (isPresent sin status PRESENT): ${outOfScope.length}`);
  for (const r of outOfScope) {
    console.log(`  ${r.empresaId}\t${r.objectiveName} / ${r.positionName}\t${r.employeeName} (${r.code})\tstatus=${r.status} origin=${r.origin}\tfin plan ${r.plannedEnd}\t${r.shiftId}`);
  }
  console.log(`\nPresentes vencidos en empresas con Centro de Control apagado: ${ccDisabled.length}`);
  for (const r of ccDisabled) {
    console.log(`  ${r.empresaId}\t${r.objectiveName} / ${r.positionName}\t${r.employeeName} (${r.code})\tfin plan ${r.plannedEnd}\t${r.shiftId}`);
  }
  console.log(`\nDetalle: ${outFile}`);
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
