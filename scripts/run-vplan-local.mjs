#!/usr/bin/env node
/**
 * Ejecuta VPLAN localmente (Admin SDK → Firestore prod o emulador).
 *
 * Uso:
 *   node scripts/run-vplan-local.mjs
 *   node scripts/run-vplan-local.mjs --emulator
 *   node scripts/run-vplan-local.mjs --objectiveId=9CbYIDmsUGnabENKvXZt --year=2026 --month=7 --mode=CONTINUE
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const arg = (name, fallback = '') => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=').trim() : fallback;
};

const useEmulator = process.argv.includes('--emulator');
const empresaId = arg('empresaId', 'bacarsa');
const objectiveId = arg('objectiveId', '9CbYIDmsUGnabENKvXZt');
const year = Number(arg('year', '2026'));
const month = Number(arg('month', '7'));
const mode = arg('mode', 'CONTINUE');

if (useEmulator) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  console.log('→ Firestore emulador :8080');
} else {
  delete process.env.FIRESTORE_EMULATOR_HOST;
  console.log('→ Firestore producción (comtroldata)');
}

const functionsRoot = path.join(root, 'apps/functions');
const adminReq = createRequire(path.join(functionsRoot, 'package.json'));

const functionsLib = path.join(functionsRoot, 'lib/vplan/vplan.orchestrator.js');
if (!fs.existsSync(functionsLib)) {
  console.error('Falta build: cd apps/functions && npm run build');
  process.exit(1);
}

const { initializeApp, getApps } = adminReq('firebase-admin/app');
if (!getApps().length) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'comtroldata' });
}

const { runVplanOrchestrator } = adminReq('./lib/vplan/vplan.orchestrator.js');

const request = {
  empresaId,
  objectiveId,
  year,
  month,
  mode,
  intent: 'full',
  budgetMode: 'cct',
  preferredCycle: '6+2',
  runOptimization: false,
  employeeIds: null,
  supplyScope: 'objective',
};

console.log('\nVPLAN run:', request, '\n');
const t0 = Date.now();
const result = await runVplanOrchestrator(request);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

const slug = `vplan-run-${objectiveId.slice(0, 8)}-${year}-${String(month).padStart(2, '0')}`;
const outDir = path.join(root, 'logs');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${slug}-${Date.now()}.json`);
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

console.log('--- Resultado ---');
console.log('status:', result.status);
console.log('message:', result.message);
console.log('tiempo:', `${elapsed}s`);
console.log('\nFases:');
for (const s of result.context?.steps ?? []) {
  console.log(`  ${s.ok ? '✓' : '✗'} ${s.phase}: ${s.summary}`);
}

const v = result.context?.verification;
const brain = result.context?.brainReport;
const feasibility = result.context?.feasibility;
const draft = result.context?.draft;

if (feasibility?.capacityAdequate) {
  console.log('\nCapacidad plantilla:');
  console.log(`  ${feasibility.avgHoursRequiredPerGuard}h/guardia requerido · ~${feasibility.avgHoursOfferPerGuard}h oferta · ${feasibility.employeeCount ?? 18} guardias`);
  const capWarn = (feasibility.warnings ?? []).find((w) => w.includes('Capacidad OK'));
  if (capWarn) console.log(`  → ${capWarn}`);
}

if (draft?.stats?.motorBillableHours != null && draft.stats.motorBillableHours !== draft.stats.totalBillableHours) {
  console.log(`\nHoras fase 5: motor ${draft.stats.motorBillableHours}h → post-CCT/ladder ${draft.stats.totalBillableHours}h`);
}

if (draft?.stats?.coverageLadder) {
  console.log('\nEscalera fase 5:', draft.stats.coverageLadder);
  console.log('NR:', draft.stats.needsReinforcementCount ?? 0);
}

if (v) {
  const blocking = (v.issues ?? []).filter((i) => i.severity === 'blocking');
  const warnings = (v.issues ?? []).filter((i) => i.severity === 'warning');
  console.log('\nVerificación:');
  console.log(`  bloqueantes: ${blocking.length} · warnings: ${warnings.length}`);
  console.log(`  horas: ${v.billableHours}h / ${v.slaVendidas}h SLA`);
  console.log(`  cobertura: ${v.coverage?.coveredSlots}/${v.coverage?.totalSlots}`);
  const streaks = blocking.filter((i) => i.code === 'WORK_STREAK_TOO_LONG');
  console.log(`  rachas >6: ${streaks.length}`);
  for (const s of streaks.slice(0, 6)) {
    console.log(`    · ${s.message}`);
  }
}

if (brain) {
  console.log('\nCerebro:', brain.summary);
  if (brain.hourHeadroom?.assignmentGapNotHeadcount) {
    console.log(`  capacidad: ${brain.hourHeadroom.summary}`);
  }
  console.log(`  mandatos: ${brain.mandatesOk}/${brain.mandatesTotal} · acción: ${brain.action}`);
  for (const m of brain.mandates ?? []) {
    console.log(`    ${m.ok ? '✓' : '✗'} ${m.key}: ${m.summary}`);
  }
}

console.log(`\nJSON guardado: ${outPath}`);
process.exit(result.status === 'ok' ? 0 : 1);
