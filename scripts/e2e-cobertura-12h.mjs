/**
 * Obrador Malagueño (octubre, emulador 8190/9199): V sobre una N de 5 días,
 * propuesta 12 h, Aplicar, COBERTURA 2/2 y celdas rojas. Otro objetivo con exigeCobertura false.
 *
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 FIRESTORE_EMULATOR_HOST=127.0.0.1:8190 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199 node scripts/e2e-cobertura-12h.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8190') throw new Error('Solo contra el emulador 127.0.0.1:8190');
if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9199') throw new Error('Auth solo en 127.0.0.1:9199');
if (!process.env.PLANIF_EMU_PORTS) process.env.PLANIF_EMU_PORTS = '8080:8190,9099:9199';

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const manifest = JSON.parse(readFileSync('scripts/.obrador-manifest.json', 'utf8'));
const app = initializeApp({ projectId: 'comtroldata' }, 'cobertura12');
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
const auth = getAuth(app);

const email = 'admin@bacarsa.com.ar';
let user;
try {
  user = await auth.getUserByEmail(email);
} catch (e) {
  if (e.code !== 'auth/user-not-found') throw e;
  user = await auth.createUser({ email, password: 'admin1234', displayName: 'Admin' });
}
await auth.setCustomUserClaims(user.uid, { role: 'SUPERADMIN' });
await db.collection('system_users').doc(user.uid).set({
  email, role: 'SUPERADMIN', empresaId: 'pruebas_sa', nombre: 'Admin', allEmpresas: true,
}, { merge: true });

const libreId = 'obj_sin_exigencia_12h';
const clientRef = db.collection('clients').doc(manifest.clientId);
const client = (await clientRef.get()).data() || {};
const objetivos = Array.isArray(client.objetivos) ? client.objetivos : [];
if (!objetivos.some((o) => o?.id === libreId)) {
  objetivos.push({ id: libreId, name: 'Sin exigencia', active: true, status: 'ACTIVE' });
  await clientRef.set({ ...client, objetivos }, { merge: true });
}
await db.collection('servicios_sla').doc('sla_sin_exigencia_12h').set({
  clientId: manifest.clientId,
  clientName: client.name || client.razonSocial || 'Pruebas',
  objectiveId: libreId,
  objectiveName: 'Sin exigencia',
  empresaId: 'pruebas_sa',
  status: 'active',
  exigeCobertura: false,
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  positions: [{
    name: 'Puesto 1',
    quantity: 1,
    coverageType: '24hs',
    allowedShiftTypes: [
      { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 1 },
      { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8, quantity: 1 },
      { code: 'N', startTime: '23:00', endTime: '07:00', hours: 8, quantity: 1 },
    ],
  }],
});
const dia = (n) => `2026-10-${String(n).padStart(2, '0')}`;
const turno = (id, empId, nombre, code, start, end, day) => db.collection('turnos').doc(id).set({
  empresaId: 'pruebas_sa',
  objectiveId: libreId,
  objectiveName: 'Sin exigencia',
  clientId: manifest.clientId,
  employeeId: empId,
  employeeName: nombre,
  code,
  positionName: 'Puesto 1',
  startTime: new Date(`${dia(day)}T${start}:00-03:00`),
  endTime: new Date(`${dia(day)}T${end}:00-03:00`),
  hours: 8,
  draft: true,
  status: 'ACTIVE',
});
await turno('libre12_herr_05', manifest.herrera, 'HERRERA', 'M', '07:00', '15:00', 5);
await turno('libre12_bord_05', manifest.bordino, 'BORDINO', 'T', '15:00', '23:00', 5);

const sexto = (await db.collection('turnos').where('objectiveId', '==', manifest.objectiveId).limit(30).get()).docs
  .map((d) => d.data())
  .find((t) => t.employeeId && ![manifest.herrera, manifest.bordino, manifest.martinez, manifest.morales, manifest.barrios].includes(t.employeeId));
if (!sexto?.employeeId) throw new Error('falta un sexto guardia en la copia de Obrador');

const turnoObrador = (id, empId, nombre, puesto, code, start, end, day, cruza) => {
  const finDia = cruza ? day + 1 : day;
  return db.collection('turnos').doc(id).set({
    empresaId: 'pruebas_sa',
    objectiveId: manifest.objectiveId,
    objectiveName: 'Obrador Malagueño',
    clientId: manifest.clientId,
    employeeId: empId,
    employeeName: nombre,
    code,
    positionName: puesto,
    startTime: new Date(`${dia(day)}T${start}:00-03:00`),
    endTime: new Date(`${dia(finDia)}T${end}:00-03:00`),
    hours: 8,
    draft: true,
    status: 'ACTIVE',
  });
};
for (const day of [11, 12, 13, 14, 15]) {
  await turnoObrador(`oct12_p1m_${day}`, manifest.herrera, 'HERRERA, ERICO VALENTIN', 'Puesto 1', 'M', '07:00', '15:00', day, false);
  await turnoObrador(`oct12_p1t_${day}`, manifest.bordino, 'BORDINO, SANTIAGO NICOLAS', 'Puesto 1', 'T', '15:00', '23:00', day, false);
  await turnoObrador(`oct12_p1n_${day}`, manifest.martinez, 'MARTINEZ, WALTER DOMINGO', 'Puesto 1', 'N', '23:00', '07:00', day, true);
  await turnoObrador(`oct12_p2m_${day}`, manifest.morales, 'MORALES, GASTON EZEQUIEL', 'Puesto 2', 'M', '07:00', '15:00', day, false);
  await turnoObrador(`oct12_p2t_${day}`, manifest.barrios, 'BARRIOS CARRANZA, ERICK', 'Puesto 2', 'T', '15:00', '23:00', day, false);
  await turnoObrador(`oct12_p2n_${day}`, sexto.employeeId, sexto.employeeName || 'NOCHE', 'Puesto 2', 'N', '23:00', '07:00', day, true);
}
console.log('octubre sembrado, noche puesto 2:', sexto.employeeName);

const fail = (msg) => { console.error('✗', msg); process.exitCode = 1; };

if (!process.argv.includes('--solo-exige')) {
const sesion = await abrirPlanificacion({
  objectiveId: manifest.objectiveId,
  clientId: manifest.clientId,
  year: 2026,
  month: 10,
  prefijo: 'cobertura-12h',
  port: 3026,
  devtoolsPort: 9366,
  scriptInicial: 'window.confirm = () => true;',
});
const { send, evaluate, waitFor, click, shot, cerrar } = sesion;

await waitFor(`document.querySelector('[data-plan-grilla]')`, 120000, 'grilla de Obrador');
await sleep(2000);
if (await evaluate(`!!document.querySelector('button[title^="Modo Corrección"]')`)) {
  await click(`document.querySelector('button[title^="Modo Corrección"]')`);
  await sleep(400);
}
await click(`document.querySelector('[data-modo-rapido-toggle]')`);
await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 8000, 'modo rápido');
await sleep(400);

const rango = await evaluate(`(() => {
  const filas = [...document.querySelectorAll('tr[id^=plan-emp-]')];
  const orden = filas.map((tr, i) => ({ i, martinez: /martinez/i.test(tr.innerText || '') })).sort((a, b) => Number(b.martinez) - Number(a.martinez));
  for (const { i: r } of orden) {
    const celdas = [...filas[r].querySelectorAll('td[data-rc]')];
    for (let c = 0; c < celdas.length - 4; c++) {
      const cinco = celdas.slice(c, c + 5).map((td) => (td.innerText || '').replace(/\\s+/g, ' ').trim());
      if (cinco.every((t) => /^N\\b/.test(t) && !/^N12/.test(t))) return { r, c };
    }
  }
  return null;
})()`);
console.log('rango N', rango);
if (!rango) {
  fail('no hay 5 noches seguidas');
  await cerrar();
  process.exit(1);
}

async function tecla(key, code, extra = {}) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: extra.vk || 0, modifiers: extra.modifiers || 0, text: extra.text || '' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: extra.vk || 0, modifiers: extra.modifiers || 0 });
}

await evaluate(`document.querySelector('td[data-rc="${rango.r}:${rango.c}"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))`);
await sleep(200);
for (let i = 0; i < 4; i++) {
  await tecla('ArrowRight', 'ArrowRight', { vk: 39, modifiers: 8 });
  await sleep(80);
}
await tecla('v', 'KeyV', { vk: 86, text: 'v' });
await sleep(150);
await tecla('Enter', 'Enter', { vk: 13 });
await sleep(800);
await waitFor(`document.querySelector('[data-cobertura-12h]')`, 8000, 'propuesta 12 h');
const texto = await evaluate(`document.querySelector('[data-cobertura-12h-texto]')?.textContent || ''`);
console.log(texto);
if (!/cubrir con 12 h/.test(texto)) fail('la propuesta no habla de 12 h');
await shot('propuesta');
await click(`document.querySelector('[data-cobertura-12h-aplicar]')`);
await sleep(1200);
const cobertura = await evaluate(`(() => {
  const tds = [...document.querySelectorAll('td[data-cobertura-dia]')].slice(${rango.c}, ${rango.c + 5});
  return tds.map((td) => ({ dia: td.dataset.coberturaDia, texto: (td.textContent || '').trim() }));
})()`);
console.log('cobertura', cobertura);
if (!cobertura?.every((d) => d.texto.startsWith('2/'))) fail('la fila COBERTURA no quedó 2/2 en los 5 días');
const rojas = await evaluate(`(() => {
  const celdas = [...document.querySelectorAll('td[data-rc]')].filter((td) => {
    const [r, c] = (td.dataset.rc || '').split(':').map(Number);
    return r !== ${rango.r} && c >= ${rango.c} && c < ${rango.c + 5};
  });
  return celdas.filter((td) => /\\b(D12|N12)\\b/.test(td.innerText || '')).map((td) => td.querySelector('div')?.className || '');
})()`);
console.log('clases 12 h', rojas);
if (!rojas?.length || !rojas.every((c) => c.includes('bg-red-600') && c.includes('text-white'))) fail('D12/N12 no quedaron en rojo con letra blanca');
await shot('aplicado');
await cerrar();
}

const libre = await abrirPlanificacion({
  objectiveId: libreId,
  clientId: manifest.clientId,
  year: 2026,
  month: 10,
  prefijo: 'exige-cobertura',
  port: 3033,
  devtoolsPort: 9368,
});
await libre.waitFor(`document.querySelector('[data-cobertura-sin-exigencia]')`, 120000, 'sin exigencia de cobertura');
await sleep(800);
const pie = await libre.evaluate(`document.querySelector('[data-cobertura-sin-exigencia]')?.textContent || ''`);
const filaCob = await libre.evaluate(`!!document.querySelector('td[data-cobertura-dia]')`);
const horas = await libre.evaluate(`[...document.querySelectorAll('tr[id^=plan-emp-]')].some((tr) => /\\d/.test(tr.innerText || ''))`);
console.log('pie', pie, 'dias cobertura', filaCob, 'hay horas', horas);
if (!/Sin exigencia/.test(pie)) fail('el pie no dice sin exigencia');
if (filaCob) fail('sigue la fila de cobertura por día');
await libre.shot('no');
await libre.cerrar();
console.log(process.exitCode ? 'con fallas' : 'ok');
