#!/usr/bin/env node
/**
 * Pega el TSV real de «A. TADICOR OCTUBRE.xlsx» y «Casisa 1. Ruta 20 OCTUBRE.xlsx»
 * en el modo rápido (emulador aislado 8190/9199) y saca las capturas de la ayuda y del resumen.
 *
 *   npx firebase emulators:start --only auth,firestore --config firebase.e2e-p2.json --project comtroldata
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 FIRESTORE_EMULATOR_HOST=127.0.0.1:8190 node scripts/e2e-modo-rapido-pegar.mjs
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

if (!process.env.PLANIF_EMU_PORTS) process.env.PLANIF_EMU_PORTS = '8080:8190,9099:9199';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8190';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9199';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8190') throw new Error('Solo contra el emulador aislado 127.0.0.1:8190');

const DIR = 'C:/Users/Mauro/OneDrive/Desktop/2026/10 - Octubre';
const py = spawnSync('python', ['-c', `
import openpyxl, json, unicodedata
base = ${JSON.stringify(DIR)}
def bloque(fname, hasta_ref=True):
    wb = openpyxl.load_workbook(base + "/" + fname, data_only=True)
    ws = wb.worksheets[0]
    day_row = day_col = None
    for r in range(1, min(ws.max_row, 80) + 1):
        for c in range(1, min(ws.max_column, 45) + 1):
            v = ws.cell(r, c).value
            if v == 1 and ws.cell(r, c + 1).value == 2:
                day_row, day_col = r, c
                break
        if day_row: break
    if not day_row: raise SystemExit("sin dias en " + fname)
    fin = ws.max_row
    for r in range(day_row + 1, ws.max_row + 1):
        n = ws.cell(r, 2).value
        if n and str(n).strip().upper().startswith("REFERENCIA"):
            fin = r - 1
            break
    leg_col = None
    for c in range(day_col - 1, 1, -1):
        nums = 0
        for r in range(day_row + 1, fin + 1):
            v = ws.cell(r, c).value
            if isinstance(v, (int, float)) and not isinstance(v, bool): nums += 1
        if nums >= 2:
            leg_col = c
            break
    filas = []
    personas = []
    for r in range(day_row - 1, fin + 1):
        vals = []
        for c in range(2, day_col + 31):
            v = ws.cell(r, c).value
            if hasattr(v, "strftime"): v = ""
            vals.append("" if v is None else str(v).replace("\\t", " ").replace("\\n", " ").strip())
        filas.append("\\t".join(vals))
        nombre = ws.cell(r, 2).value
        leg = ws.cell(r, leg_col).value if leg_col else None
        if r > day_row and nombre and str(nombre).strip():
            personas.append({"nombre": str(nombre).strip(), "legajo": "" if leg is None else str(leg).strip()})
    return {"tsv": "\\n".join(filas), "personas": personas}
out = {
  "tadicor": bloque("A. TADICOR OCTUBRE.xlsx"),
  "casisa": bloque("Casisa 1. Ruta 20 OCTUBRE.xlsx"),
}
print(json.dumps(out, ensure_ascii=False))
`], { encoding: 'utf-8' });
if (py.status !== 0) throw new Error(py.stderr || py.stdout);
const planillas = JSON.parse(py.stdout.slice(py.stdout.indexOf('{')));
const fail = (m) => { console.error('✗', m); process.exitCode = 1; };

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const app = initializeApp({ projectId: 'comtroldata' }, 'e2e-pegar');
const db = getFirestore(app);
const auth = getAuth(app);
const empresaId = 'bacarsa';
const now = Timestamp.now();
const clientId = 'cli_mqx';

const EMAIL = 'admin@bacarsa.com.ar';
try { await auth.deleteUser((await auth.getUserByEmail(EMAIL)).uid); } catch { /* nuevo */ }
const u = await auth.createUser({ email: EMAIL, password: 'admin1234', displayName: 'Admin' });
await auth.setCustomUserClaims(u.uid, { role: 'SUPERADMIN' });
await db.collection('system_users').doc(u.uid).set({ email: EMAIL, role: 'SUPERADMIN', empresaId, nombre: 'Admin' });
const modules = ['DASHBOARD', 'OPERATIONS', 'PLANNING', 'RRHH', 'CLIENTS', 'SERVICES', 'REPORTS', 'CONFIG'];
await db.collection('roles').doc('SUPERADMIN').set({
  name: 'Superadmin',
  permissions: Object.fromEntries(modules.map((m) => [m, ['read', 'create', 'update', 'delete', 'publish']])),
}, { merge: true });
await db.collection('empresas').doc(empresaId).set({ name: 'Bacarsa', migracionCompleta: true }, { merge: true });

