#!/usr/bin/env node
/**
 * Autoplanifica el mejor servicio REAL de bacarsa en emulador (no demo).
 * Uso: npm run autoplan:real
 *      npm run autoplan:real -- "MINISTERIO DE SALUD" "H. Misericordia"
 */
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
import { spawn } from 'child_process';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();

const y = new Date().getFullYear();
const m = new Date().getMonth();
const monthStart = new Date(y, m, 1);
const monthEnd = new Date(y, m + 1, 0);

const argClient = process.argv[2];
const argObj = process.argv[3];

let best = null;
const snap = await db.collection('servicios_sla').where('empresaId', '==', 'bacarsa').get();
for (const d of snap.docs) {
  const s = d.data();
  if (String(s.status || '').toLowerCase() !== 'active') continue;
  const end = s.endDate ? new Date(String(s.endDate).slice(0, 10) + 'T23:59:59') : null;
  if (end && end < monthStart) continue;
  const emps = await db.collection('empleados')
    .where('empresaId', '==', 'bacarsa')
    .where('preferredObjectiveId', '==', s.objectiveId)
    .count().get();
  const n = emps.data().count;
  if (!n) continue;
  const row = { client: s.clientName, obj: s.objectiveName, emps: n, hrs: s.totalMonthlyHours || 0 };
  if (argClient && argObj) {
    if (String(s.clientName).toLowerCase().includes(argClient.toLowerCase())
      && String(s.objectiveName).toLowerCase().includes(argObj.toLowerCase())) {
      best = row;
      break;
    }
  } else if (!best || n > best.emps) {
    best = row;
  }
}

if (!best) {
  console.error('No hay servicio real bacarsa con SLA activo + empleados asignados en el emulador.');
  console.error('Importá backup de producción o configurá SLA + dotación en Servicios/RRHH.');
  process.exit(1);
}

console.log(`\nAutoplan REAL → ${best.client} / ${best.obj}`);
console.log(`  ${best.emps} guardias · ${best.hrs}h SLA · mes ${y}-${String(m + 1).padStart(2, '0')}\n`);

const child = spawn(process.execPath, [join(root, 'scripts/test-automate-planning-ui.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, PLAN_CLIENT: best.client, PLAN_OBJECTIVE: best.obj },
  cwd: root,
});

child.on('exit', (code) => process.exit(code ?? 1));
