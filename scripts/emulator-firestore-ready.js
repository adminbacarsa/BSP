/**
 * Espera a que el emulador Firestore acepte tráfico en 127.0.0.1:8080.
 */
const http = require('http');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeFirestoreOnce(projectId = 'comtroldata') {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 8080,
        path: `/emulator/v1/projects/${projectId}/databases/(default)/documents`,
        method: 'GET',
        timeout: 8000,
      },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function waitForFirestoreEmulator(options = {}) {
  const maxWaitMs = options.maxWaitMs ?? 90_000;
  const projectId = options.projectId ?? 'comtroldata';
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await probeFirestoreOnce(projectId)) return;
    await sleep(1500);
  }
  throw new Error(
    'Firestore emulador no responde en 127.0.0.1:8080. '
    + 'Reiniciá el lab (npm run lab:restart) y esperá el puerto 8080 en la UI :4000.',
  );
}

module.exports = { waitForFirestoreEmulator, sleep, probeFirestoreOnce };
