/**
 * Borra una NVR y todos sus canales para poder cargarla de nuevo desde cero (nvrOnboard).
 * Uso: desde apps/functions  ->  node scripts/borrar-nvr.js <nvr_id>
 * Ejemplo: node scripts/borrar-nvr.js 8F0001CPAZ21EFD
 *
 * Requiere: GOOGLE_APPLICATION_CREDENTIALS con acceso a Firestore, o ejecutar en un entorno GCP con cuenta por defecto.
 */
const admin = require('firebase-admin');

const nvrId = process.argv[2] && process.argv[2].trim();
if (!nvrId) {
  console.error('Uso: node scripts/borrar-nvr.js <nvr_id>');
  console.error('Ejemplo: node scripts/borrar-nvr.js 8F0001CPAZ21EFD');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'comtroldata' });
}
const db = admin.firestore();

async function main() {
  const nvrRef = db.collection('nvr_devices').doc(nvrId);
  const nvrSnap = await nvrRef.get();
  if (!nvrSnap.exists) {
    console.log('No existe nvr_devices/' + nvrId + '. Nada que borrar.');
    process.exit(0);
    return;
  }

  // 1) Borrar todos los camera_routes de esta NVR (por nvr_serial)
  const routesSnap = await db.collection('camera_routes').where('nvr_serial', '==', nvrId).get();
  const batch = db.batch();
  routesSnap.docs.forEach((d) => batch.delete(d.ref));
  if (routesSnap.size > 0) {
    await batch.commit();
    console.log('Borrados', routesSnap.size, 'canales (camera_routes) de nvr_serial', nvrId);
  } else {
    console.log('No había documentos en camera_routes con nvr_serial', nvrId);
  }

  // 2) Borrar el documento de la NVR
  await nvrRef.delete();
  console.log('Borrado nvr_devices/' + nvrId);
  console.log('Listo. Podés volver a registrar la NVR con registrar-nvr.ps1 (o nvrOnboard).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
