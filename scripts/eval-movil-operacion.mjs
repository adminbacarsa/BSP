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
  empresaId: 'pruebas_sa',
  empresaName: 'Pruebas S.A.',
  empresas: [{ id: 'pruebas_sa', name: 'Pruebas S.A.' }, { id: 'bacarsa', name: 'Bacar S.A.' }],
  canSwitchEmpresa: true,
  modulos: saModules,
  unico: null,
  onModulo: () => {}, onSwitchEmpresa: () => {}, onAsistente: () => {}, onEscritorio: () => {}, onLogout: () => {},
});
check('menú 390: 6 módulos, empresa activa y cerrar sesión', (menuHtml.match(/data-movil-module=/g) || []).length === 6 && menuHtml.includes('Empresa activa') && menuHtml.includes('Cambiar a Bacar S.A.') && menuHtml.includes('Cerrar sesión') && menuHtml.includes('Asistente'));

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
check('tarjeta 390: ingreso real debajo del horario', tarjetasHtml.includes('Ingresó 07:00 · marcó 06:52') && tarjetasHtml.includes('Ingresó 15:12 (12 min tarde)'));
check('tarjeta 390: relevo y plan', tarjetasHtml.includes('Lo releva Guerrero, Martín · T 15:00') && tarjetasHtml.includes('Entra 23:00'));
check('tarjeta 390: LLAMAR con tel: del legajo junto a las acciones', tarjetasHtml.includes('href="tel:3515550101"') && (tarjetasHtml.match(/data-movil-llamar="1"/g) || []).length === 3 && tarjetasHtml.includes('Salida'));
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
  ['retenido', 'Retenido desde 15:00 · 20 min · tope 19:59'],
  ['ausente', 'No llegó desde 15:00 · ausente'],
  ['ausente cubierto', 'Cubierto por Sosa, Carla'],
  ['tarde avisada', 'Tarde 20 min · avisó · llega ~15:30'],
  ['tarde sin aviso', 'Tarde 20 min · sin aviso'],
  ['vacante', 'Vacante T · desde 15:00'],
  ['convocado', 'EN CAMINO · llega ~15:40'],
  ['EXT', 'EXT hasta 19:00 · cubre a Guerrero, Martín'],
]) check(`render estado ${nombre}`, estadosHtml.includes(texto));
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
check('supervisión: mismo detalle y LLAMAR, sin acciones', supervisionDetalle.includes('Retenido desde 15:00') && supervisionDetalle.includes('>Llamar<') && !supervisionDetalle.includes('Llegó?') && !supervisionDetalle.includes('Protocolo'));

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