const titulo = (nombre) => {
  const partes = nombre.trim().split(/\s+/);
  const apellido = partes[0];
  const resto = partes.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
  return `${apellido.toUpperCase()}, ${resto}`;
};
function gente(lista, obj, saltear) {
  const vistos = new Set();
  const out = [];
  for (const p of lista) {
    const clave = p.nombre.toUpperCase();
    if (vistos.has(clave) || saltear.has(clave)) continue;
    if (p.nombre.trim().split(/\s+/).filter((t) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/.test(t)).length < 2) continue;
    vistos.add(clave);
    out.push(p);
  }
  return out.reverse().map((p, i) => ({
    id: `${obj}${String(i + 1).padStart(2, '0')}`,
    name: titulo(p.nombre),
    legajo: p.legajo,
    excel: p.nombre,
  }));
}
const tadicor = gente(planillas.tadicor.personas, 'td', new Set(['VERGARA OSVALDO']));
const casisa = gente(planillas.casisa.personas, 'cs', new Set());
console.log('dotación Tadicor (sin VERGARA, orden invertido):', tadicor.map((g) => g.name).join(' · '));
console.log('dotación Casisa:', casisa.map((g) => g.name).join(' · '));

const turnos = ['M', 'T', 'N', 'P1M', 'P2M', 'P1T', 'P2T', 'C'].map((code) => {
  const horas = { M: ['07:00', '15:00', 8], T: ['15:00', '23:00', 8], N: ['23:00', '07:00', 8], P1M: ['08:00', '15:00', 7], P2M: ['10:00', '16:00', 6], P1T: ['15:00', '22:00', 7], P2T: ['16:00', '22:00', 6], C: ['07:00', '15:00', 8] };
  const [startTime, endTime, hours] = horas[code];
  return { code, startTime, endTime, hours, quantity: 4 };
});
async function objetivo(id, name, guardias) {
  for (const col of ['turnos', 'empleados']) {
    const snap = await db.collection(col).where(col === 'turnos' ? 'objectiveId' : 'preferredObjectiveId', '==', id).get();
    const b = db.batch();
    snap.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  await db.collection('servicios_sla').doc(`sla_${id}`).set({
    empresaId, clientId, clientName: 'Planillas', objectiveId: id, objectiveName: name,
    status: 'active', active: true, startDate: '2026-01-01', endDate: '2026-12-31',
    positions: [{ name: 'Puesto 1', positionName: 'Puesto 1', quantity: 4, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], allowedShiftTypes: turnos }],
    createdAt: now,
  });
  for (const g of guardias) {
    const [apellido, nombre] = g.name.split(',').map((s) => s.trim());
    await db.collection('empleados').doc(g.id).set({
      empresaId, name: g.name, fullName: g.name, nombre, apellido, lastName: apellido, firstName: nombre,
      fileNumber: g.legajo, legajo: g.legajo, status: 'ACTIVE', modalidad: 'NOMINA', category: 'VIGILADOR',
      preferredObjectiveId: id, preferredObjectiveIds: [id], createdAt: now,
    });
  }
}
await db.collection('clients').doc(clientId).set({
  name: 'Planillas Octubre', empresaId, status: 'ACTIVE', active: true,
  objetivos: [
    { id: 'obj_td', name: 'Tadicor', active: true, status: 'ACTIVE' },
    { id: 'obj_cs', name: 'Casisa Ruta 20', active: true, status: 'ACTIVE' },
  ],
  createdAt: now,
});
await objetivo('obj_td', 'Tadicor', tadicor);
await objetivo('obj_cs', 'Casisa Ruta 20', casisa);
console.log('✓ seed');

