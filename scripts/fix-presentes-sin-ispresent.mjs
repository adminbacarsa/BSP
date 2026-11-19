/**
 * Corrige turnos que Modo Rápido dejó con `status: 'PRESENT'` pero sin `isPresent: true`
 * (el CC clásico, el cierre automático y la protección contra la ausencia AA leen `isPresent`).
 *
 *   node scripts/fix-presentes-sin-ispresent.mjs --empresa pruebas_sa              (solo lectura)
 *   node scripts/fix-presentes-sin-ispresent.mjs --empresa pruebas_sa --apply --allow-prod
 *
 * Solo toca turnos con status PRESENT, sin `isCompleted`, de las últimas 48 h. Cambios por turno:
 *   isPresent: true  (+ si figuraba isAbsent: true → isAbsent: false, absenceType: null, absenceDetectedAt: null)
 * Sin `--apply --allow-prod` no escribe nada. Sin emulador en el entorno: lee/escribe prod (comtroldata).
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('No arranques este script con el emulador en el entorno: apunta a prod.');
}

const args = process.argv.slice(2);
const arg = (k, d = '') => {
  const i = args.indexOf(k);
  return i >= 0 ? String(args[i + 1] || '') : d;
};
const EMPRESA = arg('--empresa').trim();
if (!EMPRESA) throw new Error('Falta --empresa <id> (ej.: pruebas_sa).');
const APLICAR = args.includes('--apply') && args.includes('--allow-prod');
if (args.includes('--apply') && !args.includes('--allow-prod')) {
  throw new Error('--apply necesita también --allow-prod (escribe en producción).');
}

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'comtroldata' }, 'prod'));

const desde = Timestamp.fromMillis(Date.now() - 48 * 3600 * 1000);
const hora = (v) => (v && v.toDate ? v.toDate().toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '—');

const snap = await db
  .collection('turnos')
  .where('empresaId', '==', EMPRESA)
  .where('startTime', '>=', desde)
  .get();

const afectados = snap.docs.filter((d) => {
  const x = d.data();
  return String(x.status || '').toUpperCase() === 'PRESENT' && x.isPresent !== true && x.isCompleted !== true;
});

console.log(`Empresa ${EMPRESA}: ${snap.size} turnos de las últimas 48 h, ${afectados.length} con PRESENT sin isPresent.`);
for (const d of afectados) {
  const x = d.data();
  console.log(
    `  ${d.id}  ${String(x.employeeName || '').padEnd(28)} ${String(x.code || '').padEnd(4)} ${hora(x.startTime)}  ingreso ${hora(x.realStartTime)}  fuente ${x.checkInSource || '—'}${x.isAbsent === true ? '  (figuraba ausente)' : ''}`,
  );
}

if (!APLICAR) {
  console.log('\nSolo lectura: no se escribió nada. Para aplicar: agregá --apply --allow-prod');
  process.exit(0);
}

let n = 0;
for (let i = 0; i < afectados.length; i += 400) {
  const batch = db.batch();
  for (const d of afectados.slice(i, i + 400)) {
    const patch = { isPresent: true };
    if (d.data().isAbsent === true) {
      patch.isAbsent = false;
      patch.absenceType = null;
      patch.absenceDetectedAt = null;
    }
    batch.update(d.ref, patch);
    n += 1;
  }
  await batch.commit();
}
console.log(`\nCorregidos ${n} turnos.`);
