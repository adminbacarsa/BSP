/**
 * Seed emulador: admin (panel) + guardia (portal). Requiere Auth/Firestore emulador.
 * Uso: node scripts/seed-lab.js
 */
const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

function run(name) {
  const scriptPath = path.join(__dirname, name);
  const r = spawnSync(process.execPath, [scriptPath], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env },
  });
  const code = r.status !== null && r.status !== undefined ? r.status : 1;
  if (code !== 0) {
    console.error(`[seed-lab] Falló ${name} (exit ${code})`);
    process.exit(code);
  }
}

console.log('\n[seed-lab] admin + guardia\n');
run('seed-admin.js');
run('seed-empleado.js');
console.log('\n[seed-lab] OK\n');
process.exit(0);
