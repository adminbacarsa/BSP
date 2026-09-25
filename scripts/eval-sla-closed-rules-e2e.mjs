/**
 * Reglas servicios_sla: contrato cerrado solo lo modifica SuperAdmin (emulador :8080 + :9099).
 *   npm run seed  (admin@bacarsa.com.ar SuperAdmin)
 *   node scripts/eval-sla-closed-rules-e2e.mjs
 */
import { createRequire } from 'module';
const requireFn = createRequire(new URL('../apps/functions/package.json', import.meta.url));
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
const admin = requireFn('firebase-admin');
admin.initializeApp({ projectId: 'comtroldata' });
const { initializeApp } = await import('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } = await import('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, updateDoc } = await import('firebase/firestore');

const emp = 'e_rules_sla';
const email = 'admin-rules-sla@test.local';
let u;
try { u = await admin.auth().getUserByEmail(email); } catch { u = await admin.auth().createUser({ email, password: 'test1234' }); }
await admin.auth().setCustomUserClaims(u.uid, { role: 'admin', empresaId: emp });
await admin.firestore().collection('system_users').doc(u.uid).set({ uid: u.uid, email, role: 'admin', empresaId: emp });
const adb = admin.firestore();
await adb.collection('servicios_sla').doc('rules_sla_closed').set({ empresaId: emp, status: 'active', closed: true, endDate: '2026-08-31' });
await adb.collection('servicios_sla').doc('rules_sla_open').set({ empresaId: emp, status: 'active', endDate: '2026-09-30' });

const app = initializeApp({ apiKey: 'fake', authDomain: 'localhost', projectId: 'comtroldata' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
let failed = 0;
const expect = async (label, fn, shouldPass) => {
  try { await fn(); console.log(shouldPass ? 'OK' : 'FALLA', `\t${label}\t(permitido)`); if (!shouldPass) failed++; }
  catch (e) { const denied = e?.code === 'permission-denied'; console.log(!shouldPass && denied ? 'OK' : 'FALLA', `\t${label}\t(${e?.code || e})`); if (shouldPass || !denied) failed++; }
};
await signInWithEmailAndPassword(auth, email, 'test1234');
await auth.currentUser.getIdToken(true);
await expect('admin edita contrato cerrado → denegado', () => updateDoc(doc(db, 'servicios_sla', 'rules_sla_closed'), { note: 'x' }), false);
await expect('admin edita contrato abierto → permitido', () => updateDoc(doc(db, 'servicios_sla', 'rules_sla_open'), { note: 'x' }), true);
await signOut(auth);
await signInWithEmailAndPassword(auth, 'admin@bacarsa.com.ar', 'admin1234');
await expect('SuperAdmin edita contrato cerrado → permitido', () => updateDoc(doc(db, 'servicios_sla', 'rules_sla_closed'), { note: 'sa' }), true);
console.log(`\nfallas: ${failed}`);
process.exit(failed ? 1 : 0);
