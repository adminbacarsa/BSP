/**
 * cleanup-demo-duplicate-coverages.js
 *
 * Limpia coberturas duplicadas generadas por el bug Demo multi-accept
 * (varios turnos "cubre REGALO" para una sola ausencia).
 *
 * Agrupa cubridores por:
 *   1) coverageEventId
 *   2) absenceShiftId / coveredShiftId
 *   3) coversAbsenceEmployeeName + objectiveId + día (fallback)
 *
 * Por grupo con >1 cubridor (excluye par EXT+ADV legítimo):
 *   - Conserva 1 ganador (preferencia: el nombrado en el titular/vacante,
 *     luego isPresent, luego más antiguo)
 *   - Elimina extras OPERATIONS_COVERAGE / MODO_DEMO
 *   - Si el extra era RET/ESC reasignado → restaura código pasivo
 *
 * Uso:
 *   node scripts/cleanup-demo-duplicate-coverages.js --dry-run [--empresaId=ID] [--emulator]
 *   node scripts/cleanup-demo-duplicate-coverages.js --apply [--empresaId=ID] [--emulator]
 *
 * Sin --apply siempre es dry-run (seguro).
 */

'use strict';
const path = require('path');

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY || process.argv.includes('--dry-run');
const USE_EMULATOR = process.argv.includes('--emulator');
const empresaArg = (process.argv.find((a) => a.startsWith('--empresaId=')) || '')
  .replace('--empresaId=', '')
  .trim();

let db;
if (USE_EMULATOR) {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const { initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ projectId: 'comtroldata' });
  db = getFirestore();
} else {
  const credPath = path.resolve(__dirname, '../service-account.json');
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ credential: cert(credPath), projectId: 'comtroldata' });
  }
  db = getFirestore();
}

const { FieldValue } = require('firebase-admin/firestore');

function toMillis(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  return 0;
}

function dayKey(ms) {
  if (!ms) return 'noday';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isCovererDoc(data) {
  if (!data) return false;
  if (data.isAbsent === true || data.operacionallyCovered === true) return false;
  if (data.employeeId === 'VACANTE' || data.isUnassigned) return false;
  const hasLedger =
    !!data.coversAbsenceEmployeeName
    || !!data.absenceEmployeeName
    || !!data.absenceShiftId
    || !!data.coveredShiftId
    || !!data.coversEmployeeId
    || (!!data.coverageEventId && (data.origin === 'OPERATIONS_COVERAGE' || data.resolvedBy === 'MODO_DEMO' || data.resolvedBy === 'AUTO' || data.resolvedBy === 'OPERACIONES'));
  return hasLedger;
}

function isDualHalf(data) {
  const t = String(data.coverageType || '').toUpperCase();
  return t === 'EXTEND' || t === 'ADVANCE' || t === 'RETENCION';
}

function groupKey(id, data) {
  if (data.coverageEventId) return `evt:${data.coverageEventId}`;
  const absId = data.absenceShiftId || data.coveredShiftId || data.coversShiftId || null;
  if (absId) return `abs:${absId}`;
  const name = String(data.coversAbsenceEmployeeName || data.absenceEmployeeName || '')
    .trim()
    .toLowerCase();
  const oid = String(data.objectiveId || '');
  const day = dayKey(toMillis(data.startTime || data.plannedStartTime));
  if (name && oid) return `name:${oid}|${day}|${name}`;
  return `solo:${id}`;
}

function scoreWinner(doc, titularNameByAbsId) {
  const d = doc.data;
  let score = 0;
  const absId = d.absenceShiftId || d.coveredShiftId || null;
  const expected = absId ? titularNameByAbsId.get(absId) : null;
  if (expected) {
    const cov = String(d.employeeName || '').toLowerCase();
    const exp = String(expected).toLowerCase();
    if (exp && cov && (exp.includes(cov.split(',')[0].trim()) || cov.includes(exp.split(',')[0].trim()))) {
      score += 100;
    }
  }
  if (d.isPresent === true) score += 40;
  if (d.resolvedBy === 'MODO_DEMO' || d.modoDemoAt) score += 5;
  if (d.origin === 'OPERATIONS_COVERAGE') score += 10;
  // Preferir el más antiguo (primera aceptación real)
  const created = toMillis(d.assignedAt || d.createdAt || d.coverageResolvedAt || d.startTime);
  score += Math.max(0, 20 - Math.floor(created / 1e12)); // tie-break suave
  return score - created / 1e15;
}

async function batchCommit(ops) {
  const CHUNK = 400;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + CHUNK)) {
      if (op.type === 'delete') batch.delete(db.collection('turnos').doc(op.id));
      else if (op.type === 'update') batch.update(db.collection('turnos').doc(op.id), op.data);
    }
    await batch.commit();
    process.stdout.write('.');
  }
  process.stdout.write('\n');
}

