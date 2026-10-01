import { createRequire } from 'node:module';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../apps/web2/package.json'));
const ts = require('typescript');
const root = join(here, '../apps/web2/src');

const { compileMovilLib } = await import('./movil-eval-lib.mjs');
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
check('Supervisión por query modo', m.moduloMovilDe('/admin/operaciones/', { modo: 'supervision' }).id === 'supervision' && labels(m.barraDelModulo(m.moduloMovilDe('/admin/operaciones/', { modo: 'supervision' }))) === 'Objetivos · Alertas · Menú');
check('Planificación: Próximos días · Huecos · Menú', labels(m.barraDelModulo(m.moduloMovilDe('/admin/movil/planificacion/'))) === 'Próximos días · Huecos · Menú' && labels(m.barraDelModulo(m.moduloMovilDe('/admin/planificacion/'))) === 'Próximos días · Huecos · Menú');
check('Planificación apunta a la pantalla celular', m.moduloMovilDe('/admin/planificacion/').href === '/admin/movil/planificacion/' && m.rutaTieneVersionMovil('/admin/movil/planificacion') && !m.rutaTieneVersionMovil('/admin/reportes'));
check('Servicios también con CLIENTS; Supervisión solo con SUPERVISION', m.modulosMovil(solo('CLIENTS')).map((x) => x.id).join(',') === 'servicios' && m.modulosMovil(solo('SUPERVISION')).map((x) => x.id).join(',') === 'supervision');
check('RRHH: Hoy · Cargar · Novedades · Menú', labels(m.barraDelModulo(m.moduloMovilDe('/admin/rrhh/movil/'))) === 'Hoy · Cargar · Novedades · Menú');
check('Eventuales: Bolsa · ARCA · Alta · Menú', labels(m.barraDelModulo(m.moduloMovilDe('/admin/rrhh/eventuales/'))) === 'Bolsa · ARCA · Alta · Menú');
check('Servicios: Lista · Menú', labels(m.barraDelModulo(m.moduloMovilDe('/admin/servicios/'))) === 'Lista · Menú');
check('sección activa por panel', m.seccionActiva(m.moduloMovilDe('/admin/rrhh/movil/'), { panel: 'ausencia' }) === 'cargar' && m.seccionActiva(m.moduloMovilDe('/admin/operaciones/'), {}) === 'objetivos');

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
];
check('Operación filtra ARCA salvo la fichada', m.filtrarAlertasDelModulo(ops, alertas).map((a) => a.type).join(',') === 'AUSENCIA_OPERATIVA,ALTA_ARCA_PENDIENTE,CRONOGRAMA_SIN_PUBLICAR');
check('Eventuales ve ARCA', m.filtrarAlertasDelModulo(m.moduloMovilDe('/admin/rrhh/eventuales/'), alertas).map((a) => a.type).join(',') === 'ALTA_ARCA_PENDIENTE,ARCA_BAJA_PENDIENTE');
check('RRHH ve licencias', m.filtrarAlertasDelModulo(m.moduloMovilDe('/admin/rrhh/movil/'), alertas).map((a) => a.type).join(',') === 'AUSENCIA_OPERATIVA,Enfermedad');
check('Planificación ve cronograma y licencias', m.filtrarAlertasDelModulo(m.moduloMovilDe('/admin/planificacion/'), alertas).map((a) => a.type).join(',') === 'CRONOGRAMA_SIN_PUBLICAR,Enfermedad');

