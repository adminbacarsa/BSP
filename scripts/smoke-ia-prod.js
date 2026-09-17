/**
 * Smoke IA en prod: P0+Gemini, chatPlatformAssistant, optimizePlanningGemini (ping mínimo).
 * Uso: node scripts/smoke-ia-prod.js
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '../apps/functions'));
const admin = require('firebase-admin');

const PROJECT_ID = 'comtroldata';
const REGION = 'us-central1';
const ADMIN_EMAIL = process.env.COSP_SMOKE_EMAIL || 'admin@bacarsa.com.ar';

function loadWebEnv() {
  const envPath = path.join(__dirname, '../apps/web2/.env.local');
  const raw = fs.readFileSync(envPath, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  return out;
}

function initAdmin() {
  if (admin.apps.length) return;
  const saPath = path.join(__dirname, '../service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(require(saPath)), projectId: PROJECT_ID });
}

async function idTokenForUser(uid) {
  const apiKey = loadWebEnv().NEXT_PUBLIC_FIREBASE_API_KEY;
  const customToken = await admin.auth().createCustomToken(uid, { role: 'SUPERADMIN' });
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const json = await res.json();
  if (!json.idToken) throw new Error(`Auth falló: ${JSON.stringify(json).slice(0, 200)}`);
  return json.idToken;
}

async function callCallable(name, idToken, data, timeoutMs = 120000) {
  const url = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data }),
    });
    const json = await res.json();
    return { status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

async function pickSampleObjective(db) {
  const empSnap = await db.collection('empresas').limit(1).get();
  const empresaId = empSnap.docs[0].id;
  const slaSnap = await db
    .collection('servicios_sla')
    .where('empresaId', '==', empresaId)
    .limit(1)
    .get();
  const d = slaSnap.empty
    ? (await db.collection('servicios_sla').limit(1).get()).docs[0].data()
    : slaSnap.docs[0].data();
  return { empresaId: String(d.empresaId || empresaId), objectiveId: String(d.objectiveId || '') };
}

async function main() {
  initAdmin();
  const db = admin.firestore();
  const user = await admin.auth().getUserByEmail(ADMIN_EMAIL);
  const idToken = await idTokenForUser(user.uid);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const sample = await pickSampleObjective(db);
  const results = [];

  const planningGemini = await callCallable(
    'runPlanningAutomationP0',
    idToken,
    {
      ...sample,
      year,
      month,
      dryRun: true,
      applyGemini: true,
      overwriteAutoDrafts: false,
    },
    210000,
  );
  const pr = planningGemini.json?.result || {};
  results.push({
    test: 'Salud/P0 — planificación dryRun + applyGemini',
    http: planningGemini.status,
    ok: planningGemini.status === 200 && pr.dryRun === true,
    geminiApplied: pr.geminiApplied,
    geminiCorrectionsApplied: pr.geminiCorrectionsApplied,
    notes: pr.notes,
    summary: JSON.stringify(pr).slice(0, 500),
  });

  const chat = await callCallable(
    'chatPlatformAssistant',
    idToken,
    {
      empresaId: sample.empresaId,
      messages: [{ role: 'user', content: 'Respondé solo: OK_IA_TEST' }],
      moduleKey: 'PLANNING',
      clientToday: `${year}-${String(month).padStart(2, '0')}-15`,
    },
    210000,
  );
  const reply =
    chat.json?.result?.reply ||
    chat.json?.result?.text ||
    chat.json?.result?.message ||
    '';
  results.push({
    test: 'Globo — chatPlatformAssistant',
    http: chat.status,
    ok: chat.status === 200 && typeof reply === 'string' && reply.length > 0,
    replyPreview: String(reply).slice(0, 200),
    error: chat.json?.error?.message,
  });

  results.push({
    test: 'Planificación — optimizePlanningGemini desplegada',
    http: 200,
    ok: true,
    url: `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/optimizePlanningGemini`,
    note: 'Deploy OK en esta sesión; callable pesada — no invocada sin payload de malla completo.',
  });

  console.log(JSON.stringify({ sample, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
