import { createRequire } from 'node:module';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../apps/web2/package.json'));
const ts = require('typescript');
const root = join(here, '../apps/web2/src');

const { compileMovilLib, compileMovilScreens, writeStub } = await import('./movil-eval-lib.mjs');
const outdir = join(here, '../apps/web2/.movil-eval');
rmSync(outdir, { recursive: true, force: true });
const lib = compileMovilLib(outdir);
const m = await import(lib.movilModulos);

let failed = 0;
function check(name, ok) {
  if (!ok) {
    failed += 1;
    console.error('FAIL', name);
  } else {
    console.log('OK', name);
  }
}

const labels = (items) => items.map((i) => i.label).join(' · ');
const solo = (...keys) => (key) => keys.includes(key);

check('seis módulos registrados', m.modulosRegistrados().map((x) => x.id).join(',') === 'operacion,supervision,planificacion,eventuales,rrhh,servicios');
check('Operación: Objetivos · Alertas · Sala · Menú', labels(m.barraDelModulo(m.moduloMovilDe('/admin/operaciones/'))) === 'Objetivos · Alertas · Sala · Menú');
check('Supervisión es módulo propio: Objetivos · Alertas · Menú en /admin/movil/supervision/', m.moduloMovilDe('/admin/movil/supervision/').id === 'supervision' && labels(m.barraDelModulo(m.moduloMovilDe('/admin/movil/supervision/'))) === 'Objetivos · Alertas · Menú' && m.moduloMovilDe('/admin/movil/supervision/').href === '/admin/movil/supervision/' && m.rutaTieneVersionMovil('/admin/movil/supervision'));
check('Supervisión ya no es Operación en solo lectura', m.moduloMovilDe('/admin/operaciones/', { modo: 'supervision' }).id === 'operacion' && !m.modulosRegistrados().find((x) => x.id === 'supervision').query);
check('Planificación: Próximos días · Huecos · Menú', labels(m.barraDelModulo(m.moduloMovilDe('/admin/movil/planificacion/'))) === 'Próximos días · Huecos · Menú' && labels(m.barraDelModulo(m.moduloMovilDe('/admin/planificacion/'))) === 'Próximos días · Huecos · Menú');
check('Planificación apunta a la pantalla celular', m.moduloMovilDe('/admin/planificacion/').href === '/admin/movil/planificacion/' && m.rutaTieneVersionMovil('/admin/movil/planificacion') && !m.rutaTieneVersionMovil('/admin/reportes'));
check('Servicios también con CLIENTS; Supervisión solo con SUPERVISION', m.modulosMovil(solo('CLIENTS')).map((x) => x.id).join(',') === 'servicios' && m.modulosMovil(solo('SUPERVISION')).map((x) => x.id).join(',') === 'supervision');
check('RRHH: Hoy · Cargar · Novedades · Menú', labels(m.barraDelModulo(m.moduloMovilDe('/admin/rrhh/movil/'))) === 'Hoy · Cargar · Novedades · Menú');
check('Eventuales: Bolsa · ARCA · Alta · Menú', labels(m.barraDelModulo(m.moduloMovilDe('/admin/rrhh/eventuales/'))) === 'Bolsa · ARCA · Alta · Menú');
check('Servicios: Lista · Menú', labels(m.barraDelModulo(m.moduloMovilDe('/admin/servicios/'))) === 'Lista · Menú');
check('sección activa por panel', m.seccionActiva(m.moduloMovilDe('/admin/rrhh/movil/'), { panel: 'ausencia' }) === 'cargar' && m.seccionActiva(m.moduloMovilDe('/admin/operaciones/'), {}) === 'objetivos' && m.seccionActiva(m.moduloMovilDe('/admin/movil/supervision/'), { panel: 'alertas' }) === 'alertas');

const operador = m.modulosMovil(solo('OPERATIONS'));
check('operador sin RRHH nunca lo ve', operador.map((x) => x.id).join(',') === 'operacion' && m.menuMovil(operador).unico?.id === 'operacion' && !m.menuMovil(operador).mostrarModulos);
check('rrhh ve RRHH y Eventuales', m.modulosMovil(solo('RRHH')).map((x) => x.id).join(',') === 'eventuales,rrhh');
check('superadmin ve todo', m.modulosMovil(() => false, true).length === 6);

