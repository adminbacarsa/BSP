/**
 * Prueba local: seguimiento «detalle de los turnos» tras Romina Romero en mayo.
 * Requiere emuladores: Firestore 8080, Auth 9099 (Functions opcional).
 */
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'comtroldata';

const path = require('path');
const functionsRoot = path.join(__dirname, '../apps/functions');
const admin = require(path.join(functionsRoot, 'node_modules/firebase-admin'));
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'comtroldata' });
}

const { tryDeterministicDataReply } = require(path.join(
  functionsRoot,
  'lib/assistant/assistantDeterministicRouter',
));

function assertNoFirestoreIds(text, label) {
  if (!text) {
    console.log(`FAIL ${label}: respuesta vacía`);
    return false;
  }
  const idLike = text.match(/\b[a-zA-Z0-9]{10,22}\b/g) || [];
  const bad = idLike.filter((s) => /^[a-zA-Z0-9]{10,}$/.test(s) && !/\s/.test(s) && s.length <= 22);
  if (bad.length > 0) {
    console.log(`FAIL ${label}: parece contener IDs: ${bad.slice(0, 3).join(', ')}`);
    return false;
  }
  console.log(`OK ${label}`);
  return true;
}

const toolCtx = {
  persona: 'SYSTEM',
  empresaId: 'bacarsa',
  readableModuleKeys: ['DASHBOARD', 'PLANNING', 'OPERATIONS', 'REPORTS', 'RRHH', 'CLIENTS', 'SERVICES', 'CONFIG'],
  selfEmployeeFirestoreId: null,
  referenceDateYsMmDd: '2026-05-17',
};

const prior = [
  { role: 'user', content: 'cuantas horas trabajo romero romina en mayo' },
  {
    role: 'assistant',
    content:
      'Según **Firestore**, **ROMERO, Romina Paola** en **mayo 2026**:\n\n- **Horas planificadas de cobertura:** **120** h\n',
  },
];

(async () => {
  console.log('--- Test 1: detalle de los turnos (seguimiento) ---');
  const r1 = await tryDeterministicDataReply(
    'detalle de los turnos',
    toolCtx,
    true,
    'DASHBOARD',
    '/admin',
    prior,
  );
  console.log(r1 || '(null — iría a Gemini)');
  console.log('\n--- Test 2: horas Romina mayo ---');
  const r2 = await tryDeterministicDataReply(
    'cuantas horas trabajo romero romina en mayo',
    toolCtx,
    true,
    'DASHBOARD',
    '/admin',
    [],
  );
  console.log(r2 ? r2.slice(0, 500) + (r2.length > 500 ? '…' : '') : '(null)');

  console.log('\n--- Test 3: quienes son (tras franco en hilo) ---');
  const priorFranco = [
    { role: 'user', content: 'quien esta de franco hoy' },
    {
      role: 'assistant',
      content:
        'Hay 17 francos hoy. CASISA - Obrador: 5iKCc0Azmy6c, 6ZYe3LGqNULR (respuesta vieja con IDs).',
    },
  ];
  const r3 = await tryDeterministicDataReply(
    'quienes son',
    toolCtx,
    true,
    'DASHBOARD',
    '/admin',
    priorFranco,
  );
  console.log(r3 || '(null)');
  assertNoFirestoreIds(r3, 'franco quienes son');

  console.log('\n--- Test 4: sí tras oferta resumen SLA todos objetivos mayo ---');
  const priorSla = [
    {
      role: 'assistant',
      content:
        '¿Te gustaría ver un resumen de las horas vendidas por SLA, las ya planificadas en turnos y las pendientes a planificar para todos los objetivos con servicios activos en mayo de 2026?',
    },
  ];
  const r4 = await tryDeterministicDataReply('si', toolCtx, true, 'SERVICES', '/admin/servicios', priorSla);
  console.log(r4 ? r4.slice(0, 600) + (r4.length > 600 ? '…' : '') : '(null)');
  if (!r4 || !/horas vendidas sla|horas \*\*sla\*\*/i.test(r4)) {
    console.log('FAIL test 4: no devolvió resumen SLA');
  } else {
    console.log('OK test 4 resumen SLA');
  }
  console.log('\n--- Test 5: franco en H. MISERICORDIA ---');
  const r5 = await tryDeterministicDataReply(
    'A quien tengo de franco en H. MISERICORDIA?',
    toolCtx,
    true,
    'PLANNING',
    '/admin/planificacion',
    [],
  );
  console.log(r5 ? r5.slice(0, 500) : '(null)');
  assertNoFirestoreIds(r5, 'franco misericordia');

  console.log('\n--- Test 6: buscar hospital misericordia ---');
  const { ejecutarBuscarObjetivosPorNombre } = require(path.join(functionsRoot, 'lib/assistant/assistantDataTools'));
  const obj = await ejecutarBuscarObjetivosPorNombre(toolCtx, { texto: 'hospital misericordia', limite: 3 });
  console.log(obj.coincidencias?.map((c) => c.nombre_objetivo) || obj);

  console.log('\n--- Test 7: contar clientes ---');
  const { ejecutarContarClientesEmpresa, ejecutarListarObjetivosCliente } = require(path.join(
    functionsRoot,
    'lib/assistant/assistantDataTools',
  ));
  const clients = await ejecutarContarClientesEmpresa(toolCtx, {});
  console.log('clientes activos:', clients.cuenta_clientes_activos);
  const casisa = await ejecutarListarObjetivosCliente(toolCtx, { texto_cliente: 'casisa', limite: 8 });
  console.log('CASISA objetivos:', casisa.cuenta_objetivos ?? casisa.error ?? casisa.ambigua);

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
