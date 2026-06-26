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
 * Usa la REST API de Firestore con el token de gcloud ADC (firebase-admin no
 * refresca bien la credencial de usuario en Windows).
 *
 * Requisitos: estar autenticado con `gcloud auth application-default login`.
 *
 * Uso:
 *   node scripts/migrate-client-users-id.js            → dry-run (solo muestra)
 *   node scripts/migrate-client-users-id.js --apply    → aplica los cambios
 */

const { execSync } = require('child_process');

const APPLY = process.argv.includes('--apply');
const PROJECT_ID = 'comtroldata';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function getToken() {
  return execSync('gcloud auth application-default print-access-token', { encoding: 'utf8' }).trim();
}

let TOKEN = '';

async function api(method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${method} ${urlPath} → ${res.status}: ${txt}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function listAll() {
  const docs = [];
  let pageToken = '';
  do {
    const qs = `?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await api('GET', `/client_users${qs}`);
    (data.documents || []).forEach((d) => docs.push(d));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

function docId(d) {
  return d.name.split('/').pop();
}

async function getDoc(id) {
  try {
    return await api('GET', `/client_users/${id}`);
  } catch (e) {
    if (String(e.message).includes('→ 404')) return null;
    throw e;
  }
}

async function main() {
  console.log(`\n=== Migración client_users (ID = uid) — ${APPLY ? 'APLICAR' : 'DRY-RUN'} ===\n`);
  TOKEN = getToken();

  const docs = await listAll();
  console.log(`Total documentos client_users: ${docs.length}\n`);

  let migrados = 0;
  let yaOk = 0;
  let sinUid = 0;
  let destinoExistente = 0;

  for (const d of docs) {
    const id = docId(d);
    const uid = d.fields?.uid?.stringValue;
    const email = d.fields?.email?.stringValue || '-';

    if (!uid) {
      sinUid++;
      console.warn(`⚠ ${id} → sin campo uid, se omite (revisar manualmente).`);
      continue;
    }
    if (id === uid) {
      yaOk++;
      continue;
    }

    const destino = await getDoc(uid);
    if (destino) {
      destinoExistente++;
      console.log(`→ ${id} (${email}): destino client_users/${uid} YA existe → solo borrar legacy`);
      if (APPLY) await api('DELETE', `/client_users/${id}`);
      migrados++;
      continue;
    }

    console.log(`→ Migrar ${id} (${email}) → client_users/${uid}`);
    if (APPLY) {
      // Reusar los fields crudos del doc origen (ya vienen tipados en formato REST).
      await api('PATCH', `/client_users/${uid}`, { fields: d.fields });
      await api('DELETE', `/client_users/${id}`);
    }
    migrados++;
  }

  console.log(`\nResumen:`);
  console.log(`  Ya correctos (id == uid): ${yaOk}`);
  console.log(`  ${APPLY ? 'Migrados/limpiados' : 'A migrar'}: ${migrados}`);
  if (destinoExistente) console.log(`  Con destino preexistente (solo borrado legacy): ${destinoExistente}`);
  if (sinUid) console.log(`  Sin uid (omitidos): ${sinUid}`);
  if (!APPLY) console.log(`\n(DRY-RUN) Volvé a correr con --apply para aplicar los cambios.\n`);
  else console.log(`\n✅ Migración completada.\n`);
}

main().catch((e) => {
  console.error('Error en la migración:', e.message);
  process.exit(1);
});
