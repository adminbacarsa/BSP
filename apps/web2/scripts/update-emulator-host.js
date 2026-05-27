#!/usr/bin/env node
/**
 * Detecta la IP LAN actual y actualiza NEXT_PUBLIC_FIREBASE_EMULATOR_HOST en .env.local
 * Se ejecuta automáticamente como predev para que el browser siempre apunte al emulador correcto.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');

function getLanIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    // Ignorar loopback y VPN-like interfaces
    if (/loopback|lo|vmware|vbox|docker|vpn|tap|tun/i.test(name)) continue;
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Preferir rango 192.168.x.x o 10.x.x.x
        if (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(iface.address)) {
          return iface.address;
        }
      }
    }
  }
  return null;
}

if (!fs.existsSync(envPath)) {
  console.log('[predev] .env.local no encontrado, saltando auto-detección de IP.');
  process.exit(0);
}

const currentEnv = fs.readFileSync(envPath, 'utf8');

// Solo actuar si USE_EMULATOR=true
if (!currentEnv.includes('NEXT_PUBLIC_USE_EMULATOR=true')) {
  process.exit(0);
}

const ip = getLanIP();
if (!ip) {
  console.log('[predev] No se detectó IP LAN — usando la configuración existente.');
  process.exit(0);
}

// Reemplazar la línea NEXT_PUBLIC_FIREBASE_EMULATOR_HOST (descomentada)
const updated = currentEnv.replace(
  /^NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=.+$/m,
  `NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=${ip}`
);

if (updated === currentEnv) {
  console.log(`[predev] IP del emulador ya es ${ip} — sin cambios.`);
} else {
  fs.writeFileSync(envPath, updated, 'utf8');
  console.log(`[predev] IP del emulador actualizada → ${ip}`);
}
