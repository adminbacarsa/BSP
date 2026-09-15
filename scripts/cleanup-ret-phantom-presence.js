/**
 * cleanup-ret-phantom-presence.js
 *
 * Quita isPresent / COMPLETED fantasma en RET/ESC/REF (punto verde sin turno real),
 * o convierte a código del hueco si ya hay ledger de cobertura.
 *
 *   node scripts/cleanup-ret-phantom-presence.js [--dry-run] [--apply] [--empresaId=] [--emulator]
 * Sin --apply = dry-run.
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

function isPassive(data) {
  const c = String(data.code || '').toUpperCase();
  return c === 'RET' || c === 'ESC' || c === 'REF' || data.isReten === true;
}

function hasLedger(data) {
  if (String(data.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE') return true;
  if (data.coversAbsenceEmployeeName || data.absenceEmployeeName) return true;
  if (data.absenceShiftId || data.coveredShiftId) return true;
  if (data.coverageEventId && data.previousPassiveCode) return true;
  return false;
}

/** Presencia “fantasma” en UI: isPresent O status PRESENT/COMPLETED (punto verde en Plan). */
function looksPresentInUi(data) {
  if (data.isPresent === true) return true;
  const st = String(data.status || '').toUpperCase();
  return st === 'PRESENT' || st === 'COMPLETED';
}

async function run() {
  console.log(`\n${DRY_RUN ? '🔍 DRY RUN' : '🗑️  APPLY'} — RET/ESC/REF con presencia/COMPLETED fantasma\n`);

  const snap = await db.collection('turnos').orderBy('startTime', 'desc').limit(8000).get();
  const candidates = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter((d) => {
      if (empresaArg && String(d.data.empresaId || '') !== empresaArg) return false;
      return isPassive(d.data) && looksPresentInUi(d.data);
    });

  console.log(`Leídos ${snap.size} → ${candidates.length} pasivos con presencia UI\n`);

  const toClear = [];
  const toHeal = [];

  for (const c of candidates) {
    if (hasLedger(c.data) && (c.data.absenceShiftId || c.data.coveredShiftId || c.data.coversAbsenceEmployeeName)) {
      toHeal.push(c);
    } else if (hasLedger(c.data) && String(c.data.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE' && isPassive(c.data)) {
      // OPS_COV con code aún pasivo y sin absId: limpiar flags de presencia, no inventar banda
      toClear.push(c);
    } else {
      toClear.push(c);
    }
  }

  console.log(`Limpiar presencia/COMPLETED (stand-by puro): ${toClear.length}`);
  toClear.slice(0, 20).forEach((c) => {
    console.log(`  · ${c.data.employeeName || c.data.employeeId} | ${c.data.code} | status=${c.data.status || '—'} | ${c.id.slice(0, 8)}`);
  });
  console.log(`Convertir a turno real (tienen ledger): ${toHeal.length}`);
  toHeal.slice(0, 12).forEach((c) => {
    console.log(`  · ${c.data.employeeName || c.data.employeeId} | cubre ${c.data.coversAbsenceEmployeeName || '—'} | ${c.id.slice(0, 8)}`);
  });

  if (!toClear.length && !toHeal.length) {
    console.log('\n✅ Nada que corregir.\n');
    return;
  }
  if (DRY_RUN) {
    console.log('\n⏭  Dry-run. Aplicá con: node scripts/cleanup-ret-phantom-presence.js --apply\n');
    return;
  }

  const CHUNK = 400;
  const ops = [];

  for (const c of toClear) {
    ops.push({
      type: 'update',
      id: c.id,
      data: {
        isPresent: false,
        isCompleted: false,
        status: 'ASSIGNED',
        presentAt: FieldValue.delete(),
        realStartTime: FieldValue.delete(),
        realEndTime: FieldValue.delete(),
        checkInTime: FieldValue.delete(),
        autoPresencia: FieldValue.delete(),
        autoCierre: FieldValue.delete(),
        demoSimulated: FieldValue.delete(),
        retPhantomClearedAt: FieldValue.serverTimestamp(),
      },
    });
  }

  for (const c of toHeal) {
    const absId = String(c.data.absenceShiftId || c.data.coveredShiftId || '').trim();
    let vacancy = c.data;
    if (absId) {
      const abs = await db.collection('turnos').doc(absId).get();
      if (abs.exists) vacancy = abs.data() || c.data;
    }
    let code = String(vacancy.code || vacancy.shiftCode || 'M').toUpperCase();
    if (code === 'RET' || code === 'ESC' || code === 'REF') code = 'M';
    const prev = String(c.data.previousPassiveCode || c.data.code || 'RET').toUpperCase();
    ops.push({
      type: 'update',
      id: c.id,
      data: {
        code,
        startTime: vacancy.startTime || c.data.startTime || null,
        endTime: vacancy.endTime || c.data.endTime || null,
        plannedStartTime: vacancy.startTime || c.data.plannedStartTime || null,
        plannedEndTime: vacancy.endTime || c.data.plannedEndTime || null,
        objectiveId: vacancy.objectiveId || c.data.objectiveId || null,
        objectiveName: vacancy.objectiveName || c.data.objectiveName || null,
        positionName: vacancy.positionName || c.data.positionName || null,
        isReten: false,
        isFranco: false,
        origin: 'OPERATIONS_COVERAGE',
        previousPassiveCode: prev,
        reassignedFromPassiveAt: FieldValue.serverTimestamp(),
        retHealAt: FieldValue.serverTimestamp(),
      },
    });
  }

  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + CHUNK)) {
      batch.update(db.collection('turnos').doc(op.id), op.data);
    }
    await batch.commit();
    process.stdout.write('.');
  }
  console.log(`\n✅ Listo. Limpiados ${toClear.length}, convertidos ${toHeal.length}.\n`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
