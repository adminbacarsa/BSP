/**
 * Eventuales en el CC. Emulador aislado (no el lab :8080).
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-ev-cc "node scripts/eval-eventuales-cc-emulator.mjs"
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

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-ev-cc' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const { iniciarCascadaCobertura, resolverCobertura } = requireFn('./lib/coverage/convocatoriasCobertura.js');
const { evaluateServerCheckInWindow } = requireFn('./lib/fichajes/checkInWindow.js');
const { registrarPresencia } = requireFn('./lib/fichajes/registrarPresencia.js');

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

function bolsa(cuil, extra) {
  return {
    cuil,
    nombre: extra.nombre,
    disponibilidad: 'DISPONIBLE',
    empresasHabilitadas: ['ev_emp'],
    credencialVencimiento: '2027-06-01',
    aptoPsicofisico: { estado: 'APTO', vencimiento: '2027-06-01' },
    domicilioGeo: extra.geo,
    confiabilidad: extra.confiabilidad,
    uid: extra.uid,
    status: 'ACTIVE',
  };
}

async function main() {
  const start = Date.now() + 2 * 60 * 60 * 1000;
  const end = start + 6 * 60 * 60 * 1000;
  const empresaId = 'ev_emp';
  const cuilOk = '20111111119';
  const cuilCruce = '20222222228';
  await db.collection('empresas').doc(empresaId).set({ centroControlEnabled: true });
  await db.collection('eventuales_bolsa').doc(cuilOk).set(bolsa(cuilOk, {
    nombre: 'Perez, Ana',
    geo: { lat: -31.42, lng: -64.22 },
    confiabilidad: 2,
    uid: 'uid-eventual-ok',
  }));
  await db.collection('eventuales_bolsa').doc(cuilCruce).set(bolsa(cuilCruce, {
    nombre: 'Lopez, Luis',
    geo: { lat: -31.40, lng: -64.18 },
    confiabilidad: 9,
    uid: 'uid-eventual-cruce',
  }));
  await db.collection('turnos').doc('ev_cruce_prev').set({
    empresaId: 'ev_otra',
    bolsaCuil: cuilCruce,
    employeeId: cuilCruce,
    employeeName: 'Lopez, Luis',
    code: 'M',
    startTime: Timestamp.fromMillis(start - 14 * 60 * 60 * 1000),
    endTime: Timestamp.fromMillis(start - 6 * 60 * 60 * 1000),
    status: 'ACTIVE',
  });

  const shiftId = 'ev_hueco';
  await db.collection('turnos').doc(shiftId).set({
    empresaId,
    objectiveId: 'ev_obj',
    objectiveName: 'Feria',
    positionName: 'Acceso',
    clientId: 'ev_cli',
    clientName: 'Cliente',
    code: 'EV',
    origin: 'EVENTO',
    eventoId: 'evento-1',
    employeeId: 'VACANTE',
    isAbsent: true,
    lat: -31.41,
    lng: -64.19,
    startTime: Timestamp.fromMillis(start),
    endTime: Timestamp.fromMillis(end),
  });

  await iniciarCascadaCobertura(db, {
    id: shiftId,
    empresaId,
    objectiveId: 'ev_obj',
    objectiveName: 'Feria',
    positionName: 'Acceso',
    clientId: 'ev_cli',
    clientName: 'Cliente',
    code: 'EV',
    startTime: Timestamp.fromMillis(start),
    endTime: Timestamp.fromMillis(end),
  }, 'OPERACIONES');

  const convSnap = await db.collection('convocatorias_cobertura').where('shiftId', '==', shiftId).get();
  const conv = convSnap.docs[0];
  const convData = conv?.data() || {};
  report(
    'convoca eventual del evento',
    convSnap.size === 1 && convData.type === 'EVENTUAL' && convData.bolsaCuil === cuilOk && convData.candidateUid === 'uid-eventual-ok',
    `n=${convSnap.size} type=${convData.type} cuil=${convData.bolsaCuil}`,
  );
  report('cruce 12 h fuera', convData.bolsaCuil !== cuilCruce, convData.candidateEmployeeName || '');

  if (conv) {
    const resolved = await resolverCobertura(db, { id: conv.id, ...convData });
    const covId = `ops_cov_${shiftId}_${cuilOk}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    const cov = (await db.collection('turnos').doc(covId).get()).data() || {};
    const contratos = await db.collection('contratos_eventuales').where('bolsaCuil', '==', cuilOk).get();
    const contrato = contratos.docs[0]?.data() || {};
    const envios = await db.collection('arca_envios').where('bolsaCuil', '==', cuilOk).get();
    const envio = envios.docs[0]?.data() || {};
    report(
      'aceptar escribe turno contrato y AT',
      resolved.ok === true
        && cov.esEventual === true
        && cov.eventualAltaArcaConfirmada === false
        && cov.empresaId === empresaId
        && contrato.estado === 'CONFIRMADO'
        && envio.tipo === 'AT'
        && envio.canal === 'URGENTE'
        && envio.estado === 'PENDIENTE'
        && !envio.nroTransaccion,
      `ok=${resolved.ok} contrato=${contrato.estado} canal=${envio.canal}`,
    );

    let blocked = '';
    try {
      await registrarPresencia(db, {
        shiftId: covId,
        empId: cuilOk,
        source: 'OPERATIONS',
        recordedAt: new Date().toISOString(),
      });
      blocked = 'ficho';
    } catch (err) {
      blocked = err.message;
    }
    const win = evaluateServerCheckInWindow(cov, Date.now(), { source: 'OPERATIONS' });
    report('fichada bloqueada sin alta', blocked === 'ALTA_ARCA_PENDIENTE' && win.rejectCode === 'ALTA_ARCA_PENDIENTE', blocked);

    await db.collection('turnos').doc(covId).update({ eventualAltaArcaConfirmada: true });
    const after = await registrarPresencia(db, {
      shiftId: covId,
      empId: cuilOk,
      source: 'OPERATIONS',
      recordedAt: new Date().toISOString(),
    });
    const opened = evaluateServerCheckInWindow(
      { ...cov, eventualAltaArcaConfirmada: true },
      Date.now(),
      { source: 'OPERATIONS' },
    );
    report('fichada habilitada con alta', after.success === true && opened.allowed === true, `success=${after.success}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
