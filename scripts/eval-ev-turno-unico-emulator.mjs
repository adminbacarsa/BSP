/**
 * Los 4 caminos del turno EV escriben el mismo shape.
 *   firebase emulators:exec --only firestore,storage --config firebase.e2e-p2.json --project demo-ev-turno "node scripts/eval-ev-turno-unico-emulator.mjs"
 * Antes: npm run build en apps/functions.
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

const projectId = process.env.GCLOUD_PROJECT || 'demo-ev-turno';
admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const { asignarGuardiaAEvento } = requireFn('./lib/eventos/turnoEvento.js');
const { respondEventoConvocatoria } = requireFn('./lib/eventos/eventoPortalCallables.js');
const { convocarEventualEvento } = requireFn('./lib/eventuales/planificacionEventuales.js');
const { applyCoverage } = requireFn('./lib/coverage/syncAusenciaCobertura.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}
async function intentar(fn) {
  try { return { ok: true, value: await fn() }; } catch (err) { return { ok: false, code: err?.code || '', message: err?.message || String(err) }; }
}

const EMP = 'pruebas_sa';
const CLI = 'cli_pumas';
const EVT = 'evt_pumas';
const SRV = 'f0c8bbbe-puerta';
const FECHA = '2026-10-02';
const ctxSuper = { auth: { uid: 'uid-coord', token: { role: 'SuperAdmin' } }, rawRequest: { ip: '10.0.0.5', headers: {} } };

function mismoShape(t, extra) {
  if (!t) return false;
  const base = t.code === 'EV'
    && t.type === 'Evento'
    && t.origin === 'EVENTO'
    && t.eventoId === EVT
    && t.servicioId === SRV
    && t.servicioNombre === 'puerta campus'
    && t.positionName === 'puerta campus'
    && t.clientId === CLI
    && t.empresaId === EMP
    && t.draft === false
    && t.objectiveId === `evt_${EVT}`
    && t.objectiveName === 'pumas'
    && !!t.startTime && !!t.endTime;
  return base && extra(t);
}

async function main() {
  await db.collection('empresas').doc(EMP).set({ nombre: 'Pruebas', centroControlEnabled: true });
  await db.collection('clients').doc(CLI).set({
    empresaId: EMP, name: 'Cliente Pumas', status: 'ACTIVE', objetivos: [],
  });
  await db.collection('eventos').doc(EVT).set({
    empresaId: EMP,
    nombre: 'pumas',
    clienteId: CLI,
    clienteNombre: 'Cliente Pumas',
    fecha: FECHA,
    servicios: [{
      id: SRV,
      nombre: 'puerta campus',
      fecha: FECHA,
      horaInicio: '12:00',
      horaFin: '20:00',
      tipoTurno: 'libre',
      ubicacion: { tipo: 'nueva', direccion: 'Campus, Córdoba', latitud: -31.44, longitud: -64.19 },
    }],
  });
  await db.collection('roles').doc('rol_ev').set({ name: 'EV', permissions: { EVENTUALES: ['read', 'convocar'] } });
  await db.collection('system_users').doc('uid-coord').set({ empresaId: EMP, role: 'rol_ev', status: 'ACTIVE' });

  const base = {
    empresaId: EMP,
    eventoId: EVT,
    eventoNombre: 'pumas',
    clienteId: CLI,
    clienteNombre: 'Cliente Pumas',
    servicioId: SRV,
    servicioNombre: 'puerta campus',
    servicioFecha: FECHA,
    horaInicio: '12:00',
    horaFin: '20:00',
    horas: 8,
  };

  await db.collection('empleados').doc('emp_libre').set({ empresaId: EMP, firstName: 'Libre', lastName: 'Uno', status: 'ACTIVE' });
  const libre = await intentar(() => asignarGuardiaAEvento(db, { ...base, empleadoId: 'emp_libre', empleadoNombre: 'Uno, Libre' }));
  const tLibre = libre.ok ? (await db.collection('turnos').doc(libre.value.turnoId).get()).data() : null;
  const obj = (await db.collection('clients').doc(CLI).get()).data()?.objetivos?.find((o) => o.id === `evt_${EVT}`);
  report(
    'libre: EV con objetivo del evento',
    libre.ok && mismoShape(tLibre, (t) => !t.sourceShiftId) && obj?.esEvento === true && obj?.lat === -31.44 && !obj?.servicio_sla,
    libre.ok ? `obj=${tLibre?.objectiveId}` : libre.message,
  );

  const retStart = Timestamp.fromDate(new Date(`${FECHA}T08:00:00.000-03:00`));
  const retEnd = Timestamp.fromDate(new Date(`${FECHA}T16:00:00.000-03:00`));
  await db.collection('empleados').doc('emp_ret').set({ empresaId: EMP, firstName: 'Ret', lastName: 'Dos', status: 'ACTIVE' });
  await db.collection('turnos').doc('turno_ret').set({
    empresaId: EMP, employeeId: 'emp_ret', employeeName: 'Dos, Ret', code: 'RET', type: 'Retén',
    objectiveId: 'obj_base', objectiveName: 'Peaje', positionName: 'Puesto 1',
    startTime: retStart, endTime: retEnd, draft: false,
  });
  const ret = await intentar(() => asignarGuardiaAEvento(db, { ...base, empleadoId: 'emp_ret', empleadoNombre: 'Dos, Ret' }));
  const tRet = ret.ok ? (await db.collection('turnos').doc(ret.value.turnoId).get()).data() : null;
  const srcRet = (await db.collection('turnos').doc('turno_ret').get()).data();
  report(
    'RET: el origen queda RET y el EV es otro',
    ret.ok && ret.value.turnoId !== 'turno_ret' && mismoShape(tRet, (t) => t.sourceShiftId === 'turno_ret')
      && srcRet?.code === 'RET' && srcRet?.coverageUsed === true && srcRet?.coverageDocId === ret.value?.turnoId,
    ret.ok ? `src=${tRet?.sourceShiftId} ret=${srcRet?.code}` : ret.message,
  );

  await db.collection('empleados').doc('emp_franco').set({
    empresaId: EMP, firstName: 'Franco', lastName: 'Tres', uid: 'uid-franco', status: 'ACTIVE',
  });
  await db.collection('turnos').doc('turno_f').set({
    empresaId: EMP, employeeId: 'emp_franco', employeeName: 'Tres, Franco', code: 'F', isFranco: true,
    objectiveId: 'obj_base', objectiveName: 'Peaje', positionName: 'Puesto 1',
    startTime: Timestamp.fromDate(new Date(`${FECHA}T00:00:00.000-03:00`)),
    endTime: Timestamp.fromDate(new Date(`${FECHA}T23:59:00.000-03:00`)),
    draft: false,
  });
  const solF = db.collection('solicitudes_evento').doc();
  await solF.set({
    empresaId: EMP, eventoId: EVT, eventoNombre: 'pumas', servicioId: SRV, servicioNombre: 'puerta campus',
    servicioFecha: FECHA, empleadoId: 'emp_franco', empleadoNombre: 'Tres, Franco', status: 'convocado', tipo: 'admin_convoca',
  });
  const accF = await intentar(() => respondEventoConvocatoria.run({
    solicitudId: solF.id, accept: true, asEmployeeId: 'emp_franco',
  }, ctxSuper));
  const evsF = await db.collection('turnos').where('employeeId', '==', 'emp_franco').where('code', '==', 'EV').get();
  const tF = evsF.docs[0]?.data();
  const srcF = (await db.collection('turnos').doc('turno_f').get()).data();
  report(
    'franco que acepta: F queda F y el EV aparte',
    accF.ok && evsF.size === 1 && mismoShape(tF, (t) => t.sourceShiftId === 'turno_f')
      && srcF?.code === 'F' && srcF?.coverageUsed === true,
    accF.ok ? `n=${evsF.size} f=${srcF?.code}` : accF.message,
  );

  const cuil = '20999888776';
  await db.collection('eventuales_bolsa').doc(cuil).set({
    cuil, nombre: 'Aballay, Eve', disponibilidad: 'DISPONIBLE', empresasHabilitadas: [EMP],
    credencialVencimiento: '2027-06-01', aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-06-01' },
    uid: 'uid-ev', dni: '30111222', status: 'ACTIVE', exigirMarco: false, exigirAltaArca: false,
  });
  const conv = await intentar(() => convocarEventualEvento.run({
    empresaId: EMP, cuil, clientId: CLI, clientName: 'Cliente Pumas',
    evento: { eventoId: EVT, eventoNombre: 'pumas', servicioId: SRV, servicioNombre: 'puerta campus' },
    jornada: { fecha: FECHA, horaInicio: '12:00', horaFin: '20:00', horas: 8 },
    positionName: 'puerta campus',
  }, ctxSuper));
  const accE = conv.ok
    ? await intentar(() => respondEventoConvocatoria.run({ solicitudId: conv.value.solicitudId, accept: true }, {
      auth: { uid: 'uid-ev', token: { role: 'EVENTUAL', bolsaCuil: cuil } }, rawRequest: { ip: '10.0.0.9', headers: {} },
    }))
    : conv;
  const evsE = await db.collection('turnos').where('bolsaCuil', '==', cuil).get();
  const tE = evsE.docs[0]?.data();
  report(
    'eventual que acepta: mismo shape',
    accE.ok && evsE.size === 1 && mismoShape(tE, (t) => t.esEventual === true && !t.sourceShiftId),
    accE.ok ? `n=${evsE.size} obj=${tE?.objectiveId}` : accE.message,
  );

  const gapStart = Timestamp.fromDate(new Date(`${FECHA}T12:00:00.000-03:00`));
  const gapEnd = Timestamp.fromDate(new Date(`${FECHA}T20:00:00.000-03:00`));
  await db.collection('turnos').doc('tit_ev').set({
    empresaId: EMP, clientId: CLI, clientName: 'Cliente Pumas',
    objectiveId: `evt_${EVT}`, objectiveName: 'pumas', positionName: 'puerta campus',
    code: 'EV', type: 'Evento', origin: 'EVENTO', eventoId: EVT, eventoNombre: 'pumas',
    servicioId: SRV, servicioNombre: 'puerta campus',
    employeeId: 'emp_aus', employeeName: 'Ausente',
    startTime: gapStart, endTime: gapEnd, status: 'ABSENT', isAbsent: true, draft: false,
  });
  await db.collection('turnos').doc('src_ref').set({
    empresaId: EMP, clientId: CLI, objectiveId: `evt_${EVT}`, objectiveName: 'pumas',
    positionName: 'puerta campus', code: 'REF', employeeId: 'emp_ref', employeeName: 'Refuerzo',
    startTime: gapStart, endTime: gapEnd, status: 'PENDING', draft: false,
  });
  const batch = db.batch();
  const cov = await intentar(() => applyCoverage(db, batch, {
    titularShiftId: 'tit_ev',
    candidateEmployeeId: 'emp_ref',
    candidateEmployeeName: 'Refuerzo',
    sourceShiftId: 'src_ref',
    coverageType: 'REF',
    resolvedBy: 'AUTO',
    empresaId: EMP,
    titularCloseMode: 'FULL',
  }));
  if (cov.ok) await batch.commit();
  const tCov = cov.ok ? (await db.collection('turnos').doc(cov.value).get()).data() : null;
  report(
    'cascada: cobertura del hueco con el mismo shape',
    cov.ok && mismoShape(tCov, (t) => t.eventGap === true && t.employeeId === 'emp_ref' && t.coverageType === 'REF'),
    cov.ok ? `origin=${tCov?.origin} pos=${tCov?.positionName}` : cov.message,
  );

  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `FALLARON ${failed}/${results.length}` : `OK ${results.length}/${results.length}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
