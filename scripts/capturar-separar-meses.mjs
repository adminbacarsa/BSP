/**
 * Lista de Servicios con «Separar» y la vista previa.
 * Emulador aislado 8291/9291 (no el lab). El script siembra y después abre la pantalla.
 *
 *   npx firebase emulators:start --only auth,firestore --config firebase.importar-8291.json --project comtroldata
 *   NEXT_PUBLIC_USE_EMULATOR=true npm --prefix apps/web2 run build
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 node scripts/capturar-separar-meses.mjs
 * → docs/capturas-cobertura/separar-meses-lista.png
 *   docs/capturas-cobertura/separar-meses-preview.png
 *   docs/capturas-cobertura/separar-meses-siguientes.png
 */
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8291';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9291';

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion } from './planif-cdp-lib.mjs';

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
if (!getApps().length) initializeApp({ projectId: 'comtroldata' });
const db = getFirestore();
const auth = getAuth();

const puesto = {
  id: 'p1', name: 'Puesto 1', code: '', coverageType: '24hs', quantity: 1,
  activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], allowedShiftTypes: [],
};

async function sembrar() {
  const email = 'admin@bacarsa.com.ar';
  let user;
  try {
    user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { password: 'admin1234' });
  } catch {
    user = await auth.createUser({ email, password: 'admin1234' });
  }
  await auth.setCustomUserClaims(user.uid, { role: 'SUPERADMIN' });
  await db.collection('system_users').doc(user.uid).set({
    email, role: 'SUPERADMIN', empresaId: 'bacarsa', nombre: 'Admin',
  });
  await db.collection('empresas').doc('bacarsa').set({ name: 'Bacarsa', migracionCompleta: true }, { merge: true });
  await db.collection('clients').doc('cli_sep').set({
    name: 'Obrador',
    empresaId: 'bacarsa',
    status: 'ACTIVE',
    objetivos: [
      { id: 'obj_agr', name: 'Planta', status: 'ACTIVE' },
      { id: 'obj_ser', name: 'Depósito', status: 'ACTIVE' },
    ],
  });
  await db.collection('servicios_sla').doc('sla_agr').set({
    clientId: 'cli_sep', clientName: 'Obrador', objectiveId: 'obj_agr', objectiveName: 'Planta',
    empresaId: 'bacarsa', startDate: '2026-10-01', endDate: '2027-03-31', status: 'active', closed: false,
    positions: [puesto], totalMonthlyHours: 744, autoRenewMonthly: true,
  });
  const serie = 'serie_cap';
  await db.collection('servicios_sla').doc('sla_oct').set({
    clientId: 'cli_sep', clientName: 'Obrador', objectiveId: 'obj_ser', objectiveName: 'Depósito',
    empresaId: 'bacarsa', slaSeriesId: serie, startDate: '2026-10-01', endDate: '2026-10-31',
    status: 'active', closed: false, positions: [puesto], totalMonthlyHours: 248, autoRenewMonthly: true,
  });
  await db.collection('servicios_sla').doc('sla_nov').set({
    clientId: 'cli_sep', clientName: 'Obrador', objectiveId: 'obj_ser', objectiveName: 'Depósito',
    empresaId: 'bacarsa', slaSeriesId: serie, startDate: '2026-11-01', endDate: '2026-11-30',
    status: 'active', closed: false, positions: [puesto], totalMonthlyHours: 240, autoRenewMonthly: true,
  });
  console.log('sembrado');
}

await sembrar();

const { send, evaluate, waitFor, click, shot, cerrar } = await abrirPlanificacion({
  objectiveId: 'obj_agr',
  clientId: 'cli_sep',
  year: 2026,
  month: 11,
  prefijo: 'separar-meses',
  port: Number(process.env.CAPTURA_PORT || 3026),
  devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9346),
});

try {
  await send('Page.navigate', { url: 'http://127.0.0.1:3026/admin/servicios/' });
  await waitFor(`[...document.querySelectorAll('button')].some((b) => (b.innerText || '').includes('OBRADOR'))`, 90000, 'cliente Obrador');
  await click(`[...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('OBRADOR'))`);
  await waitFor(`document.querySelector('[data-separar-meses]')`, 20000, 'botón Separar');
  await waitFor(`document.querySelector('[data-separar-masivo]')`, 20000, 'masivo SuperAdmin');
  await shot('lista');
  await click(`document.querySelector('[data-separar-meses]')`);
  await waitFor(`document.querySelector('[data-separar-preview]')`, 15000, 'vista previa');
  const texto = await evaluate(`document.querySelector('[data-separar-preview]')?.innerText || ''`);
  if (!/Se van a crear 5 servicios/i.test(texto)) throw new Error(`La vista previa no lista los meses:\n${texto}`);
  await shot('preview');
  await click(`[...document.querySelectorAll('button')].find((b) => /cancelar/i.test(b.textContent || ''))`);
  await waitFor(`!document.querySelector('[data-separar-preview]')`, 10000, 'cerrar vista previa');
  await click(`[...document.querySelectorAll('[title="Editar"]')].find((b) => { let n = b.parentElement; for (let i = 0; i < 8 && n; i += 1, n = n.parentElement) { const t = (n.innerText || '').toLowerCase(); if (t.includes('2026-10-01') && t.includes('dep') && t.includes('sito') && !t.includes('planta')) return true; } return false; })`);
  await waitFor(`document.querySelector('[data-aplicar-siguientes]')`, 20000, 'aplicar a los siguientes');
  const ayuda = await evaluate(`document.querySelector('[data-aplicar-siguientes]')?.innerText || ''`);
  if (!/nov/i.test(ayuda)) throw new Error(`No nombra el mes siguiente:\n${ayuda}`);
  await shot('siguientes');
  console.log('CAPTURAS_OK');
} finally {
  await cerrar();
}
