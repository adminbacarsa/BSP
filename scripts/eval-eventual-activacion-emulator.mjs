/**
 * Activación del link eventual y acuse de contrato. Emulador aislado (Firestore 8190 + Auth 9199).
 *   firebase emulators:exec --only firestore,auth --config firebase.e2e-p2.json --project demo-ev-act "node scripts/eval-eventual-activacion-emulator.mjs"
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
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('Falta FIREBASE_AUTH_EMULATOR_HOST (auth del emulador aislado, puerto 9199).');
  process.exit(1);
}

const projectId = process.env.GCLOUD_PROJECT || 'demo-ev-act';
admin.initializeApp({ projectId });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

const { activateAndSetPasswordHandler } = requireFn('./lib/eventuales/activarAccesoEventual.js');
const { acusarReciboContratoHandler } = requireFn('./lib/eventuales/acusarReciboContrato.js');

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail || ''}`);
}

async function signIn(email, password) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const res = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return { ok: res.ok, body: await res.json() };
}

function ctx(uid, token, ip = '10.1.1.9') {
  return {
    auth: { uid, token },
    rawRequest: { ip, headers: { 'user-agent': 'CronoAppEventual/1', 'x-forwarded-for': ip } },
  };
}

async function main() {
  const cuil = '20333333339';
  const email = 'eventual.activacion@bacarsa.test';
  const password = 'clave-eventual-1';
  const user = await admin.auth().createUser({ email, password: 'temp-inicial' });
  await db.collection('eventuales_bolsa').doc(cuil).set({
    cuil,
    nombre: 'Sosa, Eva',
    mail: email,
    disponibilidad: 'DISPONIBLE',
    uid: null,
  });
  await db.collection('empleados').doc('leg_bacar').set({
    empresaId: 'bacarsa',
    bolsaCuil: cuil,
    modalidad: 'EVENTUAL',
    nombre: 'Sosa, Eva',
  });
  await db.collection('empleados').doc('leg_pruebas').set({
    empresaId: 'pruebas_sa',
    bolsaCuil: cuil,
    modalidad: 'EVENTUAL',
    nombre: 'Sosa, Eva',
  });
  const expira = Timestamp.fromDate(new Date(Date.now() + 48 * 60 * 60 * 1000));
  await db.collection('device_activations').doc('tok_eventual').set({
    bolsaCuil: cuil,
    uid: user.uid,
    email,
    tipo: 'EVENTUAL',
    expiresAt: expira,
    used: false,
  });

  const activated = await activateAndSetPasswordHandler({
    token: 'tok_eventual',
    password,
    deviceId: 'device-eventual-01',
    deviceInfo: { platform: 'android' },
    platform: 'android',
  });
  const claims = (await admin.auth().getUser(user.uid)).customClaims || {};
  const bolsa = (await db.collection('eventuales_bolsa').doc(cuil).get()).data();
  const leg1 = (await db.collection('empleados').doc('leg_bacar').get()).data();
  const leg2 = (await db.collection('empleados').doc('leg_pruebas').get()).data();
  const token = (await db.collection('device_activations').doc('tok_eventual').get()).data();
  const login = await signIn(email, password);
  report(
    'link eventual activa con claim EVENTUAL',
    activated.email === email
      && claims.role === 'EVENTUAL'
      && claims.type === 'eventual'
      && claims.bolsaCuil === cuil
      && bolsa.uid === user.uid
      && leg1.uid === user.uid
      && leg2.uid === user.uid
      && token.used === true
      && login.ok,
    `role=${claims.role} uid=${bolsa.uid}`,
  );

  let reused = '';
  try {
    await activateAndSetPasswordHandler({
      token: 'tok_eventual',
      password: 'otra-clave-99',
      deviceId: 'device-eventual-01',
    });
  } catch (e) {
    reused = e.code || e.message;
  }
  report('link de un solo uso', reused === 'already-exists', reused);

  await db.collection('contratos_eventuales').doc('ctr_mio').set({
    empresaId: 'bacarsa',
    employeeId: 'leg_bacar',
    bolsaCuil: cuil,
    causa: 'reemplazo',
    estado: 'DOCUMENTADO',
    documento: { sha256: 'abc123pdf', tipo: 'PAPEL_ESCANEADO' },
  });
  await db.collection('contratos_eventuales').doc('ctr_ajeno').set({
    empresaId: 'bacarsa',
    employeeId: 'leg_otro',
    bolsaCuil: '20999999990',
    causa: 'reemplazo',
    estado: 'DOCUMENTADO',
  });
  await db.collection('contratos_eventuales').doc('ctr_sin_pdf').set({
    empresaId: 'pruebas_sa',
    employeeId: 'leg_pruebas',
    bolsaCuil: cuil,
    causa: 'evento',
    estado: 'DOCUMENTADO',
  });

  const acuse = await acusarReciboContratoHandler(
    { contratoId: 'ctr_mio' },
    ctx(user.uid, { role: 'EVENTUAL', type: 'eventual', bolsaCuil: cuil }),
  );
  const mio = (await db.collection('contratos_eventuales').doc('ctr_mio').get()).data();
  const audits = await db.collection('audit_logs').where('contratoId', '==', 'ctr_mio').get();
  report(
    'acuse del propio contrato',
    acuse.ok === true
      && acuse.pdfHash === 'abc123pdf'
      && mio.estado === 'ACUSE_RECIBIDO'
      && mio.pdfHash === 'abc123pdf'
      && mio.ip === '10.1.1.9'
      && mio.dispositivo === 'CronoAppEventual/1'
      && !!mio.acuseReciboAt
      && audits.size === 1,
    `estado=${mio.estado} hash=${mio.pdfHash}`,
  );

  const otra = await acusarReciboContratoHandler(
    { contratoId: 'ctr_mio' },
    ctx(user.uid, { role: 'EVENTUAL', bolsaCuil: cuil }),
  );
  const audits2 = await db.collection('audit_logs').where('contratoId', '==', 'ctr_mio').get();
  report('acuse idempotente', otra.already === true && audits2.size === 1, `already=${otra.already}`);

  let ajeno = '';
  try {
    await acusarReciboContratoHandler(
      { contratoId: 'ctr_ajeno' },
      ctx(user.uid, { role: 'EVENTUAL', bolsaCuil: cuil }),
    );
  } catch (e) {
    ajeno = e.code || '';
  }
  report('acuse ajeno rechazado', ajeno === 'permission-denied', ajeno);

  const preview = await acusarReciboContratoHandler(
    { contratoId: 'ctr_sin_pdf' },
    ctx('uid-super', { role: 'SuperAdmin' }, '10.9.9.1'),
  );
  const sinPdf = (await db.collection('contratos_eventuales').doc('ctr_sin_pdf').get()).data();
  report(
    'SuperAdmin preview y sin hash de PDF',
    preview.ok === true && preview.pdfHash === null && sinPdf.estado === 'ACUSE_RECIBIDO' && sinPdf.pdfHash === undefined,
    `pdfHash=${sinPdf.pdfHash}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
