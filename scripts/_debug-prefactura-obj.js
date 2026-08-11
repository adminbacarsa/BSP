/**
 * Busca en Firestore todos los turnos de julio 2026 con un objectiveId
 * que empiece con "31Dr" (el que aparece como "OBJETIVO SIN NOMBRE").
 * Uso: node scripts/_debug-prefactura-obj.js
 */
const admin = require('firebase-admin');
const { Timestamp } = admin.firestore;

admin.initializeApp({
  projectId: 'comtroldata',
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

async function run() {
  const env = process.env.FIRESTORE_EMULATOR_HOST
    ? `EMULADOR (${process.env.FIRESTORE_EMULATOR_HOST})`
    : 'PRODUCCIÓN';
  console.log(`Entorno: ${env}\n`);

  const start = new Date('2026-07-01T00:00:00-03:00');
  const end   = new Date('2026-08-01T00:00:00-03:00');

  // Todos los turnos de julio 2026
  const snap = await db.collection('turnos')
    .where('startTime', '>=', Timestamp.fromDate(start))
    .where('startTime', '<', Timestamp.fromDate(end))
    .get();

  console.log(`Turnos julio 2026: ${snap.size}`);

  // Agrupa por objectiveId
  const byOid = new Map();
  snap.docs.forEach((doc) => {
    const d = doc.data();
    const oid = d.objectiveId ?? '(vacío)';
    if (!byOid.has(oid)) byOid.set(oid, { count: 0, names: new Set(), clients: new Set() });
    const g = byOid.get(oid);
    g.count++;
    if (d.objectiveName) g.names.add(d.objectiveName);
    if (d.clientId) g.clients.add(d.clientId);
  });

  // Muestra todos los objectiveIds únicos de julio 2026
  console.log('\nObjectiveIds distintos en julio 2026:');
  for (const [oid, g] of [...byOid.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const names = [...g.names].join(', ') || '(sin nombre)';
    const clients = [...g.clients].join(', ') || '?';
    console.log(`  ${oid}  | ${g.count} turnos | clientId(s): ${clients} | nombre(s): ${names}`);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
