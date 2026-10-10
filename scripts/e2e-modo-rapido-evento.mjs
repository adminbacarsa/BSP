/**
 * Captura del resumen de pegado con la pregunta de la «E» y del panel de avisos con «Visto».
 * Emulador aislado 8190/9199. No toca otros objetivos.
 *
 *   PLANIF_EMU_PORTS=8080:8190,9099:9199 FIRESTORE_EMULATOR_HOST=127.0.0.1:8190 node scripts/e2e-modo-rapido-evento.mjs
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { abrirPlanificacion, sleep } from './planif-cdp-lib.mjs';

if (!process.env.PLANIF_EMU_PORTS) process.env.PLANIF_EMU_PORTS = '8080:8190,9099:9199';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8190';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9199';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8190') throw new Error('Solo contra el emulador aislado 127.0.0.1:8190');

const require = createRequire(fileURLToPath(new URL('../apps/functions/package.json', import.meta.url)));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const app = initializeApp({ projectId: 'comtroldata' }, 'e2e-evento');
const db = getFirestore(app);
const auth = getAuth(app);

const empresaId = 'bacarsa';
const clientId = 'cli_ev';
const objectiveId = 'obj_ev';
const now = Timestamp.now();
const EMAIL = 'admin@bacarsa.com.ar';

let u;
try { u = await auth.getUserByEmail(EMAIL); }
catch { u = await auth.createUser({ email: EMAIL, password: 'admin1234', displayName: 'Admin' }); }
await auth.updateUser(u.uid, { password: 'admin1234' });
await auth.setCustomUserClaims(u.uid, { role: 'SUPERADMIN' });
await db.collection('system_users').doc(u.uid).set({ email: EMAIL, role: 'SUPERADMIN', empresaId, nombre: 'Admin' }, { merge: true });
const modules = ['DASHBOARD', 'OPERATIONS', 'PLANNING', 'RRHH', 'CLIENTS', 'SERVICES', 'REPORTS', 'CONFIG'];
await db.collection('roles').doc('SUPERADMIN').set({
    name: 'Superadmin',
    permissions: Object.fromEntries(modules.map((m) => [m, ['read', 'create', 'update', 'delete', 'publish']])),
}, { merge: true });
await db.collection('empresas').doc(empresaId).set({ name: 'Bacarsa', migracionCompleta: true }, { merge: true });

const guardias = [
    { id: 'ev01', name: 'LOPEZ, Daniel Alberto', legajo: '1001' },
    { id: 'ev02', name: 'BORDINO, Carlos', legajo: '1002' },
    { id: 'ev03', name: 'VIDELA, Juan', legajo: '1003' },
    { id: 'ev04', name: 'ARAYA, Pedro', legajo: '1004' },
    { id: 'ev05', name: 'KASIANCHUK, Ivan', legajo: '1005' },
];
for (const col of ['turnos', 'empleados']) {
    const snap = await db.collection(col).where(col === 'turnos' ? 'objectiveId' : 'preferredObjectiveId', '==', objectiveId).get();
    const b = db.batch();
    snap.docs.forEach((d) => b.delete(d.ref));
    if (snap.size) await b.commit();
}
const turnos = ['M', 'T', 'N', 'D12', 'N12'].map((code) => {
    const horas = { M: ['07:00', '15:00', 8], T: ['15:00', '23:00', 8], N: ['23:00', '07:00', 8], D12: ['07:00', '19:00', 12], N12: ['19:00', '07:00', 12] };
    const [startTime, endTime, hours] = horas[code];
    return { code, startTime, endTime, hours, quantity: 4 };
});
await db.collection('servicios_sla').doc(`sla_${objectiveId}`).set({
    empresaId, clientId, clientName: 'Planillas', objectiveId, objectiveName: 'Pegado evento',
    status: 'active', active: true, startDate: '2026-01-01', endDate: '2026-12-31',
    positions: [{ name: 'Puesto 1', positionName: 'Puesto 1', quantity: 4, coverageType: '24hs', activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], allowedShiftTypes: turnos }],
    createdAt: now,
});
for (const g of guardias) {
    const [apellido, nombre] = g.name.split(',').map((s) => s.trim());
    await db.collection('empleados').doc(g.id).set({
        empresaId, name: g.name, fullName: g.name, nombre, apellido, lastName: apellido, firstName: nombre,
        fileNumber: g.legajo, legajo: g.legajo, status: 'ACTIVE', modalidad: 'NOMINA', category: 'VIGILADOR',
        preferredObjectiveId: objectiveId, preferredObjectiveIds: [objectiveId], createdAt: now,
    });
}
await db.collection('clients').doc(clientId).set({
    name: 'Pegado evento', empresaId, status: 'ACTIVE', active: true,
    objetivos: [{ id: objectiveId, name: 'Pegado evento', active: true, status: 'ACTIVE' }],
    createdAt: now,
});
console.log('✓ seed');

const tsvE = [
    'LOPEZ DANIEL ALBERTO\tE\tE',
    'BORDINO CARLOS\tE\tM',
    'VIDELA JUAN\tE\tT',
    'ARAYA PEDRO\tE\tN',
    'KASIANCHUK IVAN\tN\tN',
].join('\n');
const tsvDescanso = [
    'LOPEZ DANIEL ALBERTO\tN\tM',
    'BORDINO CARLOS\tN\tM',
].join('\n');

const fail = (m) => { console.error('✗', m); process.exitCode = 1; };
const PORT = Number(process.env.CAPTURA_PORT || 3027);
const sesion = await abrirPlanificacion({
    objectiveId, clientId, year: 2026, month: 10, prefijo: 'modo-rapido',
    port: PORT, devtoolsPort: 9371,
});
const { evaluate, waitFor, click, shot, cerrar } = sesion;
try {
    await waitFor(`document.getElementById('plan-emp-ev01')`, 120000, 'grilla');
    await sleep(1200);
    if (!(await evaluate(`document.querySelector('[data-modo-rapido-toggle]')?.dataset.modoRapidoToggle === '1'`))) {
        await click(`document.querySelector('[data-modo-rapido-toggle]')`);
        await waitFor(`document.querySelector('[data-modo-rapido-capa]')`, 8000, 'modo rápido');
    }
    async function pegar(tsv) {
        await evaluate(`document.querySelector('[data-plan-grilla]')?.focus()`);
        await sleep(200);
        await evaluate(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(tsv)}); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
        await waitFor(`document.querySelector('[data-pegar-resumen]')`, 8000, 'resumen de pegado');
    }
    await pegar(tsvE);
    const pregunta = await evaluate(`document.querySelector('[data-pegar-dias-e]')?.innerText || ''`);
    console.log('pregunta E:', pregunta.replace(/\s+/g, ' '));
    if (!/¿Evento o Enfermedad\?/.test(pregunta)) fail('el resumen no pregunta Evento o Enfermedad');
    if (!/4 celdas/.test(pregunta)) fail('no cuenta las 4 celdas E del mismo día');
    const defecto = await evaluate(`[...document.querySelectorAll('[data-pegar-e-tipo]')].map((s) => s.getAttribute('data-pegar-e-tipo') + '=' + s.value).join(' ')`);
    console.log('selectores:', defecto);
    if (!/EVENTO/.test(defecto) || !/=E\b/.test(defecto)) fail('el día de 4 no arranca en Evento o el de 1 no arranca en Enfermedad: ' + defecto);
    await shot('pegar-evento');

    await click(`document.querySelector('[data-pegar-cancelar]')`);
    await waitFor(`!document.querySelector('[data-pegar-excel]')`, 5000, 'resumen cerrado');
    await pegar(tsvDescanso);
    await click(`document.querySelector('[data-pegar-aplicar]')`);
    await waitFor(`document.querySelector('[data-modo-rapido-avisos]')`, 8000, 'avisos');
    if (await evaluate(`!!document.querySelector('[data-modo-rapido-avisos-pill]')`)) {
        await click(`document.querySelector('[data-modo-rapido-avisos-pill]')`);
    }
    await waitFor(`document.querySelector('[data-avisos-todos-vistos]')`, 5000, 'marcar todos');
    await waitFor(`document.querySelector('[data-aviso-visto]')`, 5000, 'visto');
    await shot('avisos-vistos');
    const antes = Number(await evaluate(`document.querySelector('[data-modo-rapido-avisos]')?.getAttribute('data-modo-rapido-avisos') || '0'`));
    await click(`document.querySelector('[data-aviso-visto]')`);
    await sleep(400);
    const despues = Number(await evaluate(`document.querySelector('[data-modo-rapido-avisos]')?.getAttribute('data-modo-rapido-avisos') || '0'`));
    console.log('avisos', antes, '→', despues);
    if (!(despues < antes)) fail('Visto no sacó el aviso de la lista');
    const tenue = await evaluate(`!!document.querySelector('[data-modo-rapido-marca-tenue]')`);
    if (!tenue) fail('la marca del aviso visto no quedó en la celda');
    console.log('✓ pregunta de la E y avisos vistos');
} finally {
    await cerrar();
}
process.exit(process.exitCode || 0);
