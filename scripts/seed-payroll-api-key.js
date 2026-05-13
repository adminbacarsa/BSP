/**
 * Crea una API Key para una integración externa de liquidación.
 *
 * Uso:
 *   node scripts/seed-payroll-api-key.js --name "Liquidación COSP" --empresaId bacarsa --scopes payroll.read,payroll.close
 *
 * Para apuntar al emulador, exportar antes:
 *   set FIRESTORE_EMULATOR_HOST=localhost:8080
 *   set FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
 *
 * Para producción usar credenciales del proyecto:
 *   set GOOGLE_APPLICATION_CREDENTIALS=...\\service-account.json
 *
 * IMPORTANTE: la API Key generada se imprime UNA sola vez. Guardarla en un
 * lugar seguro y entregarla al sistema externo. En Firestore solo queda el hash.
 */
const crypto = require('crypto');
const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const k = argv[i];
        if (!k.startsWith('--')) continue;
        const key = k.slice(2);
        const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
        out[key] = val;
    }
    return out;
}

const args = parseArgs(process.argv);
const name = args.name || 'Liquidación';
const empresaId = args.empresaId || 'bacarsa';
const scopes = (args.scopes || 'payroll.read').split(',').map((s) => s.trim()).filter(Boolean);
const ipAllowlist = args.ip
    ? args.ip.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
const projectId = process.env.GCLOUD_PROJECT || 'comtroldata';

function initFirebase() {
    if (getApps().length > 0) return;
    if (process.env.FIRESTORE_EMULATOR_HOST) {
        initializeApp({ projectId });
        return;
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        initializeApp({
            credential: cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS)),
            projectId,
        });
        return;
    }
    initializeApp({ credential: applicationDefault(), projectId });
}

function generateApiKey() {
    const apiKey = `csp_${crypto.randomBytes(28).toString('base64url')}`;
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(`${salt}:${apiKey}`).digest('hex');
    return { apiKey, salt, hash, prefix: apiKey.slice(0, 8) };
}

async function main() {
    initFirebase();
    const db = getFirestore();
    const { apiKey, salt, hash, prefix } = generateApiKey();

    const docRef = db.collection('integraciones_api').doc();
    await docRef.set({
        name,
        empresaId,
        scopes,
        ipAllowlist,
        status: 'ACTIVE',
        apiKeyHash: hash,
        apiKeySalt: salt,
        apiKeyPrefix: prefix,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: 'CLI:seed-payroll-api-key',
    });

    console.log('\nAPI Key creada — ID interno: %s', docRef.id);
    console.log('Nombre:        %s', name);
    console.log('Empresa:       %s', empresaId);
    console.log('Scopes:        %s', scopes.join(', '));
    if (ipAllowlist.length) console.log('IP allowlist:  %s', ipAllowlist.join(', '));
    console.log('Prefijo (log): %s', prefix);
    console.log('\n=================================================================');
    console.log('  API KEY (entregar al sistema externo, no se vuelve a mostrar):');
    console.log('  %s', apiKey);
    console.log('=================================================================\n');
    console.log('Probá:');
    console.log('  curl -H "X-API-Key: %s" https://us-central1-%s.cloudfunctions.net/payrollApi/v1/payroll/cycles', apiKey, projectId);
    console.log('');
}

main().catch((e) => {
    console.error('Error:', e);
    process.exit(1);
});
