#!/usr/bin/env node
/**
 * Asegura NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1 en .env.local cuando
 * los emuladores corren en la misma PC (Notebook). Evita roturas al cambiar de WiFi.
 * Para emuladores en otra máquina (N8N), definí manualmente su IP en .env.local.
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const LOCAL_HOST = '127.0.0.1';

if (!fs.existsSync(envPath)) {
  console.log('[predev] .env.local no encontrado, saltando.');
  process.exit(0);
}

const currentEnv = fs.readFileSync(envPath, 'utf8');

if (!currentEnv.includes('NEXT_PUBLIC_USE_EMULATOR=true')) {
  process.exit(0);
}

// Si ya apunta a otra máquina explícita (N8N), no tocar
const hostMatch = currentEnv.match(/^NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=(.+)$/m);
const currentHost = hostMatch?.[1]?.trim();
if (currentHost && currentHost !== LOCAL_HOST && !/^127\.0\.0\.1$/i.test(currentHost)) {
  console.log(`[predev] Emulador remoto (${currentHost}) — sin cambios.`);
  process.exit(0);
}

const updated = currentEnv.replace(
  /^NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=.+$/m,
  `NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=${LOCAL_HOST}`
);

if (updated === currentEnv) {
  console.log(`[predev] Emulador en ${LOCAL_HOST} — OK.`);
} else {
  fs.writeFileSync(envPath, updated, 'utf8');
  console.log(`[predev] Emulador → ${LOCAL_HOST} (loopback local)`);
}
