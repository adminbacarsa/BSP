/**
 * import-backup.js
 * Convierte un backup JSON (exportado desde la Cloud Function triggerBackup)
 * al formato de directorio que acepta `firebase emulators:start --import`
 *
 * Uso: node scripts/import-backup.js ./backups/backup_2026-04-28.json ./backups/latest
 */

const fs = require('fs');
const path = require('path');

const [,, inputFile, outputDir] = process.argv;

if (!inputFile || !outputDir) {
  console.error('Uso: node import-backup.js <backup.json> <output-dir>');
  process.exit(1);
}

const raw = fs.readFileSync(inputFile, 'utf8');
const data = JSON.parse(raw);
const { _meta, ...collections } = data;

// Crear estructura de directorios del emulador
const firestoreDir = path.join(outputDir, 'firestore_export');
fs.mkdirSync(firestoreDir, { recursive: true });

const allDocs = [];

for (const [colName, docs] of Object.entries(collections)) {
  if (!Array.isArray(docs)) continue;
  for (const doc of docs) {
    const { _id, ...fields } = doc;
    allDocs.push({
      name: `projects/comtroldata/databases/(default)/documents/${colName}/${_id}`,
      fields: toFirestoreFields(fields),
    });
  }
}

// Escribir en formato de export del emulador (firestore_export/all_namespaces/all_kinds)
const kindsDir = path.join(firestoreDir, 'all_namespaces', 'all_kinds');
fs.mkdirSync(kindsDir, { recursive: true });

// El emulador acepta un directorio con un metadata.json + archivos de datos
const metadata = {
  version: '1.3',
  firestore: {
    version: 'indexes/all',
    path: 'firestore_export',
    metadata_file: 'firestore_export/firestore_export.overall_export_metadata',
  },
};

fs.writeFileSync(
  path.join(outputDir, 'firebase-export-metadata.json'),
  JSON.stringify(metadata, null, 2)
);

// Guardar docs como JSON legible para el emulador
fs.writeFileSync(
  path.join(kindsDir, 'output-0.json'),
  JSON.stringify({ kind: 'firestore#documents', documents: allDocs }, null, 2)
);

fs.writeFileSync(
  path.join(firestoreDir, 'firestore_export.overall_export_metadata'),
  JSON.stringify({ outputUriPrefix: firestoreDir, collectionIds: Object.keys(collections) }, null, 2)
);

console.log(`✔ Backup importado: ${allDocs.length} documentos en ${Object.keys(collections).length} colecciones`);
console.log(`  Directorio: ${outputDir}`);

function toFirestoreFields(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = toFirestoreValue(v);
  }
  return result;
}

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object' && v._seconds !== undefined) return { timestampValue: new Date(v._seconds * 1000).toISOString() };
  if (typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
  return { stringValue: String(v) };
}
