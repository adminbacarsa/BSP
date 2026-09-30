/**
 * Alta ARCA confirmada habilita la fichada. Emulador aislado (no el lab :8080).
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-ev-alta "node scripts/eval-eventuales-alta-emulator.mjs"
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

if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-ev-alta' });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const { aplicarTransicion } = requireFn('./lib/arca/arcaEnviosApi.js');
const { registrarPresencia } = requireFn('./lib/fichajes/registrarPresencia.js');

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail}`);
}

async function turno(id, contratoId, start) {
  await db.collection('turnos').doc(id).set({
    empresaId: 'alta_emp',
    employeeId: '20111111119',
    employeeName: 'Perez, Ana',
    esEventual: true,
    eventualAltaArcaConfirmada: false,
    eventualContratoId: contratoId,
    bolsaCuil: '20111111119',
    code: 'EV',
    origin: 'EVENTO',
    startTime: Timestamp.fromMillis(start),
    endTime: Timestamp.fromMillis(start + 6 * 3600000),
    scheduleDate: '2026-10-02',
    status: 'PENDING',
  });
}

async function fichar(shiftId) {
  try {
    const out = await registrarPresencia(db, {
      shiftId,
      empId: '20111111119',
      source: 'OPERATIONS',
      recordedAt: new Date().toISOString(),
    });
    return out.success === true ? 'ok' : 'no';
  } catch (err) {
    return err.message;
  }
}

async function main() {
  const start = Date.now() + 60 * 60 * 1000;
  await turno('alta_robot', 'ctr_robot', start);
  await turno('alta_robot_2', 'ctr_robot', start);
  await db.collection('arca_envios').doc('env_robot').set({
    empresaId: 'alta_emp',
    tipo: 'AT',
    estado: 'PENDIENTE',
    enviable: true,
    contratoIds: ['ctr_robot'],
    loteId: 'lote-robot',
    bolsaCuil: '20111111119',
    txt: '01AT',
  });
  const robot = await aplicarTransicion('env_robot', {
    estado: 'CONFIRMADO',
    origen: 'ROBOT',
    nroTransaccion: 'TX-ROBOT',
    actor: 'e2e',
  });
  const a = (await db.collection('turnos').doc('alta_robot').get()).data();
  const b = (await db.collection('turnos').doc('alta_robot_2').get()).data();
  report('lote robot denormaliza', robot.status === 200 && a.eventualAltaArcaConfirmada === true && a.nroTransaccion === 'TX-ROBOT' && b.eventualAltaArcaConfirmada === true, `status=${robot.status}`);
  report('fichada tras robot', (await fichar('alta_robot')) === 'ok', '');

  await turno('alta_link', 'ctr_link', start);
  await db.collection('arca_envios').doc('env_link').set({
    empresaId: 'alta_emp',
    tipo: 'AT',
    estado: 'PENDIENTE',
    enviable: true,
    contratoIds: ['ctr_link'],
    bolsaCuil: '20111111119',
    txt: '01AT',
    token: 'token-link-e2e',
    tokenExpiraAt: new Date(Date.now() + 3600000).toISOString(),
  });
  const link = await aplicarTransicion('env_link', {
    estado: 'CONFIRMADO',
    origen: 'LINK',
    nroTransaccion: 'TX-LINK',
    actor: 'e2e-link',
    marcarTokenUsado: true,
  });
  const linkShift = (await db.collection('turnos').doc('alta_link').get()).data();
  report('link denormaliza', link.status === 200 && linkShift.eventualAltaArcaConfirmada === true && linkShift.nroTransaccion === 'TX-LINK', `status=${link.status}`);
  report('fichada tras link', (await fichar('alta_link')) === 'ok', '');

  await db.collection('turnos').doc('alta_despues').set({
    empresaId: 'alta_emp',
    employeeId: '20111111119',
    esEventual: true,
    eventualAltaArcaConfirmada: false,
    eventualContratoId: 'ctr_link',
    bolsaCuil: '20111111119',
    startTime: Timestamp.fromMillis(start + 86400000),
    endTime: Timestamp.fromMillis(start + 86400000 + 6 * 3600000),
    scheduleDate: '2026-10-03',
  });
  await aplicarTransicion('env_link', {
    estado: 'CONFIRMADO',
    origen: 'LINK',
    nroTransaccion: 'TX-LINK',
    actor: 'e2e-link',
  });
  const { propagarAltaEnTurnos } = requireFn('./lib/arca/altaArcaDenorm.js');
  await propagarAltaEnTurnos(db, { contratoIds: ['ctr_link'], nroTransaccion: 'TX-LINK', encender: true });
  const despues = (await db.collection('turnos').doc('alta_despues').get()).data();
  report('turno nuevo del contrato hereda el alta', despues.eventualAltaArcaConfirmada === true && despues.nroTransaccion === 'TX-LINK', '');

  await db.collection('arca_envios').doc('env_bt').set({
    empresaId: 'alta_emp',
    tipo: 'BT',
    estado: 'PENDIENTE',
    enviable: true,
    contratoIds: ['ctr_link'],
    txt: '01BT',
  });
  await aplicarTransicion('env_bt', { estado: 'CONFIRMADO', origen: 'ROBOT', nroTransaccion: 'TX-BT', actor: 'e2e' });
  const futura = (await db.collection('turnos').doc('alta_despues').get()).data();
  report('BT apaga jornadas futuras', futura.eventualAltaArcaConfirmada === false, '');
  report('fichada futura bloqueada tras BT', (await fichar('alta_despues')) === 'ALTA_ARCA_PENDIENTE', '');

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
