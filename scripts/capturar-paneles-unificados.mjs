/**
 * Dock unificado de Planificación: abierto y minimizado, 1440×900 y 1366×768.
 * Emulador propio 8291/9291. Puerto 3037.
 *   NEXT_PUBLIC_USE_EMULATOR=true npm --prefix apps/web2 run build
 *   PLANIF_EMU_PORTS=8080:8291,9099:9291 FIRESTORE_EMULATOR_HOST=127.0.0.1:8291 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9291 node scripts/capturar-paneles-unificados.mjs
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion, root, shotsDir, sleep } from './planif-cdp-lib.mjs';

const host = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!/^(127\.0\.0\.1|localhost):8291$/.test(host)) throw new Error('Solo el emulador propio :8291.');

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const app = initializeApp({ projectId: 'comtroldata' }, 'captura-paneles');
const db = getFirestore(app);
const auth = getAuth(app);
const empresaId = 'bacarsa';
const clientId = 'cliPan12';
const objetivo = 'objPan12';
const now = Timestamp.now();
const fail = (m) => { console.error('✗', m); process.exitCode = 1; };

const EMAIL = 'admin@bacarsa.com.ar';
let uid;
try { uid = (await auth.getUserByEmail(EMAIL)).uid; } catch {
  uid = (await auth.createUser({ email: EMAIL, password: 'admin1234', displayName: 'Admin' })).uid;
}
await auth.setCustomUserClaims(uid, { role: 'SUPERADMIN' });
await db.collection('system_users').doc(uid).set({ email: EMAIL, role: 'SUPERADMIN', empresaId, nombre: 'Admin' }, { merge: true });
await db.collection('empresas').doc(empresaId).set({ name: 'Bacarsa', migracionCompleta: true }, { merge: true });

const banda = (code, startTime, endTime, hours) => ({ code, startTime, endTime, hours, quantity: 1 });
await db.collection('servicios_sla').doc('slaPan12oct').set({
  empresaId, clientId, clientName: 'CASISA', objectiveId: objetivo, objectiveName: 'Obrador Paneles',
  status: 'active', active: true, startDate: '2026-10-01', endDate: '2026-10-31',
  positions: [{
    name: 'Puesto 1', positionName: 'Puesto 1', quantity: 1, coverageType: '24hs', exigeCobertura: true,
    activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    allowedShiftTypes: [
      banda('M', '07:00', '15:00', 8), banda('T', '15:00', '23:00', 8), banda('N', '23:00', '07:00', 8),
      banda('D12', '07:00', '19:00', 12), banda('N12', '19:00', '07:00', 12),
    ],
  }],
  createdAt: now,
});
await db.collection('clients').doc(clientId).set({
  name: 'CASISA', empresaId, status: 'ACTIVE', active: true,
  objetivos: [{ id: objetivo, name: 'Obrador Paneles', active: true, status: 'ACTIVE' }],
  createdAt: now,
});
await db.collection('planificacion_estados').doc(`${empresaId}_${objetivo}_2026_10`).set({
  empresaId, objectiveId: objetivo, year: 2026, month: 10, status: 'DRAFT',
});

const guardias = [
  { id: 'panregalo', name: 'REGALO, Juan', legajo: '9101' },
  { id: 'panherrante', name: 'HERRANTE, Pedro', legajo: '9102' },
  { id: 'pandiaz', name: 'DIAZ, Ana', legajo: '9103' },
];
const viejos = await db.collection('turnos').where('objectiveId', '==', objetivo).get();
for (let i = 0; i < viejos.docs.length; i += 400) {
  const b = db.batch();
  viejos.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
  await b.commit();
}
for (const g of guardias) {
  const [apellido, nombre] = g.name.split(',').map((s) => s.trim());
  await db.collection('empleados').doc(g.id).set({
    empresaId, name: g.name, fullName: g.name, nombre, apellido, lastName: apellido, firstName: nombre,
    fileNumber: g.legajo, legajo: g.legajo, status: 'ACTIVE', modalidad: 'NOMINA', category: 'VIGILADOR',
    preferredObjectiveId: objetivo, preferredObjectiveIds: [objetivo],
    planificacionDotacion: { [objetivo]: { positionName: 'Puesto 1' } }, createdAt: now,
  });
}
const stamp = (ds, hm) => Timestamp.fromDate(new Date(`${ds}T${hm}:00-03:00`));
const porId = Object.fromEntries(guardias.map((g) => [g.id, g]));
async function turno(empId, ds, code, extra = {}) {
  const g = porId[empId];
  const horarios = { M: ['07:00', '15:00', 8], N: ['23:00', '07:00', 8] };
  const [s, e, h] = horarios[code];
  const doc = {
    empresaId, clientId, objectiveId: objetivo, objectiveName: 'Obrador Paneles', positionName: 'Puesto 1',
    employeeId: empId, employeeName: g.name, code, name: code,
    scheduleDate: ds, hours: h, draft: true,
    startTime: stamp(ds, s), endTime: stamp(ds, e),
    ...extra,
  };
  if (code === 'N') {
    const [y, m, d] = ds.split('-').map(Number);
    const next = new Date(y, m - 1, d + 1);
    const nd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    doc.endTime = Timestamp.fromDate(new Date(`${nd}T07:00:00-03:00`));
  }
  await db.collection('turnos').doc(`${empId}${ds.replace(/-/g, '')}`).set(doc);
}
await turno('panregalo', '2026-10-02', 'M');
await turno('panherrante', '2026-10-02', 'N');
await turno('pandiaz', '2026-10-02', 'M', { positionName: '' });
console.log('✓ seed');

const sesion = await abrirPlanificacion({
  objectiveId: objetivo, clientId, year: 2026, month: 10, prefijo: 'paneles-unificados',
  port: Number(process.env.CAPTURA_PORT || 3037), devtoolsPort: Number(process.env.CAPTURA_DEVTOOLS || 9377),
  scriptInicial: `try { localStorage.removeItem('cosp-planif-paneles'); } catch (e) {}`,
});
const { send, evaluate, waitFor, click, shot, cerrar } = sesion;

function solapa(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function medir(ancho, alto) {
  return evaluate(`(() => {
    const de = document.documentElement;
    const panel = document.querySelector('[data-paneles-planif], [data-paneles-pastilla]');
    const fab = document.querySelector('[aria-label="Abrir asistente COSP"], [aria-label="Cerrar asistente"]');
    const toast = document.querySelector('[data-sonner-toaster]');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
    };
    const cortados = panel ? [...panel.querySelectorAll('*')].filter((el) => {
      const s = getComputedStyle(el);
      if (s.overflowX === 'visible') return false;
      return el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0;
    }).slice(0, 6).map((el) => (el.getAttribute('data-paneles-tab') || el.tagName) + ':' + (el.innerText || '').slice(0, 40)) : [];
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      pagina: de.scrollWidth - de.clientWidth,
      panel: panel ? panel.scrollWidth - panel.clientWidth : -1,
      texto: (panel?.innerText || '').replace(/\\s+/g, ' ').slice(0, 400),
      cortados,
      fab: box(fab),
      pieza: box(panel),
      toast: box(toast),
    };
  })()`);
}

async function foto(nombre, ancho, alto) {
  await sleep(400);
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: ancho, height: alto, scale: 1 } });
  const file = join(shotsDir, nombre);
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('✓', file);
}

try {
  await waitFor(`document.getElementById('plan-emp-panregalo')`, 120000, 'grilla');
  await waitFor(`document.querySelector('[data-paneles-planif]')`, 20000, 'dock');
  const modo = await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.getAttribute('data-modo-rapido-toggle')`);
  if (modo !== '1') {
    await click(`document.querySelector('[data-modo-rapido-toggle]')`);
    await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 8000, 'modo rápido');
  }
  await waitFor(`(document.querySelector('[data-paneles-tab="avisos"]')?.innerText || '').includes('(1)')`, 15000, 'un aviso');
  await waitFor(`(document.querySelector('[data-paneles-tab="faltantes"]')?.innerText || '').includes('(1)')`, 8000, 'un faltante');
  await evaluate(`document.querySelector('[data-paneles-tab="faltantes"]')?.click()`);
  await sleep(300);
  const fila = await evaluate(`document.querySelector('[data-faltante]')?.innerText || ''`);
  console.log('fila', fila.replace(/\n/g, ' | '));
  if (!/02\/10/.test(fila) || !/Puesto 1/.test(fila) || !/Aplicar/.test(fila) || !/Elegir otro/.test(fila)) {
    fail(`fila inesperada: ${fila}`);
  }
  const ayuda = await evaluate(`document.querySelector('[data-modo-rapido-avisos-ayuda]')?.innerText || ''`);
  await evaluate(`document.querySelector('[data-paneles-tab="avisos"]')?.click()`);
  await sleep(200);
  const ayudaAbierta = await evaluate(`document.querySelector('[data-modo-rapido-avisos-ayuda]')?.innerText || ''`);
  console.log('ayuda', ayudaAbierta);
  if (!/PIN al publicar/.test(ayudaAbierta) || !/no se puede publicar/.test(ayudaAbierta)) fail(`texto de avisos: ${ayudaAbierta || ayuda}`);
  await evaluate(`document.querySelector('[data-paneles-tab="faltantes"]')?.click()`);
  await sleep(200);

  const abierto1440 = await medir(1440, 900);
  console.log('1440 abierto', JSON.stringify(abierto1440));
  if (abierto1440.pagina > 2) fail(`scroll horizontal de la página en 1440: ${abierto1440.pagina}`);
  if (abierto1440.panel > 2) fail(`scroll horizontal del panel en 1440: ${abierto1440.panel}`);
  if (solapa(abierto1440.pieza, abierto1440.fab)) fail('el panel tapa el escudo');
  await shot('abierto');

  await click(`document.querySelector('[data-paneles-minimizar]')`);
  await waitFor(`document.querySelector('[data-paneles-pastilla]')`, 8000, 'pastilla');
  const pastilla = await evaluate(`document.querySelector('[data-paneles-pastilla]')?.innerText || ''`);
  console.log('pastilla', pastilla);
  if (pastilla.replace(/\s+/g, ' ') !== '1 faltante · 1 aviso · 0 consultas') fail(`pastilla: ${pastilla}`);
  const min1440 = await medir(1440, 900);
  console.log('1440 min', JSON.stringify(min1440));
  if (solapa(min1440.pieza, min1440.fab)) fail('la pastilla tapa el escudo');
  if (min1440.pagina > 2) fail(`scroll horizontal minimizado en 1440: ${min1440.pagina}`);
  await shot('minimizado');

  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await click(`document.querySelector('[data-paneles-pastilla]')`);
  await waitFor(`document.querySelector('[data-paneles-planif]')`, 8000, 'dock 1366');
  await evaluate(`document.querySelector('[data-paneles-tab="faltantes"]')?.click()`);
  await sleep(300);
  const abierto1366 = await medir(1366, 768);
  console.log('1366 abierto', JSON.stringify(abierto1366));
  if (abierto1366.viewport.w !== 1366 || abierto1366.viewport.h !== 768) fail(`viewport ${abierto1366.viewport.w}x${abierto1366.viewport.h}`);
  if (abierto1366.pagina > 2) fail(`scroll horizontal de la página en 1366: ${abierto1366.pagina}`);
  if (abierto1366.panel > 2) fail(`scroll horizontal del panel en 1366: ${abierto1366.panel}`);
  if (abierto1366.cortados.length) fail(`texto cortado en 1366: ${abierto1366.cortados.join(' / ')}`);
  if (solapa(abierto1366.pieza, abierto1366.fab)) fail('el panel tapa el escudo en 1366');
  await foto('paneles-unificados-abierto-1366.png', 1366, 768);

  await click(`document.querySelector('[data-paneles-minimizar]')`);
  await waitFor(`document.querySelector('[data-paneles-pastilla]')`, 8000, 'pastilla 1366');
  const min1366 = await medir(1366, 768);
  console.log('1366 min', JSON.stringify(min1366));
  if (min1366.pagina > 2) fail(`scroll horizontal minimizado en 1366: ${min1366.pagina}`);
  if (solapa(min1366.pieza, min1366.fab)) fail('la pastilla tapa el escudo en 1366');
  const pastilla1366 = await evaluate(`document.querySelector('[data-paneles-pastilla]')?.innerText || ''`);
  if (!/1 faltante · 1 aviso · 0 consultas/.test(pastilla1366)) fail(`pastilla 1366: ${pastilla1366}`);
  await foto('paneles-unificados-minimizado-1366.png', 1366, 768);
} finally {
  await cerrar();
}
if (process.exitCode) process.exit(process.exitCode);
console.log('✓ capturas');
