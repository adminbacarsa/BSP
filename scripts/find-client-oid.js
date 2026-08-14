const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'comtroldata', credential: admin.credential.applicationDefault() });
const db = admin.firestore();

async function run() {
  const TARGET = '31DrJvGnD2pRSFiusxUF';
  const CLIENT_ID = 'DB8UZxFC4DpqGSQ3o69w';

  // Cliente CASISA
  const clientDoc = await db.collection('clients').doc(CLIENT_ID).get();
  const data = clientDoc.data();
  const objetivos = data?.objetivos || [];
  console.log(`\nCASISA objetivos[]: ${objetivos.length}`);
  objetivos.forEach((o) => {
    const match = o.id === TARGET || o.objectiveId === TARGET;
    console.log(`  ${match ? '⚠ MATCH' : '  '} id=${o.id ?? '?'} | name="${o.name ?? ''}" | objectiveId=${o.objectiveId ?? '(no campo)'}`);
  });

  // Buscar en toda la colección clients si algún objetivo tiene ese ID
  console.log('\n--- Búsqueda en todos los clients ---');
  const allClients = await db.collection('clients').get();
  allClients.docs.forEach((d) => {
    const objs = d.data().objetivos || [];
    objs.forEach((o) => {
      if (o.id === TARGET || o.objectiveId === TARGET) {
        console.log(`MATCH en client ${d.id} | name="${d.data().name}" | obj id=${o.id} name="${o.name}"`);
      }
    });
  });
  console.log('Búsqueda en clients completa.');
}

run().catch((err) => { console.error(err); process.exit(1); });
