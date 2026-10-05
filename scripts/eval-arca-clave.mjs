/**
 * Clave fiscal en Secret Manager (mock) y robot en simulacion.
 *   npm run eval:arca-clave
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ClaveFiscalError,
  ejecutarClaveFiscal,
  manejarCredencial,
  metaPublica,
  secretRefDeCuit,
} from '../apps/functions/src/arca/arcaClaveFiscal.ts';
import { formatearCuit, planAcceso, sanitizarTexto } from './arca-robot/flujo.mjs';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}${ok || !detail ? '' : `\t${detail}`}`);
  if (!ok) failed += 1;
}

const CLAVE = 'zzz-clave-no-log-77';
const CLAVE2 = 'otra-clave-no-log-88';
const AHORA = Date.parse('2031-03-02T15:00:00.000Z');
const AUTH_TIME = Math.floor(AHORA / 1000) - 60;
const LOGIN = '20111111112';
const REF = secretRefDeCuit(LOGIN);

function mundo() {
  const secretos = new Map();
  const metas = new Map();
  const audits = [];
  const empresas = [
    { empresaId: 'bacarsa', nombre: 'Bacar SA', cuit: '30111111118' },
    { empresaId: 'grupos_bacar_sa', nombre: 'Grupo Bacar', cuit: '30222222229' },
    { empresaId: 'pruebas_sa', nombre: 'Pruebas SA', cuit: '' },
  ];
  const store = {
    async escribir(id, clave) {
      const prev = secretos.get(id) || [];
      const version = String(prev.length + 1);
      secretos.set(id, [...prev.map((v) => ({ ...v, estado: 'DESTROYED' })), { version, clave, estado: 'ENABLED' }]);
      return { version };
    },
    async leer(id) {
      const viva = (secretos.get(id) || []).find((v) => v.estado === 'ENABLED');
      return viva ? viva.clave : '';
    },
    async destruir(id) {
      secretos.set(id, (secretos.get(id) || []).map((v) => ({ ...v, estado: 'DESTROYED' })));
    },
  };
  const ports = {
    lookupRole: async () => 'Operador',
    store,
    meta: {
      async listar() { return empresas.map((e) => ({ ...e, meta: metas.get(e.empresaId) || null })); },
      async guardar(id, meta) { metas.set(id, meta); },
      async borrar(id) { metas.delete(id); },
    },
    audit: { async add(entry) { audits.push(entry); } },
  };
  const viva = (id) => (secretos.get(id) || []).filter((v) => v.estado === 'ENABLED');
  return { secretos, metas, audits, ports, viva };
}

const superAuth = { uid: 'sa-1', token: { role: 'SUPERADMIN', auth_time: AUTH_TIME } };
const adminAuth = { uid: 'op-1', token: { role: 'ADMIN', auth_time: AUTH_TIME } };
const correr = (auth, data, ports, actorName = 'Mauro') =>
  ejecutarClaveFiscal({ auth, data, ahoraMs: AHORA, actorName }, ports);
const falla = (p) => p.then(() => null, (e) => e);

const denegado = await falla(correr(adminAuth, { accion: 'guardar', empresaId: 'bacarsa', cuitLogin: LOGIN, cuitRepresentado: '30111111118', clave: CLAVE }, mundo().ports, 'Operador'));
check('sin SuperAdmin no guarda', denegado instanceof ClaveFiscalError && denegado.codigo === 'permission-denied');

const viejo = await falla(correr(
  { uid: 'sa-1', token: { role: 'SUPERADMIN', auth_time: Math.floor(AHORA / 1000) - 61 * 60 } },
  { accion: 'guardar', empresaId: 'bacarsa', cuitLogin: LOGIN, cuitRepresentado: '30111111118', clave: CLAVE },
  mundo().ports,
));
check('ingreso viejo no guarda la clave', viejo instanceof ClaveFiscalError && viejo.codigo === 'failed-precondition' && /iniciar sesi/.test(viejo.message));

const box = mundo();
box.ports.lookupRole = async () => 'SUPERADMIN';
const guardado = await correr(
  { uid: 'sa-2', token: { role: 'OPERADOR', auth_time: AUTH_TIME } },
  { accion: 'guardar', empresaId: 'bacarsa', cuitLogin: '20-11111111-2', cuitRepresentado: '30-11111111-8', clave: CLAVE },
  box.ports,
);
const meta = box.metas.get('bacarsa');
const textoMeta = JSON.stringify(meta) + JSON.stringify(guardado) + JSON.stringify(box.audits);
check(
  'SuperAdmin por rol de sistema guarda metadatos sin la clave',
  guardado.configurada === true && meta.cuitLogin === LOGIN && meta.cuitRepresentado === '30111111118' && meta.secretRef === REF
    && meta.secretVersion === '1' && meta.configuradoPor === 'Mauro' && !textoMeta.includes(CLAVE) && !('clave' in meta),
  textoMeta.slice(0, 200),
);
check('el secreto es por CUIT de ingreso', REF === 'arca-clave-fiscal-20111111112' && box.viva(REF).length === 1 && box.viva(REF)[0].clave === CLAVE);
check('leer devuelve las otras empresas con su CUIT', Array.isArray(guardado.empresas) && guardado.empresas.length === 2 && guardado.empresas.find((e) => e.empresaId === 'grupos_bacar_sa')?.cuit === '30222222229' && !JSON.stringify(guardado.empresas).includes(CLAVE));
check('audit sin clave y con CUIT enmascarado', box.audits.length === 1 && box.audits[0].action === 'ARCA_CLAVE_GUARDADA' && /\*\*\*112/.test(box.audits[0].details) && !box.audits[0].details.includes(LOGIN));

const extendido = await correr(superAuth, {
  accion: 'guardar', empresaId: 'bacarsa', cuitLogin: LOGIN, cuitRepresentado: '30111111118', clave: CLAVE2,
  extender: [{ empresaId: 'grupos_bacar_sa' }, { empresaId: 'bacarsa', cuitRepresentado: '1' }, { empresaId: 'grupos_bacar_sa' }],
}, box.ports);
const metaG = box.metas.get('grupos_bacar_sa');
check(
  'extender a otra empresa comparte el secreto y toma su CUIT por defecto',
  extendido.extendidas?.length === 1 && metaG?.secretRef === REF && metaG.cuitRepresentado === '30222222229' && metaG.secretVersion === '2'
    && box.metas.get('bacarsa').secretVersion === '2' && box.viva(REF).length === 1 && box.viva(REF)[0].clave === CLAVE2,
  JSON.stringify(metaG),
);
const sinCuit = await falla(correr(superAuth, {
  accion: 'guardar', empresaId: 'bacarsa', cuitLogin: LOGIN, cuitRepresentado: '30111111118', clave: CLAVE2, extender: [{ empresaId: 'pruebas_sa' }],
}, box.ports));
check('extender a una empresa sin CUIT exige el representado', sinCuit instanceof ClaveFiscalError && sinCuit.codigo === 'invalid-argument' && /Pruebas SA/.test(sinCuit.message));
const desconocida = await falla(correr(superAuth, {
  accion: 'guardar', empresaId: 'bacarsa', cuitLogin: LOGIN, cuitRepresentado: '30111111118', clave: CLAVE2, extender: [{ empresaId: 'otra' }],
}, box.ports));
check('extender a una empresa fuera de la plataforma se rechaza', desconocida instanceof ClaveFiscalError && desconocida.codigo === 'invalid-argument');

const reemplazo = await correr(superAuth, { accion: 'reemplazarClave', empresaId: 'grupos_bacar_sa', clave: 'tercera-clave-99' }, box.ports);
check(
  'reemplazar clave pide solo la clave y actualiza a todas las que la comparten',
  reemplazo.configurada === true && reemplazo.afectadas?.length === 2 && box.metas.get('bacarsa').secretVersion === '3' && box.metas.get('grupos_bacar_sa').secretVersion === '3'
    && box.viva(REF)[0].clave === 'tercera-clave-99' && !JSON.stringify(reemplazo).includes('tercera-clave-99'),
);

const lectura = await correr({ uid: 'sa-1', token: { role: 'SUPERADMIN', auth_time: Math.floor(AHORA / 1000) - 7200 } }, { accion: 'leer', empresaId: 'bacarsa' }, box.ports);
check('leer no devuelve la clave aunque el ingreso sea viejo y enmascara', lectura.configurada === true && lectura.cuitLoginEnmascarado === '***112' && lectura.cuitRepresentadoEnmascarado === '***118' && !JSON.stringify(lectura).includes('tercera-clave-99'));

const editado = await correr(superAuth, { accion: 'editarCuits', empresaId: 'grupos_bacar_sa', cuitLogin: '27333333334', cuitRepresentado: '30222222229' }, box.ports);
const refNueva = secretRefDeCuit('27333333334');
check(
  'editar el CUIT de ingreso mueve la clave al secreto nuevo sin pedirla y deja el viejo porque Bacar lo usa',
  editado.cuitLogin === '27333333334' && box.metas.get('grupos_bacar_sa').secretRef === refNueva && box.viva(refNueva)[0]?.clave === 'tercera-clave-99'
    && box.viva(REF).length === 1 && box.audits.some((a) => a.action === 'ARCA_CLAVE_CUIT_EDITADO'),
);
const soloRepresentado = await correr(superAuth, { accion: 'editarCuits', empresaId: 'bacarsa', cuitRepresentado: '30999999990' }, box.ports);
check('editar solo el representado no toca el secreto', soloRepresentado.cuitRepresentado === '30999999990' && box.metas.get('bacarsa').secretVersion === '3' && box.viva(REF).length === 1);

const sinConfirm = await falla(correr(superAuth, { accion: 'quitar', empresaId: 'bacarsa' }, box.ports));
check('quitar sin confirmacion no borra', sinConfirm instanceof ClaveFiscalError && box.metas.has('bacarsa'));
await correr(superAuth, { accion: 'quitar', empresaId: 'bacarsa', confirmar: true }, box.ports);
check('quitar la unica empresa del secreto lo destruye', !box.metas.has('bacarsa') && box.viva(REF).length === 0 && box.audits.some((a) => a.action === 'ARCA_CLAVE_QUITADA' && /destruy/.test(a.details)));

await correr(superAuth, { accion: 'guardar', empresaId: 'bacarsa', cuitLogin: '27333333334', cuitRepresentado: '30111111118', clave: 'cuarta-clave' }, box.ports);
await correr(superAuth, { accion: 'quitar', empresaId: 'bacarsa', confirmar: true }, box.ports);
check('quitar una empresa que comparte el secreto lo deja en pie', box.viva(refNueva).length === 1 && box.metas.get('grupos_bacar_sa').secretVersion === '2' && box.audits.at(-1).details.includes('sigue en uso'));
check('ninguna auditoria ni metadato contiene una clave', ![CLAVE, CLAVE2, 'tercera-clave-99', 'cuarta-clave'].some((c) => (JSON.stringify(box.audits) + JSON.stringify([...box.metas.values()])).includes(c)));

const permiso = await falla(correr(superAuth, { accion: 'guardar', empresaId: 'bacarsa', cuitLogin: LOGIN, cuitRepresentado: '30111111118', clave: CLAVE }, {
  ...mundo().ports,
  store: { async escribir() { const e = new Error('PERMISSION_DENIED'); e.code = 7; throw e; }, async leer() { return ''; }, async destruir() {} },
}));
check('sin permiso de Secret Manager el error es claro', permiso instanceof ClaveFiscalError && /roles\/secretmanager\.admin/.test(permiso.message) && !String(permiso.message).includes(CLAVE));

check('metadatos publicos no copian una clave colada', !JSON.stringify(metaPublica({ cuitLogin: LOGIN, secretVersion: '1', clave: CLAVE })).includes(CLAVE));

let leyo = 0;
const metaOk = { cuitLogin: LOGIN, cuitRepresentado: '30111111118', secretRef: REF, configuradoAt: 'x', configuradoPor: 'Mauro', secretVersion: '4' };
const sinKey = await manejarCredencial({ key: '', expectedKey: 'robot', empresaId: 'bacarsa', nowMs: AHORA, meta: metaOk, leerClave: async () => { leyo += 1; return CLAVE; } });
const malKey = await manejarCredencial({ key: 'otra', expectedKey: 'robot', empresaId: 'bacarsa', nowMs: AHORA, meta: metaOk, leerClave: async () => { leyo += 1; return CLAVE; } });
check('endpoint sin x-arca-key o con otra responde 401 y no lee el secreto', sinKey.status === 401 && malKey.status === 401 && sinKey.body.error === 'NO_AUTORIZADO' && leyo === 0);

const sinMeta = await manejarCredencial({ key: 'robot', expectedKey: 'robot', empresaId: 'bacarsa', nowMs: AHORA + 1, meta: null, leerClave: async () => CLAVE });
check('con clave de robot pero sin configurar responde 403', sinMeta.status === 403 && sinMeta.body.error === 'SIN_CLAVE_FISCAL' && !JSON.stringify(sinMeta.body).includes(CLAVE));

const ok = await manejarCredencial({ key: 'robot', expectedKey: 'robot', empresaId: 'emp-ok-clave', nowMs: AHORA, meta: metaOk, leerClave: async () => CLAVE });
check('con x-arca-key devuelve la clave y la auditoria no la repite', ok.status === 200 && ok.body.clave === CLAVE && ok.body.cuitLogin === LOGIN && ok.audit.action === 'ARCA_CLAVE_LEIDA' && ok.audit.details.includes(REF) && !ok.audit.details.includes(CLAVE));

const negado = await manejarCredencial({
  key: 'robot', expectedKey: 'robot', empresaId: 'emp-permiso', nowMs: AHORA, meta: metaOk,
  leerClave: async () => { const e = new Error('7 PERMISSION_DENIED'); e.code = 7; throw e; },
});
check('leer el secreto sin IAM responde 403 claro', negado.status === 403 && negado.body.error === 'SIN_PERMISO_SECRET_MANAGER' && !JSON.stringify(negado.body).includes(CLAVE));

let rateStatus = 0;
for (let i = 0; i < 7; i += 1) {
  const r = await manejarCredencial({ key: 'robot', expectedKey: 'robot', empresaId: 'emp-rate-clave', nowMs: AHORA, meta: metaOk, leerClave: async () => CLAVE });
  rateStatus = r.status;
}
check('rate limit de credencial al septimo pedido', rateStatus === 429);

check('mismo CUIT entra directo y otro elige representado', planAcceso({ cuitLogin: '30111111118', cuitRepresentado: '30-11111111-8' }).elegirRepresentado === false && planAcceso({ cuitLogin: LOGIN, cuitRepresentado: '30111111118' }).elegirRepresentado === true && formatearCuit(LOGIN) === '20-11111111-2');
check('un error no conserva la clave', sanitizarTexto(`fallo ${CLAVE} en login`, CLAVE) === 'fallo *** en login');

function runRobot(env, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'arca-robot', 'subir.mjs'), ...args], {
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

const pedidos = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  pedidos.push(`${req.method} ${url.searchParams.get('action') || ''}`);
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (url.searchParams.get('action') === 'credencial') {
      res.end(JSON.stringify({ cuitLogin: LOGIN, cuitRepresentado: '30111111118', clave: CLAVE }));
      return;
    }
    res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const sim = await runRobot({
  ARCA_ENVIOS_URL: `http://127.0.0.1:${port}`,
  ARCA_ROBOT_KEY: 'robot-test',
  ARCA_SIMULACION: '1',
}, ['--lote', 'lote_demo_clave', '--tipo', 'AT', '--empresa', 'bacarsa', '--cuit', '30111111118']);
server.close();
check('simulacion no pide la clave ni la imprime', sim.code === 0 && !pedidos.includes('GET credencial') && !sim.out.includes(CLAVE));

assert.equal(secretRefDeCuit('20-11111111-2'), 'arca-clave-fiscal-20111111112');
console.log(failed ? `FALLARON ${failed}` : 'OK arca-clave');
process.exit(failed ? 1 : 0);