const ops = m.moduloMovilDe('/admin/operaciones/');
const alertas = [
  { type: 'AUSENCIA_OPERATIVA' },
  { type: 'ALTA_ARCA_PENDIENTE' },
  { type: 'ARCA_BAJA_PENDIENTE' },
  { type: 'CRONOGRAMA_SIN_PUBLICAR' },
  { type: 'IA_ALERTA_X' },
  { type: 'Enfermedad', source: 'AUSENCIA' },
  { type: 'SUPERVISION_NOVEDAD', source: 'SUPERVISION' },
];
check('Operación filtra ARCA salvo la fichada y no lista cronograma ni supervisión', m.filtrarAlertasDelModulo(ops, alertas).map((a) => a.type).join(',') === 'AUSENCIA_OPERATIVA,ALTA_ARCA_PENDIENTE');
check('Supervisión ve solo sus novedades', m.filtrarAlertasDelModulo(m.moduloMovilDe('/admin/movil/supervision/'), alertas).map((a) => a.type).join(',') === 'SUPERVISION_NOVEDAD');
check('Eventuales ve ARCA', m.filtrarAlertasDelModulo(m.moduloMovilDe('/admin/rrhh/eventuales/'), alertas).map((a) => a.type).join(',') === 'ALTA_ARCA_PENDIENTE,ARCA_BAJA_PENDIENTE');
check('RRHH ve licencias', m.filtrarAlertasDelModulo(m.moduloMovilDe('/admin/rrhh/movil/'), alertas).map((a) => a.type).join(',') === 'AUSENCIA_OPERATIVA,Enfermedad');
check('Planificación ve cronograma y licencias', m.filtrarAlertasDelModulo(m.moduloMovilDe('/admin/planificacion/'), alertas).map((a) => a.type).join(',') === 'CRONOGRAMA_SIN_PUBLICAR,Enfermedad');

