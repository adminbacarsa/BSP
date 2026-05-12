/**
 * Seed Firestore para el demo NVR AI Alert.
 * Crea: nvr_config/webhook, camera_routes/default__2
 * Opcional: guard_tokens y active_assignments de prueba.
 */
const path = require('path');
const admin = require('firebase-admin');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  let config;
  try {
    config = require(configPath);
  } catch (e) {
    const example = path.join(__dirname, 'config.example.json');
    console.error('Crea config.json (copia config.example.json y ajusta). Ejemplo:', example);
    process.exit(1);
  }
  return config;
}

async function seed() {
  const config = loadConfig();
  const { projectId, secret, channelId, cameraName, objectiveId, postId, serviceAccountPath } = config;

  const saPath = path.isAbsolute(serviceAccountPath)
    ? serviceAccountPath
    : path.join(PROJECT_ROOT, serviceAccountPath || 'service-account.json');

  if (!admin.apps.length) {
    let cred;
    try {
      cred = admin.credential.cert(require(saPath));
    } catch (e) {
      try {
        cred = admin.credential.applicationDefault();
        console.log('Usando credenciales por defecto (gcloud auth application-default login).');
      } catch (e2) {
        console.error('Error: Revisa serviceAccountPath o ejecuta: gcloud auth application-default login');
        process.exit(1);
      }
    }
    try {
      admin.initializeApp({ credential: cred, projectId });
    } catch (e) {
      console.error('Error inicializando Firebase Admin:', e.message);
      process.exit(1);
    }
  }

  const db = admin.firestore();

  console.log('1. Escribiendo nvr_config/webhook (secret)...');
  await db.doc('nvr_config/webhook').set(
    { secret: secret || '123456', updated_at: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  const routeId = `default__${channelId ?? 2}`;
  console.log('2. Escribiendo camera_routes/' + routeId + '...');
  await db.collection('camera_routes').doc(routeId).set(
    {
      enabled: true,
      camera_name: cameraName || 'Entrada Principal',
      objective_id: objectiveId || 'OBJ_PILOTO',
      post_id: postId || 'PUESTO_ENTRADA',
      event_type: 'Tripwire',
    },
    { merge: true }
  );

  console.log('3. Seed listo. Opcional: agrega guard_tokens y active_assignments desde la consola.');
}

seed().then(() => {
  console.log('OK Seed completado.');
  process.exit(0);
}).catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
