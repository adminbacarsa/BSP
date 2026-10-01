import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  else if (spec === '@cosp/ops-core') base = join(web2, '..', '..', 'packages', 'ops-core', 'src', 'index.ts');
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
  js = js.replace(/(from\s+|import\s*\(|^import\s+)\s*(['"])([^'"]+)\2/gm, (whole, lead, quote, spec) => {
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
const { filtrarAlertasDelModulo, moduloMovilDe, modulosRegistrados } = await importFront('lib/movil/movilModulos.ts');
const alertaDelModulo = (moduloId, type) => filtrarAlertasDelModulo(modulosRegistrados().find((m) => m.id === moduloId), [{ type }]).length === 1;
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
check('barra de Operación', barras((key) => key === 'OPERATIONS', '/admin/operaciones') === 'Objetivos,Alertas,Sala,Menú');
check('Operación no mezcla otros módulos', !barras((key) => key === 'OPERATIONS', '/admin/operaciones').includes('Novedades') && !barras((key) => key === 'OPERATIONS', '/admin/operaciones').includes('Plan'));
check('barra de Supervisión', barras((key) => key === 'SUPERVISION', '/admin/operaciones', { modo: 'supervision' }) === 'Objetivos,Alertas,Menú');
check('barra de Planificación (ruta celular y de escritorio)', barras((key) => key === 'PLANNING', '/admin/movil/planificacion') === 'Próximos días,Huecos,Menú' && barras((key) => key === 'PLANNING', '/admin/planificacion') === 'Próximos días,Huecos,Menú');
check('barra de RRHH', barras((key) => key === 'RRHH', '/admin/rrhh/movil') === 'Hoy,Cargar,Novedades,Menú');
check('barra de Eventuales', barras((key) => key === 'EVENTUALES' || key === 'RRHH', '/admin/rrhh/eventuales') === 'Bolsa,ARCA,Alta,Menú');
check('barra de Servicios', barras((key) => key === 'SERVICES', '/admin/servicios') === 'Lista,Menú');
const opsNav = movilNavForPermissions((key) => key === 'OPERATIONS', '/admin/operaciones');
check('Sala abre con ?panel=sala y Menú va al selector', opsNav.find((item) => item.label === 'Sala').href === '/admin/operaciones/?panel=sala' && opsNav.find((item) => item.label === 'Menú').href === '/admin/movil/');
check('un operador sin RRHH no lo ve', !movilModulesForPermissions((key) => key === 'OPERATIONS').some((item) => item.id === 'rrhh' || item.id === 'eventuales'));
check('ALTA_ARCA_PENDIENTE es de Operación', alertaDelModulo('operacion', 'ALTA_ARCA_PENDIENTE') && alertaDelModulo('supervision', 'ALTA_ARCA_PENDIENTE'));
check('el resto de ARCA es de Eventuales', alertaDelModulo('eventuales', 'ARCA_BAJA_PENDIENTE') && !alertaDelModulo('operacion', 'ARCA_BAJA_PENDIENTE') && !alertaDelModulo('operacion', 'ARCA_PENDIENTE'));
check('novedad de RRHH no entra en Operación', !alertaDelModulo('operacion', 'CERTIFICADO_VENCIDO') && alertaDelModulo('rrhh', 'CERTIFICADO_VENCIDO'));
check('cronograma sin publicar es de Planificación y Operación lo ve como aviso', alertaDelModulo('planificacion', 'CRONOGRAMA_SIN_PUBLICAR') && alertaDelModulo('operacion', 'CRONOGRAMA_SIN_PUBLICAR') && !alertaDelModulo('eventuales', 'CRONOGRAMA_SIN_PUBLICAR'));
const saModules = movilModulesForPermissions(() => true);
check('SuperAdmin ve los 6 módulos', saModules.map((item) => item.label).join(',') === 'Operación,Supervisión,Planificación,Eventuales,RRHH,Servicios');
check('solo SUPERVISION ve Supervisión y nada más', movilModulesForPermissions((key) => key === 'SUPERVISION').map((item) => item.id).join(',') === 'supervision');
check('RRHH ve Eventuales y RRHH', movilModulesForPermissions((key) => key === 'RRHH').map((item) => item.id).join(',') === 'eventuales,rrhh');
check('Supervisión se reconoce por ?modo', movilModuleForPath('/admin/operaciones', { modo: 'supervision' })?.id === 'supervision');
check('eventuales gana sobre rrhh en la ruta', movilModuleForPath('/admin/rrhh/eventuales')?.id === 'eventuales');
check('planificación apunta a /admin/movil/planificacion', moduloMovilDe('/admin/planificacion')?.href === '/admin/movil/planificacion/' && movilRouteHasMobileVersion('/admin/movil/planificacion') && movilRouteHasMobileVersion('/admin/planificacion'));
check('configuración y reportes sin versión celular', movilRouteHasMobileVersion('/admin/configuracion') === false && movilRouteHasMobileVersion('/admin/reportes') === false);
check('operaciones, servicios, rrhh y supervisión con versión celular', movilRouteHasMobileVersion('/admin/operaciones') && movilRouteHasMobileVersion('/admin/servicios') && movilRouteHasMobileVersion('/admin/rrhh') && movilRouteHasMobileVersion('/admin/supervision') && movilRouteHasMobileVersion('/admin/movil'));

const { MovilMenuScreens } = await importFront('components/movil/MovilMenuScreens.tsx');
const menuHtml = render(MovilMenuScreens, {
  empresaName: 'Pruebas S.A.',
  modulos: saModules,
  unico: null,
  now: Date.UTC(2026, 9, 1, 15, 0, 0),
  onEmpresa: () => {},
  onModulo: () => {}, onAsistente: () => {}, onEscritorio: () => {}, onLogout: () => {},
});
check('menú 390: 6 módulos, píldora de empresa (hoja) y cerrar sesión', (menuHtml.match(/data-movil-module=/g) || []).length === 6 && !menuHtml.includes('Empresa activa') && !menuHtml.includes('Cambiar a ') && menuHtml.includes('aria-label="Empresa Pruebas S.A.. Cambiar"') && menuHtml.includes('Cerrar sesión') && menuHtml.includes('Asistente'));
const { EmpresaSheetBody } = await importFront('components/movil/EmpresaSheetBody.tsx');
const hojaEmpresas = render(EmpresaSheetBody, { empresas: [{ id: 'pruebas_sa', name: 'Pruebas S.A.', color: '#2563eb' }, { id: 'bacarsa', name: 'Bacar S.A.' }], activaId: 'pruebas_sa', onElegir: () => {} });
check('hoja de empresas: activa con check y color como punto', hojaEmpresas.includes('aria-current="true"') && hojaEmpresas.includes('background-color:#2563eb') && hojaEmpresas.includes('data-movil-empresa-item="bacarsa"') && !hojaEmpresas.includes('data-movil-empresa-buscar'));

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
check('objetivo: tarjetas compactas que abren la hoja, RET con minutos y pendiente', guardHtml.includes('data-movil-card="compacta"') && guardHtml.includes('data-movil-tap="b"') && guardHtml.includes('data-movil-tap="g"') && guardHtml.includes('RET 42m') && guardHtml.includes('Pendiente de enviar') && !guardHtml.includes('Llegó?') && !guardHtml.includes('>Protocolo<'));
check('objetivo: encabezado en una línea fina con volver y cantidad', guardHtml.includes('data-movil-objetivo-header="fino"') && guardHtml.includes('aria-label="Volver"') && guardHtml.includes('>Peaje 9 Norte<') && guardHtml.includes('>2<') && !guardHtml.includes('h-12 w-12'));
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
check('supervisión muestra guardias y estados', supervisionHtml.includes('BAEZ Juan') && supervisionHtml.includes('GUERRERO Martín') && supervisionHtml.includes('RET 42m') && supervisionHtml.includes('data-movil-estado="ausente"'));
check('supervisión sin botones de acción ni sala', !supervisionHtml.includes('data-movil-tap') && !supervisionHtml.includes('Llegó?') && !supervisionHtml.includes('Protocolo') && !supervisionHtml.includes('Salida') && !supervisionHtml.includes('aria-label="Sala') && supervisionHtml.includes('Solo lectura') && supervisionHtml.includes('data-movil-readonly="1"'));
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

// ── Tarjetas del guardia: horario planificado, ingreso real o estado, relevo, convocatoria, cobertura, LLAMAR ──
const { guardDetalle, proximoRelevo } = await importFront('lib/movil/guardDetalle.ts');
const ar = (hhmm, day = '2026-10-01') => new Date(`${day}T${hhmm}:00-03:00`);
const AHORA = ar('15:20').getTime();
const base = (over) => ({ objectiveId: 'peaje', objectiveName: 'Peaje 9 Norte', positionName: 'Puesto 1', phone: '351 555-0101', ...over });
const baezM = base({ id: 'm', employeeId: 'e1', employeeName: 'Baez, Juan', code: 'M', shiftDateObj: ar('07:00'), endDateObj: ar('15:00'), isPresent: true, realStartTime: ar('07:00'), checkInAt: ar('06:52') });
const guerreroT = base({ id: 't', employeeId: 'e2', employeeName: 'Guerrero, Martín', code: 'T', shiftDateObj: ar('15:00'), endDateObj: ar('23:00'), isPresent: true, realStartTime: ar('15:12'), checkInAt: ar('15:12') });
const fariasN = base({ id: 'n', employeeId: 'e3', employeeName: 'Farias, Lucas', code: 'N', shiftDateObj: ar('23:00'), endDateObj: ar('07:00', '2026-10-02') });
const peaje = [baezM, guerreroT, fariasN];

const dBaez = guardDetalle(baezM, peaje, AHORA);
check('horario planificado con código y puesto', dBaez.horario === '07:00–15:00' && dBaez.code === 'M' && dBaez.puesto === 'Puesto 1' && dBaez.objetivo === 'Peaje 9 Norte');
check('ingreso real a horario con marca anticipada (formatIngresoLine)', dBaez.ingreso === 'Ingresó 07:00 · marcó 06:52' && dBaez.estado === null);
check('quién lo releva sale de la serie M→T', dBaez.loReleva === 'Lo releva Guerrero, Martín · T 15:00');
const dGuerrero = guardDetalle(guerreroT, peaje, AHORA);
check('ingreso tarde con minutos', dGuerrero.ingreso === 'Ingresó 15:12 (12 min tarde)');
check('a quién releva y quién lo releva', dGuerrero.relevaA === 'Releva a Baez, Juan · M 15:00' && dGuerrero.loReleva === 'Lo releva Farias, Lucas · N 23:00');
check('teléfono del legajo', dGuerrero.telefono === '351 555-0101');

const retenido = base({ ...baezM, id: 'r', isRetention: true, retentionMinutes: 20, retentionWait: { sinceMs: ar('15:00').getTime(), elapsedMinutes: 20, capAtMs: ar('19:59').getTime(), capRemainingMinutes: 279, reliever: { id: 't', employeeName: 'Guerrero, Martín', code: 'T', startMs: ar('15:00').getTime(), status: 'NO_FICHO' }, waitLabel: 'Guerrero, Martín no se presentó' } });
const dRet = guardDetalle(retenido, [retenido, { ...guerreroT, isPresent: false, isAbsent: true }], AHORA);
check('retenido desde · minutos · tope y a quién espera', dRet.estado === 'Retenido desde 15:00 · 20 min · tope 19:59' && dRet.loReleva === 'Espera a Guerrero, Martín · T 15:00');

const ausente = base({ ...guerreroT, id: 'a', isPresent: false, realStartTime: null, checkInAt: null, isAbsent: true });
check('ausente: no llegó desde la hora planificada', guardDetalle(ausente, [], AHORA).estado === 'No llegó desde 15:00 · ausente' && guardDetalle(ausente, [], AHORA).ingreso === null);
const ausenteCubierto = { ...ausente, operacionallyCovered: true, coveredByEmployeeName: 'Sosa, Carla (REF)' };
check('ausente cubierto muestra quién lo cubre', guardDetalle(ausenteCubierto, [], AHORA).cobertura === 'Cubierto por Sosa, Carla');
const provisoria = { ...ausente, isAbsent: false, isPotentialAbsence: true, isProvisionalLateAbsence: true };
check('posible ausencia con aviso', guardDetalle(provisoria, [], AHORA).estado === 'No llegó desde 15:00 · posible ausencia');

const tardeAvisada = base({ ...ausente, isAbsent: false, isLateNotified: true, lateArrivalEtaLabel: '15:30' });
check('tarde avisada con minutos y ETA', guardDetalle(tardeAvisada, [], AHORA).estado === 'Tarde 20 min · avisó · llega ~15:30');
const tardeSinAviso = base({ ...ausente, isAbsent: false, isLateUnnotified: true });
check('tarde sin aviso con minutos', guardDetalle(tardeSinAviso, [], AHORA).estado === 'Tarde 20 min · sin aviso');

const vacante = base({ id: 'v', employeeId: 'VACANTE', isUnassigned: true, vacancyBand: 'T', code: 'T', shiftDateObj: ar('15:00'), endDateObj: ar('23:00'), phone: '' });
const dVac = guardDetalle(vacante, peaje, AHORA);
check('vacante con banda y desde cuándo, sin teléfono', dVac.nombre === 'VACANTE · T' && dVac.estado === 'Vacante T · desde 15:00' && dVac.telefono === null && dVac.relevaA === null);

const convocado = base({ id: 'c', employeeId: 'e9', employeeName: 'Sosa, Carla', code: 'REF', shiftDateObj: ar('15:00'), endDateObj: ar('23:00'), expectedArrivalAt: ar('15:40'), originSource: 'DEVICE', convocadoReminderSentAt: ar('15:25'), convocadoDemorado: false });
check('convocatoria en curso', guardDetalle(convocado, [], AHORA).convocatoria === 'EN CAMINO · llega ~15:40 · celular · recordatorio enviado');
check('convocado demorado', guardDetalle({ ...convocado, convocadoDemorado: true }, [], AHORA).convocatoria.endsWith('DEMORADO'));

const ext = base({ id: 'x', employeeId: 'e1', employeeName: 'Baez, Juan', code: 'T', origin: 'OPERATIONS_COVERAGE', coverageSegmentRole: 'EXTENSION', coverageHoursOnSource: true, coversEmployeeName: 'Guerrero, Martín', shiftDateObj: ar('15:00'), endDateObj: ar('19:00'), isPresent: true, realStartTime: ar('15:00') });
check('cobertura EXT hasta HH:MM y a quién cubre', guardDetalle(ext, [], AHORA).cobertura === 'EXT hasta 19:00 · cubre a Guerrero, Martín');
const adv = { ...ext, id: 'y', coverageSegmentRole: 'EARLY_START', shiftDateObj: ar('19:00'), endDateObj: ar('23:00') };
check('cobertura ADV desde HH:MM', guardDetalle(adv, [], AHORA).cobertura === 'ADV desde 19:00 · cubre a Guerrero, Martín');
const ft = { ...ext, id: 'z', coverageSegmentRole: null, coverageType: 'FT' };
check('cobertura FT', guardDetalle(ft, [], AHORA).cobertura === 'FT · cubre a Guerrero, Martín');

const plan = base({ ...fariasN, isFuture: true });
check('planificado: entra a HH:MM', guardDetalle(plan, peaje, AHORA).estado === 'Entra 23:00' && guardDetalle(plan, peaje, AHORA).relevaA === 'Releva a Guerrero, Martín · T 23:00');
check('próximo relevo del objetivo', proximoRelevo(peaje, AHORA) === 'Próximo relevo 23:00 · N' && proximoRelevo([baezM, guerreroT], AHORA) === null);
check('próximo relevo vacante', proximoRelevo([baezM, { ...vacante, shiftDateObj: ar('23:00'), vacancyBand: 'N' }], AHORA) === 'Próximo relevo 23:00 · N · VACANTE');

const objetivoDetalle = { objectiveId: 'peaje', name: 'Peaje 9 Norte', client: 'Ruta 9', active: 2, retention: 0, absent: 0, vacant: 0, plan: 1, shifts: peaje };
const tarjetasHtml = render(OperacionScreens, {
  empresa: 'Pruebas S.A.', modeLabel: 'Manual', online: true, pendingLabel: null, now: AHORA,
  stats: { activos: 2, retenidos: 0, ausentes: 0, vacantes: 0, plan: 1 },
  panel: 'objetivo', alerts: [], objectives: [objetivoDetalle], objective: objetivoDetalle, ...noops,
});
check('tarjeta 390: horario planificado y código en cada guardia', tarjetasHtml.includes('07:00–15:00') && tarjetasHtml.includes('15:00–23:00') && tarjetasHtml.includes('23:00–07:00') && (tarjetasHtml.match(/data-movil-detalle=/g) || []).length === 3);
check('tarjeta 390: ingreso con ícono (verde a tiempo, ámbar con +min)', (tarjetasHtml.match(/data-movil-mini="ingreso"/g) || []).length === 2 && tarjetasHtml.includes('</svg>07:00</span>') && tarjetasHtml.includes('15:12 +12′') && tarjetasHtml.includes('text-amber-600') && !tarjetasHtml.includes('Ingresó'));
check('tarjeta 390: relevo con apellido y hora; plan con chip de hora', tarjetasHtml.includes('GUERRERO 15:00') && tarjetasHtml.includes('GUERRERO 23:00') && tarjetasHtml.includes('data-movil-estado="plan"') && tarjetasHtml.includes('</svg>23:00</span>') && !tarjetasHtml.includes('Lo releva') && !tarjetasHtml.includes('Entra 23:00'));
check('tarjeta 390: teléfono como ícono de 36 px, sin fila de botones; tocar abre la hoja', tarjetasHtml.includes('href="tel:3515550101"') && (tarjetasHtml.match(/data-movil-llamar="1"/g) || []).length === 3 && tarjetasHtml.includes('h-9 w-9') && !tarjetasHtml.includes('Salida') && !tarjetasHtml.includes('data-movil-mas-acciones') && (tarjetasHtml.match(/data-movil-tap="/g) || []).length === 3);
const homeRelevo = render(OperacionScreens, {
  empresa: 'Pruebas S.A.', modeLabel: 'Manual', online: true, pendingLabel: null, now: AHORA,
  stats: { activos: 2, retenidos: 0, ausentes: 0, vacantes: 0, plan: 1 },
  panel: 'home', alerts: [], objectives: [objetivoDetalle], objective: null, ...noops,
});
check('tarjeta del objetivo: próximo relevo', homeRelevo.includes('Próximo relevo 23:00 · N'));
const estadosTarjeta = [retenido, ausente, ausenteCubierto, tardeAvisada, tardeSinAviso, vacante, convocado, ext];
const objetivoEstados = { objectiveId: 'peaje', name: 'Peaje 9 Norte', client: 'Ruta 9', active: 2, retention: 1, absent: 2, vacant: 1, plan: 1, shifts: estadosTarjeta };
const estadosHtml = render(OperacionScreens, {
  empresa: 'Pruebas S.A.', modeLabel: 'Manual', online: true, pendingLabel: null, now: AHORA,
  stats: { activos: 2, retenidos: 1, ausentes: 2, vacantes: 1, plan: 1 },
  panel: 'objetivo', alerts: [], objectives: [objetivoEstados], objective: objetivoEstados, ...noops,
});
for (const [nombre, texto] of [
  ['retenido: chip RET con minutos', 'RET 20m'],
  ['retenido: tope 12:59 con reloj de arena', 'data-movil-mini="tope"'],
  ['retenido: tope hora', 'tope 19:59'],
  ['retenido: a quién espera', 'GUERRERO 15:00'],
  ['ausente', 'data-movil-estado="ausente"'],
  ['ausente cubierto', 'data-movil-estado="cubierto"'],
  ['tarde avisada', 'TAR 20′'],
  ['tarde sin aviso', 'data-movil-estado="tarde"'],
  ['vacante', 'data-movil-estado="vacante"'],
  ['vacante con banda', 'VACANTE · T'],
]) check(`render estado ${nombre}`, estadosHtml.includes(texto));
check('la tarjeta no lleva los textos largos (van en la hoja)', !estadosHtml.includes('Retenido desde') && !estadosHtml.includes('No llegó desde') && !estadosHtml.includes('Cubierto por') && !estadosHtml.includes('EN CAMINO'));
const { GuardAccionesSheetBody: HojaDetalle } = await importFront('components/movil/OperacionScreens.tsx');
const hojaDe = (s) => render(HojaDetalle, { shift: s, siblings: estadosTarjeta, now: AHORA, onEjecutar: () => {}, onCerrar: () => {} });
check('hoja: detalle completo del retenido', hojaDe(retenido).includes('Retenido desde 15:00 · 20 min · tope 19:59') && hojaDe(retenido).includes('Espera a Guerrero, Martín · T 15:00'));
check('hoja: ausente, cubierto, tarde y vacante con texto largo', hojaDe(ausente).includes('No llegó desde 15:00 · ausente') && hojaDe(ausenteCubierto).includes('Cubierto por Sosa, Carla') && hojaDe(tardeAvisada).includes('Tarde 20 min · avisó · llega ~15:30') && hojaDe(vacante).includes('Vacante T · desde 15:00'));
check('hoja: convocatoria y cobertura EXT', hojaDe(convocado).includes('EN CAMINO · llega ~15:40') && hojaDe(ext).includes('EXT hasta 19:00 · cubre a Guerrero, Martín'));
const sinTelHtml = render(OperacionScreens, { empresa: 'P', modeLabel: 'Manual', online: true, pendingLabel: null, now: AHORA, stats: { activos: 1, retenidos: 0, ausentes: 0, vacantes: 0, plan: 0 }, panel: 'objetivo', alerts: [], objectives: [], objective: { ...objetivoDetalle, shifts: [{ ...baezM, phone: '' }] }, ...noops });
check('vacante sin LLAMAR; sin teléfono deshabilitado', !estadosHtml.includes('data-movil-llamar="0"') && (estadosHtml.match(/data-movil-llamar="1"/g) || []).length === estadosTarjeta.length - 1 && sinTelHtml.includes('data-movil-llamar="0"'));
const alertasDetalle = render(OperacionScreens, {
  empresa: 'Pruebas S.A.', modeLabel: 'Manual', online: true, pendingLabel: null, now: AHORA,
  stats: { activos: 0, retenidos: 0, ausentes: 1, vacantes: 1, plan: 0 },
  panel: 'alertas', alerts: [ausente, vacante], objectives: [objetivoEstados], objective: null, ...noops,
});
check('alertas con horario, estado, objetivo y LLAMAR', alertasDetalle.includes('15:00–23:00') && alertasDetalle.includes('No llegó desde 15:00 · ausente') && alertasDetalle.includes('Peaje 9 Norte') && alertasDetalle.includes('href="tel:3515550101"') && alertasDetalle.includes('VACANTE · T'));
const supervisionDetalle = render(OperacionScreens, {
  empresa: 'Pruebas S.A.', modeLabel: 'Auto', online: true, pendingLabel: null, readOnly: true, now: AHORA,
  stats: { activos: 2, retenidos: 1, ausentes: 2, vacantes: 1, plan: 1 },
  panel: 'objetivo', alerts: [], objectives: [objetivoEstados], objective: objetivoEstados, ...noops,
});
check('supervisión: mismas tarjetas compactas y teléfono, sin tocar ni acciones', supervisionDetalle.includes('RET 20m') && supervisionDetalle.includes('tope 19:59') && supervisionDetalle.includes('data-movil-llamar="1"') && !supervisionDetalle.includes('data-movil-tap') && !supervisionDetalle.includes('Llegó?') && !supervisionDetalle.includes('Protocolo'));

// ── Contadores como filtros + cliente/objetivo (paridad con las solapas del escritorio) ──
const F = await importFront('lib/movil/operacionFiltros.ts');
const { shiftMatchesOpsViewTab } = await importFront('../../../packages/ops-core/src/index.ts');
const { shiftCountsInOpsHeader } = await importFront('lib/operaciones/opsHeaderCounts.ts');
const NOW_F = ar('15:20');
const pruebasSaPublicado = { peaje_2026_10: true, obra_2026_10: true, cet_2026_10: true, viejo_2026_10: false };
const fx = (over) => ({ positionName: 'Puesto 1', phone: '351', shiftDateObj: ar('15:00'), endDateObj: ar('23:00'), ...over });
const ruta9 = { clientId: 'c1', clientName: 'Ruta 9' };
const malag = { clientId: 'c2', clientName: 'Malagueño' };
const fixture = [
  // Peaje (Ruta 9): 2 activos (uno retenido), 1 ausente, 1 vacante, 1 plan, 1 tarde sin aviso
  fx({ id: 'p1', ...ruta9, objectiveId: 'peaje', objectiveName: 'Peaje 9 Norte', employeeId: 'e1', employeeName: 'Baez, Juan', code: 'M', shiftDateObj: ar('07:00'), endDateObj: ar('15:00'), isPresent: true, isRetention: true, retentionMinutes: 20 }),
  fx({ id: 'p2', ...ruta9, objectiveId: 'peaje', objectiveName: 'Peaje 9 Norte', employeeId: 'e2', employeeName: 'Guerrero, Martín', code: 'T', isPresent: true, realStartTime: ar('15:02') }),
  fx({ id: 'p3', ...ruta9, objectiveId: 'peaje', objectiveName: 'Peaje 9 Norte', employeeId: 'e3', employeeName: 'Sosa, Carla', code: 'T', positionName: 'Puesto 2', isAbsent: true }),
  fx({ id: 'p4', ...ruta9, objectiveId: 'peaje', objectiveName: 'Peaje 9 Norte', employeeId: 'VACANTE', employeeName: 'VACANTE', isUnassigned: true, vacancyBand: 'T', code: 'T', positionName: 'Puesto 3' }),
  fx({ id: 'p5', ...ruta9, objectiveId: 'peaje', objectiveName: 'Peaje 9 Norte', employeeId: 'e5', employeeName: 'Farias, Lucas', code: 'N', shiftDateObj: ar('23:00'), endDateObj: ar('07:00', '2026-10-02'), isFuture: true }),
  fx({ id: 'p6', ...ruta9, objectiveId: 'peaje', objectiveName: 'Peaje 9 Norte', employeeId: 'e6', employeeName: 'Lopez, Ana', code: 'T', positionName: 'Puesto 4', isLateUnnotified: true }),
  // CET (Ruta 9): 1 activo, 1 ausente
  fx({ id: 'c1', ...ruta9, objectiveId: 'cet', objectiveName: 'CET Río Ceballos', employeeId: 'e7', employeeName: 'Perez, Hugo', code: 'T', isPresent: true, realStartTime: ar('15:00') }),
  fx({ id: 'c2', ...ruta9, objectiveId: 'cet', objectiveName: 'CET Río Ceballos', employeeId: 'e8', employeeName: 'Diaz, Rosa', code: 'T', positionName: 'Puesto 2', isAbsent: true, operacionallyCovered: true, coveredByName: 'Perez, Hugo' }),
  // Obrador (Malagueño): 2 activos, 1 vacante, 1 plan
  fx({ id: 'o1', ...malag, objectiveId: 'obra', objectiveName: 'Obrador Malagueño', employeeId: 'e9', employeeName: 'Ruiz, Pablo', code: 'D12', shiftDateObj: ar('07:00'), endDateObj: ar('19:00'), isPresent: true, realStartTime: ar('07:00') }),
  fx({ id: 'o2', ...malag, objectiveId: 'obra', objectiveName: 'Obrador Malagueño', employeeId: 'e10', employeeName: 'Vega, Luis', code: 'D12', positionName: 'Puesto 2', shiftDateObj: ar('07:00'), endDateObj: ar('19:00'), isPresent: true, realStartTime: ar('07:05') }),
  fx({ id: 'o3', ...malag, objectiveId: 'obra', objectiveName: 'Obrador Malagueño', employeeId: 'VACANTE', employeeName: 'VACANTE', isUnassigned: true, vacancyBand: 'N12', code: 'N12', positionName: 'Puesto 3', shiftDateObj: ar('19:00'), endDateObj: ar('07:00', '2026-10-02') }),
  fx({ id: 'o4', ...malag, objectiveId: 'obra', objectiveName: 'Obrador Malagueño', employeeId: 'e11', employeeName: 'Mora, Iván', code: 'N12', shiftDateObj: ar('19:00'), endDateObj: ar('07:00', '2026-10-02'), isFuture: true }),
  // Evento (Malagueño): un EV presente — en el escritorio va en el grupo de eventos, en el celular también es tarjeta
  fx({ id: 'ev1', ...malag, objectiveId: 'obra', objectiveName: 'Obrador Malagueño', employeeId: 'e12', employeeName: 'Paz, Noé', code: 'EV', origin: 'EVENTO', eventoId: 'ev', eventoNombre: 'Fiesta patronal', isPresent: true, realStartTime: ar('15:00') }),
  // Fuera del encabezado: mes sin publicar (no cuenta en el escritorio) y franco (no es tarjeta)
  fx({ id: 'x1', ...ruta9, objectiveId: 'viejo', objectiveName: 'Depósito viejo', employeeId: 'e13', employeeName: 'Nadie', code: 'T', isFuture: true }),
  fx({ id: 'f1', ...ruta9, objectiveId: 'peaje', objectiveName: 'Peaje 9 Norte', employeeId: 'e14', employeeName: 'Franco, Juan', code: 'F', isFranco: true }),
];
const visiblesF = F.turnosVisiblesMovil(fixture, pruebasSaPublicado);
check('universo = encabezado del escritorio (sin mes sin publicar ni francos, con el evento)', visiblesF.length === 13 && !visiblesF.some((s) => s.id === 'x1' || s.id === 'f1') && visiblesF.some((s) => s.id === 'ev1'));
// Paridad: el escritorio cuenta hoy ∧ shiftCountsInOpsHeader por solapa (useOperacionesMonitor.stats)
const escritorio = fixture.filter((s) => shiftCountsInOpsHeader(s, pruebasSaPublicado));
const statsEscritorio = Object.fromEntries(['ACTIVOS', 'PLAN', 'AUSENTES', 'VACANTES', 'RETENIDOS', 'NO_LLEGO'].map((tab) => [tab, escritorio.filter((s) => shiftMatchesOpsViewTab(s, tab, NOW_F)).length]));
const contTodos = F.contadoresMovil(visiblesF, F.FILTRO_VACIO, NOW_F);
if (process.env.MOVIL_DEBUG) console.log({ statsEscritorio, contTodos });
// VAC: el titular ausente sin cobertura también representa el hueco (P3: p3), más p4 y o3.
check('paridad de conteos con el escritorio', ['ACTIVOS', 'PLAN', 'AUSENTES', 'VACANTES', 'RETENIDOS', 'NO_LLEGO'].every((tab) => contTodos[tab] === statsEscritorio[tab]) && contTodos.ACTIVOS === 6 && contTodos.RETENIDOS === 1 && contTodos.AUSENTES === 2 && contTodos.VACANTES === 3 && contTodos.PLAN === 2 && contTodos.NO_LLEGO === 1);
for (const estado of ['ACTIVOS', 'PLAN', 'AUSENTES', 'VACANTES', 'RETENIDOS', 'NO_LLEGO']) {
  const tarjetas = F.turnosFiltrados(visiblesF, { ...F.FILTRO_VACIO, estado }, NOW_F);
  check(`contador ${estado} = tarjetas al filtrar`, tarjetas.length === contTodos[estado]);
}
check('tocar el contador activo vuelve a Todos', F.alternarEstado(F.FILTRO_VACIO, 'AUSENTES').estado === 'AUSENTES' && F.alternarEstado({ ...F.FILTRO_VACIO, estado: 'AUSENTES' }, 'AUSENTES').estado === 'TODOS' && F.alternarEstado({ ...F.FILTRO_VACIO, estado: 'AUSENTES' }, 'PLAN').estado === 'PLAN');
const clientesF = F.clientesParaFiltro(visiblesF, [{ id: 'cet', clientId: 'c1', name: 'CET Río Ceballos', clientName: 'Ruta 9' }, { id: 'sinTurnos', clientId: 'c1', name: 'Sucursal Norte', clientName: 'Ruta 9' }]);
check('clientes → objetivos con turnos (catálogo completa los sin turnos)', clientesF.map((c) => c.name).join(',') === 'Ruta 9,Malagueño' && clientesF[0].objetivos.map((o) => o.name).join(',') === 'Peaje 9 Norte,CET Río Ceballos,Sucursal Norte' && clientesF[0].turnos === 8 && clientesF[1].turnos === 5);
check('buscador por objetivo recorta el cliente', F.buscarClientes(clientesF, 'ceballos').map((c) => `${c.name}:${c.objetivos.length}`).join(',') === 'Ruta 9:1' && F.buscarClientes(clientesF, 'malag')[0].objetivos.length === 1 && F.buscarClientes(clientesF, 'zzz').length === 0);
const enRuta9 = F.contadoresMovil(visiblesF, { clientId: 'c1', objectiveId: null }, NOW_F);
if (process.env.MOVIL_DEBUG) console.log({ enRuta9 });
check('contadores dentro del cliente', enRuta9.ACTIVOS === 3 && enRuta9.AUSENTES === 2 && enRuta9.VACANTES === 2 && enRuta9.PLAN === 1);
const ausRuta9 = F.turnosFiltrados(visiblesF, { estado: 'AUSENTES', clientId: 'c1', objectiveId: null }, NOW_F);
check('combinación cliente + AUS', ausRuta9.map((s) => s.id).join(',') === 'p3,c2' && ausRuta9.length === enRuta9.AUSENTES);
const vacObra = F.turnosFiltrados(visiblesF, { estado: 'VACANTES', clientId: 'c2', objectiveId: 'obra' }, NOW_F);
check('combinación objetivo + VAC', vacObra.length === 1 && vacObra[0].id === 'o3' && F.contadoresMovil(visiblesF, { clientId: 'c2', objectiveId: 'obra' }, NOW_F).VACANTES === 1);
check('etiqueta del chip', F.etiquetaAmbito({ clientId: 'c1', objectiveId: null }, clientesF) === 'Ruta 9' && F.etiquetaAmbito({ clientId: 'c1', objectiveId: 'cet' }, clientesF) === 'CET Río Ceballos' && F.etiquetaAmbito(F.FILTRO_VACIO, clientesF) === null);
check('mensaje de lista vacía', F.mensajeVacio({ estado: 'AUSENTES', clientId: 'c2', objectiveId: null }, clientesF) === 'Sin guardias en AUS para Malagueño' && F.mensajeVacio({ estado: 'RETENIDOS', clientId: null, objectiveId: null }, clientesF) === 'Sin guardias en RET');
const gruposF = F.agruparPorObjetivo(F.turnosFiltrados(visiblesF, F.FILTRO_VACIO, NOW_F), NOW_F);
check('agrupado por objetivo, evento aparte y criticidad primero', gruposF.map((g) => g.name).join('|') === 'Peaje 9 Norte|CET Río Ceballos|Obrador Malagueño|Evento: Fiesta patronal' && gruposF[3].esEvento && gruposF[0].shifts.length === 6);
const memoria = new Map();
const storageF = { getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, v), removeItem: (k) => memoria.delete(k) };
F.guardarFiltro('pruebas_sa', { estado: 'AUSENTES', clientId: 'c1', objectiveId: null }, storageF);
check('último filtro en sessionStorage por empresa', F.leerFiltroGuardado('pruebas_sa', storageF).estado === 'AUSENTES' && F.leerFiltroGuardado('pruebas_sa', storageF).clientId === 'c1' && F.leerFiltroGuardado('otra', storageF).estado === 'TODOS');
F.guardarFiltro('pruebas_sa', F.FILTRO_VACIO, storageF);
check('Todos sin ámbito borra la memoria', memoria.size === 0 && F.leerFiltroGuardado('pruebas_sa', { getItem: () => '{"estado":"X"}' }).estado === 'TODOS');

const baseFiltros = { empresa: 'Pruebas S.A.', modeLabel: 'Manual', online: true, pendingLabel: null, now: NOW_F.getTime(), panel: 'home', alerts: [], objective: null, onAmbito: () => {}, onQuitarAmbito: () => {}, ...noops };
const renderFiltro = (filtro, extra = {}) => {
  const cont = F.contadoresMovil(visiblesF, filtro, NOW_F);
  const grp = F.agruparPorObjetivo(F.turnosFiltrados(visiblesF, filtro, NOW_F), NOW_F);
  const objs = F.agruparPorObjetivo(F.turnosEnAmbito(visiblesF, filtro), NOW_F);
  return { html: render(OperacionScreens, { ...baseFiltros, filtro, contadores: cont, grupos: grp, objectives: objs, ambitoLabel: F.etiquetaAmbito(filtro, clientesF), vacioLabel: F.mensajeVacio(filtro, clientesF), ...extra }), cont, grp };
};
const todosHtml = renderFiltro(F.FILTRO_VACIO).html;
if (process.env.MOVIL_DEBUG) console.log('contadores en home', (todosHtml.match(/data-movil-contador=/g) || []).length, ['Peaje 9 Norte', 'Obrador Malagueño', 'Evento: Fiesta patronal', 'Todos los clientes y objetivos'].map((t) => todosHtml.includes(t)));
check('home 390: seis contadores sin activo y resumen por objetivo', (todosHtml.match(/data-movil-contador=/g) || []).length === 6 && !todosHtml.includes('data-movil-filtro-activo') && todosHtml.includes('Peaje 9 Norte') && todosHtml.includes('Obrador Malagueño') && todosHtml.includes('Evento: Fiesta patronal') && todosHtml.includes('Todos los clientes y objetivos') && !todosHtml.includes('data-movil-chip'));
for (const estado of ['ACTIVOS', 'PLAN', 'AUSENTES', 'VACANTES', 'RETENIDOS', 'NO_LLEGO']) {
  const { html, cont } = renderFiltro({ ...F.FILTRO_VACIO, estado });
  const tarjetas = (html.match(/data-movil-detalle=/g) || []).length;
  check(`filtro ${estado}: contador activo y ${cont[estado]} tarjetas agrupadas`, html.includes(`data-movil-contador="${estado}" data-movil-filtro-activo="1"`) && tarjetas === cont[estado] && html.includes('Ver todos'));
}
const ausHtml = renderFiltro({ ...F.FILTRO_VACIO, estado: 'AUSENTES' }).html;
check('AUS muestra Sosa y Diaz agrupadas por objetivo con detalle', ausHtml.includes('SOSA Carla') && ausHtml.includes('DIAZ Rosa') && !ausHtml.includes('GUERRERO Martín') && ausHtml.includes('data-movil-grupo="peaje"') && ausHtml.includes('data-movil-grupo="cet"') && ausHtml.includes('data-movil-estado="ausente"'));
const comboHtml = renderFiltro({ estado: 'AUSENTES', clientId: 'c1', objectiveId: null }).html;
check('cliente + AUS: chip con X, contadores del cliente y solo sus ausentes', comboHtml.includes('data-movil-chip="ambito"') && comboHtml.includes('>Ruta 9<') && comboHtml.includes('aria-label="Quitar filtro Ruta 9"') && comboHtml.includes('data-movil-ambito="cliente"') && (comboHtml.match(/data-movil-detalle=/g) || []).length === 2 && !comboHtml.includes('Obrador'));
const vacioHtml = renderFiltro({ estado: 'AUSENTES', clientId: 'c2', objectiveId: null }).html;
const vacioTag = (() => { const i = vacioHtml.indexOf('data-movil-vacio'); return vacioHtml.slice(vacioHtml.lastIndexOf('<p', i), i); })();
check('lista vacía: una línea gris, sin tarjeta', vacioHtml.includes('data-movil-vacio="1"') && vacioHtml.includes('Sin guardias en AUS para Malagueño') && vacioTag.includes('text-slate-400') && !vacioTag.includes('border') && !vacioTag.includes('bg-white'));
const objHtml = renderFiltro({ estado: 'TODOS', clientId: 'c2', objectiveId: 'obra' }).html;
check('objetivo elegido en Todos: chip y resumen solo de ese objetivo', objHtml.includes('data-movil-ambito="objetivo"') && objHtml.includes('>Obrador Malagueño<') && !objHtml.includes('Peaje 9 Norte'));

const { AmbitoSheetBody } = await importFront('components/movil/OperacionScreens.tsx');
const sheetHtml = render(AmbitoSheetBody, { clientes: clientesF, filtro: F.FILTRO_VACIO, onElegir: () => {} });
check('hoja cliente → objetivos con buscador', sheetHtml.includes('data-movil-sheet="ambito"') && sheetHtml.includes('placeholder="Buscar cliente u objetivo"') && sheetHtml.includes('data-movil-cliente="c1"') && sheetHtml.includes('data-movil-cliente="c2"') && sheetHtml.includes('Todos los clientes'));
const sheetAbierto = render(AmbitoSheetBody, { clientes: clientesF, filtro: { estado: 'TODOS', clientId: 'c1', objectiveId: null }, onElegir: () => {} });
check('hoja con cliente abierto lista sus objetivos y «Todo el cliente»', sheetAbierto.includes('data-movil-cliente-todo="c1"') && sheetAbierto.includes('data-movil-objetivo="peaje"') && sheetAbierto.includes('data-movil-objetivo="cet"') && !sheetAbierto.includes('data-movil-objetivo="obra"'));

// ── Contadores igual que escritorio ──
const { isFinServicioSinCronograma } = await importFront('lib/operaciones/opsHeaderCounts.ts');
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
const visiblesNoche = [noche, { ...noche }, { ...noche }].filter((s) => shiftCountsInOpsHeader(s, publicado));
const activos = visiblesNoche.filter(enActivos).length;
const retenidos = visiblesNoche.filter(enRetenidos).length;
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

// ── Respaldo celular: acciones por estado en la hoja de la tarjeta (mismas callables del escritorio) ──
const { accionesParaTurno } = await importFront('lib/movil/guardAcciones.ts');
const { GuardAccionesSheetBody, SalaSheetBody, GuardCard } = await importFront('components/movil/OperacionScreens.tsx');
const { isPilotInactive, pilotInactiveMinutes, PILOT_INACTIVE_MS } = await importFront('lib/operaciones/pilotInactivity.ts');
const NOW_A = ar('15:20').getTime();
const ids = (shift, now = NOW_A) => accionesParaTurno(shift, now).map((a) => a.id).join(',');
const turnoBase = { id: 'a1', employeeName: 'Baez, Juan', phone: '351', code: 'T', positionName: 'Puesto 1', objectiveName: 'Peaje', shiftDateObj: ar('15:00'), endDateObj: ar('23:00') };
check('plan antes de T−60: sin acciones (ni ingreso ni ausente)', ids({ ...turnoBase, shiftDateObj: ar('17:00'), endDateObj: ar('01:00', '2026-10-02'), isFuture: true }) === '');
check('plan en ventana (T−30): marcar ingreso, todavía no ausente', ids({ ...turnoBase, shiftDateObj: ar('15:45'), endDateObj: ar('23:45'), isFuture: true, isImminent: true }) === 'INGRESO');
check('tarde sin aviso (T+20): avisar por la app + ingreso + ausente', ids({ ...turnoBase, isLateUnnotified: true }) === 'AVISAR_ENTRANTE,INGRESO,AUSENTE');
check('tarde avisada: avisar + ingreso + ausente', ids({ ...turnoBase, isLateNotified: true, lateArrivalEtaMinutes: 30 }) === 'AVISAR_ENTRANTE,INGRESO,AUSENTE');
check('activo: salida/relevo', ids({ ...turnoBase, isPresent: true, realStartTime: ar('15:01') }) === 'SALIDA');
check('retenido: liberar (CHECKOUT) + extender retención + avisar al retenido, sin salida simple', ids({ ...turnoBase, shiftDateObj: ar('07:00'), endDateObj: ar('15:00'), isPresent: true, isRetention: true, retentionMinutes: 20 }) === 'LIBERAR,RETENCION,AVISAR_RETENIDO');
check('esperando relevo (fin vencido, P9): liberar + retención + avisar', ids({ ...turnoBase, shiftDateObj: ar('07:00'), endDateObj: ar('15:00'), isPresent: true, isPendingClose: true }) === 'LIBERAR,RETENCION,AVISAR_RETENIDO');
check('ausente dentro de T+60: avisar + llegó/revertir + cubrir hueco', ids({ ...turnoBase, isAbsent: true, status: 'ABSENT' }) === 'AVISAR_ENTRANTE,LLEGO,PROTOCOLO');
check('ausente pasado T+60: solo cubrir hueco (canRevertAbsenceNow)', ids({ ...turnoBase, isAbsent: true, status: 'ABSENT' }, ar('16:05').getTime()) === 'PROTOCOLO');
check('ausente ya cubierto: revertir sigue hasta T+60 (P5f) + ver protocolo', ids({ ...turnoBase, isAbsent: true, operacionallyCovered: true }) === 'AVISAR_ENTRANTE,LLEGO,PROTOCOLO');
check('vacante: solo cubrir hueco', ids({ ...turnoBase, employeeId: 'VACANTE', employeeName: 'VACANTE', isUnassigned: true, vacancyBand: 'T' }) === 'PROTOCOLO');
check('franco: sin acciones', ids({ ...turnoBase, code: 'F', isFranco: true }) === '');
check('completado: sin acciones', ids({ ...turnoBase, isPresent: false, isCompleted: true, realEndTime: ar('15:10') }) === '');
const conf = (shift, id) => accionesParaTurno(shift, NOW_A).find((a) => a.id === id)?.confirm;
check('las escrituras piden confirmación, abrir el protocolo no', !!conf({ ...turnoBase, isLateUnnotified: true }, 'INGRESO') && !!conf({ ...turnoBase, isLateUnnotified: true }, 'AUSENTE') && !!conf({ ...turnoBase, isPresent: true }, 'SALIDA') && conf({ ...turnoBase, isAbsent: true }, 'PROTOCOLO') === null);

const hojaNoops = { onEjecutar: () => {}, onCerrar: () => {} };
const hojaTarde = render(GuardAccionesSheetBody, { shift: { ...turnoBase, isLateUnnotified: true }, siblings: [], now: NOW_A, ...hojaNoops });
check('hoja 390 tarde: detalle, Marcar ingreso, Marcar ausente y LLAMAR', hojaTarde.includes('data-movil-sheet="acciones"') && hojaTarde.includes('data-movil-accion="INGRESO"') && hojaTarde.includes('data-movil-accion="AUSENTE"') && !hojaTarde.includes('data-movil-accion="SALIDA"') && hojaTarde.includes('registrarPresencia') && hojaTarde.includes('marcarAusenciaOperaciones') && hojaTarde.includes('data-movil-llamar="1"') && hojaTarde.includes('data-movil-detalle="a1"'));
const hojaAus = render(GuardAccionesSheetBody, { shift: { ...turnoBase, isAbsent: true }, siblings: [], now: NOW_A, ...hojaNoops });
check('hoja 390 ausente: Llegó/revertir y Cubrir hueco', hojaAus.includes('data-movil-accion="LLEGO"') && hojaAus.includes('data-movil-accion="PROTOCOLO"') && hojaAus.includes('Cubrir hueco') && !hojaAus.includes('data-movil-accion="INGRESO"'));
const hojaRet = render(GuardAccionesSheetBody, { shift: { ...turnoBase, shiftDateObj: ar('07:00'), endDateObj: ar('15:00'), isPresent: true, isRetention: true, retentionMinutes: 20 }, siblings: [], now: NOW_A, ...hojaNoops });
check('hoja 390 retenido: Liberar retenido + Extender retención', hojaRet.includes('data-movil-accion="LIBERAR"') && hojaRet.includes('data-movil-accion="RETENCION"') && hojaRet.includes('Retenido desde 15:00'));
const hojaVac = render(GuardAccionesSheetBody, { shift: { ...turnoBase, employeeId: 'VACANTE', employeeName: 'VACANTE', isUnassigned: true, vacancyBand: 'T' }, siblings: [], now: NOW_A, ...hojaNoops });
check('hoja 390 vacante: solo Cubrir hueco, sin LLAMAR', hojaVac.includes('data-movil-accion="PROTOCOLO"') && !hojaVac.includes('data-movil-llamar') && (hojaVac.match(/data-movil-accion=/g) || []).length === 1);
const hojaConfirm = render(GuardAccionesSheetBody, { shift: { ...turnoBase, isLateUnnotified: true }, siblings: [], now: NOW_A, confirmandoInicial: 'AUSENTE', ...hojaNoops });
check('hoja 390 confirmación en la hoja: pregunta + Confirmar/Volver, sin lista', hojaConfirm.includes('data-movil-confirmar="AUSENTE"') && hojaConfirm.includes('¿Declarar ausente a Baez, Juan?') && hojaConfirm.includes('data-movil-confirmar-ok="1"') && hojaConfirm.includes('>Volver<') && !hojaConfirm.includes('data-movil-accion='));
const hojaSin = render(GuardAccionesSheetBody, { shift: { ...turnoBase, isCompleted: true }, siblings: [], now: NOW_A, ...hojaNoops });
check('hoja 390 sin acciones: aviso', hojaSin.includes('data-movil-acciones-vacio="1"'));
const tarjetaTarde = render(GuardCard, { shift: { ...turnoBase, isLateUnnotified: true }, now: NOW_A, onLlego: () => {}, onRevertir: () => {}, onSalida: () => {}, onProtocolo: () => {}, onRetencion: () => {}, onAcciones: () => {} });
check('tarjeta 390 tarde: tocar la tarjeta abre la hoja; sin botones Ingreso/⋯', tarjetaTarde.includes('data-movil-tap="a1"') && tarjetaTarde.includes('aria-label="Acciones de BAEZ Juan"') && tarjetaTarde.includes('data-movil-estado="tarde"') && tarjetaTarde.includes('TAR 20′') && !tarjetaTarde.includes('>Ingreso<') && !tarjetaTarde.includes('data-movil-mas-acciones'));
check('hoja: sin WhatsApp; Llamar es el último recurso (abajo, blanco con borde)', !hojaTarde.includes('data-movil-whatsapp') && !hojaTarde.includes('wa.me') && hojaTarde.includes('Último recurso') && hojaTarde.includes('Llamar · 351') && hojaTarde.lastIndexOf('data-movil-llamar="1"') > hojaTarde.lastIndexOf('data-movil-accion='));

// ── Segunda vuelta: avisar por la app, nota rápida, próximas 3 h, pie ──
check('tarde: Avisar por la app primero (ENTRANTE sobre el propio turno), después ingreso/ausente', ids({ ...turnoBase, isLateUnnotified: true }) === 'AVISAR_ENTRANTE,INGRESO,AUSENTE' && accionesParaTurno({ ...turnoBase, isLateUnnotified: true }, NOW_A)[0].targetShiftId === 'a1');
check('ausente reversible: Avisar + Llegó + Cubrir; pasado T+60 solo Cubrir', ids({ ...turnoBase, isAbsent: true, status: 'ABSENT' }) === 'AVISAR_ENTRANTE,LLEGO,PROTOCOLO' && ids({ ...turnoBase, isAbsent: true, status: 'ABSENT' }, ar('16:05').getTime()) === 'PROTOCOLO');
const retBase = { ...turnoBase, shiftDateObj: ar('07:00'), endDateObj: ar('15:00'), isPresent: true, isRetention: true, retentionMinutes: 20 };
const retConRelevo = { ...retBase, retentionWait: { sinceMs: ar('15:00').getTime(), elapsedMinutes: 20, capAtMs: ar('19:59').getTime(), capRemainingMinutes: 279, reliever: { id: 't2', employeeName: 'Guerrero, Martín', code: 'T', startMs: ar('15:00').getTime(), status: 'NO_FICHO' }, waitLabel: '' } };
const accRet = accionesParaTurno(retConRelevo, NOW_A);
check('retenido con relevo sin fichar: Avisar al entrante (push al relevo) + liberar + retención + Avisar al retenido', accRet.map((a) => a.id).join(',') === 'AVISAR_ENTRANTE,LIBERAR,RETENCION,AVISAR_RETENIDO' && accRet[0].label === 'Avisar a Guerrero, Martín por la app' && accRet[0].targetShiftId === 't2' && accRet[0].relatedShiftId === 'a1' && accRet[3].label === 'Avisar a Baez, Juan' && accRet[3].targetShiftId === 'a1' && accRet[3].relatedShiftId === 't2');
check('retenido con relevo ya presente: no se avisa al entrante', ids({ ...retConRelevo, retentionWait: { ...retConRelevo.retentionWait, reliever: { ...retConRelevo.retentionWait.reliever, status: 'PRESENTE' } } }) === 'LIBERAR,RETENCION,AVISAR_RETENIDO');
check('retenido sin retentionWait: el entrante sale de la serie (siblings)', accionesParaTurno({ ...retBase, code: 'M' }, NOW_A, [{ ...retBase, code: 'M' }, { id: 'tt', employeeName: 'Perez, Hugo', code: 'T', positionName: 'Puesto 1', shiftDateObj: ar('15:00'), endDateObj: ar('23:00'), startTime: ar('15:00'), endTime: ar('23:00') }])[0].label === 'Avisar a Perez, Hugo por la app');
const { avisoManualRestanteSeg, AVISO_MANUAL_COOLDOWN_MS } = await importFront('lib/movil/guardAcciones.ts');
check('cooldown 5 min del aviso manual (espejo del servidor)', AVISO_MANUAL_COOLDOWN_MS === 300000 && avisoManualRestanteSeg({ opsAvisoManualAt: new Date(NOW_A - 2 * 60000) }, NOW_A) === 180 && avisoManualRestanteSeg({ opsAvisoManualAt: new Date(NOW_A - 6 * 60000) }, NOW_A) === 0 && avisoManualRestanteSeg({}, NOW_A) === 0);
const hojaAviso = render(GuardAccionesSheetBody, { shift: { ...turnoBase, isLateUnnotified: true }, siblings: [], now: NOW_A, onNota: () => {}, ...hojaNoops });
check('hoja 390: Avisar por la app arriba, nota rápida con input y Guardar, llamar al final', hojaAviso.includes('data-movil-accion="AVISAR_ENTRANTE"') && hojaAviso.indexOf('data-movil-accion="AVISAR_ENTRANTE"') < hojaAviso.indexOf('data-movil-accion="INGRESO"') && hojaAviso.includes('¿venís?') && hojaAviso.includes('data-movil-nota-input="1"') && hojaAviso.includes('data-movil-nota-guardar="1"') && hojaAviso.includes(`maxLength="140"`) && hojaAviso.lastIndexOf('data-movil-llamar') > hojaAviso.lastIndexOf('data-movil-nota-guardar'));
const hojaCooldown = render(GuardAccionesSheetBody, { shift: { ...turnoBase, isLateUnnotified: true, opsAvisoManualAt: new Date(NOW_A - 60000) }, siblings: [], now: NOW_A, ...hojaNoops });
check('hoja 390: aviso reciente → botón deshabilitado con «reintentá en N min»', /data-movil-accion="AVISAR_ENTRANTE"[^>]*disabled=""/.test(hojaCooldown) && hojaCooldown.includes('reintentá en 4 min'));
const hojaConfAviso = render(GuardAccionesSheetBody, { shift: retConRelevo, siblings: [], now: NOW_A, confirmandoInicial: 'AVISAR_ENTRANTE', ...hojaNoops });
check('hoja 390: confirmar aviso al entrante con el puesto', hojaConfAviso.includes('data-movil-confirmar="AVISAR_ENTRANTE"') && hojaConfAviso.includes('¿Avisar a Guerrero, Martín por la app que lo esperan en Puesto 1?'));
const GCx = await importFront('lib/movil/guardCompacto.ts');
const tardeRespondio = { ...tardeAvisada, lateArrivalConfirmedAt: ar('15:08'), lateArrivalRespondedLabel: '15:08' };
check('respuesta del guardia con hora (hoja y tarjeta compacta)', guardDetalle(tardeRespondio, [], AHORA).estado === 'Tarde 20 min · avisó · llega ~15:30 · respondió 15:08' && GCx.guardCompacto(tardeRespondio, [], AHORA).respuesta.hhmm === '15:08' && GCx.guardCompacto(tardeRespondio, [], AHORA).respuesta.eta === '15:30' && render(GuardCard, { shift: tardeRespondio, now: AHORA, onAcciones: () => {} }).includes('data-movil-mini="respuesta"'));
check('respuesta sin label usa lateArrivalAt', guardDetalle({ ...tardeAvisada, lateArrivalAt: ar('15:09') }, [], AHORA).estado.endsWith('respondió 15:09'));

// Nota rápida: en el turno (opsNota) y como novedad NOTA_OPERADOR informativa.
const N = await importFront('lib/operaciones/opsNota.ts');
const notaDoc = { texto: 'Sin llaves del portón', autor: 'Lopez', autorUid: 'u1', at: ar('15:21') };
check('nota: línea con hora y autor, normalización y tope 140', N.formatOpsNotaLine(notaDoc) === 'Nota 15:21 · Lopez: Sin llaves del portón' && N.normalizarNota('  hola   mundo ') === 'hola mundo' && N.normalizarNota('') === null && N.normalizarNota('x'.repeat(200)).length === 140 && N.OPS_NOTA_MAX === 140);
const notaNov = N.buildNotaNovedad({ id: 'a1', employeeId: 'e1', employeeName: 'Baez, Juan', objectiveId: 'peaje', objectiveName: 'Peaje', empresaId: 'pruebas_sa' }, notaDoc, 'CC_MOVIL');
check('nota → novedad NOTA_OPERADOR con turno, autor y origen', notaNov.type === 'NOTA_OPERADOR' && notaNov.shiftId === 'a1' && notaNov.description === 'Sin llaves del portón' && notaNov.createdByName === 'Lopez' && notaNov.source === 'CC_MOVIL' && notaNov.empresaId === 'pruebas_sa');
// novedadAlertDisplay arrastra el hook del monitor (Firebase): se verifica por fuente.
check('la nota es informativa en el escritorio (no exige acción)', /INFO_NOVEDAD_TYPES = new Set\(\[[^\]]*'NOTA_OPERADOR'/s.test(readFileSync(join(web2, 'src/lib/operaciones/novedadAlertDisplay.ts'), 'utf8')));
const conNota = { ...baezM, opsNota: notaDoc };
check('nota visible en tarjeta compacta, hoja y detalle', GCx.guardCompacto(conNota, peaje, AHORA).nota === 'Sin llaves del portón' && guardDetalle(conNota, peaje, AHORA).nota === 'Nota 15:21 · Lopez: Sin llaves del portón' && render(GuardCard, { shift: conNota, now: AHORA, onAcciones: () => {} }).includes('data-movil-mini="nota"') && render(GuardAccionesSheetBody, { shift: conNota, siblings: peaje, now: AHORA, onNota: () => {}, ...hojaNoops }).includes('data-movil-nota-actual="1"'));
const indexSrc = readFileSync(join(web2, 'src/pages/admin/operaciones/index.tsx'), 'utf8');
check('el escritorio muestra la nota en la tarjeta del CC', (indexSrc.match(/formatOpsNotaLine\(shift\.opsNota\)/g) || []).length >= 2);

// Próximas 3 horas: franjas que entran, confirmados / sin confirmar / sin nadie → Cubrir.
const PF = await importFront('lib/movil/proximasFranjas.ts');
const { ProximasSheetBody } = await importFront('components/movil/OperacionScreens.tsx');
const nocheN = base({ id: 'n', employeeId: 'e3', employeeName: 'Farias, Lucas', code: 'N', shiftDateObj: ar('23:00'), endDateObj: ar('07:00', '2026-10-02') });
const prox = PF.proximasFranjas([
  baezM, guerreroT,
  base({ id: 'p1', employeeId: 'e5', employeeName: 'Sosa, Carla', code: 'T', positionName: 'Puesto 2', shiftDateObj: ar('16:00'), endDateObj: ar('00:00', '2026-10-02'), lateArrivalAt: ar('15:10'), isLateNotified: true }),
  base({ id: 'p2', employeeId: 'e6', employeeName: 'Diaz, Rosa', code: 'T', positionName: 'Puesto 2', shiftDateObj: ar('16:00'), endDateObj: ar('00:00', '2026-10-02') }),
  base({ id: 'p3', employeeId: 'e7', employeeName: 'Gomez, Ana', code: 'T', positionName: 'Puesto 3', objectiveId: 'cet', objectiveName: 'CET', shiftDateObj: ar('17:00'), endDateObj: ar('01:00', '2026-10-02'), isAbsent: true }),
  base({ id: 'p4', employeeId: 'VACANTE', employeeName: 'VACANTE', isUnassigned: true, vacancyBand: 'T', positionName: 'Puesto 4', shiftDateObj: ar('18:00'), endDateObj: ar('02:00', '2026-10-02') }),
  nocheN,
  base({ id: 'f', employeeId: 'e9', employeeName: 'Franco, Luis', code: 'F', isFranco: true, shiftDateObj: ar('16:00'), endDateObj: ar('00:00', '2026-10-02') }),
], AHORA);
check('próximas 3 h: 3 franjas (16, 17, 18), la de las 23 y el franco quedan afuera', prox.length === 3 && prox.every((f) => f.startMs > AHORA && f.startMs <= AHORA + 3 * 3600000) && !prox.some((f) => f.guardias.some((g) => g.nombre.startsWith('Franco')) || f.hora === '23:00'));
const f16 = prox.find((f) => f.hora === '16:00');
check('franja 16:00: Sosa confirmó (avisó 15:10), Diaz sin confirmar', f16.confirmados === 1 && f16.sinConfirmar === 1 && !f16.sinNadie && f16.guardias.find((g) => g.nombre === 'Sosa, Carla').estado === 'CONFIRMADO' && f16.guardias.find((g) => g.nombre === 'Sosa, Carla').hora === '15:10' && f16.guardias.find((g) => g.nombre === 'Diaz, Rosa').estado === 'SIN_CONFIRMAR');
check('franja 17:00 con el único ausente y 18:00 vacante = sin nadie → Cubrir sobre ese turno; van primero', prox[0].sinNadie && prox[1].sinNadie && prox.find((f) => f.hora === '17:00').cubrirShift.id === 'p3' && prox.find((f) => f.hora === '18:00').cubrirShift.id === 'p4');
check('etiqueta del resumen', PF.etiquetaProximas(PF.resumenProximas(prox)) === 'Próximas 3 h · 3 franjas · 1 ok · 1 sin confirmar · 2 sin nadie' && PF.etiquetaProximas(PF.resumenProximas([])) === 'Próximas 3 h · sin relevos');
const proxHtml = render(ProximasSheetBody, { franjas: prox, now: AHORA, onCubrir: () => {}, onAbrirObjetivo: () => {} });
check('hoja 390 próximas: franjas con filete, estados en texto con hora y botón Cubrir solo en las sin nadie', proxHtml.includes('data-movil-sheet="proximas"') && (proxHtml.match(/data-movil-franja=/g) || []).length === 3 && (proxHtml.match(/data-movil-franja-cubrir=/g) || []).length === 2 && proxHtml.includes('confirmó 15:10') && proxHtml.includes('sin confirmar') && proxHtml.includes('Franja sin nadie asignado') && proxHtml.includes('data-movil-franja-estado="sin-nadie"') && !proxHtml.includes('rounded-2xl'));
check('hoja próximas en supervisión: sin Cubrir', !render(ProximasSheetBody, { franjas: prox, readOnly: true, now: AHORA, onCubrir: () => {} }).includes('data-movil-franja-cubrir'));
const homeProx = render(OperacionScreens, { ...baseFiltros, filtro: F.FILTRO_VACIO, contadores: {}, grupos: [], objectives: [], proximas: prox, onProximas: () => {}, pieLabel: 'Actualizado hace 3 min · 2 pendientes de enviar' });
check('home 390: fila «Próximas 3 h» bajo los contadores y pie con actualizado + pendientes', homeProx.includes('data-movil-proximas="fila"') && homeProx.includes('data-movil-proximas-sin-nadie="1"') && homeProx.includes('2 sin nadie') && homeProx.includes('data-movil-pie="1"') && homeProx.includes('Actualizado hace 3 min · 2 pendientes de enviar') && homeProx.indexOf('data-movil-contadores="fila"') < homeProx.indexOf('data-movil-proximas="fila"'));
const EL = await importFront('lib/movil/estadoLista.ts');
check('«Actualizado hace N min» y pendientes', EL.formatActualizadoHace(AHORA - 30000, AHORA) === 'Actualizado recién' && EL.formatActualizadoHace(AHORA - 7 * 60000, AHORA) === 'Actualizado hace 7 min' && EL.formatActualizadoHace(AHORA - 65 * 60000, AHORA) === 'Actualizado hace 1 h 05 min' && EL.formatActualizadoHace(0, AHORA) === 'Sin datos todavía' && EL.piePrincipal(AHORA - 60000, 1, AHORA) === 'Actualizado hace 1 min · 1 pendiente de enviar' && EL.piePrincipal(AHORA - 60000, 0, AHORA) === 'Actualizado hace 1 min');
const movilSrc2 = readFileSync(join(web2, 'src/components/movil/OperacionMovil.tsx'), 'utf8');
check('OperacionMovil: callable avisarGuardiaOperaciones, nota por cola offline, próximas y pie', movilSrc2.includes('invokeAvisarGuardiaOperaciones') && movilSrc2.includes('guardarNotaOperador') && movilSrc2.includes("enqueueFirestoreWrite(`Nota") && movilSrc2.includes('proximasFranjas(') && movilSrc2.includes('piePrincipal(') && movilSrc2.includes('ProximasSheetBody') && !movilSrc2.includes('WhatsApp'));

// ── Tarjeta compacta 390x844: alto, cantidad visible, un solo botón ──
const GC = await importFront('lib/movil/guardCompacto.ts');
check('nombre compacto APELLIDO Nombre', GC.nombreCompacto('Lopez, Hector Juan') === 'LOPEZ Hector Juan' && GC.nombreCompacto('LOPEZ, HECTOR') === 'LOPEZ Hector' && GC.nombreCompacto('Sin coma') === 'Sin coma' && GC.apellidoCompacto('Guerrero, Martín') === 'GUERRERO');
check('puesto compacto', GC.puestoCompacto('Puesto 2') === 'P2' && GC.puestoCompacto('Puesto 12') === 'P12' && GC.puestoCompacto('Portería Norte') === 'PORTER…' && GC.puestoCompacto('') === 'P?');
const cBaez = GC.guardCompacto(baezM, peaje, AHORA);
check('activo: reloj con horas en servicio desde la marca real, ingreso a tiempo y relevo', cBaez.estado.kind === 'activo' && cBaez.estado.texto === '08:28' && cBaez.ingreso.hhmm === '07:00' && cBaez.ingreso.tardeMin === 0 && cBaez.relevo.apellido === 'GUERRERO' && cBaez.relevo.hhmm === '15:00' && cBaez.relevo.sentido === 'lo_releva' && cBaez.puesto === 'P1');
const cRet = GC.guardCompacto(retenido, [retenido, { ...guerreroT, isPresent: false, isAbsent: true }], AHORA);
check('retenido: RET minutos, tope y a quién espera', cRet.estado.texto === 'RET 20m' && cRet.tope === 'tope 19:59' && cRet.relevo.apellido === 'GUERRERO');
check('tarde: TAR minutos sin ingreso', GC.guardCompacto(tardeSinAviso, [], AHORA).estado.texto === 'TAR 20′' && GC.guardCompacto(tardeSinAviso, [], AHORA).ingreso === null);
check('vacante: VAC sin teléfono', GC.guardCompacto(vacante, peaje, AHORA).estado.kind === 'vacante' && GC.guardCompacto(vacante, peaje, AHORA).telefono === null && GC.guardCompacto(vacante, peaje, AHORA).nombre === 'VACANTE · T');
check('alto de diseño ≤ 80 px y ≥ 7 tarjetas en 390x844 con barra, encabezado fino, contadores y nav', GC.ALTO_TARJETA_COMPACTA_PX <= 80 && GC.tarjetasVisibles(844, 56 + 40 + 44 + 64) >= 7 && GC.tarjetasVisibles(844, 56 + 40 + 44 + 64) === 10);
const soloTarjeta = render(GuardCard, { shift: baezM, siblings: peaje, now: AHORA, onAcciones: () => {} });
check('tarjeta: 2 filas (leading-5 + leading-4, py-2), sin avatar grande ni botones altos', soloTarjeta.includes('leading-5') && soloTarjeta.includes('leading-4') && soloTarjeta.includes('py-2') && !soloTarjeta.includes('h-10 w-10') && !soloTarjeta.includes('min-h-12') && !soloTarjeta.includes('min-h-14') && (soloTarjeta.match(/<button/g) || []).length === 1 && (soloTarjeta.match(/<a /g) || []).length === 1);
check('tarjeta: íconos lucide en la fila 2 (MapPin, Clock, LogIn, ArrowRightLeft)', ['puesto', 'horario', 'ingreso', 'relevo'].every((k) => soloTarjeta.includes(`data-movil-mini="${k}"`)) && (soloTarjeta.match(/<svg/g) || []).length >= 6);
const ocho = Array.from({ length: 8 }, (_, i) => ({ ...baezM, id: `k${i}`, employeeId: `k${i}`, employeeName: `Guardia ${i}, Nombre` }));
const ochoHtml = render(OperacionScreens, { empresa: 'P', modeLabel: 'Manual', online: true, pendingLabel: null, now: AHORA, stats: { activos: 8, retenidos: 0, ausentes: 0, vacantes: 0, plan: 0 }, panel: 'objetivo', alerts: [], objectives: [], objective: { ...objetivoDetalle, shifts: ocho }, onAcciones: () => {}, ...noops });
check('8 tarjetas compactas en el objetivo, cada una con una sola zona de toque', (ochoHtml.match(/data-movil-card="compacta"/g) || []).length === 8 && (ochoHtml.match(/data-movil-tap="/g) || []).length === 8 && (ochoHtml.match(/data-movil-detalle=/g) || []).length === 8);
const soloLectura = render(GuardCard, { shift: baezM, siblings: peaje, now: AHORA, readOnly: true, onAcciones: () => {} });
check('solo lectura: la tarjeta no se toca y conserva el teléfono', !soloLectura.includes('<button') && !soloLectura.includes('data-movil-tap') && soloLectura.includes('data-movil-llamar="1"'));
const chips = [...todosHtml.matchAll(/<button[^>]*data-movil-contador="[^"]+"[\s\S]*?<\/button>/g)].map((m) => m[0]);
check('contadores: 6 chips en una fila (grid, alto 32, texto 11, sin ícono ni scroll) y entran a 360 px', todosHtml.includes('grid-cols-6') && !todosHtml.includes('overflow-x-auto') && chips.length === 6 && chips.every((b) => b.includes('h-8') && b.includes('text-[11px]') && !b.includes('<svg')) && ['ACT', 'PLA', 'TAR', 'AUS', 'VAC', 'RET'].every((c) => todosHtml.includes(`>${c}<`)) && F.contadoresCabenEnFila(360) && F.contadoresCabenEnFila(390) && !F.contadoresCabenEnFila(200));
check('contador activo relleno con el color de la empresa (negro por defecto); los demás blancos con borde', ausHtml.includes('data-movil-contador="AUSENTES" data-movil-filtro-activo="1"') && ausHtml.includes('bg-[var(--movil-primary,#111827)]') && ausHtml.includes('aria-pressed="true"') && ausHtml.includes('border-[#eceef1] bg-white text-slate-700') && !ausHtml.includes('ring-2'));

// ── Sala del celular: tomar mando con piloto inactivo, pedir mando, pasar a Auto con confirmación ──
const sesionPiloto = (minAgo) => ({ startTime: new Date(NOW_A - 3 * 3600000), lastActivityAt: new Date(NOW_A - minAgo * 60000) });
check('piloto con heartbeat reciente está activo', !isPilotInactive(sesionPiloto(2), NOW_A) && pilotInactiveMinutes(sesionPiloto(2), NOW_A) === 2);
check('piloto sin heartbeat hace 5 min está inactivo (umbral 5)', isPilotInactive(sesionPiloto(5), NOW_A) && PILOT_INACTIVE_MS === 300000 && isPilotInactive({ startTime: new Date(NOW_A - 10 * 60000), lastActivityAt: null }, NOW_A));
check('sesión sin heartbeat usa startTime', !isPilotInactive({ startTime: new Date(NOW_A - 60000), lastActivityAt: null }, NOW_A));
const salaNoops = { onTomarMando: () => {}, onTakeOver: () => {}, onRequestPilot: () => {}, onAcceptPilot: () => {}, onRejectPilot: () => {}, onPasarAuto: () => {}, onSalir: () => {} };
const salaBase = { modeLabel: 'Manual', steps: ['RET', 'REF', 'ESC', 'Ext+Adel', 'Eventuales', 'FT'], ...salaNoops };
const salaInactivo = render(SalaSheetBody, { ...salaBase, isPilot: false, inRoom: false, pilotName: 'Lopez, Ana', pilotInactive: true, pilotInactiveMin: 7 });
check('sala 390: piloto sin actividad 7 min → Tomar el mando ahora (sin pedir)', salaInactivo.includes('data-movil-piloto-inactivo="1"') && salaInactivo.includes('Sin actividad hace 7 min') && salaInactivo.includes('data-movil-sala-accion="TOMAR_INACTIVO"') && !salaInactivo.includes('data-movil-sala-accion="PEDIR"') && !salaInactivo.includes('data-movil-sala-accion="AUTO"'));
const salaActivo = render(SalaSheetBody, { ...salaBase, isPilot: false, inRoom: true, pilotName: 'Lopez, Ana', pilotInactive: false, pilotInactiveMin: 1 });
check('sala 390: piloto activo → Pedir mando y Salir de la sala, sin tomar', salaActivo.includes('data-movil-sala-accion="PEDIR"') && salaActivo.includes('>Pedir mando<') && salaActivo.includes('data-movil-sala-accion="SALIR"') && !salaActivo.includes('TOMAR_INACTIVO') && !salaActivo.includes('data-movil-piloto-inactivo'));
const salaFuera = render(SalaSheetBody, { ...salaBase, isPilot: false, inRoom: false, pilotName: 'Lopez, Ana', pilotInactive: false });
check('sala 390: fuera de la sala con piloto activo → entrar como apoyo y pedir', salaFuera.includes('Entrar como apoyo y pedir mando'));
const salaPiloto = render(SalaSheetBody, { ...salaBase, isPilot: true, inRoom: true, pilotName: 'Yo', pendingPilotName: 'Perez, Hugo' });
check('sala 390: piloto → Pasar a Auto + pedido de mando pendiente', salaPiloto.includes('data-movil-sala-accion="AUTO"') && salaPiloto.includes('data-movil-pedido-mando="1"') && salaPiloto.includes('Perez, Hugo pide el mando') && !salaPiloto.includes('PEDIR'));
const salaAuto = render(SalaSheetBody, { ...salaBase, modeLabel: 'Auto', isPilot: false, inRoom: false });
check('sala 390: sin sala → Tomar mando · pasar a Manual', salaAuto.includes('data-movil-sala-accion="TOMAR"') && salaAuto.includes('pasar a Manual'));
const salaConfAuto = render(SalaSheetBody, { ...salaBase, isPilot: true, inRoom: true, pilotName: 'Yo', confirmandoInicial: 'AUTO' });
check('sala 390: Pasar a Auto pide confirmación', salaConfAuto.includes('data-movil-confirmar="AUTO"') && salaConfAuto.includes('Sí, pasar a Auto') && !salaConfAuto.includes('data-movil-sala-accion='));
const salaConfTomar = render(SalaSheetBody, { ...salaBase, isPilot: false, inRoom: true, pilotName: 'Lopez, Ana', pilotInactive: true, pilotInactiveMin: 9, confirmandoInicial: 'TOMAR' });
check('sala 390: tomar mando pide confirmación y avisa la bitácora', salaConfTomar.includes('data-movil-confirmar="TOMAR"') && salaConfTomar.includes('no da señales hace 9 min') && salaConfTomar.includes('bitácora') && salaConfTomar.includes('Sí, tomar el mando'));

// ── Deep-link del push: /admin/operaciones/?shiftId=… ──
const opsAlertLink = (() => {
  try {
    return createRequire(join(repo, 'apps/functions/package.json'))('./lib/notifications/onNovedadCreated.js').opsAlertLink;
  } catch {
    return null;
  }
})();
if (opsAlertLink) {
  check('push: link con shiftId abre la tarjeta; sin turno va al CC', opsAlertLink({ shiftId: 'abc 1' }) === '/admin/operaciones/?shiftId=abc%201' && opsAlertLink({ virtualVacancyId: 'gap_x' }) === '/admin/operaciones/?shiftId=gap_x' && opsAlertLink({}) === '/admin/operaciones/');
} else {
  console.log('SKIP push link (compilar apps/functions)');
}
const swSrc = readFileSync(join(web2, 'public/firebase-messaging-sw.js'), 'utf8');
check('service worker: click navega al link del aviso (deep-link) con requireInteraction y vibrate para el operador', swSrc.includes('notificationclick') && swSrc.includes('client.navigate(target)') && swSrc.includes('requireInteraction: esOperador') && swSrc.includes('vibrate: esOperador'));
const fcmSrc = readFileSync(join(web2, 'src/hooks/useAdminFcm.ts'), 'utf8');
check('primer plano: notificación persistente con requireInteraction, vibrate y data.link', fcmSrc.includes('registration.showNotification') && fcmSrc.includes('requireInteraction: true') && fcmSrc.includes('vibrate: [300, 120, 300]') && fcmSrc.includes('data: { link }'));
const novSrc = readFileSync(join(repo, 'apps/functions/src/notifications/onNovedadCreated.ts'), 'utf8');
check('onNovedadCreated: ausencia, retención larga, tope 12:59, convocatoria rechazada y sin candidato con deep-link', ['AUSENCIA_AUTO', 'RETENCION_LARGA', 'TOPE_JORNADA', 'CONVOCATORIA_RECHAZADA', 'VACANTE_SIN_COBERTURA', 'SIN_COBERTURA'].every((t) => novSrc.includes(`'${t}'`)) && novSrc.includes('vibrate: [300, 120, 300]') && novSrc.includes('fcmOptions: { link }'));
const movilSrc = readFileSync(join(web2, 'src/components/movil/OperacionMovil.tsx'), 'utf8');
check('OperacionMovil: ?shiftId abre el objetivo y la hoja de acciones del turno', movilSrc.includes('router.query.shiftId') && movilSrc.includes('setAccionesShiftId(shift.id)') && movilSrc.includes('setSelectedId(esTurnoEvento(shift)'));

// ── Estilo del panel (components/movil/ui): barra oscura, encabezado RRHH, KPIs, tarjetas, píldoras ──
const UI = await importFront('components/movil/ui/index.ts');
const RadioIcon = (p) => createElement('svg', { 'data-icon': 'radio', width: p.size, height: p.size });
const headerHtmlUi = render(UI.MovilHeader, { icon: RadioIcon, title: 'Centro de Control', date: new Date(2026, 9, 1) });
check('MovilHeader: ícono gris sin cuadro ni sombra, título MAYÚSCULAS espaciadas y fecha en gris', !headerHtmlUi.includes('bg-slate-200') && !headerHtmlUi.includes('shadow') && headerHtmlUi.includes('font-semibold uppercase leading-none tracking-wider text-slate-900') && headerHtmlUi.includes('tracking-widest text-slate-500') && /jueves,? 1 de octubre de 2026/.test(headerHtmlUi));
const statHtml = render(UI.MovilStat, { icon: RadioIcon, tone: 'emerald', label: 'Activos', value: 7, badge: createElement(UI.MovilBadge, { tone: 'emerald' }, '99%'), pct: 99, onClick: () => {}, active: true, attrs: { 'data-x': 'a' } });
const statQuieto = render(UI.MovilStat, { icon: RadioIcon, tone: 'emerald', label: 'Activos', value: 7, pct: 99 });
check('MovilStat: sin cuadro pastel ni sombra; número en color de estado; activo = relleno color empresa', !/\bbg-emerald-50\b/.test(statQuieto) && !statQuieto.includes('shadow') && statQuieto.includes('rounded-lg border border-[#eceef1] bg-white') && statQuieto.includes('text-emerald-600">7<') && statQuieto.includes('role="progressbar"') && statHtml.includes('bg-[var(--movil-primary,#111827)]') && !statHtml.includes('ring-2') && statHtml.includes('>99%<') && statHtml.includes('aria-pressed="true"') && statHtml.includes('data-x="a"'));
const cardHtmlUi = render(UI.MovilCard, { icon: RadioIcon, tone: 'rose', title: 'Peaje', subtitle: 'Ruta 9', badge: createElement(UI.MovilBadge, { tone: 'rose', size: 'md' }, '50%'), onClick: () => {}, attrs: { 'data-c': '1' } }, null);
check('MovilCard: blanca, borde #eceef1, radio 8 px, sin sombra; botón si tiene onClick', cardHtmlUi.startsWith('<button') && cardHtmlUi.includes('rounded-lg border border-[#eceef1] bg-white') && !cardHtmlUi.includes('shadow') && !cardHtmlUi.includes('rounded-2xl') && cardHtmlUi.includes('>Peaje<') && cardHtmlUi.includes('>50%<') && cardHtmlUi.includes('data-c="1"'));
const cardFilete = render(UI.MovilCard, { title: 'X', ring: 'rose' }, null);
check('MovilCard: estado = filete de 3 px a la izquierda, no anillo', cardFilete.includes('w-[3px]') && cardFilete.includes('bg-rose-500') && !cardFilete.includes('ring-'));
const badgeHtml = render(UI.MovilBadge, { tone: 'rose' }, 'AUS 2');
const badgeOutline = render(UI.MovilBadge, { tone: 'slate', outline: true }, 'M');
check('MovilBadge: texto en color sin relleno; outline = recuadro con borde', badgeHtml.includes('text-rose-600') && !badgeHtml.includes('bg-rose') && !badgeHtml.includes('rounded-full') && badgeOutline.includes('rounded border border-slate-300'));
const topHtml = render(UI.MovilTopBar, { modulo: 'Operación', empresa: 'Pruebas S.A.', online: false, pendingLabel: '1 ingreso' });
check('MovilTopBar: fondo con variable de empresa (negro por defecto), módulo en MAYÚSCULAS espaciadas, empresa en píldora con borde sin relleno, sin sombra', topHtml.includes('bg-[var(--movil-topbar,#111827)]') && !topHtml.includes('shadow') && topHtml.includes('tracking-[0.2em]') && topHtml.includes('>Operación<') && topHtml.includes('rounded-full border border-white/40 bg-transparent') && !topHtml.includes('bg-white/10 ') && topHtml.includes('>Pruebas S.A.<') && topHtml.includes('Sin señal') && topHtml.includes('Pendiente de enviar: 1 ingreso'));
const iconBtn = render(UI.MovilIconButton, { icon: RadioIcon, label: 'Más', onClick: () => {} });
check('MovilIconButton: blanco con borde, sin sombra, ícono gris', iconBtn.includes('border border-slate-300 bg-white') && !iconBtn.includes('shadow') && iconBtn.includes('text-slate-700'));
check('tarjeta compacta: código en recuadro con borde (no relleno), estado solo texto en color, sin sombra ni rounded-2xl', soloTarjeta.includes('rounded border border-slate-300') && soloTarjeta.includes('data-movil-code="M"') && !soloTarjeta.includes('bg-slate-900') && !soloTarjeta.includes('shadow') && !soloTarjeta.includes('rounded-2xl') && !soloTarjeta.includes('rounded-full') && soloTarjeta.includes('w-[3px]') && soloTarjeta.includes('bg-emerald-500'));
check('ningún componente del celular conserva pastel/sombras/indigo/rounded-2xl', ['OperacionScreens.tsx', 'OperacionMovil.tsx', 'MovilBottomNav.tsx', 'BottomSheet.tsx', 'MovilMenuScreens.tsx', 'RrhhScreens.tsx', 'EventualesScreens.tsx', 'PlanificacionMovilView.tsx', 'ServiciosMovilScreens.tsx', 'MovilDesktopOnly.tsx', 'ui/MovilCard.tsx', 'ui/MovilStat.tsx', 'ui/MovilTopBar.tsx', 'ui/MovilHeader.tsx', 'ui/MovilBadge.tsx', 'ui/MovilIconBox.tsx', 'ui/MovilIconButton.tsx', 'ui/tones.ts'].every((f) => {
  const src = readFileSync(join(web2, 'src/components/movil', f), 'utf8');
  return !/\b(bg-indigo-\d+|text-indigo-\d+|rounded-2xl|rounded-3xl|shadow-(sm|md|lg)\b|font-black|bg-(emerald|rose|amber|indigo|violet|orange)-50)\b/.test(src);
}));
const navSrc = readFileSync(join(web2, 'src/components/movil/MovilBottomNav.tsx'), 'utf8');
check('barra inferior: pestaña activa = línea de 2 px + texto con el color de la empresa, sin relleno indigo', navSrc.includes('data-movil-nav-active') && navSrc.includes('MOVIL_PRIMARY_TEXT') && navSrc.includes('MOVIL_PRIMARY_BG') && navSrc.includes('h-0.5') && !navSrc.includes('bg-indigo-50'));

// ── Colores de la empresa: solo variables CSS, nunca hex fijos; contraste AA si el color es claro ──
const CT = await importFront('lib/companyTheme.ts');
const azul = CT.buildMovilTheme('#1d4ed8');
const amarillo = CT.buildMovilTheme('#fde047');
check('empresa azul: primario = su color, barra = tono oscuro, texto blanco', azul['--movil-primary'] === '#1d4ed8' && azul['--movil-primary-text'] === '#ffffff' && azul['--movil-topbar'] === CT.buildCompanyTheme('#1d4ed8')['--topbar-bg'] && azul['--movil-topbar'] !== '#1d4ed8');
check('empresa amarilla (clara): primario pasa al tono oscuro (--company-primary-darker) para AA', CT.companyColorIsLight('#fde047') && !CT.companyColorIsLight('#1d4ed8') && amarillo['--movil-primary'] === CT.buildCompanyTheme('#fde047')['--company-primary-darker'] && amarillo['--movil-primary'] !== '#fde047');
check('las variables --movil-* se limpian con el tema', ['--movil-topbar', '--movil-primary', '--movil-primary-text'].every((v) => CT.COMPANY_THEME_VARS.includes(v)));
const movilFiles = ['OperacionScreens.tsx', 'MovilBottomNav.tsx', 'MovilMenuScreens.tsx', 'ui/tones.ts', 'ui/MovilTopBar.tsx', 'ui/MovilStat.tsx'].map((f) => readFileSync(join(web2, 'src/components/movil', f), 'utf8')).join('\n');
check('el celular usa var(--movil-*) con fallback negro, nunca el hex de una empresa', movilFiles.includes('var(--movil-primary,#111827)') && movilFiles.includes('var(--movil-topbar,#111827)') && !/#(1d4ed8|4f46e5|6366f1|059669)/i.test(movilFiles));
// Render con dos empresas: el markup es el mismo (clases con variables); el color lo pone el tema en :root.
const renderEmpresa = (nombre) => render(OperacionScreens, { ...baseFiltros, empresa: nombre, filtro: { ...F.FILTRO_VACIO, estado: 'AUSENTES' }, contadores: { AUSENTES: 1 }, grupos: [], objectives: [] });
const htmlA = renderEmpresa('Bacar S.A.');
const htmlB = renderEmpresa('Grupo Norte');
check('dos empresas de colores distintos: mismo markup salvo el nombre (el color viene de las variables)', htmlA.replaceAll('Bacar S.A.', 'X') === htmlB.replaceAll('Grupo Norte', 'X') && htmlA.includes('bg-[var(--movil-topbar,#111827)]') && htmlA.includes('bg-[var(--movil-primary,#111827)]'));
// Los estados nunca usan el color de la empresa.
check('colores de estado semánticos (verde/ámbar/naranja/rojo) intactos', UI.MOVIL_TEXT.emerald === 'text-emerald-600' && UI.MOVIL_TEXT.amber === 'text-amber-600' && UI.MOVIL_TEXT.orange === 'text-orange-600' && UI.MOVIL_TEXT.rose === 'text-rose-600' && UI.MOVIL_FILETE.rose === 'bg-rose-500' && UI.toneForGuard('plan') === 'slate' && UI.toneForGuard('late') === 'amber');
check('Operación: barra + fecha/modo en línea gris, sin encabezado «Centro de Control», buscador de 36 px y modo sobrio', todosHtml.includes('data-movil-topbar="Operación"') && todosHtml.includes('data-movil-fecha="1"') && todosHtml.includes('data-movil-modo="Manual"') && todosHtml.includes('h-6') && !todosHtml.includes('>Centro de Control<') && !todosHtml.includes('bg-emerald-600') && todosHtml.includes('data-movil-buscar="1"') && todosHtml.includes('h-9') && (todosHtml.match(/role="progressbar"/g) || []).length >= 3 && todosHtml.includes('data-movil-objetivo-card="peaje"'));
const objChrome = render(OperacionScreens, { empresa: 'P', modeLabel: 'Manual', online: true, pendingLabel: null, now: AHORA, panel: 'objetivo', alerts: [], objectives: [], objective: { ...objetivoDetalle, shifts: [baezM] }, onAcciones: () => {}, ...noops });
check('primera tarjeta de guardia a menos de 170 px del borde', F.ALTO_HASTA_PRIMERA_TARJETA_PX < 170 && F.ALTO_HASTA_PRIMERA_TARJETA_PX === 112 && objChrome.includes(`data-movil-hasta-tarjeta="${F.ALTO_HASTA_PRIMERA_TARJETA_PX}"`) && objChrome.includes('data-movil-card="compacta"') && objChrome.indexOf('data-movil-fecha') < objChrome.indexOf('data-movil-card="compacta"'));
check('Supervisión: barra con «Supervisión» y Solo lectura en píldora', supervisionHtml.includes('data-movil-topbar="Supervisión"') && supervisionHtml.includes('Solo lectura'));
check('Selector de módulos con barra oscura, fecha en línea gris y tiles compactos con ícono', menuHtml.includes('data-movil-topbar="Menú"') && !menuHtml.includes('>Módulos<') && menuHtml.includes('data-movil-fecha="1"') && (menuHtml.match(/data-movil-tile="64"/g) || []).length === 6 && (menuHtml.match(/<svg/g) || []).length >= 8 && menuHtml.includes('Ver como escritorio'));
check('ningún módulo del celular redefine tarjetas/píldoras sueltas en Operación', !readFileSync(join(web2, 'src/components/movil/OperacionScreens.tsx'), 'utf8').includes('TONE_PILL'));

// ── Zoom del navegador: viewport, touch-action, inputs de 16 px y nada más ancho que la pantalla ──
const VP = await importFront('lib/movil/viewportMovil.ts');
check('viewport: celular sin zoom (maximum-scale=1, viewport-fit=cover); escritorio igual que siempre', VP.metaViewport(true) === 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover' && VP.metaViewport(false) === 'width=device-width, initial-scale=1');
const appSrc = readFileSync(join(web2, 'src/pages/_app.tsx'), 'utf8');
check('_app usa metaViewport(movil) y marca html[data-movil]', appSrc.includes('content={metaViewport(movil)}') && appSrc.includes('aplicarModoMovilAlDocumento(movil)') && !appSrc.includes('content="width=device-width, initial-scale=1"'));
const rootAttrs = {};
const fakeRoot = { setAttribute: (k, v) => { rootAttrs[k] = v; }, removeAttribute: (k) => { delete rootAttrs[k]; } };
VP.aplicarModoMovilAlDocumento(true, fakeRoot);
const marcado = rootAttrs['data-movil'] === '1';
VP.aplicarModoMovilAlDocumento(false, fakeRoot);
check('html[data-movil="1"] solo en modo celular', marcado && !('data-movil' in rootAttrs));
const css = readFileSync(join(web2, 'src/styles/globals.css'), 'utf8');
const bloqueMovil = css.slice(css.indexOf('html[data-movil="1"]'), css.indexOf('/* Inputs y selects más grandes en mobile'));
check('globals.css: touch-action manipulation + overflow-x hidden + inputs 16px bajo html[data-movil]', bloqueMovil.includes('touch-action: manipulation') && bloqueMovil.includes('overflow-x: hidden') && bloqueMovil.includes('html[data-movil="1"] input') && bloqueMovil.includes('font-size: 16px !important') && bloqueMovil.includes('textarea'));
const inputsMovil = readdirSync(join(web2, 'src/components/movil')).filter((f) => f.endsWith('.tsx')).map((f) => readFileSync(join(web2, 'src/components/movil', f), 'utf8')).join('\n');
const tagsInput = inputsMovil.match(/<(input|textarea)\b[\s\S]*?(?<!=)\/?>/g) || [];
check(`inputs del celular con font-size ≥ 16 px (${tagsInput.length} inputs, ninguno text-sm/xs/[13px])`, tagsInput.length >= 10 && tagsInput.every((t) => !/text-\[1[0-5]px\]|\btext-sm\b|\btext-xs\b/.test(t)) && tagsInput.filter((t) => !t.includes('type="file"')).every((t) => t.includes('text-base')));
const pantallas = { home: todosHtml, objetivo: objChrome, filtrada: vacioHtml, ocho: ochoHtml, menu: menuHtml, supervision: supervisionHtml };
for (const ancho of [360, 390]) {
  const fallan = Object.entries(pantallas).filter(([, h]) => !VP.cabeEnViewport(h, ancho)).map(([k, h]) => `${k}:${VP.scrollWidthEstimado(h, ancho)}`);
  check(`a ${ancho} px ningún render supera el viewport (scrollWidth ≤ clientWidth) y la raíz corta el desborde`, fallan.length === 0 && Object.values(pantallas).every((h) => h.includes('touch-manipulation overflow-x-hidden')) && F.contadoresCabenEnFila(ancho));
  if (fallan.length) console.error('   desbordan:', fallan.join(', '));
}
check('scrollWidthEstimado detecta anchos fijos', VP.anchoFijoMaximoPx('<div class="w-[420px]">') === 420 && VP.anchoFijoMaximoPx('<div class="min-w-96 max-w-[480px]">') === 384 && VP.anchoFijoMaximoPx('<div style="width:500px">') === 500 && !VP.cabeEnViewport('<div class="overflow-x-hidden w-[400px]">', 390) && VP.cabeEnViewport('<div class="overflow-x-hidden w-full">', 360));
// Estado vacío con filtro activo: dice el filtro, no «Mostrando ACT · 0».
const vacioAct = render(OperacionScreens, { ...baseFiltros, filtro: { ...F.FILTRO_VACIO, estado: 'ACTIVOS' }, contadores: { ACTIVOS: 0 }, grupos: [], objectives: [], vacioLabel: undefined });
check('vacío con filtro: «Sin guardias en ACT», sin «Mostrando ACT · 0», con Ver todos', vacioAct.includes('Sin guardias en ACT') && !vacioAct.includes('Mostrando') && vacioAct.includes('Ver todos') && vacioHtml.includes('Sin guardias en AUS para Malagueño') && !vacioHtml.includes('Mostrando'));

rmSync(outdir, { recursive: true, force: true });

if (failed) {
  console.error(failed, 'fallos');
  process.exit(1);
}
console.log('movil operacion ok');
