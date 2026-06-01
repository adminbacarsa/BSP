#!/usr/bin/env node
/**
 * Deploy a producción.
 *
 * Por defecto, si el lab está activo (emuladores :8080/:9099 o dev :3000), deploy en
 * worktree separado ../cronoapp-deploy — no build en esta carpeta, emulador intacto.
 *
 * Uso:
 *   npm run deploy              → worktree si lab activo; si no, build en build/ aquí
 *   npm run deploy -- --here    → forzar build en esta carpeta (build/ solamente)
 *   npm run deploy -- --worktree → siempre worktree
 *   npm run deploy --functions  → hosting + functions
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { runDeploy, labIsActive } = require('./deploy-lib');

const args = process.argv.slice(2);
const forceHere = args.includes('--here');
const forceWorktree = args.includes('--worktree');
const deployArgs = args.filter((a) => a !== '--here' && a !== '--worktree');

if (forceWorktree || (!forceHere && labIsActive())) {
  if (!forceWorktree && labIsActive()) {
    console.log('\n🧪 Lab activo (emulador o :3000) → deploy en carpeta separada (cronoapp-deploy).\n');
    console.log('   Para build en esta carpeta igual: npm run deploy -- --here\n');
  }
  const child = spawnSync(process.execPath, [path.join(__dirname, 'deploy-worktree.js'), ...deployArgs], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });
  process.exit(child.status ?? 1);
}

console.log('\n▶ Deploy en esta carpeta (artefactos en build/, no apps/web2/out).\n');
runDeploy(path.join(__dirname, '..'), deployArgs);
