/**
 * Anulación por el robot: datos del endpoint, simulación SIM-ANUL y fallback a manual.
 *   npm run eval:arca-anulacion
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decidirAnulacion, debeAvisarAnulacion, nroAnulacionSimulado, planRespuestaAnulacion, planTrasError } from '../apps/functions/src/arca/anulacionRobot.ts';
import { bodyAnulacionSimulada, extraerAcuse } from './arca-robot/anular.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = Date.parse('2026-10-05T15:00:00-03:00');
const vence = Date.parse('2026-10-06T00:00:00-03:00');
let failed = 0;
function check(name, ok) {
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}`);
  if (!ok) failed += 1;
}

const base = {
  tipo: 'ANULACION',
  estado: 'PENDIENTE',
  bolsaCuil: '20-11111111-2',
  fechaInicio: '2026-10-05',
  nroTransaccionAlta: '778899',
  empresaId: 'bacarsa',
  venceAnulacionMs: vence,
};

check('entrar en PENDIENTE avisa el webhook', debeAvisarAnulacion(null, base));
check('seguir en PENDIENTE no reavisa', !debeAvisarAnulacion(base, { ...base, intentos: [] }));
check('un AT urgente no es anulación', !debeAvisarAnulacion(null, { tipo: 'AT', estado: 'PENDIENTE', canal: 'URGENTE' }));

const listo = planRespuestaAnulacion(base, { nowMs: now, envioId: 'env-1', cuitRepresentado: '30712345678' });
check('GET anulación devuelve CUIL, fecha y representado', listo.status === 200
  && listo.body.cuil === '20111111112'
  && listo.body.fechaInicio === '20261005'
  && listo.body.nroTransaccionAlta === '778899'
  && listo.body.cuitRepresentado === '30712345678'
  && listo.patch.estado === 'SUBIENDO');

const corto = planRespuestaAnulacion(base, { nowMs: vence - 60 * 60 * 1000, envioId: 'env-1', cuitRepresentado: '30712345678' });
check('a menos de 2 h queda MANUAL', corto.status === 409 && corto.body.motivo === 'MENOS_DE_2H' && corto.patch.estado === 'MANUAL' && corto.avisar);

const cansado = planRespuestaAnulacion({ ...base, fallosRobot: 2 }, { nowMs: now, envioId: 'env-1', cuitRepresentado: '30712345678' });
check('dos fallos del robot quedan MANUAL', cansado.body.motivo === 'ROBOT_FALLO_2' && cansado.avisar);

const vencido = planRespuestaAnulacion(base, { nowMs: vence + 1000, envioId: 'env-1', cuitRepresentado: '30712345678' });
check('plazo vencido no pisa la baja código 30', vencido.body.error === 'PLAZO_VENCIDO' && vencido.patch === null);

const incompleto = planRespuestaAnulacion({ ...base, bolsaCuil: '' }, { nowMs: now, envioId: 'env-1', cuitRepresentado: '30712345678' });
check('sin CUIL pasa a manual', incompleto.body.motivo === 'FALTAN_DATOS');

const unFallo = planTrasError(base, now, 1);
check('el primer error reintenta', unFallo.estado === 'PENDIENTE' && unFallo.fallosRobot === 1);
const dosFallos = planTrasError(base, now, 2);
check('el segundo error es manual', dosFallos.estado === 'MANUAL' && dosFallos.motivo === 'ROBOT_FALLO_2');
check('poco plazo en el error también es manual', planTrasError(base, vence - 30 * 60 * 1000, 1).motivo === 'MENOS_DE_2H');
check('con plazo no manda al robot si ya es manual', decidirAnulacion({ ...base, estado: 'MANUAL', manualMotivo: 'MENOS_DE_2H' }, now).accion === 'MANUAL');

check('simulación arma SIM-ANUL', nroAnulacionSimulado('envio_abc123xyz').startsWith('SIM-ANUL-') && bodyAnulacionSimulada('envio_abc').estado === 'ANULADO');
check('lee el acuse de la pantalla', extraerAcuse('Constancia. Acuse de anulación 44556677') === '44556677');

function escuchar() {
  const hits = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      hits.push({ url: req.url, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, hits, port: server.address().port }));
  });
}

function correr(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/arca-robot/subir.mjs', ...args], {
      cwd: root,
      env: { ...process.env, ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

const srv = await escuchar();
const sim = await correr(
  ['--modo', 'anular', '--envio', 'envioSIM9988', '--empresa', 'bacarsa'],
  {
    ARCA_SIMULACION: '1',
    ARCA_ENVIOS_URL: `http://127.0.0.1:${srv.port}`,
    ARCA_ROBOT_KEY: 'test-key',
  },
);
check('simulación no pide la clave ni entra a ARCA', sim.code === 0 && !srv.hits.some((h) => h.url.includes('credencial')) && sim.out.includes('SIM-ANUL-'));
const post = srv.hits.find((h) => h.url.includes('action=resultado'));
const posted = post ? JSON.parse(post.body) : {};
check('simulación confirma ANULADO con el acuse', posted.estado === 'ANULADO' && String(posted.acuse || '').startsWith('SIM-ANUL-') && posted.envioId === 'envioSIM9988');

const explorar = await correr(['--modo', 'explorar', '--envio', 'envioSIM9988', '--empresa', 'bacarsa'], {
  ARCA_SIMULACION: '1',
  ARCA_ENVIOS_URL: `http://127.0.0.1:${srv.port}`,
  ARCA_ROBOT_KEY: 'test-key',
});
check('explorar en simulación no confirma', explorar.code === 0 && explorar.out.includes('ARCA_SIMULACION') && srv.hits.length === 1);
srv.server.close();

if (failed) {
  console.error(`FALLARON ${failed}`);
  process.exit(1);
}
console.log('eval-arca-anulacion OK');
