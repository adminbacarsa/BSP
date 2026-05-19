/**
 * Sincroniza custom claims de Auth con system_users.role en producción.
 * Uso: node scripts/sync-user-claims.js implementaciones.it@bacarsa.com.ar
 * Requiere GOOGLE_APPLICATION_CREDENTIALS o firebase login + proyecto comtroldata.
 */
const admin = require('firebase-admin');

const email = process.argv[2];
if (!email) {
  console.error('Uso: node scripts/sync-user-claims.js <email>');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'comtroldata' });
}

function normalizeRole(role) {
  return String(role ?? '').trim().toUpperCase().replace(/\s+/g, '_');
}

(async () => {
  const auth = admin.auth();
  const db = admin.firestore();
  const user = await auth.getUserByEmail(email);
  const snap = await db.collection('system_users').doc(user.uid).get();
  if (!snap.exists) {
    console.error(`No hay system_users/${user.uid} para ${email}`);
    process.exit(1);
  }
  const role = normalizeRole(snap.data().role);
  await auth.setCustomUserClaims(user.uid, { role, type: 'SYSTEM' });
  console.log(`OK ${email} uid=${user.uid} role=${role} type=SYSTEM`);
  console.log('Pedile al usuario que cierre sesión y vuelva a entrar (o F5 tras unos segundos).');
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