// ── Supervisión: lógica pura ──
const sup = await import(lib.supervisionMovil);
const NOW = Date.UTC(2026, 9, 1, 15, 0, 0); // 01/10/2026 12:00 AR
const H = 60 * 60 * 1000;
const objetivos = [
  { id: 'o1', name: 'Peaje 9 Norte', clientId: 'c1', clientName: 'Caminos', address: 'Ruta 9 km 710', lat: -31.3, lng: -64.2 },
  { id: 'o2', name: 'Río Primero', clientId: 'c1', clientName: 'Caminos', address: 'Av. Siempreviva 1' },
  { id: 'o3', name: 'Planta Sur', clientId: 'c2', clientName: 'Arcor' },
];
const turnos = [
  { objectiveId: 'o1', startTime: NOW - 4 * H, endTime: NOW + 4 * H, isPresent: true },
  { objectiveId: 'o1', startTime: NOW - 4 * H, endTime: NOW + 4 * H, isPresent: true, isRetention: true },
  { objectiveId: 'o1', startTime: NOW - 4 * H, endTime: NOW + 4 * H, isAbsent: true },
  { objectiveId: 'o2', startTime: NOW - 4 * H, endTime: NOW + 4 * H, isPresent: true, isRetention: true },
  { objectiveId: 'o3', startTime: NOW - 4 * H, endTime: NOW + 4 * H, isPresent: true, isCompleted: true },
  { objectiveId: 'o3', startTime: NOW - 4 * H, endTime: NOW + 4 * H, isPresent: true, draft: true },
];
const visitas = [
  { id: 'v1', objectiveId: 'o1', createdAtMs: NOW - 2 * H, supervisorNombre: 'Pérez', resultado: 'OK' },
  { id: 'v0', objectiveId: 'o1', createdAtMs: NOW - 5 * 24 * H, supervisorNombre: 'Pérez', resultado: 'OBSERVADO' },
  { id: 'v2', objectiveId: 'o2', createdAtMs: NOW - 9 * 24 * H, supervisorNombre: 'Gómez', resultado: 'CRITICO' },
];
const rows = sup.buildSupervisionRows({ objetivos, turnos, visitas, nowMs: NOW });
check('supervisión: estado resumido por objetivo (activos/ausentes/retenidos) y orden', rows.map((r) => r.id).join(',') === 'o1,o2,o3' && rows[0].estadoTexto === '2 activos · 1 ausente · 1 retenido' && rows[0].tono === 'rose' && rows[1].estadoTexto === '1 activo · 1 retenido' && rows[1].tono === 'orange' && rows[2].estadoTexto === 'Sin guardias ahora' && rows[2].tono === 'slate');
check('supervisión: cómo llegar con coords, con dirección o sin link', rows[0].mapsUrl === 'https://www.google.com/maps/dir/?api=1&destination=-31.3,-64.2' && rows[1].mapsUrl === 'https://www.google.com/maps/dir/?api=1&destination=Av.%20Siempreviva%201' && rows[2].mapsUrl === null);
check('supervisión: última visita por objetivo', rows[0].ultimaVisita.id === 'v1' && rows[0].visitaTexto === 'Hoy 10:00 · Pérez' && rows[0].diasSinVisita === 0 && rows[1].visitaTexto === 'Hace 9 días · Gómez' && rows[1].diasSinVisita === 9 && rows[2].visitaTexto === 'Sin visitas' && rows[2].diasSinVisita === null);
check('supervisión: filtro por cliente y búsqueda', sup.buildSupervisionRows({ objetivos, turnos, visitas, nowMs: NOW, clientId: 'c2' }).map((r) => r.id).join(',') === 'o3' && sup.buildSupervisionRows({ objetivos, turnos, visitas, nowMs: NOW, buscar: 'ruta 9' }).map((r) => r.id).join(',') === 'o1' && sup.clientesSupervision(objetivos).map((c) => `${c.name}:${c.objetivos}`).join(',') === 'Arcor:1,Caminos:2');
const novedadesSup = [
  { id: 'n1', type: 'SUPERVISION_NOVEDAD', source: 'SUPERVISION', status: 'pending', objectiveName: 'Peaje 9 Norte', description: 'Garita sin luz', createdAtMs: NOW - H, reportedBy: 'Pérez', imageUrl: 'https://x/foto.jpg' },
  { id: 'n2', type: 'SUPERVISION_NOVEDAD', source: 'SUPERVISION', status: 'ATENDIDA', createdAtMs: NOW },
  { id: 'n3', type: 'AUSENCIA_OPERATIVA', status: 'pending', createdAtMs: NOW },
];
const al = sup.alertasSupervision({ rows, novedades: novedadesSup });
check('supervisión: alertas = sin visita ≥ 7 días o nunca + novedades propias pendientes', al.sinVisita.map((x) => `${x.row.id}:${x.dias}`).join(',') === 'o3:null,o2:9' && al.novedades.map((n) => n.id).join(',') === 'n1' && al.total === 3 && sup.textoSinVisita(null) === 'Nunca visitado' && sup.textoSinVisita(9) === '9 días sin visita · límite 7');

// ── RRHH: justificar la AA ──
const rr = await import(lib.rrhhDia);
check('rrhh: la AA del día es justificable, la E no, la ya justificada no', rr.esAusenciaInjustificada({ type: 'No Presentación', absenceType: 'AA', status: 'Confirmada' }) && rr.esAusenciaInjustificada({ type: 'Ausencia injustificada', status: 'Pendiente' }) && !rr.esAusenciaInjustificada({ type: 'Enfermedad', absenceType: 'E', status: 'En verificación' }) && !rr.esAusenciaInjustificada({ type: 'Enfermedad', absenceType: 'E', status: 'Justificada' }));
const catalogo = [{ id: 'aa', label: 'Ausencia injustificada', code: 'AA' }, { id: 'l', label: 'Licencia', code: 'L' }, { id: 'e', label: 'Enfermedad', code: 'E' }, { id: 'v', label: 'Vacaciones', code: 'V' }];
check('rrhh: tipos para justificar = E, L, A en ese orden desde el catálogo', rr.tiposParaJustificar(catalogo).map((t) => t.code).join(',') === 'E,L' && rr.TIPOS_JUSTIFICAR_DEFAULT.map((t) => t.code).join(',') === 'E,L,A');
const pE = rr.patchJustificarAusencia({ tipo: { id: 'e', label: 'Enfermedad', code: 'E' }, tieneCertificado: false, requiereVerificacionMedica: true, nombreReal: 'Mauro' });
const pL = rr.patchJustificarAusencia({ tipo: { id: 'l', label: 'Licencia', code: 'L' }, tieneCertificado: true, requiereVerificacionMedica: false, nombreReal: 'Mauro' });
check('rrhh: enfermedad sin certificado queda En verificación; licencia con certificado Justificada', pE.status === 'En verificación' && pE.absenceType === 'E' && pE.type === 'Enfermedad' && pL.status === 'Justificada' && pL.hasCertificate && pL.comments.includes('Mauro'));

