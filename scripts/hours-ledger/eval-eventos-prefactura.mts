/**
 * Prefactura de eventos: horas vendidas, no fichadas ni TURA/EV.
 *   npx tsx --conditions=development --tsconfig apps/web2/tsconfig.json scripts/hours-ledger/eval-eventos-prefactura.mts
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const envFile = path.resolve('apps/web2/.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m || process.env[m[1].trim()]) continue;
    process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
  }
}
process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= 'AIzaSyDummyKeyForEvalEventosPrefactura01';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= 'comtroldata';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= 'comtroldata.firebaseapp.com';
process.env.NEXT_PUBLIC_USE_EMULATOR = 'false';
delete process.env.FIRESTORE_EMULATOR_HOST;

const { buildEventosPrefactura } = await import('../../apps/web2/src/lib/crm/eventosProforma.ts');
const { isEventosPositionName } = await import('../../apps/web2/src/lib/servicios/eventosPosition.ts');
const { calcRefuerzoHorasVendidas } = await import('../../apps/web2/src/lib/refuerzo/refuerzoProforma.ts');
type Evento = import('../../apps/web2/src/services/eventoService.ts').Evento;

const fixture = buildEventosPrefactura({
  eventos: [{
    id: 'e1',
    empresaId: 'x',
    nombre: 'Fiesta',
    clienteId: 'c',
    clienteNombre: 'C',
    fecha: '2026-09-08',
    status: 'activo',
    servicios: [{
      id: 's1',
      nombre: 'Día',
      fecha: '2026-09-08',
      tipoTurno: 'libre',
      horaInicio: '08:00',
      horaFin: '20:00',
      horasTotal: 12,
      ubicacion: { tipo: 'nueva' },
      cupo: 3,
      status: 'pendiente',
      horasVendidas: 24,
    }],
  }],
  turnos: [
    { code: 'EV', eventoId: 'e1', clientId: 'c', hours: 8, isPresent: true, isCompleted: true, startTime: '2026-09-08T11:00:00.000Z', realStartTime: '2026-09-08T11:00:00.000Z', realEndTime: '2026-09-08T19:00:00.000Z' },
    { code: 'TURA', positionName: 'Eventos', hours: 4, startTime: '2026-09-08T11:00:00.000Z' },
  ],
  clientId: 'c',
  startYmd: '2026-09-01',
  endYmd: '2026-09-30',
});
if (fixture.length !== 1 || fixture[0].totalHoras !== 24) {
  throw new Error(`fixture factura ${fixture[0]?.totalHoras} != 24 (horas vendidas)`);
}
if (fixture[0].dias.length !== 1) throw new Error('fixture debe ser un renglón por día');
if (!(fixture[0].horasTrabajadas > 0) || fixture[0].horasTrabajadas === fixture[0].totalHoras) {
  throw new Error(`trabajadas deben verse aparte, no facturarse: ${fixture[0].horasTrabajadas}`);
}
console.log('FIXTURE_OK', fixture[0].totalHoras, 'vendidas', fixture[0].horasTrabajadas, 'trabajadas');

process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||= 'h2-readonly';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||= 'comtroldata';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||= 'comtroldata.firebaseapp.com';
delete process.env.FIRESTORE_EMULATOR_HOST;

const repo = path.resolve('C:/APP/cronoapp-planificacion');
const requireFn = createRequire(path.join(repo, 'apps/functions/package.json'));
const admin = requireFn('firebase-admin');
const { DocumentReference, WriteBatch, CollectionReference, Firestore } = admin.firestore;
const deny = (what: string) => function denied() { throw new Error(`escritura bloqueada (${what})`); };
for (const m of ['set', 'update', 'delete', 'create']) DocumentReference.prototype[m] = deny(m);
CollectionReference.prototype.add = deny('add');
WriteBatch.prototype.commit = deny('batch');
Firestore.prototype.runTransaction = deny('tx');
Firestore.prototype.recursiveDelete = deny('recursiveDelete');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'comtroldata' });
}
const db = admin.firestore();
const start = new Date('2026-09-01T00:00:00.000-03:00');
const end = new Date('2026-09-30T23:59:59.999-03:00');
const [turnosSnap, eventosSnap, solSnap] = await Promise.all([
  db.collection('turnos')
    .where('empresaId', '==', 'pruebas_sa')
    .where('startTime', '>=', admin.firestore.Timestamp.fromDate(start))
    .where('startTime', '<=', admin.firestore.Timestamp.fromDate(end))
    .get(),
  db.collection('eventos')
    .where('empresaId', '==', 'pruebas_sa')
    .where('fecha', '>=', '2026-06-01')
    .where('fecha', '<=', '2026-09-30')
    .get(),
  db.collection('solicitudes_refuerzo').where('empresaId', '==', 'pruebas_sa').get(),
]);

const turnos = turnosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
const eventos = eventosSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Evento[];
const sols = solSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];

const inSept = (ymd: string) => ymd >= '2026-09-01' && ymd <= '2026-09-30';
const r1 = (n: number) => Math.round(n * 10) / 10;

let antesEv = 0;
let antesEvCount = 0;
let antesTuraTurno = 0;
for (const t of turnos as any[]) {
  const code = String(t.code || '').toUpperCase();
  if (code === 'EV') {
    antesEv += Number(t.hours) || 0;
    antesEvCount += 1;
  }
  if (code === 'TURA' && isEventosPositionName(t.positionName)) antesTuraTurno += Number(t.hours) || 0;
}
let antesTuraSol = 0;
let antesTuraSolCount = 0;
for (const sol of sols) {
  if (String(sol.tipo || '') !== 'AGREGADO_TURNO') continue;
  if (!isEventosPositionName(sol.positionName)) continue;
  if (!inSept(String(sol.fecha || '').slice(0, 10))) continue;
  if (!['APROBADA', 'ASIGNADA', 'COMPLETADA'].includes(String(sol.estado || ''))) continue;
  antesTuraSol += calcRefuerzoHorasVendidas(sol);
  antesTuraSolCount += 1;
}

const despues = buildEventosPrefactura({
  eventos,
  turnos,
  clientId: '',
  startYmd: '2026-09-01',
  endYmd: '2026-09-30',
});
const vendidas = r1(despues.reduce((a, e) => a + e.totalHoras, 0));
const trabajadas = r1(despues.reduce((a, e) => a + e.horasTrabajadas, 0));
const dias = despues.reduce((a, e) => a + e.dias.length, 0);
const conCampo = eventos.filter((ev) => (ev.servicios || []).some((s) => inSept(String(s.fecha || '')) && Number(s.horasVendidas) > 0)).length;

console.log(JSON.stringify({
  antes: {
    evPlanificado: r1(antesEv),
    evTurnos: antesEvCount,
    turaPuestoEventosTurnos: r1(antesTuraTurno),
    turaPuestoEventosSolicitudes: r1(antesTuraSol),
    turaSolicitudes: antesTuraSolCount,
    facturadoEventos: r1(antesEv + antesTuraSol),
  },
  despues: {
    horasVendidas: vendidas,
    horasTrabajadasInformativas: trabajadas,
    eventos: despues.length,
    dias,
    eventosConHorasVendidas: conCampo,
  },
}, null, 2));
if (vendidas !== 0 && conCampo === 0) throw new Error('facturó horas sin campo horasVendidas');
console.log('EVENTOS_PREFACTURA_OK');
