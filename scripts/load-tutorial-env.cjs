/**
 * Carga TUTORIAL_EMAIL / TUTORIAL_PASSWORD / TUTORIAL_BASE desde un archivo local
 * si las variables no están ya definidas en el proceso.
 *
 * Archivos probados (el primero que exista):
 *   docs/tutorial-capture.env
 *   scripts/tutorial-capture.env
 *
 * Formato: KEY=valor  (líneas # comentario). Podés usar comillas.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadTutorialEnv() {
  const candidates = [
    path.join(ROOT, 'docs', 'tutorial-capture.env'),
    path.join(ROOT, 'scripts', 'tutorial-capture.env'),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      const cur = process.env[key];
      if (cur === undefined || cur === '') process.env[key] = val;
    }
    console.log('[tutorial-env] Credenciales desde:', envPath);
    return true;
  }
  return false;
}

module.exports = { loadTutorialEnv };