// ── Render de pantallas (390x844) ──
const serviciosStub = writeStub(outdir, 'serviciosMovilStub', "export const ESTADO_LABEL = { active: 'En operación', withoutPlan: 'Con servicio sin operación', closed: 'Cerrado', none: 'Sin servicio' };\n");
const screens = compileMovilScreens(outdir, lib, ['MovilMenuScreens', 'EmpresaSheetBody', 'RrhhScreens', 'EventualesScreens', 'SupervisionScreens', 'ServiciosMovilScreens'], {
  '@/lib/servicios/serviciosMovil': serviciosStub,
});
const { createElement } = await import(pathToFileURL(require.resolve('react')).href);
const { renderToStaticMarkup } = await import(pathToFileURL(require.resolve('react-dom/server')).href);
const { MovilMenuScreens } = await import(screens.MovilMenuScreens);
const { EmpresaSheetBody } = await import(screens.EmpresaSheetBody);
const { RrhhScreens } = await import(screens.RrhhScreens);
const { EventualesScreens } = await import(screens.EventualesScreens);
const { SupervisionScreens } = await import(screens.SupervisionScreens);
const { ServiciosMovilScreens } = await import(screens.ServiciosMovilScreens);
const sel = await import(lib.empresaSelector);
const noop = () => {};

const menuBase = {
  empresaName: 'Pruebas S.A.',
  now: NOW,
  onEmpresa: noop,
  onModulo: noop, onAsistente: noop, onEscritorio: noop, onLogout: noop,
};
const todos = m.modulosMovil(() => false, true);
const menuSa = renderToStaticMarkup(createElement(MovilMenuScreens, { ...menuBase, modulos: todos, unico: null, alertas: { operacion: 3, rrhh: 1 } }));
const tilesSa = (menuSa.match(/data-movil-tile="flex"/g) || []).length;
check('menú superadmin 390 con seis módulos', menuSa.includes('data-viewport="390x844"') && ['Operación', 'Supervisión', 'Planificación', 'Eventuales', 'RRHH', 'Servicios'].every((l) => menuSa.includes(l)) && tilesSa === 6 && menuSa.includes('Recorrida y visitas'));
check('menú sin encabezado grande ni bloque de empresa', !menuSa.includes('>Módulos<') && !menuSa.includes('Empresa activa') && !menuSa.includes('Cambiar a ') && !menuSa.includes('empresas<') && menuSa.includes('data-movil-fecha="1"'));
check('menú: píldora de empresa es botón que abre la hoja', menuSa.includes('aria-label="Empresa Pruebas S.A.. Cambiar"') && menuSa.includes('data-movil-topbar="Menú"'));
check('menú: grilla 2x3 que ocupa la pantalla, alertas en la línea de estado', menuSa.includes('grid-cols-2') && menuSa.includes('data-movil-tiles="6"') && menuSa.includes('>3 alertas<') && menuSa.includes('data-movil-estado="rojo"') && !menuSa.includes('data-movil-alertas=') && !menuSa.includes('MovilIconBox') && !/bg-(emerald|indigo|violet|amber|blue)-(50|100)/.test(menuSa));
check('menú: seis módulos entran en 390x844 sin scroll y en 360x740 sin cortar', sel.menuCabeEnPantalla(6, 844) && sel.altoMenuPx(6, 844) <= 844 && sel.tileAltoPx(844, 6) === 150 && sel.tileAltoPx(740, 6) >= 96 && menuSa.includes(`data-movil-alto="${sel.altoMenuPx(6)}"`) && menuSa.includes(`data-movil-alto-740="${sel.altoMenuPx(6, 740)}"`) && menuSa.includes('>Asistente<') && menuSa.includes('Ver como escritorio'));
const menuOp = renderToStaticMarkup(createElement(MovilMenuScreens, { ...menuBase, onEmpresa: undefined, modulos: operador, unico: operador[0] }));
check('menú de un solo módulo: empresa, asistente y salir', !menuOp.includes('data-movil-module="rrhh"') && menuOp.includes('Volver a Operación') && menuOp.includes('Asistente') && menuOp.includes('Cerrar sesión') && menuOp.includes('data-movil-empresa="Pruebas S.A."') && !menuOp.includes('aria-label="Empresa'));

