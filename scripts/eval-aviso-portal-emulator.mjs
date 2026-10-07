/**
 * Aviso del guardia desde la app: el turno queda ausente al toque,
 * no sale ¿Venís? ni una AA automática, el CC puede abrir la vacante
 * y RRHH justifica a Enfermedad.
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-aviso-portal "node scripts/eval-aviso-portal-emulator.mjs"
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

const projectId = process.env.GCLOUD_PROJECT || 'demo-aviso-portal';
admin.initializeApp({ projectId });
const db = admin.firestore();

const { aplicarAvisoPortal, aplicarJustificacionAviso } = requireFn('./lib/attendance/avisoPortal.js');
const { shiftEligibleForArrivalNotice } = requireFn('./lib/attendance/arrivalNotices.js');
const { markShiftAbsent } = requireFn('./lib/attendance/markShiftAbsent.js');
const { iniciarCascadaCobertura } = requireFn('./lib/coverage/convocatoriasCobertura.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

const EMP = 'aviso_emp';
const GUARDIA = 'aviso_cardo';
const TURNO = 'aviso_m2';
const CONTROL = 'aviso_control';
const AUS = 'aviso_aus';

async function main() {
  const ahora = Date.now();
  const inicio = admin.firestore.Timestamp.fromMillis(ahora + 20 * 60 * 1000);
  const fin = admin.firestore.Timestamp.fromMillis(ahora + 8 * 60 * 60 * 1000);
  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  await db.collection('empresas').doc(EMP).set({ name: 'Pruebas aviso', centroControlEnabled: true, status: 'ACTIVE' });
  await db.collection('empleados').doc(GUARDIA).set({ empresaId: EMP, firstName: 'Analia', lastName: 'Cardo', status: 'activo' });
  const turnoBase = {
    empresaId: EMP,
    employeeId: GUARDIA,
    employeeName: 'CARDO, Analia Veronica',
    code: 'M2',
    status: 'PLANIFICADO',
    isAbsent: false,
    isPresent: false,
    objectiveId: 'obj_aviso',
    objectiveName: 'Objetivo',
    positionName: 'Puesto 1',
    startTime: inicio,
    endTime: fin,
    scheduleDate: hoy,
  };
  await db.collection('turnos').doc(TURNO).set(turnoBase);
  await db.collection('turnos').doc(CONTROL).set({ ...turnoBase, employeeId: 'aviso_otro', employeeName: 'OTRO' });
  await db.collection('ausencias').doc(AUS).set({
    empresaId: EMP,
    employeeId: GUARDIA,
    employeeName: 'CARDO, Analia Veronica',
    source: 'EMPLEADO',
    type: 'Ausencia con aviso',
    status: 'Pendiente',
    reason: 'Me duele la panza',
    shiftId: TURNO,
    startDate: hoy,
    endDate: hoy,
    absenceCase: 'CORTO_PLAZO',
    hasCertificate: false,
  });
  await db.collection('ausencias').doc('aviso_vacaciones').set({
    empresaId: EMP,
    employeeId: GUARDIA,
    source: 'EMPLEADO',
    type: 'Vacaciones',
    status: 'Pendiente',
    absenceCase: 'PROGRAMADA',
    startDate: hoy,
    endDate: hoy,
  });

  const aplicado = await aplicarAvisoPortal(db, AUS, (await db.collection('ausencias').doc(AUS).get()).data());
  const aus = (await db.collection('ausencias').doc(AUS).get()).data();
  const turno = (await db.collection('turnos').doc(TURNO).get()).data();
  const novedad = await db.collection('novedades').doc(`aviso_portal_${AUS}`).get();
  report(
    'el aviso queda activo y el turno ausente',
    aplicado.aplicado === true && aplicado.turnos === 1
      && aus?.status === 'Avisada' && aus?.revisionEstado === 'POR_REVISAR' && aus?.type === 'Ausencia con aviso' && aus?.absenceType === 'AA'
      && turno?.isAbsent === true && turno?.status === 'ABSENT' && turno?.absenceDetectedBy === 'AVISO_PORTAL'
      && turno?.absenceDetectedAt && turno?.code === 'M2' && turno?.isUnassigned !== true,
    `status=${aus?.status} turno=${turno?.status} code=${turno?.code}`,
  );
  report(
    'no sale ¿Venís? ni T−5',
    shiftEligibleForArrivalNotice(turno) === false
      && shiftEligibleForArrivalNotice({ employeeId: 'x', code: 'M2', status: 'PLANIFICADO', absenceDetectedBy: 'AVISO_PORTAL' }) === false
      && shiftEligibleForArrivalNotice((await db.collection('turnos').doc(CONTROL).get()).data()) === true,
    '',
  );

  const aa = await markShiftAbsent(db, TURNO, { reason: 'AUTO_T30', by: 'SYSTEM_SCHEDULER' });
  const ausencias = await db.collection('ausencias').where('employeeId', '==', GUARDIA).get();
  const noPresentacion = ausencias.docs.filter((d) => String(d.data().type || '').toLowerCase().includes('no presentaci'));
  report(
    'no se fabrica la AA automática',
    aa.alreadyAbsent === true && aa.applied === false && noPresentacion.length === 0,
    `applied=${aa.applied} already=${aa.alreadyAbsent} extra=${noPresentacion.length}`,
  );
  report(
    'RRHH recibe la novedad para revisar',
    novedad.exists && novedad.data()?.type === 'AVISO_AUSENCIA_PORTAL' && novedad.data()?.source === 'AUSENCIA' && novedad.data()?.handledBy === 'RRHH',
    novedad.data()?.title || '',
  );

  const vac = await aplicarAvisoPortal(db, 'aviso_vacaciones', (await db.collection('ausencias').doc('aviso_vacaciones').get()).data());
  const vacDoc = (await db.collection('ausencias').doc('aviso_vacaciones').get()).data();
  report('unas vacaciones no se convierten en aviso', vac.aplicado === false && vacDoc?.type === 'Vacaciones' && vacDoc?.status === 'Pendiente', vacDoc?.type);

  let cascadaError = '';
  try {
    const fresco = (await db.collection('turnos').doc(TURNO).get()).data();
    await iniciarCascadaCobertura(db, { id: TURNO, ...fresco, startTime: fresco.startTime, empresaId: EMP, objectiveId: 'obj_aviso' }, 'AUTO');
  } catch (err) {
    cascadaError = err?.message || String(err);
  }
  const conCandado = (await db.collection('turnos').doc(TURNO).get()).data();
  report('la vacante del CC toma el turno', !!conCandado?.cascadeLockAt, cascadaError);

  await aplicarJustificacionAviso(db, AUS, { code: 'E', label: 'Enfermedad', tieneCertificado: true });
  const just = (await db.collection('ausencias').doc(AUS).get()).data();
  const turnoE = (await db.collection('turnos').doc(TURNO).get()).data();
  report(
    'justificar con certificado pasa a E',
    just?.type === 'Enfermedad' && just?.absenceType === 'E' && just?.status === 'Justificada'
      && just?.revisionEstado === 'JUSTIFICADA' && turnoE?.absenceType === 'E' && turnoE?.isAbsent === true,
    `${just?.type} ${just?.status} turno=${turnoE?.absenceType}`,
  );

  const fails = results.filter((r) => !r.ok);
  console.log(`${results.length - fails.length}/${results.length}`);
  if (fails.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
