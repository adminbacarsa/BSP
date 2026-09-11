/**
 * Deduplica turnos de Lotería tras remap A→B (mismo nombre, 2 employeeId, misma grilla).
 *
 * Caso CET: 4 guardias con cronograma completo duplicado (~124 docs).
 * Caso Carlos Paz: empId "stub" (pocos días del duplicado) + empId principal.
 *
 * Uso:
 *   node scripts/dedupe-loteria-remapped-turnos.js
 *   node scripts/dedupe-loteria-remapped-turnos.js --apply
 *   node scripts/dedupe-loteria-remapped-turnos.js --year=2026 --month=7 --apply
 */
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v];
    }),
);
const YEAR = Number(args.year || 2026);
const MONTH = Number(args.month || 7);

const TARGETS = [
  { oid: 'uaiQwu5ge9ujZKfaRuKZ', label: 'Casino Carlos Paz' },
  { oid: 'ApC8R5sBpVBRBAw5EJ2b', label: 'CET Río Ceballos' },
];

if (!getApps().length) {
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'comtroldata' });
}
const db = getFirestore();

function toDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();
  if (v.seconds) return new Date(v.seconds * 1000);
  return null;
}
function dayKey(t) {
  const st = toDate(t.startTime);
  if (!st) return '?';
  return new Date(st.getTime() - 3 * 3600000).toISOString().slice(0, 10);
}
function empLabel(emp, fallback) {
  if (!emp) return fallback || '';
  if (emp.name) return String(emp.name);
  if (emp.firstName || emp.lastName) {
    return `${emp.lastName || ''}, ${emp.firstName || ''}`.replace(/^,\s*|,\s*$/g, '').trim();
  }
  return fallback || '';
}
function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

async function loadEmpMap() {
  const snap = await db.collection('empleados').get();
  const map = new Map();
  snap.docs.forEach((d) => map.set(d.id, d.data()));
  return map;
}

async function planDeletes(empMap) {
  const start = Timestamp.fromDate(new Date(YEAR, MONTH - 1, 1));
  const end = Timestamp.fromDate(new Date(YEAR, MONTH, 0, 23, 59, 59, 999));
  const deleteIds = [];
  const report = [];

  for (const { oid, label } of TARGETS) {
    const snap = await db
      .collection('turnos')
      .where('objectiveId', '==', oid)
      .where('startTime', '>=', start)
      .where('startTime', '<=', end)
      .get();

    const byName = new Map();
    snap.docs.forEach((d) => {
      const t = d.data();
      const empId = String(t.employeeId || '').trim();
      if (!empId) return;
      const name = norm(empLabel(empMap.get(empId), t.employeeName));
      if (!name) return;
      if (!byName.has(name)) byName.set(name, new Map());
      const m = byName.get(name);
      if (!m.has(empId)) m.set(empId, []);
      m.get(empId).push(d.id);
    });

    let local = 0;
    for (const [name, empDocs] of byName) {
      if (empDocs.size < 2) continue;
      const ranked = [...empDocs.entries()].sort((a, b) => b[1].length - a[1].length);
      const keep = ranked[0][0];
      const keepN = ranked[0][1].length;
      for (let i = 1; i < ranked.length; i++) {
        const [dropEmp, ids] = ranked[i];
        ids.forEach((id) => deleteIds.push(id));
        local += ids.length;
        report.push({
          label,
          name,
          keep: `${keep} (${keepN})`,
          drop: `${dropEmp} (${ids.length})`,
        });
      }
    }
    console.log(`${label}: ${snap.size} turnos → borrar ${local} duplicados de empId`);
  }
  return { deleteIds, report };
}

async function main() {
  console.log(`\n=== Dedupe Lotería turnos ${MONTH}/${YEAR} ===`);
  console.log(`Modo: ${APPLY ? 'APLICAR (deleteDoc)' : 'dry-run'}\n`);

  const empMap = await loadEmpMap();
  const { deleteIds, report } = await planDeletes(empMap);

  console.log('\nDetalle (keep empId con más días):');
  report.slice(0, 40).forEach((r) => {
    console.log(`  [${r.label}] ${r.name}: keep ${r.keep} | drop ${r.drop}`);
  });
  if (report.length > 40) console.log(`  ... +${report.length - 40} más`);

  console.log(`\nTotal turnos a eliminar: ${deleteIds.length}`);
  if (!deleteIds.length) {
    console.log('Nada para hacer.');
    return;
  }

  if (!APPLY) {
    console.log('\nDry-run OK. Para aplicar:');
    console.log('  node scripts/dedupe-loteria-remapped-turnos.js --apply');
    return;
  }

  let batch = db.batch();
  let n = 0;
  let total = 0;
  for (const id of deleteIds) {
    batch.delete(db.collection('turnos').doc(id));
    n += 1;
    total += 1;
    if (n >= 450) {
      await batch.commit();
      batch = db.batch();
      n = 0;
      console.log(`  eliminados ${total}/${deleteIds.length}`);
    }
  }
  if (n > 0) await batch.commit();
  console.log(`\n✓ Eliminados ${total} turnos duplicados.\n`);
  console.log('Reabrí Prefactura julio Lotería (Carlos Paz / CET) y verificá filas únicas.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
