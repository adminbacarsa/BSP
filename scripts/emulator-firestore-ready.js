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

function formatFirestoreSeedError(err) {
  const e = err && typeof err === 'object' ? err : { message: String(err ?? '') };
  const msg = String(e.message ?? '').trim();
  const code = e.code != null ? String(e.code) : '';
  const note = String(e.note ?? '').trim();
  const combined = `${code} ${msg} ${note}`.toLowerCase();

  if (/payload isn't valid|payload is not valid|invalid argument.*payload/i.test(combined)) {
    return 'Payload inválido para Firestore. El JSON del backup puede estar corrupto o el emulador saturado. '
      + 'Reiniciá el lab (npm run lab:restart), cerrá pestañas de Planificación/Operaciones e intentá de nuevo.';
  }
  // Admin SDK suele devolver code 2/13 con message vacío → "Error Firestore (13)"
  if (/\b(2|13)\b|unknown|econnreset|unavailable|offline|internal/i.test(combined)) {
    return 'Firestore emulador no acepta escrituras (saturado o con el navegador en modo offline). '
      + 'Cerrá otras pestañas de COSP, ejecutá npm run lab:restart, abrí solo Configuración → Backups y volvé a importar.';
  }
  if (msg) return msg;
  if (code) return `Error Firestore (${code}). Probá npm run lab:restart e importá de nuevo.`;
  return 'Error desconocido al importar backup';
}

async function assertTurnosWritable(db, options = {}) {
  const projectId = options.projectId ?? 'comtroldata';
  await waitForFirestoreEmulator({ maxWaitMs: options.maxWaitMs ?? 45_000, projectId });
  const probeId = `__import_probe_${Date.now()}`;
  const ref = db.collection('turnos').doc(probeId);
  try {
    await ref.set({ __probe: true, at: new Date().toISOString() });
    await ref.delete();
  } catch (err) {
    throw new Error(formatFirestoreSeedError(err));
  }
}

module.exports = {
  waitForFirestoreEmulator,
  sleep,
  probeFirestoreOnce,
  formatFirestoreSeedError,
  assertTurnosWritable,
};
