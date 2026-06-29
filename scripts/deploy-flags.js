/**
 * Flags compartidos para deploy.js / deploy-worktree.js / deploy-lib.js
 *
 * Uso recomendado:
 *   npm run deploy:functions
 *   npm run deploy -- --functions
 *
 * Evitar: npm run deploy --functions  (npm no pasa el flag al script)
 */

/**
 * @param {string[]} argv — process.argv completo o slice(2)
 * @returns {{ withFunctions: boolean, withRules: boolean, withHosting: boolean, dryRun: boolean, raw: string[] }}
 */
function parseDeployFlags(argv) {
  const raw = argv[0] === process.execPath || String(argv[0] || '').includes('node')
    ? argv.slice(2)
    : argv.slice();

  const normalized = new Set();
  for (const token of raw) {
    if (token === '--here' || token === '--worktree') continue;
    const t = String(token).trim().toLowerCase();
    if (t === '--functions' || t === 'functions') normalized.add('functions');
    if (t === '--rules' || t === 'rules') normalized.add('rules');
    if (t === '--all' || t === 'all') normalized.add('all');
    if (t === '--dry-run' || t === 'dry-run') normalized.add('dry-run');
    if (t === '--hosting-only' || t === 'hosting-only') normalized.add('hosting-only');
  }

  const envFunctions = /^(1|true|yes)$/i.test(String(process.env.COSP_DEPLOY_FUNCTIONS ?? '').trim());
  const envRules = /^(1|true|yes)$/i.test(String(process.env.COSP_DEPLOY_RULES ?? '').trim());
  const envAll = /^(1|true|yes)$/i.test(String(process.env.COSP_DEPLOY_ALL ?? '').trim());

  const withFunctions = normalized.has('functions') || normalized.has('all') || envFunctions || envAll;
  const withRules = normalized.has('rules') || normalized.has('all') || envRules || envAll;
  const dryRun = normalized.has('dry-run');
  const withHosting = !normalized.has('hosting-only');

  return { withFunctions, withRules, withHosting, dryRun, raw };
}

function formatDeployTargets(flags) {
  const targets = [];
  if (flags.withHosting) targets.push('hosting');
  if (flags.withFunctions) targets.push('functions');
  if (flags.withRules) targets.push('firestore:rules');
  return targets;
}

function logDeployPlan(flags, { label = 'Deploy' } = {}) {
  const targets = formatDeployTargets(flags);
  console.log(`\n▶ ${label} — objetivos: ${targets.length ? targets.join(', ') : '(ninguno)'}`);
  if (flags.dryRun) console.log('   (dry-run: no build ni firebase deploy)\n');
  if (!flags.withFunctions && !flags.withRules && flags.withHosting) {
    console.log('   Tip: hosting + functions → npm run deploy:functions');
  }
}

module.exports = { parseDeployFlags, formatDeployTargets, logDeployPlan };
