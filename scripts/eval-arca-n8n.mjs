/**
 * Reglas del lote, del aviso urgente y del robot (simulacion, sin ARCA y sin clave fiscal).
 *   npm run eval:arca-n8n
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { armarLotes, esUrgenteVencido, LOTE_RECLAMO_STALE_MS } from '../apps/functions/src/arca/arcaEnviosCore.ts';
import { debeAvisarUrgente, notificarUrgenteN8n } from '../apps/functions/src/arca/notificarUrgenteN8n.ts';
import { claveDeCuit, clavesPathSeguro, esSimulacion, extraerNros, nroSimulado, parseArgs } from './arca-robot/flujo.mjs';

const now = Date.parse('2026-10-05T21:00:00.000Z');
let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}`);
  if (!ok) failed += 1;
}

const envios = [
  { id: 'a', empresaId: 'bacarsa', tipo: 'AT', estado: 'PENDIENTE', canal: 'LOTE', txt: 'LINEA-A', enviable: true },
  { id: 'b', empresaId: 'bacarsa', tipo: 'AT', estado: 'PENDIENTE', canal: 'LOTE', txt: 'LINEA-B', enviable: true },
  { id: 'u', empresaId: 'bacarsa', tipo: 'AT', estado: 'PENDIENTE', canal: 'URGENTE', txt: 'LINEA-U', enviable: true },
  { id: 'o', empresaId: 'grupos_bacar_sa', tipo: 'AT', estado: 'PENDIENTE', canal: 'LOTE', txt: 'LINEA-O', enviable: true },
  { id: 'q', empresaId: 'bacarsa', tipo: 'AT', estado: 'PENDIENTE', canal: 'LOTE', txt: 'LINEA-Q', quitadoDelLote: true, enviable: true },
  { id: 'x', empresaId: 'bacarsa', tipo: 'AT', estado: 'PENDIENTE', canal: 'LOTE', txt: 'LINEA-X', enviable: false },
  { id: 'e', empresaId: 'bacarsa', tipo: 'AT', estado: 'ERROR', canal: 'LOTE', txt: 'LINEA-E', enviable: true },
  { id: 's', empresaId: 'bacarsa', tipo: 'AT', estado: 'SUBIENDO', canal: 'LOTE', txt: 'LINEA-S', enviable: true, loteReclamadoAtMs: now - 60_000 },
  { id: 'v', empresaId: 'bacarsa', tipo: 'AT', estado: 'SUBIENDO', canal: 'LOTE', txt: 'LINEA-V', enviable: true, loteReclamadoAtMs: now - LOTE_RECLAMO_STALE_MS - 1000 },
];
const lote = armarLotes(envios, { tipo: 'AT', canal: 'LOTE', empresaId: 'bacarsa' }, now);
check('lote AT agrupa la empresa y deja afuera urgente, otra empresa, quitado y no enviable', lote.length === 1 && lote[0].envioIds.join(',') === 'a,b,e,v' && lote[0].txt === 'LINEA-A\nLINEA-B\nLINEA-E\nLINEA-V');
const urg = armarLotes(envios, { tipo: 'AT', canal: 'URGENTE' }, now);
check('urgente es su propio lote', urg.length === 1 && urg[0].envioIds.join(',') === 'u');
check('bajas no mezclan altas', armarLotes(envios, { tipo: 'BT', canal: 'LOTE' }, now).length === 0);

check('vencido a los 30 min', esUrgenteVencido({ canal: 'URGENTE', tipo: 'AT', estado: 'PENDIENTE', createdAtMs: now - 31 * 60_000 }, now, 30));
check('no vencido antes de N', !esUrgenteVencido({ canal: 'URGENTE', tipo: 'BT', estado: 'ERROR', createdAtMs: now - 10 * 60_000 }, now, 30));
check('confirmado y lote programado no son respaldo', !esUrgenteVencido({ canal: 'URGENTE', tipo: 'AT', estado: 'CONFIRMADO', createdAtMs: now - 90 * 60_000 }, now, 30) && !esUrgenteVencido({ canal: 'LOTE', tipo: 'AT', estado: 'PENDIENTE', createdAtMs: now - 90 * 60_000 }, now, 30));
check('ya avisado no vuelve a salir', !esUrgenteVencido({ canal: 'URGENTE', tipo: 'AT', estado: 'PENDIENTE', createdAtMs: now - 90 * 60_000, respaldoAvisadoAt: 'x' }, now, 30));

check('alta nueva urgente avisa', debeAvisarUrgente(null, { tipo: 'AT', canal: 'URGENTE', estado: 'PENDIENTE' }));
check('correccion del mismo urgente no reavisa', !debeAvisarUrgente({ tipo: 'AT', canal: 'URGENTE', estado: 'PENDIENTE' }, { tipo: 'AT', canal: 'URGENTE', estado: 'SUBIENDO' }));
check('pasar de LOTE a URGENTE avisa', debeAvisarUrgente({ tipo: 'AT', canal: 'LOTE', estado: 'PENDIENTE' }, { tipo: 'AT', canal: 'URGENTE', estado: 'PENDIENTE' }));
check('anulacion no dispara el robot', !debeAvisarUrgente(null, { tipo: 'ANULACION', canal: 'URGENTE', estado: 'PENDIENTE' }));

const prevUrl = process.env.ARCA_N8N_URGENTE_URL;
const prevKey = process.env.ARCA_ROBOT_KEY;
delete process.env.ARCA_N8N_URGENTE_URL;
check('sin URL no llama a nadie', await notificarUrgenteN8n({ empresaId: 'bacarsa', tipo: 'AT', envioIds: ['a'] }) === 'omitido');
process.env.ARCA_N8N_URGENTE_URL = 'http://n8n.local/webhook/urgente';
process.env.ARCA_ROBOT_KEY = 'k-test';
let visto = null;
const okFetch = async (url, init) => {
  visto = { url, init: { ...init, body: JSON.parse(init.body) } };
  return { ok: true, status: 200 };
};
const aviso = await notificarUrgenteN8n({ empresaId: 'bacarsa', tipo: 'BT', envioIds: ['b'], fetchImpl: okFetch });
check('POST urgente al webhook', aviso === 'ok' && visto.init.body.canal === 'URGENTE' && visto.init.body.tipo === 'BT' && visto.init.headers['x-arca-key'] === 'k-test' && !JSON.stringify(visto).includes('claveFiscal'));
if (prevUrl === undefined) delete process.env.ARCA_N8N_URGENTE_URL; else process.env.ARCA_N8N_URGENTE_URL = prevUrl;
if (prevKey === undefined) delete process.env.ARCA_ROBOT_KEY; else process.env.ARCA_ROBOT_KEY = prevKey;

check('extrae uno o varios numeros de transaccion', extraerNros('Numero de transaccion: 0012345678').join(',') === '0012345678' && extraerNros('transacción 11111111 y transacción 22222222').join(',') === '11111111,22222222');
check('simulacion configurable', esSimulacion({ ARCA_SIMULACION: '1' }) && !esSimulacion({ ARCA_SIMULACION: '0' }));
check('clave por CUIT sin guiones', claveDeCuit({ '30111111118': 'no-log' }, '30-11111111-8') === 'no-log' && claveDeCuit({}, '30111111118') === '');
assert.throws(() => clavesPathSeguro(path.join(os.tmpdir(), 'repo', 'claves.json'), path.join(os.tmpdir(), 'repo')), /DENTRO_DEL_REPO/);
check('args del robot', parseArgs(['--lote', 'L1', '--tipo', 'AT']).lote === 'L1');
check('nro simulado estable', nroSimulado('lote_bacarsa_AT_99') === 'SIM-bacarsaAT99' || nroSimulado('lote_bacarsa_AT_99').startsWith('SIM-'));

function runRobot(env, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'arca-robot', 'subir.mjs'), ...args], { env: { ...process.env, ...env }, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    server.last = { key: req.headers['x-arca-key'], body: JSON.parse(raw || '{}') };
    res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const baseEnv = { ARCA_ENVIOS_URL: `http://127.0.0.1:${port}`, ARCA_ROBOT_KEY: 'robot-test', ARCA_SIMULACION: '1' };
const sim = await runRobot(baseEnv, ['--lote', 'lote_demo_1', '--tipo', 'AT', '--empresa', 'bacarsa', '--cuit', '30111111118']);
check('simulacion deja ENVIADO sin abrir ARCA', sim.code === 0 && server.last.body.estado === 'ENVIADO' && String(server.last.body.nroTransaccion).startsWith('SIM-') && server.last.key === 'robot-test');

const fuera = path.join(os.tmpdir(), `arca-claves-test-${process.pid}.json`);
fs.writeFileSync(fuera, JSON.stringify({ '30999999990': 'no-usar' }));
const falta = await runRobot({ ...baseEnv, ARCA_SIMULACION: '0', ARCA_CLAVES_PATH: fuera, COSP_REPO: path.join(os.tmpdir(), 'otro-repo') }, ['--lote', 'lote_demo_2', '--tipo', 'BT', '--cuit', '30111111118', '--empresa', 'bacarsa']);
check('sin clave de ese CUIT marca ERROR y no imprime la clave', falta.code === 0 && server.last.body.estado === 'ERROR' && server.last.body.error === 'FALTA_CLAVE_FISCAL' && !falta.out.includes('no-usar'));
fs.unlinkSync(fuera);
server.close();

console.log(failed ? `FALLARON ${failed}` : 'OK arca-n8n');
process.exit(failed ? 1 : 0);