const empresas = [
  { id: 'pruebas_sa', name: 'Pruebas S.A.', color: '#2563eb' },
  { id: 'bacarsa', name: 'Bacar SA', color: '#0f766e' },
  { id: 'sin_color', name: 'Sin color' },
  { id: 'inactiva', name: 'Inactiva', active: false },
];
const hoja = renderToStaticMarkup(createElement(EmpresaSheetBody, { empresas, activaId: 'pruebas_sa', onElegir: noop }));
check('hoja de empresas: lista, activa con check, color como punto, inactiva afuera', hoja.includes('data-movil-empresa-item="bacarsa"') && hoja.includes('aria-current="true"') && hoja.includes('aria-label="Empresa activa"') && hoja.includes('background-color:#2563eb') && hoja.includes('data-movil-empresa-color="none"') && !hoja.includes('Inactiva') && !hoja.includes('data-movil-empresa-buscar'));
const muchas = Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, name: `Empresa ${i}` }));
const hojaMuchas = renderToStaticMarkup(createElement(EmpresaSheetBody, { empresas: muchas, activaId: 'e2', onElegir: noop }));
check('hoja de empresas: buscador solo con más de 6', hojaMuchas.includes('data-movil-empresa-buscar="1"') && sel.necesitaBuscador(7) && !sel.necesitaBuscador(6));
check('empresasVisibles: filtra, ordena y deja la activa', sel.empresasVisibles(empresas, 'inactiva', '').map((e) => e.id).join(',') === 'bacarsa,inactiva,pruebas_sa,sin_color' && sel.empresasVisibles(muchas, 'e2', 'empresa 7').map((e) => e.id).join(',') === 'e7' && sel.empresaColor('#ABCDEF') === '#ABCDEF' && sel.empresaColor('rojo') === null);
// Cambio de empresa: sin DOM, se llama al componente como función (useState estático) y se
// dispara el onClick del botón de la fila elegida recorriendo el árbol de elementos.
const estaticoSrc = readFileSync(join(root, 'components/movil/EmpresaSheetBody.tsx'), 'utf8')
  .replace("import { useState } from 'react';", 'const useState = (v) => [v, () => {}];')
  .replace("from '@/lib/movil/empresaSelector'", `from ${JSON.stringify(lib.empresaSelector)}`)
  .replace(/from '\.\/ui\/(\w+)'/g, "from './ui/$1.mjs'");
const estaticoFile = join(outdir, 'EmpresaSheetBody.static.mjs');
writeFileSync(estaticoFile, ts.transpileModule(estaticoSrc, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }, fileName: 'EmpresaSheetBody.static.tsx' }).outputText);
const { EmpresaSheetBody: HojaEstatica } = await import(pathToFileURL(estaticoFile).href);
const buscarBoton = (node, id) => {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const hit = buscarBoton(n, id); if (hit) return hit; } return null; }
  if (node.props?.['data-movil-empresa-item'] === id) return node;
  return buscarBoton(node.props?.children, id);
};
let elegida = null;
const arbol = HojaEstatica({ empresas, activaId: 'pruebas_sa', onElegir: (id) => { elegida = id; } });
buscarBoton(arbol, 'bacarsa')?.props.onClick();
check('cambio de empresa: tocar la fila llama onElegir con su id', elegida === 'bacarsa');

// Estilo común a todos los módulos: sin pastel, sin emojis, sin sombras ni degradés; color de empresa solo por variables.
const PASTEL = /bg-(emerald|indigo|violet|amber|blue|rose)-(50|100)(?!\d)/;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const estiloOk = (html) => {
  const motivos = [];
  if (PASTEL.test(html)) motivos.push(`pastel ${html.match(PASTEL)[0]}`);
  if (EMOJI.test(html)) motivos.push(`emoji ${html.match(EMOJI)[0]}`);
  if (/shadow-(sm|md|lg)/.test(html)) motivos.push('sombra');
  if (/bg-gradient/.test(html)) motivos.push('degradé');
  if (/bg-indigo-6/.test(html)) motivos.push('indigo fijo');
  if (!html.includes('var(--movil-topbar')) motivos.push('sin variable de empresa');
  if (!html.includes('bg-[#f7f8fa]')) motivos.push('sin fondo claro');
  if (!html.includes('data-viewport="390x844"')) motivos.push('sin viewport');
  if (motivos.length) console.error('   estilo:', motivos.join(', '));
  return motivos.length === 0;
};

