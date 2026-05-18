/**
 * Reclasifica entradas de assistant_interaction_logs con classifyAssistantOutcome actual.
 * Uso:
 *   node scripts/reclassify-assistant-logs.js [--empresa bacarsa] [--dry-run]
 *   node scripts/reclassify-assistant-logs.js --empresa bacarsa --apply
 */
const path = require('path');

const credPath = path.resolve(__dirname, '../service-account.json');

const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const functionsRoot = path.join(__dirname, '../apps/functions');
const { classifyAssistantOutcome } = require(path.join(
  functionsRoot,
  'lib/assistant/assistantInteractionLog',
));

const COLLECTION = 'assistant_interaction_logs';
const BATCH_SIZE = 400;

function parseArgs() {
  const args = process.argv.slice(2);
  let empresa = 'bacarsa';
  let all = false;
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--empresa' && args[i + 1]) {
      empresa = args[++i];
    } else if (args[i] === '--all') {
      all = true;
    } else if (args[i] === '--apply') {
      apply = true;
    } else if (args[i] === '--dry-run') {
      apply = false;
    }
  }
  return { empresa, all, apply };
}

async function main() {
  const { empresa, all, apply } = parseArgs();
  const fs = require('fs');
  if (!getApps().length) {
    if (fs.existsSync(credPath)) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
      initializeApp({ credential: cert(credPath), projectId: 'comtroldata' });
    } else {
      initializeApp({ credential: applicationDefault(), projectId: 'comtroldata' });
    }
  }
  const db = getFirestore();

  const snap = all
    ? await db.collection(COLLECTION).get()
    : await db.collection(COLLECTION).where('empresaId', '==', empresa).get();
  console.log(all ? `Documentos (todas las empresas): ${snap.size}` : `Documentos empresa="${empresa}": ${snap.size}`);
  if (snap.empty) {
    process.exit(0);
  }

  let changed = 0;
  let toAnswered = 0;
  let toUnsatisfied = 0;
  let batch = db.batch();
  let batchOps = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    const hadError = d.outcome === 'error';
    const prev = d.outcome;
    const next = classifyAssistantOutcome(d.reply, hadError);
    const prevReview = !!d.needsReview;
    const nextReview = next === 'unsatisfied' || next === 'error';

    if (prev !== next || prevReview !== nextReview) {
      changed++;
      if (prev === 'answered' && next === 'unsatisfied') toUnsatisfied++;
      if (prev === 'unsatisfied' && next === 'answered') toAnswered++;
      if (apply) {
        batch.update(doc.ref, { outcome: next, needsReview: nextReview });
        batchOps++;
        if (batchOps >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          batchOps = 0;
        }
      }
    }
  }

  if (apply && batchOps > 0) {
    await batch.commit();
  }

  console.log(
    apply ? 'Aplicado:' : 'Dry-run (usá --apply para escribir):',
    { changed, answered_a_unsatisfied: toUnsatisfied, unsatisfied_a_answered: toAnswered },
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
