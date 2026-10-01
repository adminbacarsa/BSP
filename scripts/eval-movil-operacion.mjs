import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolvePath(here, '..');
const web2 = join(repo, 'apps/web2');
const require = createRequire(join(web2, 'package.json'));
const ts = require('typescript');

let failed = 0;
function check(name, ok) {
  if (!ok) {
    failed += 1;
    console.error('FAIL', name);
  } else {
    console.log('OK', name);
  }
}

// ── Cargador: transpila .ts/.tsx del front resolviendo `@/` y relativos sin extensión ──
const outdir = join(web2, '.movil-eval');
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
const compiled = new Map();

function resolveSource(spec, fromDir) {
  let base;
  if (spec.startsWith('@/')) base = join(web2, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = resolvePath(fromDir, spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

function loadModule(absPath) {
  if (compiled.has(absPath)) return compiled.get(absPath);
  const hash = createHash('md5').update(absPath).digest('hex').slice(0, 10);
  const outfile = join(outdir, `${hash}.mjs`);
  compiled.set(absPath, outfile);
  const source = readFileSync(absPath, 'utf8');
  let js = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, verbatimModuleSyntax: false },
    fileName: absPath,
  }).outputText;
  js = js.replace(/(from\s+|import\s*\()\s*(['"])([^'"]+)\2/g, (whole, lead, quote, spec) => {
    const target = resolveSource(spec, dirname(absPath));
    if (!target) return whole;
    return `${lead}${quote}${pathToFileURL(loadModule(target)).href}${quote}`;
  });
  writeFileSync(outfile, js);
  return outfile;
}

async function importFront(relPath) {
  return import(pathToFileURL(loadModule(join(web2, 'src', relPath))).href);
}

const { createElement } = await import(pathToFileURL(require.resolve('react')).href);
const { renderToStaticMarkup } = await import(pathToFileURL(require.resolve('react-dom/server')).href);
const render = (component, props) => renderToStaticMarkup(createElement(component, props));

const { createWriteQueue } = await importFront('lib/movil/writeQueue.ts');
const { createCallableGate } = await importFront('lib/movil/callableOnline.ts');
const { movilNavForPermissions, movilModulesForPermissions, movilModuleForPath, movilRouteHasMobileVersion } = await importFront('lib/movil/navItems.ts');
const { alertaDelModulo, movilDestinosVisibles } = await importFront('lib/movil/destinos.ts');
const { coveragePct, guardStatusLabel, guardTone } = await importFront('lib/movil/guardTone.ts');

// ── Cola offline y callables ──
const online = { value: false };
const queue = createWriteQueue(() => online.value);
let writes = 0;
const queued = await queue.enqueue('Salida Baez', async () => { writes += 1; });
check('sin red queda pendiente', queued === 'queued' && queue.pending()[0] === 'Salida Baez' && writes === 0);
online.value = true;
const flushed = await queue.flush();
check('al volver la señal se envía', flushed === 1 && writes === 1 && queue.pending().length === 0);

const gate = createCallableGate(() => online.value);
online.value = false;
let calls = 0;
let threw = false;
try {
  await gate.run('Revertir', async () => { calls += 1; });
} catch (error) {
  threw = String(error.message).includes('requiere conexión');
}
check('callable avisa y queda para reintentar', threw && gate.pending().length === 1 && calls === 0);
online.value = true;
check('callable se reintenta', (await gate.retry()) === 1 && calls === 1);

// ── Shell: barra corta y menú por permisos ──
const barras = (canRead, path, query) => movilNavForPermissions(canRead, path, query).map((item) => item.label).join(',');
check('barra de Operación', barras((key) => key === 'OPERATIONS', '/admin/operaciones') === 'Objetivos,Alertas de operación,Sala,Menú');
check('Operación no mezcla otros módulos', !barras((key) => key === 'OPERATIONS', '/admin/operaciones').includes('Novedades') && !barras((key) => key === 'OPERATIONS', '/admin/operaciones').includes('Eventuales'));
check('barra de Supervisión', barras((key) => key === 'SUPERVISION', '/admin/operaciones', { modo: 'supervision' }) === 'Objetivos,Alertas,Menú');
check('barra de Planificación', barras((key) => key === 'PLANNING', '/admin/planificacion') === 'Próximos días,Huecos,Menú');
check('barra de RRHH', barras((key) => key === 'RRHH', '/admin/rrhh/movil') === 'Hoy,Cargar,Novedades,Menú');
check('barra de Eventuales', barras((key) => key === 'EVENTUALES' || key === 'RRHH', '/admin/rrhh/eventuales') === 'Bolsa,ARCA pendientes,Alta,Menú');
check('barra de Servicios', barras((key) => key === 'SERVICES', '/admin/servicios') === 'Lista,Menú');
const opsNav = movilNavForPermissions((key) => key === 'OPERATIONS', '/admin/operaciones');
check('Sala y Menú no navegan', opsNav.find((item) => item.label === 'Sala').href === '' && opsNav.find((item) => item.label === 'Menú').href === '');
check('un operador sin RRHH no lo ve', !movilDestinosVisibles((key) => key === 'OPERATIONS').some((item) => item.id === 'rrhh' || item.id === 'eventuales'));
check('ALTA_ARCA_PENDIENTE es de Operación', alertaDelModulo('operacion', 'ALTA_ARCA_PENDIENTE') && !alertaDelModulo('eventuales', 'ALTA_ARCA_PENDIENTE'));
check('el resto de ARCA es de Eventuales', alertaDelModulo('eventuales', 'BAJA_ARCA') && !alertaDelModulo('operacion', 'BAJA_ARCA') && !alertaDelModulo('operacion', 'ARCA_PENDIENTE'));
check('novedad de RRHH no entra en Operación', !alertaDelModulo('operacion', 'RRHH_NOVEDAD') && alertaDelModulo('rrhh', 'RRHH_NOVEDAD'));
check('hueco de planificación no entra en Operación', !alertaDelModulo('operacion', 'VACANTE_A_PLANIFICACION') && alertaDelModulo('planificacion', 'CRONOGRAMA_SIN_PUBLICAR'));
const saModules = movilModulesForPermissions(() => true);
check('SuperAdmin ve los 6 módulos', saModules.map((item) => item.label).join(',') === 'Operación,Supervisión,Planificación,Eventuales,RRHH,Servicios');
check('solo SUPERVISION ve Supervisión y nada más', movilModulesForPermissions((key) => key === 'SUPERVISION').map((item) => item.id).join(',') === 'supervision');
check('RRHH ve Eventuales y RRHH', movilModulesForPermissions((key) => key === 'RRHH').map((item) => item.id).join(',') === 'eventuales,rrhh');
check('Supervisión se reconoce por ?modo', movilModuleForPath('/admin/operaciones', { modo: 'supervision' })?.id === 'supervision');
check('eventuales gana sobre rrhh en la ruta', movilModuleForPath('/admin/rrhh/eventuales')?.id === 'eventuales');
check('planificación sin versión celular', movilRouteHasMobileVersion('/admin/planificacion') === false && movilRouteHasMobileVersion('/admin/rrhh') === false);
check('operaciones, servicios y supervisión con versión celular', movilRouteHasMobileVersion('/admin/operaciones') && movilRouteHasMobileVersion('/admin/servicios') && movilRouteHasMobileVersion('/admin/supervision'));

const { MovilMenuGrid } = await importFront('components/movil/MovilMenuGrid.tsx');
const menuHtml = render(MovilMenuGrid, {
  empresaId: 'pruebas_sa',
  empresaName: 'Pruebas S.A.',
  empresas: [{ id: 'pruebas_sa', name: 'Pruebas S.A.' }, { id: 'bacarsa', name: 'Bacar S.A.' }],
  canSwitchEmpresa: true,
  modules: saModules,
  currentModuleId: 'operacion',
  onModule: () => {}, onSwitchEmpresa: () => {}, onAsistente: () => {}, onEscritorio: () => {}, onAvisos: () => {}, onLogout: () => {},
});
check('menú 390: 6 módulos, empresa activa y cerrar sesión', (menuHtml.match(/data-movil-module=/g) || []).length === 6 && menuHtml.includes('Empresa activa') && menuHtml.includes('Cambiar a Bacar S.A.') && menuHtml.includes('Cerrar sesión') && menuHtml.includes('Asistente'));
check('módulo sin versión celular avisa', menuHtml.includes('En la computadora'));

const { MovilDesktopOnly } = await importFront('components/movil/MovilDesktopOnly.tsx');
const gateHtml = render(MovilDesktopOnly, { moduleLabel: 'Planificación', onOpenFull: () => {} });
check('pantalla «Disponible en la computadora»', gateHtml.includes('Disponible en la computadora') && gateHtml.includes('Abrir versión completa') && gateHtml.includes('Planificación'));

// ── Operación ──
const shift = { isAbsent: true, employeeName: 'Guerrero, Martín', code: 'T', id: '1' };
check('ausente es Llegó', guardTone(shift) === 'aus' && guardStatusLabel(shift).includes('Ausente'));
check('cobertura', coveragePct({ active: 3, retention: 1, absent: 1, vacant: 1 }) === 67);

const { OperacionScreens } = await importFront('components/movil/OperacionScreens.tsx');
const noops = { onBack: () => {}, onOpen: () => {}, onCounter: () => {}, onLlego: () => {}, onRevertir: () => {}, onSalida: () => {}, onProtocolo: () => {}, onRetencion: () => {}, onSala: () => {} };
const html = render(OperacionScreens, {
  empresa: 'Pruebas S.A.',
  modeLabel: 'Manual',
  online: true,
  pendingLabel: null,
  stats: { activos: 12, retenidos: 1, ausentes: 2, vacantes: 3, plan: 1 },
  panel: 'home',
  objective: null,
  alerts: [],
  objectives: [
    { objectiveId: 'peaje', name: 'Peaje 9 Norte', client: 'Ruta 9', active: 3, retention: 1, absent: 1, vacant: 1, plan: 0, shifts: [] },
    { objectiveId: 'obra', name: 'Obrador Malagueño', client: 'Malagueño', active: 6, retention: 0, absent: 0, vacant: 0, plan: 0, shifts: [] },
  ],
  ...noops,
});
check('home 390 muestra Peaje y contadores', html.includes('Peaje 9 Norte') && html.includes('Obrador Malagueño') && html.includes('>12<'));
check('MANUAL abre la sala (no el menú)', html.includes('aria-label="Sala · Manual"'));

const objetivoPeaje = {
  objectiveId: 'peaje',
  name: 'Peaje 9 Norte',
  active: 1,
  retention: 1,
  absent: 1,
  vacant: 0,
  plan: 0,
  shifts: [
    { id: 'b', employeeName: 'Baez, Juan', code: 'M', isRetention: true, retentionMinutes: 42, positionName: 'Puesto 1' },
    { id: 'g', employeeName: 'Guerrero, Martín', code: 'T', isAbsent: true, positionName: 'Puesto 1' },
  ],
};
const guardHtml = render(OperacionScreens, {
  empresa: 'Pruebas S.A.',
  modeLabel: 'Manual',
  online: false,
  pendingLabel: 'Salida Baez',
  stats: { activos: 1, retenidos: 1, ausentes: 1, vacantes: 0, plan: 0 },
  panel: 'objetivo',
  alerts: [],
  objectives: [],
  objective: objetivoPeaje,
  ...noops,
});
check('objetivo muestra Llegó, protocolo y pendiente', guardHtml.includes('Llegó?') && guardHtml.includes('Protocolo') && guardHtml.includes('Pendiente de enviar') && guardHtml.includes('42'));
check('marco de pantalla', html.includes('data-movil-screen') && html.includes('max-w-[480px]'));

// ── Supervisión: mismo CC en solo lectura ──
const supervisionHtml = render(OperacionScreens, {
  empresa: 'Pruebas S.A.',
  modeLabel: 'Auto',
  online: true,
  pendingLabel: null,
  readOnly: true,
  stats: { activos: 1, retenidos: 1, ausentes: 1, vacantes: 0, plan: 0 },
  panel: 'objetivo',
  alerts: [],
  objectives: [],
  objective: objetivoPeaje,
  ...noops,
});
check('supervisión muestra guardias y estados', supervisionHtml.includes('Baez, Juan') && supervisionHtml.includes('Guerrero, Martín') && supervisionHtml.includes('42'));
check('supervisión sin botones de acción ni sala', !supervisionHtml.includes('Llegó?') && !supervisionHtml.includes('Protocolo') && !supervisionHtml.includes('Salida') && !supervisionHtml.includes('aria-label="Sala') && supervisionHtml.includes('Solo lectura') && supervisionHtml.includes('data-movil-readonly="1"'));
const supervisionAlertas = render(OperacionScreens, {
  empresa: 'Pruebas S.A.',
  modeLabel: 'Auto',
  online: true,
  pendingLabel: null,
  readOnly: true,
  stats: { activos: 0, retenidos: 0, ausentes: 1, vacantes: 0, plan: 0 },
  panel: 'alertas',
  alerts: [{ id: 'g', employeeName: 'Guerrero, Martín', code: 'T', isAbsent: true, objectiveName: 'Peaje 9 Norte' }],
  objectives: [],
  objective: null,
  ...noops,
});
check('alertas en supervisión sin Cubrir/Llegó', supervisionAlertas.includes('Guerrero, Martín') && !supervisionAlertas.includes('Llegó') && !supervisionAlertas.includes('Cubrir'));

// ── Contadores igual que escritorio ──
const { shiftCountsInOpsHeader, isFinServicioSinCronograma } = await importFront('lib/operaciones/opsHeaderCounts.ts');
const enActivos = (s) => s.isPresent && !s.isCompleted;
const enRetenidos = (s) => !!s.isRetention || (!!s.isPendingClose && !!s.isPresent && !s.isCompleted);
const noche = {
  objectiveId: 'NK1',
  shiftDateObj: new Date('2026-09-30T23:00:00-03:00'),
  endDateObj: new Date('2026-10-01T07:00:00-03:00'),
  isPresent: true,
  isCompleted: false,
  isRetention: true,
};
const publicado = { NK1_2026_9: true };
const visibles = [noche, { ...noche }, { ...noche }].filter((s) => shiftCountsInOpsHeader(s, publicado));
const activos = visibles.filter(enActivos).length;
const retenidos = visibles.filter(enRetenidos).length;
check('contadores igual que escritorio con octubre sin publicar', activos === 3 && retenidos === 3);
check('fin de servicio cruza de mes', isFinServicioSinCronograma(noche, publicado) === true);
const headerHtml = render(OperacionScreens, {
  empresa: 'Pruebas S.A.',
  modeLabel: 'Manual',
  online: true,
  pendingLabel: null,
  stats: { activos, retenidos, ausentes: 0, vacantes: 0, plan: 0 },
  notices: ['Nuevo Edificio: octubre sin cronograma publicado. Mañana el servicio se corta a las 07:00.'],
  panel: 'home',
  objective: null,
  alerts: [],
  objectives: [{ objectiveId: 'NK1', name: 'Nuevo Edificio', client: 'NK', active: 0, retention: 3, absent: 0, vacant: 0, plan: 0, shifts: [] }],
  ...noops,
});
check('header muestra ACT 3 y RET 3 y el aviso', headerHtml.includes('>3<') && headerHtml.includes('se corta a las 07:00'));

// ── Servicios ──
const { buildServiciosMovilRows, slaMovilDetalle, serviciosMovilAcciones, fechaCorta } = await importFront('lib/servicios/serviciosMovil.ts');
const now = new Date(2026, 9, 1, 12);
const services = [
  { id: 's1', clientId: 'c1', clientName: 'Ruta 9', objectiveId: 'peaje', objectiveName: 'Peaje 9 Norte', startDate: '2026-01-01', endDate: '2026-12-31', status: 'active', billingMode: 'EJECUTADO', positions: [
    { id: 'p1', name: 'Puesto 1', coverageType: '24hs', quantity: 2, activeDays: [], allowedShiftTypes: [
      { code: 'M', name: 'Mañana', startTime: '07:00', endTime: '15:00', hours: 8, quantity: 2 },
      { code: 'T', name: 'Tarde', startTime: '15:00', endTime: '23:00', hours: 8, quantity: 1 },
      { code: 'N', name: 'Noche', startTime: '23:00', endTime: '07:00', hours: 8 },
    ] },
  ] },
  { id: 's2', clientId: 'c2', clientName: 'Malagueño', objectiveId: 'obra', objectiveName: 'Obrador Malagueño', startDate: '2026-10-01', endDate: '2026-10-31', status: 'active', positions: [] },
  { id: 's3', clientId: 'c1', clientName: 'Ruta 9', objectiveId: 'cet', objectiveName: 'CET Río Ceballos', startDate: '2026-09-01', endDate: '2026-10-15', status: 'active', closed: true, closedReason: 'MANUAL', reopenedManually: false, positions: [] },
];
const clients = [
  { id: 'c1', name: 'Ruta 9', status: 'ACTIVO', objectives: [{ id: 'peaje', name: 'Peaje 9 Norte' }, { id: 'cet', name: 'CET Río Ceballos' }, { id: 'nuevo', name: 'Nuevo Edificio' }] },
  { id: 'c2', name: 'Malagueño', status: 'ACTIVO', objectives: [{ id: 'obra', name: 'Obrador Malagueño' }] },
];
const rows = buildServiciosMovilRows({ services, clients, hasPublishedPlan: (oid, y, m) => oid === 'peaje' && y === 2026 && m === 10, now });
const estados = Object.fromEntries(rows.map((r) => [r.objectiveId, r.estado]));
check('estados: en operación / con servicio sin operación / cerrado / sin servicio', estados.peaje === 'active' && estados.obra === 'withoutPlan' && estados.cet === 'closed' && estados.nuevo === 'none');
check('orden: operación primero, sin servicio al final', rows[0].objectiveId === 'peaje' && rows[rows.length - 1].objectiveId === 'nuevo');
const detalle = slaMovilDetalle(services[0], { clientHasOpenContract: false });
check('detalle: vigencia dd/MM/yyyy, facturación y franjas con cantidad', detalle.vigencia === '01/01/2026 → 31/12/2026' && detalle.facturacion === 'Ejecutado' && detalle.puestos[0].franjas.map((f) => `${f.code}x${f.quantity}`).join(',') === 'Mx2,Tx1,Nx2');
check('facturación Auto sigue al contrato comercial', slaMovilDetalle(services[1], { clientHasOpenContract: true }).facturacion.startsWith('Auto: ejecutado') && slaMovilDetalle(services[1], {}).facturacion === 'Auto: planificado');
check('fecha corta', fechaCorta('2026-10-05') === '05/10/2026' && fechaCorta('') === '');
const accCerrado = serviciosMovilAcciones(services[2], true);
const accReabierto = serviciosMovilAcciones({ ...services[2], closed: false, reopenedManually: true }, true);
check('acciones igual que escritorio: reabrir solo SA; cerrar solo reabierto', accCerrado.reabrir && !accCerrado.cerrar && accReabierto.cerrar && !accReabierto.reabrir && !serviciosMovilAcciones(services[2], false).reabrir);

const { ServiciosMovilScreens } = await importFront('components/movil/ServiciosMovilScreens.tsx');
const servNoops = { onFilter: () => {}, onOpen: () => {}, onBack: () => {}, onCerrar: () => {}, onReabrir: () => {} };
const listaHtml = render(ServiciosMovilScreens, {
  empresa: 'Pruebas S.A.', online: true, pendingLabel: null, loading: false, rows, row: null, detalle: null,
  acciones: { cerrar: false, reabrir: false }, filter: '', ...servNoops,
});
check('servicios 390: lista con los 4 objetivos y estados', listaHtml.includes('Peaje 9 Norte') && listaHtml.includes('Obrador Malagueño') && listaHtml.includes('CET Río Ceballos') && listaHtml.includes('Nuevo Edificio') && listaHtml.includes('En operación') && listaHtml.includes('Con servicio sin operación') && listaHtml.includes('Cerrado') && listaHtml.includes('Sin servicio') && listaHtml.includes('data-movil-screen="servicios-lista"'));
const detalleHtml = render(ServiciosMovilScreens, {
  empresa: 'Pruebas S.A.', online: true, pendingLabel: null, loading: false, rows, row: rows.find((r) => r.objectiveId === 'peaje'), detalle,
  acciones: { cerrar: false, reabrir: false }, filter: '', ...servNoops,
});
check('detalle: puestos, franjas, vigencia y facturación sin editor', detalleHtml.includes('Puesto 1') && detalleHtml.includes('07:00–15:00') && detalleHtml.includes('×2') && detalleHtml.includes('01/01/2026 → 31/12/2026') && detalleHtml.includes('Ejecutado') && detalleHtml.includes('se hace en la computadora') && !detalleHtml.includes('Guardar'));
const cerradoHtml = render(ServiciosMovilScreens, {
  empresa: 'Pruebas S.A.', online: true, pendingLabel: null, loading: false, rows, row: rows.find((r) => r.objectiveId === 'cet'), detalle: slaMovilDetalle(services[2]),
  acciones: accCerrado, filter: '', ...servNoops,
});
check('cerrado: aviso y botón Reabrir', cerradoHtml.includes('Contrato cerrado (manual)') && cerradoHtml.includes('Reabrir contrato') && !cerradoHtml.includes('>Cerrar contrato<'));

rmSync(outdir, { recursive: true, force: true });

if (failed) {
  console.error(failed, 'fallos');
  process.exit(1);
}
console.log('movil operacion ok');