const rrhhBase = {
  empresa: 'Pruebas S.A.', online: true, pendingLabel: null, hoyLabel: 'sábado 4 de octubre',
  ausenciasHoy: [
    { id: '1', employeeId: 'g', nombre: 'Guerrero, Martín', tipo: 'Enfermedad' },
    { id: '2', employeeId: 'b', nombre: 'Baez, Juan', tipo: 'No Presentación', justificable: true },
  ],
  licencias: [], certificados: [],
  busqueda: '', onBusqueda: noop, guardias: [{ id: 'g', nombre: 'Guerrero, Martín', telefono: '351' }], tipos: [{ id: 'e', label: 'Enfermedad', code: 'E' }], tipoId: 'e', onTipo: noop,
  dias: '1', onDias: noop, fotoNombre: null, onFoto: noop, onGuardarAusencia: noop, novedadTipo: 'Observación', onNovedadTipo: noop, novedadTexto: '', onNovedadTexto: noop, onGuardarNovedad: noop,
  ficha: null, onElegir: noop, onFicha: noop, onPanel: noop, onJustificar: noop,
};
const hoy = renderToStaticMarkup(createElement(RrhhScreens, { ...rrhhBase, panel: 'dia' }));
const cargar = renderToStaticMarkup(createElement(RrhhScreens, { ...rrhhBase, panel: 'ausencia' }));
const novedad = renderToStaticMarkup(createElement(RrhhScreens, { ...rrhhBase, panel: 'novedad' }));
check('RRHH Hoy sin pestañas internas', hoy.includes('Ausencias de hoy') && !hoy.includes('Cargar ausencia') && !hoy.includes('>Hoy<'));
check('RRHH Hoy: Justificar solo en la AA', (hoy.match(/>Justificar</g) || []).length === 1 && hoy.includes('data-rrhh-accion="2"') && !hoy.includes('data-rrhh-accion="1"'));
const justificar = renderToStaticMarkup(createElement(RrhhScreens, { ...rrhhBase, panel: 'dia', justificar: { id: '2', nombre: 'Baez, Juan · No Presentación', tipos: rr.TIPOS_JUSTIFICAR_DEFAULT, tipoId: 'E', fotoNombre: null } }));
check('RRHH hoja Justificar: E/L/A, foto del certificado y botón', justificar.includes('data-rrhh-justificar="2"') && justificar.includes('Enfermedad') && justificar.includes('Licencia') && justificar.includes('Autorizada') && justificar.includes('Foto del certificado') && justificar.includes('>Justificar<') && justificar.includes('aria-pressed="true"'));
check('RRHH Cargar', cargar.includes('Cargar ausencia') && cargar.includes('Foto del certificado') && !cargar.includes('Ausencias de hoy'));
check('RRHH Novedades', novedad.includes('Novedad rápida') && novedad.includes('Incidente'));
check('RRHH estilo guía', estiloOk(hoy) && estiloOk(cargar) && estiloOk(novedad) && !hoy.includes('border-emerald-600'));