const PORT = Number(process.env.CAPTURA_PORT || 3023);
const sesion = await abrirPlanificacion({
  objectiveId: 'obj_td', clientId, year: 2026, month: 10, prefijo: 'modo-rapido',
  port: PORT, devtoolsPort: 9363,
});
const { send, evaluate, waitFor, click, shot, cerrar } = sesion;
try {
await waitFor(`document.getElementById('plan-emp-${tadicor[0].id}')`, 120000, 'grilla Tadicor');
await sleep(1500);
if (!(await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.dataset.modoRapidoToggle === '1'`))) {
  await click(`document.querySelector('[data-modo-rapido-toggle]')`);
  await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 8000, 'modo rápido');
}
await click(`document.querySelector('[data-modo-rapido-ayuda-abrir]')`);
await waitFor(`document.querySelector('[data-modo-rapido-ayuda-pegar]')`, 5000, 'ayuda');
const ayudaTxt = await evaluate(`document.querySelector('[data-modo-rapido-ayuda-pegar]').innerText`);
if (!/Ctrl\+V/.test(ayudaTxt) || !/D12/.test(ayudaTxt)) fail('la ayuda no explica el pegado ni D12/N12');
await shot('ayuda');
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await waitFor(`!document.querySelector('[data-modo-rapido-ayuda]')`, 5000, 'ayuda cerrada con Esc');

async function pegar(tsv) {
  await evaluate(`document.querySelector('[data-plan-grilla]')?.focus()`);
  await sleep(200);
  await evaluate(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(tsv)}); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  await waitFor(`document.querySelector('[data-pegar-resumen]')`, 8000, 'resumen de pegado');
}
await pegar(planillas.tadicor.tsv);
const resumen = await evaluate(`document.querySelector('[data-pegar-resumen]').innerText`);
console.log('resumen Tadicor:', resumen);
if (!/VERGARA/.test(resumen)) fail('el resumen no lista a VERGARA como sin encontrar');
if (!/sin encontrar/.test(resumen)) fail('el resumen no dice sin encontrar');
await shot('pegar-resumen');
await click(`document.querySelector('[data-pegar-aplicar]')`);
await sleep(400);
const filaNievas = tadicor.find((g) => g.name.startsWith('NIEVAS'));
await waitFor(`document.querySelector('#plan-emp-${filaNievas.id} td[data-rc]')?.innerText.trim().startsWith('T')`, 15000, 'NIEVAS día 1 = T');
const dia1 = await evaluate(`[...document.querySelectorAll('tr[id^=plan-emp-]')].slice(0, 3).map((tr) => tr.id.replace('plan-emp-','') + ' ' + (tr.querySelector('td[data-rc]')?.innerText || '').trim().slice(0, 6))`);
console.log('primeras filas día 1:', dia1.join(' · '));
await shot('pegar-tadicor');

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/admin/planificacion/?objectiveId=obj_cs&clientId=${clientId}&year=2026&month=10` });
await waitFor(`document.getElementById('plan-emp-${casisa[0].id}')`, 90000, 'grilla Casisa');
await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 8000, 'modo rápido recordado');
await sleep(800);
await pegar(planillas.casisa.tsv);
const resumenCs = await evaluate(`document.querySelector('[data-pegar-resumen]').innerText`);
console.log('resumen Casisa:', resumenCs);
if (/sin encontrar/.test(resumenCs)) fail('Casisa dejó gente sin encontrar: ' + resumenCs);
await click(`document.querySelector('[data-pegar-aplicar]')`);
const filaMoreno = casisa.find((g) => g.name.startsWith('MORENO'));
await waitFor(`document.querySelector('#plan-emp-${filaMoreno.id} td[data-rc]')?.innerText.trim().startsWith('M')`, 15000, 'MORENO día 1 = M');
await sleep(500);
await shot('pegar-casisa');
console.log('✓ pegado de Tadicor y Casisa');
} finally {
  await cerrar();
}
process.exit(process.exitCode || 0);
