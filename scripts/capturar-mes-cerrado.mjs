/**
 * Agosto 2026 en el emulador 8190/9199: sin acciones (rol con correct, no SuperAdmin)
 * y SuperAdmin en modo corrección.
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 node scripts/capturar-mes-cerrado.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

if (String(process.env.FIRESTORE_EMULATOR_HOST || '') !== '127.0.0.1:8190') {
  throw new Error('Este script solo escribe en el emulador 8190');
}
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9199';

const m = JSON.parse(readFileSync(new URL('./.obrador-manifest.json', import.meta.url), 'utf8'));
const app = initializeApp({ projectId: 'comtroldata' }, 'cap-mes');
const db = getFirestore(app);
const auth = getAuth(app);
const email = 'planif.cerrado@bacarsa.com.ar';
let user;
try { user = await auth.getUserByEmail(email); } catch { user = null; }
if (!user) user = await auth.createUser({ email, password: 'planif1234', displayName: 'Planif' });
await auth.setCustomUserClaims(user.uid, { role: 'PLANIFICACION' });
await db.collection('system_users').doc(user.uid).set({
  email, role: 'PLANIFICACION', empresaId: m.empresaId, nombre: 'Planif',
});
await db.collection('roles').doc('PLANIFICACION').set({
  name: 'Planificación',
  permissions: { PLANNING: ['read', 'update', 'correct', 'publish'] },
}, { merge: true });
await db.collection('planificacion_estados').doc(`${m.empresaId}_${m.objectiveId}_2026_8`).set({
  empresaId: m.empresaId,
  objectiveId: m.objectiveId,
  year: 2026,
  month: 8,
  publishedAt: Timestamp.fromDate(new Date('2026-08-01T12:00:00Z')),
  publishedBy: 'captura',
}, { merge: true });

async function sacar(etiqueta, login) {
  const sesion = await abrirPlanificacion({
    objectiveId: m.objectiveId,
    clientId: m.clientId,
    year: 2026,
    month: 8,
    prefijo: 'mes-cerrado',
    port: login.email.includes('planif') ? 3018 : 3019,
    devtoolsPort: login.email.includes('planif') ? 9348 : 9349,
    email: login.email,
    password: login.password,
  });
  await sesion.waitFor(`document.querySelector('[data-mes-cerrado-aviso]')`, 90000, 'aviso mes cerrado');
  await sleep(800);
  if (login.corregir) {
    await sesion.click(`document.querySelector('button[title^=\"Modo Corrección\"]')`);
    await sesion.waitFor(`!document.querySelector('[data-mes-cerrado-aviso]')`, 8000, 'corrección activa');
    await sleep(600);
  }
  const hayCelda = await sesion.evaluate(`!!document.querySelector('td[data-testid=grilla-celda]')`);
  if (hayCelda) await sesion.click(`document.querySelector('td[data-testid=grilla-celda]')`, 'right', 500);
  await sleep(300);
  const texto = await sesion.evaluate(`document.querySelector('[data-menu-rapido=raiz]')?.innerText || ''`);
  const acciones = await sesion.evaluate(`document.querySelectorAll('[data-menu-accion]').length`);
  const publicar = await sesion.evaluate(`!!document.querySelector('[data-action=publicar-cronograma]')`);
  console.log(etiqueta, { hayCelda, texto, acciones, publicar });
  await sesion.shot(etiqueta);
  await sesion.cerrar();
}

await sacar('agosto-sin-acciones', { email, password: 'planif1234', corregir: false });
await sacar('agosto-sa-correccion', { email: 'admin@bacarsa.com.ar', password: 'admin1234', corregir: true });
process.exit(0);