const evBase = {
  empresa: 'Pruebas S.A.', online: true, pendingLabel: null, buscar: '', onBuscar: noop,
  personas: [
    { id: '20111111112', nombre: 'Sosa, Carla', cuil: '20-11111111-2', marco: 'Marco vigente', marcoVigente: true, telefono: '351', legajoIngreso: 'Legajo 1001 · 1º ingreso 15/02/2024' },
    { id: '20222222223', nombre: 'Ruiz, Pedro', cuil: '20-22222222-3', marco: 'Sin marco', telefono: '', legajoIngreso: '' },
  ],
  onElegir: noop, onCerrarAlta: noop,
  cuil: '', onCuil: noop, cuilEstado: '', nombre: '', onNombre: noop, mail: '', onMail: noop, telefono: '', onTelefono: noop, onGuardarAlta: noop, onCrearAcceso: noop,
  arca: [{ id: 'a', nombre: 'Sosa, Carla', tipo: 'AT', estado: 'PENDIENTE' }], nro: '', onNro: noop, arcaId: '', onArca: noop, onConfirmarArca: noop, elegido: null,
};
const bolsa = renderToStaticMarkup(createElement(EventualesScreens, { ...evBase, panel: 'bolsa' }));
const arca = renderToStaticMarkup(createElement(EventualesScreens, { ...evBase, panel: 'arca' }));
const alta = renderToStaticMarkup(createElement(EventualesScreens, { ...evBase, panel: 'alta' }));
check('Eventuales Bolsa con legajo y 1º ingreso', bolsa.includes('Sosa, Carla') && bolsa.includes('Marco vigente') && bolsa.includes('Legajo 1001 · 1º ingreso 15/02/2024') && bolsa.includes('data-eventual-legajo="1"') && bolsa.includes('data-eventual-legajo="0"') && bolsa.includes('20-22222222-3') && !bolsa.includes('ARCA pendiente') && !bolsa.includes('Alta rápida'));
check('Eventuales ARCA', arca.includes('ARCA pendiente') && arca.includes('AT PENDIENTE') && !arca.includes('Buscar en la bolsa'));
check('Eventuales Alta', alta.includes('Alta rápida') && alta.includes('Guardar en la bolsa'));
check('Eventuales estilo guía', estiloOk(bolsa) && estiloOk(arca) && !bolsa.includes('border-emerald-600'));

const supBase = {
  empresa: 'Pruebas S.A.', online: true, pendingLabel: null, fechaLabel: 'jueves 1 de octubre', loading: false,
  clientes: sup.clientesSupervision(objetivos), clienteId: '', onCliente: noop, buscar: '', onBuscar: noop,
  rows, row: null, visitasObjetivo: [], onOpen: noop, onBack: noop, onMarcarVisita: noop, onNovedad: noop,
  alertas: al, diasLimite: 7, nowMs: NOW, onNovedadVista: noop,
};
const supLista = renderToStaticMarkup(createElement(SupervisionScreens, { ...supBase, panel: 'objetivos' }));
const supDetalle = renderToStaticMarkup(createElement(SupervisionScreens, { ...supBase, panel: 'objetivos', row: rows[0], visitasObjetivo: visitas.filter((v) => v.objectiveId === 'o1') }));
const supAlertas = renderToStaticMarkup(createElement(SupervisionScreens, { ...supBase, panel: 'alertas' }));
check('Supervisión lista: filtro cliente, estado resumido en color, última visita', supLista.includes('data-movil-screen="supervision-objetivos"') && supLista.includes('data-movil-topbar="Supervisión"') && supLista.includes('data-supervision-clientes="2"') && supLista.includes('>Caminos<') && supLista.includes('2 activos · 1 ausente · 1 retenido') && supLista.includes('data-supervision-estado="rose"') && supLista.includes('Hoy 10:00 · Pérez') && supLista.includes('data-supervision-visita="nunca"') && supLista.includes('Ruta 9 km 710'));
check('Supervisión detalle: cómo llegar, marcar visita, novedad con foto, sin acciones de turnos', supDetalle.includes('data-movil-screen="supervision-detalle"') && supDetalle.includes('href="https://www.google.com/maps/dir/?api=1&amp;destination=-31.3,-64.2"') && supDetalle.includes('Cómo llegar') && supDetalle.includes('data-supervision-marcar="1"') && supDetalle.includes('data-supervision-novedad="1"') && supDetalle.includes('data-supervision-ultima="v1"') && supDetalle.includes('Con observaciones') && !supDetalle.includes('Marcar ingreso') && !supDetalle.includes('Marcar ausente'));
check('Supervisión alertas: sin visita y novedades propias con foto', supAlertas.includes('data-movil-screen="supervision-alertas"') && supAlertas.includes('data-supervision-sin-visita="2"') && supAlertas.includes('Nunca visitado') && supAlertas.includes('9 días sin visita · límite 7') && supAlertas.includes('data-supervision-novedades="1"') && supAlertas.includes('Garita sin luz') && supAlertas.includes('src="https://x/foto.jpg"') && supAlertas.includes('Marcar como vista'));
check('Supervisión estilo guía', estiloOk(supLista) && estiloOk(supDetalle) && estiloOk(supAlertas));

