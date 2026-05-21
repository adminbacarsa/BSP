#!/usr/bin/env node
/**
 * E2E emulador: auth admin → optimizePlanningGemini con contexto mínimo válido.
 * Requiere: Firestore 8080, Auth 9099, Functions 5001, GEMINI_API_KEY en apps/functions/.env
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import net from 'net';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function waitPort(port, label, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tryOnce = () => {
      const s = net.createConnection({ port, host: '127.0.0.1' }, () => {
        s.end();
        resolve();
      });
      s.on('error', () => {
        s.destroy();
        if (Date.now() >= deadline) reject(new Error(`Timeout ${label} :${port}`));
        else setTimeout(tryOnce, 800);
      });
    };
    tryOnce();
  });
}

function loadGeminiEnv() {
  const p = join(root, 'apps/functions/.env');
  if (!existsSync(p)) throw new Error('Falta apps/functions/.env');
  const text = readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('GEMINI_API_KEY=')) {
      process.env.GEMINI_API_KEY = t.slice('GEMINI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
      break;
    }
  }
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no definida en apps/functions/.env');
}

async function main() {
  console.log('COSP — test agente planificación (emulador)\n');
  for (const [port, label] of [[8080, 'Firestore'], [9099, 'Auth'], [5001, 'Functions']]) {
    await waitPort(port, label);
    console.log(`✓ ${label} :${port}`);
  }
  loadGeminiEnv();
  console.log('✓ GEMINI_API_KEY cargada (no se imprime)\n');

  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  process.env.FUNCTIONS_EMULATOR = 'true';

  const { initializeApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = await import('firebase/auth');
  const { getFunctions, connectFunctionsEmulator, httpsCallable } = await import('firebase/functions');
  const { initializeApp: initAdmin, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  if (!getApps().length) initAdmin({ projectId: 'comtroldata' });
  const adb = getFirestore();

  const app = initializeApp({
    apiKey: 'fake-api-key',
    authDomain: 'localhost',
    projectId: 'comtroldata',
  });
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const functions = getFunctions(app, 'us-central1');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);

  const email = 'admin@bacarsa.com.ar';
  const password = 'admin1234';
  let cred;
  try {
    cred = await signInWithEmailAndPassword(auth, email, password);
    console.log(`✓ Login ${email}`);
  } catch (e) {
    console.error('✗ Login falló — ejecutá: npm run seed');
    throw e;
  }

  const empresaId = 'bacarsa';
  const clientsSnap = await adb.collection('clients').limit(20).get();
  let clientId = null;
  let objectiveId = null;
  let objectiveName = null;
  for (const doc of clientsSnap.docs) {
    const d = doc.data();
    if (String(d.empresaId || '') !== empresaId && d.empresaId) continue;
    const objs = Array.isArray(d.objetivos) ? d.objetivos : [];
    if (objs.length === 0) continue;
    const o = objs.find((x) => x && (x.active !== false)) || objs[0];
    clientId = doc.id;
    objectiveId = o.id || o.name;
    objectiveName = o.name || objectiveId;
    break;
  }
  if (!objectiveId) {
    console.warn('⚠ Sin cliente/objetivo en emulador — contexto sintético');
    objectiveId = 'test-obj';
    objectiveName = 'Objetivo prueba';
  } else {
    console.log(`✓ Objetivo: ${objectiveName} (${objectiveId})`);
  }

  const slaSnap = await adb.collection('servicios_sla').limit(30).get();
  let slaVendidas = 2160;
  let puestos = [
    {
      positionName: 'General',
      qty: 3,
      coverageType: '24hs',
      shifts: [{ code: 'M', hours: 8 }, { code: 'T', hours: 8 }, { code: 'N', hours: 8 }],
      activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    },
  ];
  for (const doc of slaSnap.docs) {
    const s = doc.data();
    if (String(s.empresaId || '') !== empresaId) continue;
    if (clientId && s.clientId && s.clientId !== clientId) continue;
    slaVendidas = Number(s.totalMonthlyHours) || slaVendidas;
    if (Array.isArray(s.positions) && s.positions.length) puestos = s.positions;
    break;
  }
  console.log(`✓ SLA vendidas ref: ${slaVendidas}h\n`);

  const y = new Date().getFullYear();
  const m = new Date().getMonth();
  const days = [];
  const last = Math.min(7, new Date(y, m + 1, 0).getDate());
  for (let d = 1; d <= last; d++) {
    days.push(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }

  const empleadosSnap = await adb.collection('empleados').where('empresaId', '==', empresaId).limit(12).get();
  const empleados = empleadosSnap.docs.map((doc) => ({
    id: doc.id,
    nombre: doc.data().fullName || doc.data().name || doc.id,
    puestoAsignado: 'General',
    defaultPos: 'General',
    ownerVirtual: false,
    horasMes: 168,
    priorHoursCiclo: 0,
    diferenciaProm: 0,
  }));
  if (empleados.length < 3) {
    for (let i = empleados.length; i < 4; i++) {
      empleados.push({
        id: `e${i}`,
        nombre: `Empleado ${i}`,
        puestoAsignado: 'General',
        defaultPos: 'General',
        ownerVirtual: false,
        horasMes: 168,
        priorHoursCiclo: 0,
        diferenciaProm: 0,
      });
    }
  }

  const planificacionCompleta = {};
  const codes = ['M', 'T', 'N', 'F'];
  empleados.forEach((e, ei) => {
    planificacionCompleta[e.id] = days.map((fecha, di) => ({
      fecha,
      codigo: codes[(di + ei) % 4],
      puesto: 'General',
    }));
  });

  const coberturaPorDia = {};
  days.forEach((fecha) => {
    coberturaPorDia[fecha] = {
      General: { actual: 16, requerido: 24, deficit: 8, retDisponibles: 2 },
    };
  });

  const context = {
    mes: `${y}-${String(m + 1).padStart(2, '0')}`,
    objetivo: objectiveName,
    slaVendidas,
    puestos,
    empleados,
    dias: days,
    diasBloqueados: [],
    planificacionCompleta,
    ausencias: {},
    coberturaPorDia,
    autoCycles: ['6+2'],
    cicloCCT: {
      cortePrev: `${m === 0 ? y - 1 : y}-${String(m === 0 ? 12 : m).padStart(2, '0')}-26`,
      corteActual: `${y}-${String(m + 1).padStart(2, '0')}-25`,
      descripcion: 'Test emulador',
    },
  };

  console.log('Llamando optimizePlanningGemini (timeout ~180s)…');
  const fn = httpsCallable(functions, 'optimizePlanningGemini', { timeout: 210000 });
  const t0 = Date.now();
  let res;
  try {
    res = await fn({ context, empresaId });
  } catch (e) {
    const code = e?.code || e?.errorInfo?.code;
    const msg = e?.message || e?.details || String(e);
    console.error('\n✗ Callable error:', code, msg);
    if (e?.details) console.error('  details:', e.details);
    if (e?.customData) console.error('  customData:', JSON.stringify(e.customData));
    try {
      console.error('  full:', JSON.stringify(e, Object.getOwnPropertyNames(e)));
    } catch {
      /* ignore */
    }
    throw e;
  }
  const data = res.data;
  const ms = Date.now() - t0;

  console.log(`\n✓ Respuesta en ${(ms / 1000).toFixed(1)}s`);
  console.log(`  bloqueoEstructural: ${data.bloqueoEstructural}`);
  console.log(`  correcciones: ${data.correcciones?.length ?? 0}`);
  console.log(`  resumen: ${(data.resumen || '').slice(0, 200)}`);
  if (data.metricas) {
    console.log(`  métricas: hs=${data.metricas.totalHsFacturables} déficit días=${data.metricas.diasConDeficit?.length ?? 0}`);
  }
  if (data.correcciones?.length) {
    console.log('  muestra corrección:', JSON.stringify(data.correcciones[0]));
  }
  console.log('\nOK — pipeline Gemini operativo en emulador.');
  console.log('UI manual: http://localhost:3000/admin/planificacion → Automatizar');
}

main().catch((e) => {
  console.error('\n✗', e.message || e);
  process.exit(1);
});
