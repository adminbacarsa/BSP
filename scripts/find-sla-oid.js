/**
 * Busca el objectiveId huérfano en servicios_sla de CASISA.
 */
const admin = require('firebase-admin');

admin.initializeApp({
  projectId: 'comtroldata',
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();
const TARGET = '31DrJvGnD2pRSFiusxUF';
const CLIENT_ID = 'DB8UZxFC4DpqGSQ3o69w';

async function run() {
  // Buscar en servicios_sla por clientId CASISA
  const snap = await db.collection('servicios_sla')
    .where('clientId', '==', CLIENT_ID)
    .get();

  console.log(`\nSLAs de CASISA: ${snap.size}`);
  snap.docs.forEach((d) => {
    const data = d.data();
    const oid = String(data.objectiveId ?? '').trim();
    const match = oid === TARGET || d.id === TARGET;
    console.log(`  ${match ? '⚠ MATCH' : '  '} id=${d.id} | oid=${oid} | obj="${data.objectiveName ?? ''}" | start=${data.startDate ?? '?'} | end=${data.endDate ?? '?'}`);
  });

  // Buscar directamente por objectiveId
  console.log('\n--- Búsqueda directa por objectiveId en servicios_sla ---');
  const byOid = await db.collection('servicios_sla')
    .where('objectiveId', '==', TARGET)
    .get();
  console.log(`Resultados: ${byOid.size}`);
  byOid.docs.forEach((d) => console.log(`  id=${d.id}`, JSON.stringify(d.data()).slice(0, 200)));

  // Buscar por doc ID
  console.log('\n--- Doc con ID == TARGET en servicios_sla ---');
  const byDocId = await db.collection('servicios_sla').doc(TARGET).get();
  if (byDocId.exists) {
    console.log('Encontrado:', JSON.stringify(byDocId.data()).slice(0, 300));
  } else {
    console.log('No existe doc con ese ID en servicios_sla');
  }
}

run().catch((err) => { console.error('Error:', err); process.exit(1); });
