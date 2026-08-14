/**
 * Lee todos los turnos de julio 2026 del projeto y encuentra
 * los que se matchean a CASISA (por nombre/objectiveId) pero NO tienen
 * clientId == CASISA_ID — candidatos a "OBJETIVO SIN NOMBRE".
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'comtroldata', credential: admin.credential.applicationDefault() });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const CLIENT_ID = 'DB8UZxFC4DpqGSQ3o69w';
const CLIENT_NAME_NORM = 'casisa';
const TARGET_OID = '31DrJvGnD2pRSFiusxUF';

const KNOWN_OIDS = new Set([
  '3xqaoEr1npPnCX7q08uq','5XMZ7UuKJEWosCnRhrHz','9CbYIDmsUGnabENKvXZt',
  'AUOMjDCashPHdrTBFef2','C0vVFSwfbUuz5nLbHJFP','cjfbhj8Pz5yqIhc6s2uc',
  'gEFStTLl3AornRIX0kcq','i0P5axzS2wRAlvIfAuc1','I3y36XNAwZJRMl550C6z',
  'L2zXxSy4hWcYIRl4VMUQ','lNJTL47NRCaluny4etzL','mYfci0lv8rKRRQhKwepW',
  'pPXuDgjGTrFEwSeaFc1M',
]);

function norm(s) { return String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').trim(); }
function matchCasisa(data) {
  if (String(data.clientId ?? '').trim() === CLIENT_ID) return 'clientId';
  const clientName = norm(data.clientName || data.client || data.name || '');
  if (clientName && (clientName.includes(CLIENT_NAME_NORM) || CLIENT_NAME_NORM.includes(clientName))) return 'name';
  return null;
}

async function run() {
  const julio2026Start = new Date('2026-07-01T00:00:00-03:00');
  const julio2026End   = new Date('2026-07-31T23:59:59-03:00');

  console.log('\nLeyendo todos los turnos de julio 2026...');
  const snap = await db.collection('turnos')
    .where('startTime', '>=', Timestamp.fromDate(julio2026Start))
    .where('startTime', '<=', Timestamp.fromDate(julio2026End))
    .get();
  console.log(`Total: ${snap.size}`);

  const orphans = [];
  const byOid = new Map();

  snap.docs.forEach((d) => {
    const data = d.data();
    const how = matchCasisa(data);
    if (!how) return;
    const oid = String(data.objectiveId ?? '').trim();
    if (!oid) return;
    if (!byOid.has(oid)) byOid.set(oid, { count: 0, known: KNOWN_OIDS.has(oid), match: how, samples: [] });
    byOid.get(oid).count++;
    if (byOid.get(oid).samples.length < 2) byOid.get(oid).samples.push({ id: d.id, clientId: data.clientId ?? '?', objName: data.objectiveName ?? '', empName: data.employeeName ?? '' });
  });

  console.log('\nObjectiveIds relacionados a CASISA en julio 2026:');
  for (const [oid, info] of [...byOid.entries()].sort((a, b) => (a[1].known ? 1 : -1) - (b[1].known ? 1 : -1))) {
    const tag = oid === TARGET_OID ? ' *** TARGET ***' : (info.known ? ' (conocido)' : ' ⚠ DESCONOCIDO');
    console.log(`  ${tag} ${oid}  (${info.count} turnos, match por ${info.match})`);
    info.samples.forEach(s => console.log(`      ${s.id} | clientId=${s.clientId} | obj="${s.objName}" | emp="${s.empName}"`));
  }

  // También buscar por prefijo
  console.log(`\nBúsqueda por prefijo "31DrJvGnD2pRSF" en turnos de julio:`);
  const prefix = snap.docs.filter(d => String(d.data().objectiveId ?? '').startsWith('31DrJvGnD2pRSF'));
  console.log(`  Resultados: ${prefix.length}`);
  prefix.forEach(d => console.log(`  ${d.id}`, JSON.stringify(d.data()).slice(0, 150)));
}

run().catch((err) => { console.error(err); process.exit(1); });
