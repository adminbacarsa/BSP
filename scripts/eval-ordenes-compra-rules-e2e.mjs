/**
 * Reglas ordenes_compra: admin de la empresa crea y lee su OC; otra empresa no.
 * Emulador Firestore :8080 + Auth :9099.
 *   node scripts/eval-ordenes-compra-rules-e2e.mjs
 */
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
const requireFn = createRequire(new URL('../apps/functions/package.json', import.meta.url));
const requireWeb = createRequire(new URL('../apps/web2/package.json', import.meta.url));
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
const admin = requireFn('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'comtroldata' });

const firebaseAppPath = pathToFileURL(requireWeb.resolve('firebase/app')).href;
const firebaseAuthPath = pathToFileURL(requireWeb.resolve('firebase/auth')).href;
const firebaseFsPath = pathToFileURL(requireWeb.resolve('firebase/firestore')).href;
const { initializeApp, deleteApp } = await import(firebaseAppPath);
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } = await import(firebaseAuthPath);
const {
  getFirestore, connectFirestoreEmulator, doc, getDoc, addDoc, collection, query, where, getDocs,
} = await import(firebaseFsPath);

async function ensureAdmin(email, empresaId) {
  let u;
  try { u = await admin.auth().getUserByEmail(email); }
  catch { u = await admin.auth().createUser({ email, password: 'test1234' }); }
  await admin.auth().setCustomUserClaims(u.uid, { role: 'admin', empresaId });
  await admin.firestore().collection('system_users').doc(u.uid).set({
    uid: u.uid, email, role: 'admin', empresaId,
  });
  return u;
}

const empA = 'e_oc_rules_a';
const empB = 'e_oc_rules_b';
await ensureAdmin('admin-oc-a@test.local', empA);
await ensureAdmin('admin-oc-b@test.local', empB);

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const fsHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const [fsHostname, fsPortRaw] = fsHost.split(':');
const fsPort = Number(fsPortRaw || 8080);

const app = initializeApp({ apiKey: 'fake', authDomain: 'localhost', projectId: 'comtroldata' }, 'oc-rules');
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, fsHostname, fsPort);

let failed = 0;
const expect = async (label, fn, shouldPass) => {
  try {
    await fn();
    console.log(shouldPass ? 'OK' : 'FALLA', `\t${label}\t(permitido)`);
    if (!shouldPass) failed++;
  } catch (e) {
    const denied = e?.code === 'permission-denied';
    console.log(!shouldPass && denied ? 'OK' : 'FALLA', `\t${label}\t(${e?.code || e})`);
    if (shouldPass || !denied) failed++;
  }
};

await signInWithEmailAndPassword(auth, 'admin-oc-a@test.local', 'test1234');
await auth.currentUser.getIdToken(true);

let createdId = '';
await expect('admin A crea OC de su empresa', async () => {
  const ref = await addDoc(collection(db, 'ordenes_compra'), {
    empresaId: empA,
    clientId: 'cli_oc_rules',
    ocNumber: 'OC-TEST-1',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    status: 'ACTIVE',
    authorizedHours: 100,
  });
  createdId = ref.id;
}, true);

await expect('admin A lee su OC', async () => {
  const snap = await getDoc(doc(db, 'ordenes_compra', createdId));
  if (!snap.exists()) throw new Error('missing');
}, true);

await expect('admin A lista OC por empresaId+clientId', async () => {
  const snap = await getDocs(query(
    collection(db, 'ordenes_compra'),
    where('empresaId', '==', empA),
    where('clientId', '==', 'cli_oc_rules'),
  ));
  if (snap.empty) throw new Error('empty');
}, true);

await signOut(auth);
await signInWithEmailAndPassword(auth, 'admin-oc-b@test.local', 'test1234');
await auth.currentUser.getIdToken(true);

await expect('admin B NO lee OC de A', () => getDoc(doc(db, 'ordenes_compra', createdId)), false);

await signOut(auth);
await deleteApp(app);
console.log(`\nfallas: ${failed}`);
process.exit(failed ? 1 : 0);
