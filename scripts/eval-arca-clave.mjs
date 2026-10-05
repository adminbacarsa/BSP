/**
 * Clave fiscal en Secret Manager (mock) y robot en simulacion.
 *   node --experimental-strip-types scripts/eval-arca-clave.mjs
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
  secretIdDe,
} from '../apps/functions/src/arca/arcaClaveFiscal.ts';
import { formatearCuit, planAcceso, sanitizarTexto } from './arca-robot/flujo.mjs';

let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}`);
  if (!ok) failed += 1;
}

const CLAVE = 'zzz-clave-no-log-77';
const AHORA = Date.parse('2031-03-02T15:00:00.000Z');
const AUTH_TIME = Math.floor(AHORA / 1000) - 60;

function mundo() {
  const secretos = new Map();
  const metas = new Map();
  const audits = [];
  const store = {
    async escribir(id, clave) {
      const prev = secretos.get(id) || [];
      const version = String(prev.length + 1);
      secretos.set(id, [...prev.map((v) => ({ ...v, estado: 'DESTROYED' })), { version, clave, estado: 'ENABLED' }]);
      return { version };
    },
    async destruir(id) {
      secretos.set(id, (secretos.get(id) || []).map((v) => ({ ...v, estado: 'DESTROYED' })));
    },
  };
  const ports = {
    lookupRole: async () => 'Operador',
    store,
    meta: {
      async leer(id) { return metas.get(id) || null; },
      async guardar(id, meta) { metas.set(id, meta); },
      async borrar(id) { metas.delete(id); },
    },
    audit: { async add(entry) { audits.push(entry); } },
  };
  return { secretos, metas, audits, ports };
}

const superAuth = { uid: 'sa-1', token: { role: 'SUPERADMIN', auth_time: AUTH_TIME } };
const adminAuth = { uid: 'op-1', token: { role: 'ADMIN', auth_time: AUTH_TIME } };

const denegado = await ejecutarClaveFiscal({
  auth: adminAuth,
  data: { accion: 'guardar', empresaId: 'bacarsa', cuitLogin: '20111111112', cuitRepresentado: '30111111118', clave: CLAVE },
  ahoraMs: AHORA,
  actorName: 'Operador',
}, mundo().ports).then(() => null, (e) => e);
check('sin SuperAdmin no guarda', denegado instanceof ClaveFiscalError && denegado.codigo === 'permission-denied');

const viejo = await ejecutarClaveFiscal({
  auth: { uid: 'sa-1', token: { role: 'SUPERADMIN', auth_time: Math.floor(AHORA / 1000) - 16 * 60 } },
  data: { accion: 'guardar', empresaId: 'bacarsa', cuitLogin: '20111111112', cuitRepresentado: '30111111118', clave: CLAVE },
  ahoraMs: AHORA,
  actorName: 'Mauro',
}, mundo().ports).then(() => null, (e) => e);
check('ingreso viejo no guarda la clave', viejo instanceof ClaveFiscalError && viejo.codigo === 'failed-precondition' && /15 minutos/.test(viejo.message));

const box = mundo();
box.ports.lookupRole = async () => 'SUPERADMIN';
const guardado = await ejecutarClaveFiscal({
  auth: { uid: 'sa-2', token: { role: 'OPERADOR', auth_time: AUTH_TIME } },
  data: { accion: 'guardar', empresaId: 'grupos_bacar_sa', cuitLogin: '20-11111111-2', cuitRepresentado: '30-11111111-8', clave: CLAVE },
  ahoraMs: AHORA,
  actorName: 'Mauro',
}, box.ports);
const meta = box.metas.get('grupos_bacar_sa');
const textoMeta = JSON.stringify(meta) + JSON.stringify(guardado) + JSON.stringify(box.audits);
check('SuperAdmin por rol de sistema guarda metadatos sin la clave', guardado.configurada === true && meta.cuitLogin === '20111111112' && meta.cuitRepresentado === '30111111118' && meta.secretVersion === '1' && meta.configuradoPor === 'Mauro' && !textoMeta.includes(CLAVE) && !('clave' in meta));
check('la clave quedo solo en el secreto y la version anterior se destruye', box.secretos.get(secretIdDe('grupos_bacar_sa'))[0].clave === CLAVE && box.secretos.get(secretIdDe('grupos_bacar_sa'))[0].estado === 'ENABLED');

await ejecutarClaveFiscal({
  auth: superAuth,
  data: { accion: 'guardar', empresaId: 'grupos_bacar_sa', cuitLogin: '20111111112', cuitRepresentado: '30111111118', clave: 'otra-clave-no-log-88' },
  ahoraMs: AHORA,
  actorName: 'Mauro',
}, box.ports);
const versiones = box.secretos.get(secretIdDe('grupos_bacar_sa'));
check('reemplazar destruye la version anterior', versiones.length === 2 && versiones[0].estado === 'DESTROYED' && versiones[1].estado === 'ENABLED' && versiones[1].version === '2' && !JSON.stringify(box.metas.get('grupos_bacar_sa')).includes('otra-clave-no-log-88'));

const lectura = await ejecutarClaveFiscal({
  auth: { uid: 'sa-1', token: { role: 'SUPERADMIN', auth_time: Math.floor(AHORA / 1000) - 3600 } },
  data: { accion: 'leer', empresaId: 'grupos_bacar_sa' },
  ahoraMs: AHORA,
  actorName: 'Mauro',
}, box.ports);
check('leer no devuelve la clave aunque el ingreso sea viejo', lectura.configurada === true && lectura.secretVersion === '2' && !JSON.stringify(lectura).includes('otra-clave-no-log-88') && !JSON.stringify(lectura).includes(CLAVE));

const sinConfirm = await ejecutarClaveFiscal({
  auth: superAuth,
  data: { accion: 'quitar', empresaId: 'grupos_bacar_sa' },
  ahoraMs: AHORA,
  actorName: 'Mauro',
}, box.ports).then(() => null, (e) => e);
check('quitar sin confirmacion no borra', sinConfirm instanceof ClaveFiscalError && box.metas.has('grupos_bacar_sa'));

await ejecutarClaveFiscal({
  auth: superAuth,
  data: { accion: 'quitar', empresaId: 'grupos_bacar_sa', confirmar: true },
  ahoraMs: AHORA,
  actorName: 'Mauro',
}, box.ports);
check('quitar confirmado destruye el secreto y los metadatos', !box.metas.has('grupos_bacar_sa') && box.secretos.get(secretIdDe('grupos_bacar_sa')).every((v) => v.estado === 'DESTROYED') && box.audits.some((a) => a.action === 'ARCA_CLAVE_QUITADA') && !JSON.stringify(box.audits).includes(CLAVE));

const permiso = await ejecutarClaveFiscal({
  auth: superAuth,
  data: { accion: 'guardar', empresaId: 'bacarsa', cuitLogin: '20111111112', cuitRepresentado: '30111111118', clave: CLAVE },
  ahoraMs: AHORA,
  actorName: 'Mauro',
}, {
  ...mundo().ports,
  store: { async escribir() { const e = new Error('PERMISSION_DENIED'); e.code = 7; throw e; }, async destruir() {} },
}).then(() => null, (e) => e);
check('sin permiso de Secret Manager el error es claro', permiso instanceof ClaveFiscalError && /roles\/secretmanager\.admin/.test(permiso.message) && !String(permiso.message).includes(CLAVE));

check('metadatos publicos no copian una clave colada', !JSON.stringify(metaPublica({ cuitLogin: '20111111112', secretVersion: '1', clave: CLAVE })).includes(CLAVE));

let leyo = 0;
const metaOk = { cuitLogin: '20111111112', cuitRepresentado: '30111111118', configuradoAt: 'x', configuradoPor: 'Mauro', secretVersion: '4' };
const sinKey = await manejarCredencial({ key: '', expectedKey: 'robot', empresaId: 'bacarsa', nowMs: AHORA, meta: metaOk, leerClave: async () => { leyo += 1; return CLAVE; } });
const malKey = await manejarCredencial({ key: 'otra', expectedKey: 'robot', empresaId: 'bacarsa', nowMs: AHORA, meta: metaOk, leerClave: async () => { leyo += 1; return CLAVE; } });
check('endpoint sin x-arca-key o con otra responde 401 y no lee el secreto', sinKey.status === 401 && malKey.status === 401 && sinKey.body.error === 'NO_AUTORIZADO' && leyo === 0);

const sinMeta = await manejarCredencial({ key: 'robot', expectedKey: 'robot', empresaId: 'bacarsa', nowMs: AHORA + 1, meta: null, leerClave: async () => CLAVE });
check('con clave de robot pero sin configurar responde 403', sinMeta.status === 403 && sinMeta.body.error === 'SIN_CLAVE_FISCAL' && !JSON.stringify(sinMeta.body).includes(CLAVE));

const ok = await manejarCredencial({ key: 'robot', expectedKey: 'robot', empresaId: 'emp-ok-clave', nowMs: AHORA, meta: metaOk, leerClave: async () => CLAVE });
check('con x-arca-key devuelve la clave y la auditoria no la repite', ok.status === 200 && ok.body.clave === CLAVE && ok.body.cuitLogin === '20111111112' && ok.audit.action === 'ARCA_CLAVE_LEIDA' && !ok.audit.details.includes(CLAVE));

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

check('mismo CUIT entra directo y otro elige representado', planAcceso({ cuitLogin: '30111111118', cuitRepresentado: '30-11111111-8' }).elegirRepresentado === false && planAcceso({ cuitLogin: '20111111112', cuitRepresentado: '30111111118' }).elegirRepresentado === true && formatearCuit('20111111112') === '20-11111111-2');
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
      res.end(JSON.stringify({ cuitLogin: '20111111112', cuitRepresentado: '30111111118', clave: CLAVE }));
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

assert.equal(secretIdDe('grupos_bacar_sa'), 'arca-clave-fiscal-grupos_bacar_sa');
console.log(failed ? `FALLARON ${failed}` : 'OK arca-clave');
process.exit(failed ? 1 : 0);