/**
 * Sincroniza custom claims de Auth con system_users (rol + tenant).
 * Uso: node scripts/sync-user-claims.js iranzofer@gmail.com
 * Requiere Application Default Credentials (firebase login / GOOGLE_APPLICATION_CREDENTIALS).
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

function isSuper(role) {
  const r = normalizeRole(role);
  return r === 'SUPERADMIN' || r === 'SUPER_ADMIN' || r === 'SP';
}

function buildClaims(row) {
  const role = normalizeRole(row.role);
  const allEmpresas = isSuper(role) || row.allEmpresas === true;
  const fromMap = row.rolesByEmpresa && typeof row.rolesByEmpresa === 'object' && !Array.isArray(row.rolesByEmpresa)
    ? Object.keys(row.rolesByEmpresa).map((k) => String(k || '').trim()).filter(Boolean)
    : [];
  const fromArr = Array.isArray(row.empresaIds)
    ? row.empresaIds.map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  const ids = [...new Set(fromArr.length ? fromArr : fromMap)];
  const primary = String(row.empresaId ?? '').trim() || ids[0] || '';
  const claims = { role, type: 'SYSTEM', allEmpresas };
  if (!allEmpresas) {
    if (primary) claims.empresaId = primary;
    if (ids.length > 0) claims.empresaIds = ids;
    else if (primary) claims.empresaIds = [primary];
  }
  return claims;
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
  const row = snap.data() || {};
  const claims = buildClaims(row);
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(`OK ${email} uid=${user.uid}`);
  console.log(JSON.stringify(claims, null, 2));
  console.log('Pedile logout/login (refresca el JWT).');
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