async function run() {
  console.log(`\n${DRY_RUN ? '🔍 DRY RUN — solo reporte (pasá --apply para borrar)' : '🗑️  APPLY — limpieza en Firestore'}`);
  if (USE_EMULATOR) console.log('   Emulador local');
  if (empresaArg) console.log(`   Empresa: ${empresaArg}`);
  console.log();

  console.log('1. Leyendo turnos candidatos a cubridor…');
  let q = db.collection('turnos').orderBy('startTime', 'desc').limit(5000);
  // Sin índice compuesto empresaId+startTime en todos los proyectos: filtramos en memoria
  const snap = await q.get();
  const docs = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter((d) => {
      if (empresaArg && String(d.data.empresaId || '') !== empresaArg) return false;
      return isCovererDoc(d.data);
    });
  console.log(`   ${snap.size} turnos leídos → ${docs.length} cubridores con ledger\n`);

  if (docs.length === 0) {
    console.log('Nada que limpiar.');
    return;
  }

  // Mapa titular/vacante → coveredByEmployeeName (para elegir ganador)
  const absIds = new Set();
  docs.forEach((d) => {
    const a = d.data.absenceShiftId || d.data.coveredShiftId;
    if (a) absIds.add(a);
  });
  const titularNameByAbsId = new Map();
  const absIdList = [...absIds];
  for (let i = 0; i < absIdList.length; i += 30) {
    const chunk = absIdList.slice(i, i + 30);
    await Promise.all(
      chunk.map(async (id) => {
        const s = await db.collection('turnos').doc(id).get();
        if (!s.exists) return;
        const data = s.data() || {};
        titularNameByAbsId.set(
          id,
          data.coveredByEmployeeName || data.coveredBy || data.employeeName || null,
        );
      }),
    );
  }

  const groups = new Map();
  for (const d of docs) {
    const k = groupKey(d.id, d.data);
    if (k.startsWith('solo:')) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }

  const toDelete = [];
  const toRevertPassive = [];
  const report = [];

  for (const [key, members] of groups) {
    if (members.length <= 1) continue;

    // EXT+ADV legítimo: exactamente 2 con tipos distintos EXTEND/ADVANCE
    const types = new Set(members.map((m) => String(m.data.coverageType || '').toUpperCase()));
    if (
      members.length === 2
      && types.has('EXTEND')
      && types.has('ADVANCE')
    ) {
      continue;
    }
    // RETENCION dual label no se toca si hay coverageDual*
    if (members.every((m) => isDualHalf(m.data)) && members.length <= 2) continue;

    const ranked = [...members].sort(
      (a, b) => scoreWinner(b, titularNameByAbsId) - scoreWinner(a, titularNameByAbsId),
    );
    const winner = ranked[0];
    const losers = ranked.slice(1);

    report.push({
      key,
      winner: `${winner.data.employeeName || winner.data.employeeId} (${winner.id.slice(0, 8)})`,
      losers: losers.map((l) => `${l.data.employeeName || l.data.employeeId} (${l.id.slice(0, 8)})`),
      titular: winner.data.coversAbsenceEmployeeName || '—',
      n: members.length,
    });

    for (const loser of losers) {
      const d = loser.data;
      const prev = String(d.previousPassiveCode || '').toUpperCase();
      const wasPassive = ['RET', 'ESC', 'REF'].includes(prev) || !!d.reassignedFromPassiveAt;
      if (wasPassive && prev) {
        toRevertPassive.push({
          id: loser.id,
          data: {
            code: prev,
            origin: prev === 'RET' ? 'PLANIFICACION' : FieldValue.delete(),
            isReten: prev === 'RET',
            coversAbsenceEmployeeName: FieldValue.delete(),
            absenceEmployeeName: FieldValue.delete(),
            absenceShiftId: FieldValue.delete(),
            coveredShiftId: FieldValue.delete(),
            coverageEventId: FieldValue.delete(),
            coverageType: FieldValue.delete(),
            coverageConvocatoriaId: FieldValue.delete(),
            assignedByConvocatoria: FieldValue.delete(),
            resolvedBy: FieldValue.delete(),
            previousPassiveCode: FieldValue.delete(),
            reassignedFromPassiveAt: FieldValue.delete(),
            vacancyLabel: FieldValue.delete(),
            demoDuplicateCleanedAt: FieldValue.serverTimestamp(),
          },
        });
      } else if (
        d.origin === 'OPERATIONS_COVERAGE'
        || d.resolvedBy === 'MODO_DEMO'
        || d.modoDemoAt
        || d.createdBy === 'MODO_DEMO'
      ) {
        toDelete.push(loser.id);
      } else {
        // No borrar planificado: solo limpiar ledger falso
        toRevertPassive.push({
          id: loser.id,
          data: {
            coversAbsenceEmployeeName: FieldValue.delete(),
            absenceEmployeeName: FieldValue.delete(),
            absenceShiftId: FieldValue.delete(),
            coveredShiftId: FieldValue.delete(),
            coverageEventId: FieldValue.delete(),
            coverageType: FieldValue.delete(),
            demoDuplicateCleanedAt: FieldValue.serverTimestamp(),
          },
        });
      }
    }
  }

  console.log(`2. Grupos con >1 cubridor: ${report.length}`);
  report.slice(0, 15).forEach((r) => {
    console.log(`   • [${r.n}] cubre ${r.titular}`);
    console.log(`     KEEP  ${r.winner}`);
    console.log(`     DROP  ${r.losers.join(' | ')}`);
  });
  if (report.length > 15) console.log(`   … y ${report.length - 15} grupos más`);
  console.log();
  console.log(`   A eliminar (OPS_COV / Demo) : ${toDelete.length}`);
  console.log(`   A revertir / limpiar ledger : ${toRevertPassive.length}`);

  if (toDelete.length === 0 && toRevertPassive.length === 0) {
    console.log('\n✅ Sin duplicados. Nada que hacer.\n');
    return;
  }

  if (DRY_RUN) {
    console.log('\n⏭  Dry-run. Para aplicar:\n   node scripts/cleanup-demo-duplicate-coverages.js --apply' +
      (empresaArg ? ` --empresaId=${empresaArg}` : '') +
      (USE_EMULATOR ? ' --emulator' : '') +
      '\n');
    return;
  }

  console.log('\n3. Aplicando…');
  const ops = [
    ...toDelete.map((id) => ({ type: 'delete', id })),
    ...toRevertPassive.map((u) => ({ type: 'update', id: u.id, data: u.data })),
  ];
  process.stdout.write('   ');
  await batchCommit(ops);

  // Cancelar convocatorias PENDING/ESCALATED huérfanas de esos absenceShiftIds
  const absToCancel = new Set();
  report.forEach((r) => {
    const m = /^abs:(.+)$/.exec(r.key);
    if (m) absToCancel.add(m[1]);
  });
  let cancelledConv = 0;
  for (const shiftId of absToCancel) {
    const [p, e] = await Promise.all([
      db.collection('convocatorias_cobertura').where('shiftId', '==', shiftId).where('status', '==', 'PENDING').get(),
      db.collection('convocatorias_cobertura').where('shiftId', '==', shiftId).where('status', '==', 'ESCALATED').get(),
    ]);
    const batch = db.batch();
    let n = 0;
    for (const d of [...p.docs, ...e.docs]) {
      batch.update(d.ref, {
        status: 'CANCELLED',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelReason: 'CLEANUP_DEMO_DUPLICATES',
      });
      n++;
    }
    if (n) {
      await batch.commit();
      cancelledConv += n;
    }
  }

  console.log('\n── RESUMEN ─────────────────────────────────────────');
  console.log(`   Grupos deduplicados     : ${report.length}`);
  console.log(`   Turnos eliminados       : ${toDelete.length}`);
  console.log(`   Turnos revertidos/limpios: ${toRevertPassive.length}`);
  console.log(`   Convocatorias canceladas: ${cancelledConv}`);
  console.log();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