const slaRow = { id: 's1', clientId: 'c1', objectiveId: 'o1', endDate: '2026-10-31', positions: [{ name: 'Puesto 1', quantity: 2 }] };
const srvRows = [
  { objectiveId: 'o1', objectiveName: 'Peaje 9 Norte', clientId: 'c1', clientName: 'Caminos', estado: 'active', sla: slaRow, contratos: 1, cronogramaAviso: 'Sin cronograma de noviembre' },
  { objectiveId: 'o2', objectiveName: 'Río Primero', clientId: 'c1', clientName: 'Caminos', estado: 'withoutPlan', sla: { ...slaRow, id: 's2' }, contratos: 1, cronogramaAviso: 'Sin cronograma de octubre' },
  { objectiveId: 'o3', objectiveName: 'Planta Sur', clientId: 'c2', clientName: 'Arcor', estado: 'closed', sla: { ...slaRow, id: 's3', closed: true }, contratos: 2, cronogramaAviso: null },
];
const detalleSrv = { vigencia: '01/10/2026 → 31/10/2026', facturacion: 'Planificado', cerrado: false, cerradoMotivo: '', reabiertoManual: false, puestos: [{ name: 'Puesto 1', quantity: 2, franjas: [{ code: 'M', horario: '07:00–15:00', quantity: 2 }] }] };
const srvBase = { empresa: 'Pruebas S.A.', online: true, pendingLabel: null, loading: false, rows: srvRows, row: null, detalle: null, acciones: { cerrar: false, reabrir: false }, filter: '', onFilter: noop, estadoFiltro: '', onEstadoFiltro: noop, onOpen: noop, onBack: noop, onCerrar: noop, onReabrir: noop, onAgregarMeses: noop };
const srvLista = renderToStaticMarkup(createElement(ServiciosMovilScreens, srvBase));
const srvFiltro = renderToStaticMarkup(createElement(ServiciosMovilScreens, { ...srvBase, estadoFiltro: 'closed' }));
const srvDetalle = renderToStaticMarkup(createElement(ServiciosMovilScreens, { ...srvBase, row: srvRows[0], detalle: detalleSrv, acciones: { cerrar: false, reabrir: false, agregarMeses: true } }));
const srvCerrado = renderToStaticMarkup(createElement(ServiciosMovilScreens, { ...srvBase, row: srvRows[2], detalle: { ...detalleSrv, cerrado: true, cerradoMotivo: 'vencido' }, acciones: { cerrar: false, reabrir: true, agregarMeses: false } }));
check('Servicios lista: contadores como filtros, aviso de mes sin cronograma por objetivo y agrupado', srvLista.includes('data-servicios-contadores="3"') && srvLista.includes('data-servicios-sin-cronograma="2"') && srvLista.includes('Sin cronograma de noviembre') && srvLista.includes('Sin cronograma de octubre') && (srvLista.match(/data-servicio-cronograma="1"/g) || []).length === 2 && srvLista.includes('data-servicio-estado="withoutPlan"'));
check('Servicios lista: tocar un contador filtra', (srvFiltro.match(/data-servicio-objetivo=/g) || []).length === 1 && srvFiltro.includes('Planta Sur') && srvFiltro.includes('aria-pressed="true"'));
check('Servicios detalle: Agregar meses y aviso de cronograma', srvDetalle.includes('data-servicio-agregar-meses="1"') && srvDetalle.includes('Agregar meses') && srvDetalle.includes('no entra en operación hasta publicarlo') && srvDetalle.includes('07:00–15:00') && !srvDetalle.includes('Reabrir contrato'));
check('Servicios cerrado: candado lucide sin emoji, Reabrir sin Agregar meses', srvCerrado.includes('data-servicio-cerrado="1"') && srvCerrado.includes('Contrato cerrado (vencido)') && !srvCerrado.includes('🔒') && srvCerrado.includes('Reabrir contrato') && !srvCerrado.includes('data-servicio-agregar-meses'));
check('Servicios estilo guía', estiloOk(srvLista) && estiloOk(srvDetalle) && estiloOk(srvCerrado) && !srvLista.includes('rounded-full px-2'));

rmSync(outdir, { recursive: true, force: true });
if (failed) {
  console.error(failed, 'fallos');
  process.exit(1);
}
console.log('eval-movil-modulos ok');
