#!/usr/bin/env node
/**
 * Falla si Alert.alert de react-native aparece fuera de src/lib/appAlert.ts.
 * Uso: node scripts/check-mobile-no-rn-alert.mjs
 * o: npm --prefix apps/mobile-guardia run lint:no-alert
 */
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..', 'apps', 'mobile-guardia');
const allowed = path.join('src', 'lib', 'appAlert.ts');

let out = '';
try {
  out = execSync(
    `rg -n "Alert\\.alert" app src --glob '*.{ts,tsx}' || true`,
    { cwd: root, encoding: 'utf8', shell: true },
  );
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '');
}

const lines = out
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)
  .filter((l) => !l.startsWith(allowed) && !l.includes(`${allowed}:`));

if (lines.length) {
  console.error('✗ Alert.alert prohibido fuera de src/lib/appAlert.ts:\n');
  for (const l of lines) console.error('  ', l);
  console.error('\nUsá: import { appAlert } from \'@/lib/appAlert\'');
  process.exit(1);
}

console.log('✓ Sin Alert.alert fuera de appAlert.ts');
