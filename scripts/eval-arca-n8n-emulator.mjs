/**
 * Endpoints del robot contra el emulador aislado (no el lab :8080).
 *   firebase emulators:exec --only firestore --config firebase.e2e-p2.json --project demo-arca-n8n "node scripts/eval-arca-n8n-emulator.mjs"
 */
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST.includes(':8080')) {
  console.error('Usar el emulador aislado firebase.e2e-p2.json, no el lab :8080.');
  process.exit(1);
}

process.env.ARCA_ROBOT_KEY = 'e2e-robot-key';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-arca-n8n';
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(process.cwd(), 'no-existe-credencial.json');
process.env.FUNCTIONS_EMULATOR = 'true';

const requireFn = createRequire(path.join(process.cwd(), 'apps/functions/package.json'));
const admin = requireFn('firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const results = [];
function report(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'OK' : 'FALLA'}\t${name}\t${detail || ''}`);
}

class FakeRes extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.body = undefined;
  }
  status(c) { this.statusCode = c; return this; }
  json(b) { this.body = b; return this; }
  setHeader() { return this; }
  getHeader() { return undefined; }
  end() { return this; }
}

function fakeReq({ method = 'GET', query = {}, body = {}, headers = {} }) {
  return {
    method,
    query,
    body,
    headers: { 'user-agent': 'e2e', ...headers },
    ip: '10.1.0.9',
    get: (h) => headers[String(h).toLowerCase()] || '',
  };
}

const KEY = { 'x-arca-key': 'e2e-robot-key' };

async function main() {
  const { arcaEnviosApi } = await import(pathToFileURL(path.join(process.cwd(), 'apps/functions/lib/arca/arcaEnviosApi.js')).href);
  const ahora = Date.now();
  await db.collection('empresas').doc('bacarsa').set({ nombre: 'Bacar SA', cuit: '30-11111111-8' });
  await db.collection('arca_envios').doc('at1').set({
    empresaId: 'bacarsa', tipo: 'AT', estado: 'PENDIENTE', canal: 'LOTE', txt: 'LINEA-1', enviable: true,
    contratoIds: ['c1'], createdAt: admin.firestore.Timestamp.fromMillis(ahora),
  });
  await db.collection('arca_envios').doc('at2').set({
    empresaId: 'bacarsa', tipo: 'AT', estado: 'PENDIENTE', canal: 'LOTE', txt: 'LINEA-2', enviable: true,
    contratoIds: ['c2'], createdAt: admin.firestore.Timestamp.fromMillis(ahora),
  });
  await db.collection('arca_envios').doc('no').set({
    empresaId: 'bacarsa', tipo: 'AT', estado: 'PENDIENTE', canal: 'LOTE', txt: 'LINEA-NO', enviable: false,
    createdAt: admin.firestore.Timestamp.fromMillis(ahora),
  });
  await db.collection('arca_envios').doc('urg').set({
    empresaId: 'bacarsa', tipo: 'AT', estado: 'PENDIENTE', canal: 'URGENTE', txt: 'LINEA-U', enviable: true,
    createdAt: admin.firestore.Timestamp.fromMillis(ahora - 40 * 60 * 1000),
  });
  await db.collection('turnos').doc('t1').set({
    empresaId: 'bacarsa', eventualContratoId: 'c1', eventualAltaArcaConfirmada: false, scheduleDate: '2026-10-06',
  });

  const sin = new FakeRes();
  await arcaEnviosApi(fakeReq({ query: { action: 'lote', tipo: 'AT', canal: 'LOTE' } }), sin);
  report('sin clave 401', sin.statusCode === 401, String(sin.statusCode));

  const lote = new FakeRes();
  await arcaEnviosApi(fakeReq({ query: { action: 'lote', tipo: 'AT', canal: 'LOTE', empresaId: 'bacarsa' }, headers: KEY }), lote);
  const uno = (lote.body?.lotes || [])[0];
  const doc1 = (await db.collection('arca_envios').doc('at1').get()).data();
  report(
    'lote AT por empresa reclama y no incluye el no enviable',
    lote.statusCode === 200 && uno && uno.envioIds.slice().sort().join(',') === 'at1,at2' && uno.txt.split('\n').sort().join(',') === 'LINEA-1,LINEA-2' && uno.cuit === '30111111118' && doc1.estado === 'SUBIENDO' && doc1.loteId === uno.loteId,
    JSON.stringify({ status: lote.statusCode, ids: uno?.envioIds, cuit: uno?.cuit, estado: doc1.estado }),
  );

  const otra = new FakeRes();
  await arcaEnviosApi(fakeReq({ query: { action: 'lote', tipo: 'AT', canal: 'LOTE', empresaId: 'bacarsa' }, headers: KEY }), otra);
  report('el mismo lote no se entrega dos veces', otra.statusCode === 200 && (otra.body?.lotes || []).length === 0, JSON.stringify(otra.body?.lotes || []));

  const conf = new FakeRes();
  await arcaEnviosApi(fakeReq({
    method: 'POST',
    query: { action: 'resultado' },
    headers: KEY,
    body: { loteId: uno.loteId, estado: 'CONFIRMADO', nroTransaccion: '445566', nrosTransaccion: ['445566', '778899'], constanciaUrl: 'https://ejemplo.invalid/acuse' },
  }), conf);
  const d1 = (await db.collection('arca_envios').doc('at1').get()).data();
  const d2 = (await db.collection('arca_envios').doc('at2').get()).data();
  const turno = (await db.collection('turnos').doc('t1').get()).data();
  report(
    'CONFIRMAR el lote aplica el mismo numero a todos',
    conf.statusCode === 200 && d1.estado === 'CONFIRMADO' && d2.estado === 'CONFIRMADO' && d1.nroTransaccion === '445566,778899' && d2.nroTransaccion === '445566,778899' && turno.eventualAltaArcaConfirmada === true,
    `status=${conf.statusCode} n1=${d1.nroTransaccion} n2=${d2.nroTransaccion} fichada=${turno.eventualAltaArcaConfirmada}`,
  );

  const ven = new FakeRes();
  await arcaEnviosApi(fakeReq({ query: { action: 'vencidos', minutos: '30' }, headers: KEY }), ven);
  const ids = (ven.body?.envios || []).map((e) => e.envioId);
  const traeTxt = JSON.stringify(ven.body || {}).includes('LINEA-U');
  report('vencidos lista el urgente de 40 min y no el TXT', ven.statusCode === 200 && ids.join(',') === 'urg' && !traeTxt, ids.join(','));

  const link = new FakeRes();
  await arcaEnviosApi(fakeReq({ method: 'POST', query: { action: 'link-emitir' }, headers: KEY, body: { envioId: 'urg', marcarRespaldo: true } }), link);
  const ven2 = new FakeRes();
  await arcaEnviosApi(fakeReq({ query: { action: 'vencidos', minutos: '30' }, headers: KEY }), ven2);
  report('marcar respaldo no lo vuelve a listar y devuelve link', link.statusCode === 200 && String(link.body?.linkUrl || '').includes('token=') && (ven2.body?.envios || []).length === 0, `status=${link.statusCode}`);

  await db.collection('arca_envios').doc('bt1').set({
    empresaId: 'bacarsa', tipo: 'BT', estado: 'PENDIENTE', canal: 'LOTE', txt: 'BAJA-1', enviable: true,
    createdAt: admin.firestore.Timestamp.fromMillis(ahora),
  });
  const baja = new FakeRes();
  await arcaEnviosApi(fakeReq({ query: { action: 'lote', tipo: 'BT', canal: 'LOTE', empresaId: 'bacarsa' }, headers: KEY }), baja);
  const loteBt = (baja.body?.lotes || [])[0];
  const mal = new FakeRes();
  await arcaEnviosApi(fakeReq({
    method: 'POST', query: { action: 'resultado' }, headers: KEY,
    body: { loteId: loteBt.loteId, estado: 'ERROR', error: 'AFIP_RECHAZO pantalla de login' },
  }), mal);
  const bt = (await db.collection('arca_envios').doc('bt1').get()).data();
  report('ERROR del lote guarda el detalle', mal.statusCode === 200 && bt.estado === 'ERROR' && String(bt.ultimoError).includes('AFIP_RECHAZO'), `${mal.statusCode} ${bt.estado} ${bt.ultimoError}`);

  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `FALLARON ${failed}/${results.length}` : `OK ${results.length}/${results.length}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
