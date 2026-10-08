/**
 * Marcar ausente deja `ausencias`. Cubrir un turno futuro sin ausencia previa también.
 * El aviso del portal no se duplica.
 *
 * firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-ausente-registro "node scripts/eval-ausente-sin-registro-emulator.mjs"
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFn = createRequire(path.join(__dirname, '../apps/functions/package.json'));
const admin = requireFn('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST.includes(':8080')) {
  console.error('Usar el emulador aislado firebase.e2e-p2.json, no el lab :8080.');
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-ausente-registro' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const { applyCoverage } = requireFn('./lib/coverage/syncAusenciaCobertura.js');
const { markShiftAbsent } = requireFn('./lib/attendance/markShiftAbsent.js');

const prefix = `aus_${Date.now()}`;
const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK' : 'FAIL'}\t${name}${detail ? `\t${detail}` : ''}`);
}

function ar(day, h, m) {
  return Timestamp.fromDate(new Date(`2026-10-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`));
}

async function ausenciasDe(shiftId) {
  const snap = await db.collection('ausencias').where('shiftId', '==', shiftId).get();
  return snap.docs.map((d) => d.data());
}

async function seedPar(id, titularExtra) {
  const empresaId = `${prefix}_${id}`;
  const titularId = `${prefix}_${id}_tit`;
  const refId = `${prefix}_${id}_ref`;
  const emp = `${prefix}_${id}_baez`;
  const lallana = `${prefix}_${id}_lallana`;
  const titular = {
    employeeId: emp,
    employeeName: 'BAEZ',
    code: 'M',
    objectiveId: `${prefix}_obj`,
    empresaId,
    positionName: 'Puesto 1',
    startTime: ar(8, 10, 45),
    endTime: ar(8, 12, 0),
    status: 'PENDING',
    isAbsent: false,
    ...titularExtra,
  };
  await db.collection('turnos').doc(titularId).set(titular);
  await db.collection('turnos').doc(refId).set({
    employeeId: lallana,
    employeeName: 'LALLANA',
    code: 'REF',
    objectiveId: `${prefix}_obj`,
    empresaId,
    positionName: 'Puesto 1',
    startTime: ar(8, 10, 45),
    endTime: ar(8, 12, 0),
    status: 'PENDING',
  });
  return { empresaId, titularId, refId, emp, lallana, titular };
}

async function cubrir(s) {
  const batch = db.batch();
  await applyCoverage(db, batch, {
    titularShiftId: s.titularId,
    titularShift: { id: s.titularId, ...(await db.collection('turnos').doc(s.titularId).get()).data() },
    candidateEmployeeId: s.lallana,
    candidateEmployeeName: 'LALLANA',
    sourceShiftId: s.refId,
    coverageType: 'REF',
    resolvedBy: 'OPERACIONES',
    empresaId: s.empresaId,
  });
  await batch.commit();
}

try {
  {
    const s = await seedPar('mapa', {});
    const r = await markShiftAbsent(db, s.titularId, { reason: 'MANUAL_OPS', by: 'operador' });
    const docs = await ausenciasDe(s.titularId);
    const turno = (await db.collection('turnos').doc(s.titularId).get()).data();
    report(
      'marcar ausente (callable / mapa) deja ausencias',
      r.applied === true && docs.length === 1 && turno.absenceType === 'AA' && turno.absenceDetectedBy === 'MANUAL_OPS',
      `docs=${docs.length} type=${turno.absenceType} by=${turno.absenceDetectedBy}`,
    );
  }

  {
    const s = await seedPar('futuro', {});
    await cubrir(s);
    const docs = await ausenciasDe(s.titularId);
    const turno = (await db.collection('turnos').doc(s.titularId).get()).data();
    report(
      'cubrir un turno futuro registra la ausencia',
      docs.length === 1 && turno.isAbsent === true && turno.absenceType === 'AA' && turno.coverageStatus === 'COVERED',
      `docs=${docs.length} type=${turno.absenceType} cov=${turno.coverageStatus}`,
    );
  }

  {
    const s = await seedPar('portal', {
      isAbsent: true,
      status: 'ABSENT',
      absenceType: 'AA',
      absenceDetectedBy: 'AVISO_PORTAL',
      absenceDetectedAt: ar(8, 9, 0),
    });
    await db.collection('ausencias').doc(`${prefix}_portal_aus`).set({
      shiftId: s.titularId,
      empresaId: s.empresaId,
      employeeId: s.emp,
      type: 'Ausencia con aviso',
      absenceType: 'AA',
      origin: 'AVISO_PORTAL',
    });
    await cubrir(s);
    const docs = await ausenciasDe(s.titularId);
    const turno = (await db.collection('turnos').doc(s.titularId).get()).data();
    report(
      'aviso del portal + cobertura no duplica',
      docs.length === 1 && docs[0].origin === 'AVISO_PORTAL' && turno.absenceDetectedBy === 'AVISO_PORTAL',
      `docs=${docs.length} origin=${docs.map((d) => d.origin).join(',')} by=${turno.absenceDetectedBy}`,
    );
  }

  {
    const s = await seedPar('fix', { isAbsent: true, status: 'ABSENT' });
    const r = await markShiftAbsent(db, s.titularId, {
      reason: 'FIX_SIN_REGISTRO',
      by: 'FIX_SIN_REGISTRO',
      skipCascadeSideEffects: true,
    });
    const docs = await ausenciasDe(s.titularId);
    const turno = (await db.collection('turnos').doc(s.titularId).get()).data();
    const nov = await db.collection('novedades').where('shiftId', '==', s.titularId).where('type', '==', 'AUSENCIA_AUTO').get();
    report(
      'fix histórico cierra el registro sin novedad de push',
      r.applied === true && docs.length === 1 && turno.absenceDetectedBy === 'FIX_SIN_REGISTRO' && turno.absenceCascadeSkip === true && nov.empty,
      `docs=${docs.length} by=${turno.absenceDetectedBy} novedades=${nov.size}`,
    );
  }
} catch (err) {
  report('excepción', false, err?.stack || String(err));
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAIL ${results.length - failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
if (failed.length) process.exit(1);