const compile = (src, name) => {
  const out = join(outdir, name.replace(/\.tsx?$/, '.mjs'));
  writeFileSync(out, ts.transpileModule(src, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    fileName: name,
  }).outputText);
  return out;
};
const sheet = compile(readFileSync(join(root, 'components/movil/BottomSheet.tsx'), 'utf8').replace("from './ui/tones'", "from './ui/tones.mjs'"), 'BottomSheet.tsx');
// components/movil/ui: piezas visuales compartidas (lucide-react se resuelve desde apps/web2/node_modules).
const uiDir = join(root, 'components/movil/ui');
const { readdirSync, mkdirSync } = await import('node:fs');
mkdirSync(join(outdir, 'ui'), { recursive: true });
let uiIndex = '';
for (const name of readdirSync(uiDir)) {
  const src = readFileSync(join(uiDir, name), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
  const out = compile(src, `ui/${name}`);
  if (name === 'index.ts') uiIndex = out;
}
const withLibs = (src) => src
  .replace("from '@/lib/movil/empresaSelector'", `from ${JSON.stringify(lib.empresaSelector)}`)
  .replace("from '@/lib/movil/fechaCorta'", `from ${JSON.stringify(lib.fechaCorta)}`)
  .replace("from './ui/tones'", "from './ui/tones.mjs'")
  .replace("from './ui/MovilTopBar'", "from './ui/MovilTopBar.mjs'");
const menuFile = compile(
  withLibs(readFileSync(join(root, 'components/movil/MovilMenuScreens.tsx'), 'utf8'))
    .replace(/import type .*\n/, '')
    .replace("from './ui'", `from ${JSON.stringify(pathToFileURL(uiIndex).href)}`),
  'MovilMenuScreens.tsx',
);
const empresaSheetFile = compile(withLibs(readFileSync(join(root, 'components/movil/EmpresaSheetBody.tsx'), 'utf8')), 'EmpresaSheetBody.tsx');
const rrhhFile = compile(withLibs(readFileSync(join(root, 'components/movil/RrhhScreens.tsx'), 'utf8')), 'RrhhScreens.tsx');
const evFile = compile(withLibs(readFileSync(join(root, 'components/movil/EventualesScreens.tsx'), 'utf8')).replace("from './BottomSheet'", JSON.stringify(pathToFileURL(sheet).href).replace(/^/, 'from ')), 'EventualesScreens.tsx');

const { createElement } = await import(pathToFileURL(require.resolve('react')).href);
const { renderToStaticMarkup } = await import(pathToFileURL(require.resolve('react-dom/server')).href);
const { MovilMenuScreens } = await import(pathToFileURL(menuFile).href);
const { EmpresaSheetBody } = await import(pathToFileURL(empresaSheetFile).href);
const { RrhhScreens } = await import(pathToFileURL(rrhhFile).href);
const { EventualesScreens } = await import(pathToFileURL(evFile).href);
const sel = await import(lib.empresaSelector);
const noop = () => {};

const NOW = Date.UTC(2026, 9, 1, 15, 0, 0);
const menuBase = {
  empresaName: 'Pruebas S.A.',
  now: NOW,
  onEmpresa: noop,
  onModulo: noop, onAsistente: noop, onEscritorio: noop, onLogout: noop,
};
const todos = m.modulosMovil(() => false, true);
const menuSa = renderToStaticMarkup(createElement(MovilMenuScreens, { ...menuBase, modulos: todos, unico: null, alertas: { operacion: 3, rrhh: 1 } }));
const tilesSa = (menuSa.match(/data-movil-tile="64"/g) || []).length;
check('menú superadmin 390 con seis módulos', menuSa.includes('data-viewport="390x844"') && ['Operación', 'Supervisión', 'Planificación', 'Eventuales', 'RRHH', 'Servicios'].every((l) => menuSa.includes(l)) && tilesSa === 6);
check('menú sin encabezado grande ni bloque de empresa', !menuSa.includes('>Módulos<') && !menuSa.includes('Empresa activa') && !menuSa.includes('Cambiar a ') && !menuSa.includes('empresas<') && menuSa.includes('data-movil-fecha="1"'));
check('menú: píldora de empresa es botón que abre la hoja', menuSa.includes('aria-label="Empresa Pruebas S.A.. Cambiar"') && menuSa.includes('data-movil-topbar="Menú"'));
check('menú: tiles compactos 2 columnas con alertas a la derecha', menuSa.includes('grid-cols-2') && menuSa.includes('data-movil-tiles="6"') && menuSa.includes('data-movil-alertas="3"') && menuSa.includes('data-movil-alertas="1"') && (menuSa.match(/data-movil-alertas=/g) || []).length === 2 && !menuSa.includes('MovilIconBox') && !/bg-(emerald|indigo|violet|amber|blue)-(50|100)/.test(menuSa));
check('menú: seis módulos + asistente entran en 844 sin scroll', sel.menuCabeEnPantalla(6) && sel.altoMenuPx(6) < 844 && menuSa.includes(`data-movil-alto="${sel.altoMenuPx(6)}"`) && menuSa.includes('>Asistente<') && menuSa.includes('Ver como escritorio'));
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
const estaticoFile = compile(
  withLibs(readFileSync(join(root, 'components/movil/EmpresaSheetBody.tsx'), 'utf8')).replace("import { useState } from 'react';", 'const useState = (v) => [v, () => {}];'),
  'EmpresaSheetBody.static.tsx',
);
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

const rrhhBase = {
  empresa: 'Pruebas S.A.', online: true, pendingLabel: null, hoyLabel: 'sábado 4 de octubre',
  ausenciasHoy: [{ id: '1', employeeId: 'g', nombre: 'Guerrero, Martín', tipo: 'Enfermedad' }], licencias: [], certificados: [],
  busqueda: '', onBusqueda: noop, guardias: [{ id: 'g', nombre: 'Guerrero, Martín', telefono: '351' }], tipos: [{ id: 'e', label: 'Enfermedad', code: 'E' }], tipoId: 'e', onTipo: noop,
  dias: '1', onDias: noop, fotoNombre: null, onFoto: noop, onGuardarAusencia: noop, novedadTipo: 'Observación', onNovedadTipo: noop, novedadTexto: '', onNovedadTexto: noop, onGuardarNovedad: noop,
  ficha: null, onElegir: noop, onFicha: noop, onPanel: noop,
};
const hoy = renderToStaticMarkup(createElement(RrhhScreens, { ...rrhhBase, panel: 'dia' }));
const cargar = renderToStaticMarkup(createElement(RrhhScreens, { ...rrhhBase, panel: 'ausencia' }));
const novedad = renderToStaticMarkup(createElement(RrhhScreens, { ...rrhhBase, panel: 'novedad' }));
check('RRHH Hoy sin pestañas internas', hoy.includes('Ausencias de hoy') && !hoy.includes('Cargar ausencia') && !hoy.includes('>Hoy<'));
check('RRHH Cargar', cargar.includes('Cargar ausencia') && cargar.includes('Foto del certificado') && !cargar.includes('Ausencias de hoy'));
check('RRHH Novedades', novedad.includes('Novedad rápida') && novedad.includes('Incidente'));

const evBase = {
  empresa: 'Pruebas S.A.', online: true, pendingLabel: null, buscar: '', onBuscar: noop,
  personas: [{ id: '20111111112', nombre: 'Sosa, Carla', cuil: '20-11111111-2', marco: 'Marco vigente', telefono: '351' }], onElegir: noop, onCerrarAlta: noop,
  cuil: '', onCuil: noop, cuilEstado: '', nombre: '', onNombre: noop, mail: '', onMail: noop, telefono: '', onTelefono: noop, onGuardarAlta: noop, onCrearAcceso: noop,
  arca: [{ id: 'a', nombre: 'Sosa, Carla', tipo: 'AT', estado: 'PENDIENTE' }], nro: '', onNro: noop, arcaId: '', onArca: noop, onConfirmarArca: noop, elegido: null,
};
const bolsa = renderToStaticMarkup(createElement(EventualesScreens, { ...evBase, panel: 'bolsa' }));
const arca = renderToStaticMarkup(createElement(EventualesScreens, { ...evBase, panel: 'arca' }));
const alta = renderToStaticMarkup(createElement(EventualesScreens, { ...evBase, panel: 'alta' }));
check('Eventuales Bolsa', bolsa.includes('Sosa, Carla') && bolsa.includes('Marco vigente') && !bolsa.includes('ARCA pendiente') && !bolsa.includes('Alta rápida'));
check('Eventuales ARCA', arca.includes('ARCA pendiente') && arca.includes('AT PENDIENTE') && !arca.includes('Buscar en la bolsa'));
check('Eventuales Alta', alta.includes('Alta rápida') && alta.includes('Guardar en la bolsa'));

rmSync(outdir, { recursive: true, force: true });
if (failed) {
  console.error(failed, 'fallos');
  process.exit(1);
}
console.log('eval-movil-modulos ok');
