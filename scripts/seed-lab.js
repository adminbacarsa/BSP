/**
 * Seed emulador: admin (panel) + guardia (portal). Requiere Auth/Firestore emulador.
 * Uso: node scripts/seed-lab.js  |  npm run seed  |  npm run seed:lab
 *
 * Espera a que 8080 (Firestore) y 9099 (Auth) respondan, para evitar carrera al arranque automático.
 */
const { spawnSync } = require('child_process');
const net = require('net');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

function waitTcpPort(port, { host = '127.0.0.1', timeoutMs = 180000, label = '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const socket = net.createConnection({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Timeout esperando ${label || 'puerto ' + port} (${host}:${port})`));
          return;
        }
        setTimeout(attempt, 1000);
      });
    }
    attempt();
  });
}

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

async function main() {
  console.log('\n[seed-lab] Esperando emuladores 127.0.0.1:8080 (Firestore) y :9099 (Auth)...');
  await waitTcpPort(8080, { label: 'Firestore' });
  await waitTcpPort(9099, { label: 'Auth' });
  console.log('[seed-lab] Emuladores listos. Siembra admin + guardia.\n');
  run('seed-admin.js');
  run('seed-empleado.js');
  run('seed-empresa-prueba.js');
  console.log('\n[seed-lab] OK (bacarsa + prueba_sa)\n');
}

main().catch((e) => {
  console.error('[seed-lab]', e.message || e);
  process.exit(1);
});
