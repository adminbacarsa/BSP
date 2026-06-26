/**
 * migrate-client-users-id.js
 * Migra documentos de `client_users` cuyo ID NO es el uid del usuario.
 *
 * Contexto: la callable `createClientPortalAccess` antes creaba el doc con
 * ID autogenerado (.add) y guardaba `uid` como campo. El portal del cliente
 * lee con getDoc(doc('client_users', uid)) y las reglas asumen docId == uid,
 * por lo que esos docs quedaban inservibles. Este script los reescribe con
 * ID = uid y borra el doc legacy.
 *
 * Uso:
 *   node scripts/migrate-client-users-id.js            → dry-run (solo muestra)
 *   node scripts/migrate-client-users-id.js --apply    → aplica los cambios
 *
 * Apunta a PRODUCCIÓN — fuerza ignorar emuladores.
 */

delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const path = require('path');

const APPLY = process.argv.includes('--apply');

const serviceAccountPath = path.join(__dirname, '..', 'service-account.json');
try {
  const sa = require(serviceAccountPath);
  if (!getApps().length) initializeApp({ credential: cert(sa) });
} catch {
  if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
}
const db = getFirestore();

async function main() {
  console.log(`\n=== Migración client_users (ID = uid) — ${APPLY ? 'APLICAR' : 'DRY-RUN'} ===\n`);

  const snap = await db.collection('client_users').get();
  console.log(`Total documentos client_users: ${snap.size}\n`);

  let migrados = 0;
  let yaOk = 0;
  let sinUid = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const uid = data.uid;

    if (!uid) {
      sinUid++;
      console.warn(`⚠ ${docSnap.id} → sin campo uid, se omite (revisar manualmente).`);
      continue;
    }

    if (docSnap.id === uid) {
      yaOk++;
      continue;
    }

    console.log(`→ Migrar ${docSnap.id} (email: ${data.email || '-'}) → client_users/${uid}`);

    if (!APPLY) {
      migrados++;
      continue;
    }

    const canonicalRef = db.collection('client_users').doc(uid);
    const canonicalSnap = await canonicalRef.get();

    // El doc canónico manda; el legacy solo aporta campos faltantes.
    const merged = {
      ...data,
      ...(canonicalSnap.exists ? canonicalSnap.data() : {}),
      uid,
      ...(canonicalSnap.exists ? {} : { creadoEn: data.creadoEn || FieldValue.serverTimestamp() }),
    };

    await canonicalRef.set(merged, { merge: true });
    await docSnap.ref.delete();
    migrados++;
  }

  console.log(`\nResumen:`);
  console.log(`  Ya correctos (id == uid): ${yaOk}`);
  console.log(`  ${APPLY ? 'Migrados' : 'A migrar'}: ${migrados}`);
  if (sinUid) console.log(`  Sin uid (omitidos): ${sinUid}`);
  if (!APPLY) console.log(`\n(DRY-RUN) Volvé a correr con --apply para aplicar los cambios.\n`);
  else console.log(`\n✅ Migración completada.\n`);

  process.exit(0);
}

main().catch((e) => {
  console.error('Error en la migración:', e);
  process.exit(1);
});
