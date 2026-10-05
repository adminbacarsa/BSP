/**
 * Clave fiscal del robot ARCA en el emulador (Secret Manager mockeado en memoria):
 * guardar para una empresa, extender a otra, reemplazar clave, editar CUIT, quitar;
 * metadatos sin clave, audit_logs y el endpoint del robot por secretRef.
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-ev-clave "node scripts/eval-arca-clave-emulator.mjs"
 * Antes: `npm run build` en apps/functions.
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

const projectId = process.env.GCLOUD_PROJECT || 'demo-ev-clave';
admin.initializeApp({ projectId });
const db = admin.firestore();
const { gestionarClaveFiscalArca, leerCredencialParaRobot, usarClaveStoreDePrueba } = requireFn('./lib/arca/arcaClaveFiscalCallable.js');

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}${ok || !detail ? '' : `\t${detail}`}`);
}
async function intentar(fn) {
  try { return { ok: true, value: await fn() }; } catch (err) { return { ok: false, code: err?.code || '', message: err?.message || String(err) }; }
}

// Secret Manager de mentira: versiones por secreto, la anterior se destruye.
const secretos = new Map();
const viva = (id) => (secretos.get(id) || []).filter((v) => v.estado === 'ENABLED');
usarClaveStoreDePrueba({
  async escribir(id, clave) {
    const prev = secretos.get(id) || [];
    const version = String(prev.length + 1);
    secretos.set(id, [...prev.map((v) => ({ ...v, estado: 'DESTROYED' })), { version, clave, estado: 'ENABLED' }]);
    return { version };
  },
  async leer(id) { return viva(id)[0]?.clave || ''; },
  async destruir(id) { secretos.set(id, (secretos.get(id) || []).map((v) => ({ ...v, estado: 'DESTROYED' }))); },
});

const CLAVE = 'clave-e2e-no-log-1';
const CLAVE2 = 'clave-e2e-no-log-2';
const LOGIN = '20111111112';
const REF = `arca-clave-fiscal-${LOGIN}`;
const ahora = Math.floor(Date.now() / 1000);
const ctxSuper = { auth: { uid: 'uid-sa', token: { role: 'SUPERADMIN', auth_time: ahora - 30 } }, rawRequest: { ip: '10.0.0.8', headers: {} } };
const ctxAdmin = { auth: { uid: 'uid-admin', token: { role: 'ADMIN', auth_time: ahora - 30 } }, rawRequest: { ip: '10.0.0.8', headers: {} } };
const ctxViejo = { auth: { uid: 'uid-sa', token: { role: 'SUPERADMIN', auth_time: ahora - 2 * 3600 } }, rawRequest: { ip: '10.0.0.8', headers: {} } };
const run = (data, ctx = ctxSuper) => gestionarClaveFiscalArca.run(data, ctx);

async function metaDe(id) {
  const snap = await db.collection('empresas').doc(id).get();
  return snap.data()?.arcaRobotAcceso || null;
}
async function audits(action) {
  const snap = await db.collection('audit_logs').where('action', '==', action).get();
  return snap.docs.map((d) => d.data());
}
async function todoElTexto() {
  const emp = await db.collection('empresas').get();
  const aud = await db.collection('audit_logs').get();
  return JSON.stringify(emp.docs.map((d) => d.data())) + JSON.stringify(aud.docs.map((d) => d.data()));
}

async function main() {
  await db.collection('empresas').doc('bacarsa').set({ name: 'Bacar SA', cuit: '30-11111111-8', status: 'ACTIVE' });
  await db.collection('empresas').doc('grupos_bacar_sa').set({ name: 'Grupo Bacar', cuit: '30222222229', status: 'ACTIVE' });
  await db.collection('empresas').doc('vieja_sa').set({ name: 'Vieja SA', cuit: '30333333330', status: 'INACTIVE' });
  await db.collection('system_users').doc('uid-sa').set({ role: 'SUPERADMIN', name: 'Mauro' });
  await db.collection('system_users').doc('uid-admin').set({ role: 'ADMIN', empresaId: 'bacarsa', name: 'Admin' });

  const sinSesion = await intentar(() => run({ accion: 'leer', empresaId: 'bacarsa' }, { rawRequest: {} }));
  report('sin sesión no lee', !sinSesion.ok && sinSesion.code === 'unauthenticated', sinSesion.code);

  const admin1 = await intentar(() => run({ accion: 'guardar', empresaId: 'bacarsa', cuitLogin: LOGIN, cuitRepresentado: '30111111118', clave: CLAVE }, ctxAdmin));
  report('un admin no guarda la clave', !admin1.ok && admin1.code === 'permission-denied', admin1.code);

  const lee0 = await intentar(() => run({ accion: 'leer', empresaId: 'bacarsa' }));
  report(
    'leer sin configurar trae las otras empresas activas con su CUIT',
    lee0.ok && lee0.value.configurada === false && lee0.value.empresa?.nombre === 'Bacar SA' && lee0.value.empresas?.length === 1 && lee0.value.empresas[0].empresaId === 'grupos_bacar_sa' && lee0.value.empresas[0].cuit === '30222222229',
    lee0.message || JSON.stringify(lee0.value?.empresas),
  );

  const viejo = await intentar(() => run({ accion: 'guardar', empresaId: 'bacarsa', cuitLogin: LOGIN, cuitRepresentado: '30111111118', clave: CLAVE }, ctxViejo));
  report('ingreso de hace 2 h pide volver a iniciar sesión', !viejo.ok && viejo.code === 'failed-precondition' && /iniciar sesi/.test(viejo.message), viejo.code);

  const guardar = await intentar(() => run({ accion: 'guardar', empresaId: 'bacarsa', cuitLogin: '20-11111111-2', cuitRepresentado: '', clave: CLAVE }));
  const metaB = await metaDe('bacarsa');
  report(
    'guardar escribe el secreto por CUIT login y metadatos sin la clave',
    guardar.ok && guardar.value.configurada === true && metaB?.cuitLogin === LOGIN && metaB.cuitRepresentado === '30111111118' && metaB.secretRef === REF && metaB.secretVersion === '1'
      && metaB.configuradoPor === 'Mauro' && !('clave' in metaB) && viva(REF)[0]?.clave === CLAVE,
    guardar.message || JSON.stringify(metaB),
  );
  const aud1 = await audits('ARCA_CLAVE_GUARDADA');
  report('audit_logs registra el guardado con CUIT enmascarado', aud1.length === 1 && aud1[0].empresaId === 'bacarsa' && aud1[0].module === 'EVENTUALES' && /\*\*\*112/.test(aud1[0].details) && !aud1[0].details.includes(LOGIN), JSON.stringify(aud1.map((a) => a.details)));

  const robot = await leerCredencialParaRobot({ key: 'robot', expectedKey: 'robot', empresaId: 'bacarsa', nowMs: Date.now() });
  report('el robot obtiene la clave por secretRef', robot.status === 200 && robot.body.clave === CLAVE && robot.body.cuitLogin === LOGIN && robot.body.cuitRepresentado === '30111111118', JSON.stringify({ status: robot.status, error: robot.body.error }));
  const robotMal = await leerCredencialParaRobot({ key: 'otra', expectedKey: 'robot', empresaId: 'bacarsa', nowMs: Date.now() });
  report('sin x-arca-key correcta el robot recibe 401', robotMal.status === 401);
  const robotSin = await leerCredencialParaRobot({ key: 'robot', expectedKey: 'robot', empresaId: 'grupos_bacar_sa', nowMs: Date.now() });
  report('empresa sin credenciales → 403 SIN_CLAVE_FISCAL', robotSin.status === 403 && robotSin.body.error === 'SIN_CLAVE_FISCAL');
  const leida = await audits('ARCA_CLAVE_LEIDA');
  report('cada lectura del robot queda en audit_logs sin la clave', leida.length === 1 && leida[0].actorName === 'Robot ARCA' && !leida[0].details.includes(CLAVE), JSON.stringify(leida.map((a) => a.details)));

  const extender = await intentar(() => run({
    accion: 'guardar', empresaId: 'bacarsa', cuitLogin: LOGIN, cuitRepresentado: '30111111118', clave: CLAVE2,
    extender: [{ empresaId: 'grupos_bacar_sa' }, { empresaId: 'vieja_sa' }],
  }));
  report('extender a una empresa inactiva se rechaza', !extender.ok && extender.code === 'invalid-argument', extender.code || 'ok');
  const extender2 = await intentar(() => run({
    accion: 'guardar', empresaId: 'bacarsa', cuitLogin: LOGIN, cuitRepresentado: '30111111118', clave: CLAVE2,
    extender: [{ empresaId: 'grupos_bacar_sa' }],
  }));
  const metaG = await metaDe('grupos_bacar_sa');
  const metaB2 = await metaDe('bacarsa');
  report(
    'extender a Grupo Bacar comparte el secreto y usa su CUIT como representado',
    extender2.ok && extender2.value.extendidas?.length === 1 && metaG?.secretRef === REF && metaG.cuitRepresentado === '30222222229' && metaG.secretVersion === '2' && metaB2.secretVersion === '2'
      && viva(REF).length === 1 && viva(REF)[0].clave === CLAVE2,
    extender2.message || JSON.stringify(metaG),
  );
  const robotG = await leerCredencialParaRobot({ key: 'robot', expectedKey: 'robot', empresaId: 'grupos_bacar_sa', nowMs: Date.now() });
  report('el robot de Grupo Bacar recibe la misma clave con su representado', robotG.status === 200 && robotG.body.clave === CLAVE2 && robotG.body.cuitRepresentado === '30222222229');

  const reemplazo = await intentar(() => run({ accion: 'reemplazarClave', empresaId: 'grupos_bacar_sa', clave: 'clave-e2e-no-log-3' }));
  report(
    'reemplazar clave solo pide la clave y actualiza a las dos empresas',
    reemplazo.ok && reemplazo.value.afectadas?.length === 2 && (await metaDe('bacarsa')).secretVersion === '3' && (await metaDe('grupos_bacar_sa')).secretVersion === '3' && viva(REF)[0].clave === 'clave-e2e-no-log-3'
      && (await audits('ARCA_CLAVE_REEMPLAZADA')).length === 2,
    reemplazo.message,
  );

  const editar = await intentar(() => run({ accion: 'editarCuits', empresaId: 'grupos_bacar_sa', cuitLogin: '27333333334', cuitRepresentado: '30222222229' }));
  const metaG3 = await metaDe('grupos_bacar_sa');
  report(
    'editar CUIT mueve la clave al secreto del CUIT nuevo y conserva el viejo para Bacar',
    editar.ok && metaG3?.cuitLogin === '27333333334' && metaG3.secretRef === 'arca-clave-fiscal-27333333334' && viva('arca-clave-fiscal-27333333334')[0]?.clave === 'clave-e2e-no-log-3' && viva(REF).length === 1,
    editar.message || JSON.stringify(metaG3),
  );

  const quitar = await intentar(() => run({ accion: 'quitar', empresaId: 'bacarsa', confirmar: true }));
  report('quitar borra los metadatos y destruye el secreto que ya nadie usa', quitar.ok && quitar.value.configurada === false && (await metaDe('bacarsa')) === null && viva(REF).length === 0 && (await audits('ARCA_CLAVE_QUITADA')).length === 1, quitar.message);
  const robotQ = await leerCredencialParaRobot({ key: 'robot', expectedKey: 'robot', empresaId: 'bacarsa', nowMs: Date.now() });
  report('después de quitar el robot recibe 403', robotQ.status === 403 && robotQ.body.error === 'SIN_CLAVE_FISCAL');

  const texto = await todoElTexto();
  report('ninguna clave quedó en Firestore ni en audit_logs', ![CLAVE, CLAVE2, 'clave-e2e-no-log-3'].some((c) => texto.includes(c)));

  const fallas = results.filter((r) => !r.ok);
  console.log(fallas.length ? `FALLARON ${fallas.length}` : `OK arca-clave-emulator (${results.length})`);
  process.exit(fallas.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});