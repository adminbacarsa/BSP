/**
 * Functions aislada (copia temporal sin el repo) contra el emulador: gestionarEventual (alta y detalle),
 * confirmarAnexoEventual y arcaEnviosApi tienen que resolver sus módulos compartidos (eventuales-shared).
 *
 *   firebase emulators:exec --only firestore,storage --config firebase.e2e-p2.json --project demo-ev-standalone "node scripts/eval-eventuales-standalone-emulator.mjs"
 *
 * Requiere `npm --prefix apps/functions run build`. Drive queda bloqueado (credenciales inexistentes):
 * el PDF cae a Storage del emulador.
 */
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { prepareStandaloneCopy, removeStandaloneCopy } from './check-functions-standalone.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST.includes(':8080')) {
  console.error('Usar el emulador aislado firebase.e2e-p2.json, no el lab :8080.');
  process.exit(1);
}
if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  console.error('Falta el emulador de Storage (--only firestore,storage).');
  process.exit(1);
}

const projectId = process.env.GCLOUD_PROJECT || 'demo-ev-standalone';
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(process.cwd(), 'no-existe-credencial.json');
process.env.ARCA_ROBOT_KEY = 'e2e-robot-key';
process.env.FUNCTIONS_EMULATOR = 'true';

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail || ''}`);
}

class FakeRes extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.body = undefined;
    this.done = false;
  }
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }
  getHeader(k) { return this.headers[String(k).toLowerCase()]; }
  status(c) { this.statusCode = c; return this; }
  json(b) { this.body = b; return this.end(); }
  send(b) { this.body = b; return this.end(); }
  end() { if (!this.done) { this.done = true; this.emit('finish'); } return this; }
}

function fakeReq({ method = 'GET', query = {}, body = {}, headers = {} }) {
  return { method, query, body, headers: { 'user-agent': 'e2e', ...headers }, ip: '10.0.0.5', get: (h) => headers[String(h).toLowerCase()] };
}

function ctxSuper(uid = 'uid-super') {
  return { auth: { uid, token: { role: 'SuperAdmin' } }, rawRequest: { ip: '10.0.0.5', headers: {} } };
}

async function main() {
  const tmp = prepareStandaloneCopy({ label: 'cosp-ev-standalone' });
  console.log(`copia aislada: ${tmp}`);
  const requireTmp = createRequire(path.join(tmp, 'package.json'));
  const admin = requireTmp('firebase-admin');
  admin.initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
  const db = admin.firestore();
  const libUrl = (rel) => pathToFileURL(path.join(tmp, 'lib', rel)).href;

  const empresaId = 'bacarsa';
  const cuil = '20123456786';

  await db.collection('empresas').doc(empresaId).set({
    nombre: 'Bacar SA',
    razonSocial: 'Bacar S.A.',
    cuit: '30111111118',
    avisos: { ARCA_ALTA_PENDIENTE: [{ tipo: 'ROL', rol: 'RRHH' }] },
  });
  await db.collection('roles').doc('rol_rrhh').set({ name: 'RRHH', permissions: { RRHH: ['read'], EVENTUALES: ['read', 'create', 'update'] } });
  await db.collection('system_users').doc('uid-rrhh').set({ empresaId, role: 'rol_rrhh', status: 'ACTIVE', email: 'rrhh@bacarsa.test' });

  // 1) gestionarEventual: alta + detalle (grupo, planilla, ficha)
  const { gestionarEventual } = await import(libUrl('eventuales/gestionarEventual.js'));
  let alta;
  try {
    alta = await gestionarEventual.run({
      accion: 'crear',
      cuil,
      nombre: 'Sosa, Eva',
      mail: 'eva.sosa@bacarsa.test',
      dni: '12345678',
      empresasHabilitadas: [empresaId],
      obraSocialRnos: '108605',
    }, ctxSuper());
  } catch (e) {
    alta = { error: e?.message || String(e) };
  }
  const bolsa = (await db.collection('eventuales_bolsa').doc(cuil).get()).data();
  report('gestionarEventual crear', alta?.ok === true && bolsa?.nombre === 'Sosa, Eva', JSON.stringify(alta));

  let detalle;
  try {
    detalle = await gestionarEventual.run({ accion: 'detalle', cuil }, ctxSuper());
  } catch (e) {
    detalle = { error: e?.message || String(e) };
  }
  report('gestionarEventual detalle', detalle?.ficha?.id === cuil && Array.isArray(detalle?.contratos), detalle?.error || `contratos=${detalle?.contratos?.length}`);

  // 2) confirmarAnexoEventual (marcoAnexo) con código válido; Drive bloqueado → Storage del emulador
  const marco = await import(libUrl('eventuales-shared/marcoAnexo.mjs'));
  const { confirmarAnexoEventual } = await import(libUrl('eventuales/marcoAnexoCall.js'));
  const contratoId = 'ctr_standalone';
  const codigo = '482913';
  const salt = 'salt-e2e';
  await db.collection('eventuales_bolsa').doc(cuil).set({
    uid: 'uid-eventual',
    marcos: { [empresaId]: { firmado: true, fechaFirma: '2026-09-01', estado: 'VIGENTE' } },
  }, { merge: true });
  await db.collection('contratos_eventuales').doc(contratoId).set({
    empresaId,
    bolsaCuil: cuil,
    causa: 'reemplazo por licencia',
    estado: 'CONFIRMADO',
    objectiveName: 'Peaje Norte',
    jornadas: [{ fecha: '2026-10-03', horaInicio: '07:00', horaFin: '15:00', horas: 8 }],
  });
  await db.collection('anexo_codigos').doc(contratoId).set({
    contratoId,
    bolsaCuil: cuil,
    salt,
    hash: marco.hashCodigo(codigo, salt),
    usado: false,
    venceMs: Date.now() + 10 * 60 * 1000,
  });
  let anexo;
  try {
    anexo = await confirmarAnexoEventual.run(
      { contratoId, codigo, dispositivo: 'e2e-device' },
      { auth: { uid: 'uid-eventual', token: { role: 'EVENTUAL', bolsaCuil: cuil } }, rawRequest: { ip: '10.0.0.5' } },
    );
  } catch (e) {
    anexo = { error: e?.message || String(e) };
  }
  const anexoDoc = (await db.collection('anexos_eventuales').doc(contratoId).get()).data();
  const codigoDoc = (await db.collection('anexo_codigos').doc(contratoId).get()).data();
  report(
    'confirmarAnexoEventual',
    anexo?.ok === true && !!anexo?.hashAnexo && anexoDoc?.hashAnexo === anexo?.hashAnexo && codigoDoc?.usado === true,
    anexo?.error || `hash=${String(anexo?.hashAnexo || '').slice(0, 12)} storage=${anexoDoc?.storagePath ? 'si' : 'no'}`,
  );

  // 3) arcaEnviosApi: config-avisos resuelve avisos.mjs
  const { arcaEnviosApi } = await import(libUrl('arca/arcaEnviosApi.js'));
  const res = new FakeRes();
  let apiError = '';
  try {
    await arcaEnviosApi(fakeReq({
      method: 'GET',
      query: { action: 'config-avisos', empresaId },
      headers: { 'x-arca-key': 'e2e-robot-key' },
    }), res);
  } catch (e) {
    apiError = e?.message || String(e);
  }
  const avisos = res.body?.avisos || {};
  report(
    'arcaEnviosApi config-avisos',
    !apiError && res.statusCode === 200 && Array.isArray(avisos.ARCA_ALTA_PENDIENTE?.mails),
    apiError || `status=${res.statusCode} tipos=${Object.keys(avisos).join(',')}`,
  );

  const res2 = new FakeRes();
  await arcaEnviosApi(fakeReq({ method: 'GET', query: { action: 'link', token: 'no-existe' } }), res2);
  report('arcaEnviosApi link inválido responde 403', res2.statusCode === 403, `status=${res2.statusCode} ${JSON.stringify(res2.body)}`);

  removeStandaloneCopy(tmp);
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `FALLARON ${failed.length}/${results.length}` : `OK ${results.length}/${results.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
