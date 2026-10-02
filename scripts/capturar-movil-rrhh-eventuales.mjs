/**
 * Capturas 390×844 de RRHH y Eventuales (celular), con el CSS del export estático.
 * Antes: cd apps/web2 && npx next build
 *
 *   node --experimental-strip-types scripts/capturar-movil-rrhh-eventuales.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildMovilTheme } from '../apps/web2/src/lib/companyTheme.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(join(root, 'apps/web2/package.json'));
const webRoot = join(root, 'apps/web2/src');
const outDir = join(root, 'docs/movil/capturas-1003');
const copia = join(process.env.USERPROFILE || '', 'Downloads', 'COSP Celular');
const cssDir = join(root, 'apps/web2/out/_next/static/css');

const cssFiles = readdirSync(cssDir).filter((name) => name.endsWith('.css'));
if (!cssFiles.length) throw new Error('Falta el CSS del export. Corré next build en apps/web2.');
const css = cssFiles.map((name) => readFileSync(join(cssDir, name), 'utf8')).join('\n');

const { compileMovilLib, compileMovilScreens, writeStub } = await import('./movil-eval-lib.mjs');
const outdir = join(root, 'apps/web2/.movil-eval');
rmSync(outdir, { recursive: true, force: true });
const lib = compileMovilLib(outdir);
const firestoreStub = writeStub(outdir, 'firestore-stub', 'export function collection(){return {}} export function query(){return {}} export function where(){return {}} export function onSnapshot(){return ()=>{}}');
const firebaseStub = writeStub(outdir, 'firebase-stub', 'export const db = {};');
const linkStub = writeStub(outdir, 'next-link', `import { createElement } from 'react';
export default function Link(props) { return createElement('a', { href: props.href, className: props.className, 'aria-current': props['aria-current'] }, props.children); }`);
const routerStub = writeStub(outdir, 'next-router', `export function useRouter() { return globalThis.__MOVIL_ROUTE || { pathname: '/', query: {} }; }`);
const authStub = writeStub(outdir, 'auth-stub', `export function useAuth() { return { canReadModule: () => true, isSuperAdmin: true, rolePermissions: {} }; }`);
const screens = compileMovilScreens(outdir, lib, ['RrhhScreens', 'EventualesScreens', 'EscalaMovilPanel', 'MovilBottomNav'], {
  'firebase/firestore': firestoreStub,
  '@/lib/firebase': firebaseStub,
  '@/lib/eventuales/escalaCct.mjs': pathToFileURL(join(webRoot, 'lib/eventuales/escalaCct.mjs')).href,
  '@/lib/eventuales/plazoAnulacion.mjs': pathToFileURL(join(webRoot, 'lib/eventuales/plazoAnulacion.mjs')).href,
  'next/link': linkStub,
  'next/router': routerStub,
  '@/context/AuthContext': authStub,
});

const { createElement } = await import(pathToFileURL(require.resolve('react')).href);
const { renderToStaticMarkup } = await import(pathToFileURL(require.resolve('react-dom/server')).href);
const { RrhhScreens } = await import(screens.RrhhScreens);
const { EventualesScreens } = await import(screens.EventualesScreens);
const { EscalaMovilPanel } = await import(screens.EscalaMovilPanel);
const { MovilBottomNav } = await import(screens.MovilBottomNav);
const noop = () => {};

const bacar = buildMovilTheme('#1d4ed8');
const clara = buildMovilTheme('#fde047');
const estilo = (tema) => Object.entries(tema).map(([k, v]) => `${k}:${v}`).join(';');

const rrhhBase = {
  online: true, pendingLabel: null, hoyLabel: 'viernes 2 de octubre',
  ausenciasHoy: [
    { id: '2', employeeId: 'b', nombre: 'Baez, Juan', tipo: 'No Presentación', justificable: true },
    { id: '1', employeeId: 'g', nombre: 'Guerrero, Martín', tipo: 'Enfermedad' },
  ],
  licencias: [{ id: 'l', employeeId: 'g', nombre: 'Guerrero, Martín', detalle: 'Termina hoy' }],
  certificados: [{ id: 'c', employeeId: 'g', nombre: 'Guerrero, Martín' }],
  busqueda: '', onBusqueda: noop,
  guardias: [{ id: 'g', nombre: 'Guerrero, Martín', telefono: '3515550101' }],
  tipos: [{ id: 'e', label: 'Enfermedad', code: 'E' }, { id: 'l', label: 'Licencia', code: 'L' }, { id: 'a', label: 'Autorizada', code: 'A' }],
  tipoId: 'e', onTipo: noop, dias: '2', onDias: noop, fotoNombre: null, onFoto: noop, onGuardarAusencia: noop,
  novedadTipo: 'Observación', onNovedadTipo: noop, novedadTexto: '', onNovedadTexto: noop, onGuardarNovedad: noop,
  ficha: { nombre: 'Baez, Juan', telefono: '3515550199', turnos: [{ id: 't1', dia: 'vie 02/10', codigo: 'M' }, { id: 't2', dia: 'sáb 03/10', codigo: 'F' }] },
  onElegir: noop, onFicha: noop, onPanel: noop, onJustificar: noop,
};

const personas = [
  { id: '1', nombre: 'Sosa, Carla', cuil: '20-11111111-2', marco: 'Marco vigente', marcoEstado: 'MARCO_VIGENTE', telefono: '3515550101', legajo: '148', primerIngreso: '15/02/2024', estadoTexto: 'Listo para convocar', estadoTono: 'ok' },
  { id: '2', nombre: 'Ruiz, Pedro', cuil: '20-22222222-3', marco: 'Sin marco', marcoEstado: 'SIN_MARCO', telefono: '', legajo: '203', primerIngreso: '01/03/2025', estadoTexto: 'Falta: mail, contrato marco', estadoTono: 'falta' },
];
const evBase = {
  online: true, pendingLabel: null, buscar: '', onBuscar: noop, totalEmpresa: 2, personas, onElegir: noop, onCerrarAlta: noop,
  cuil: '20-33333333-4', onCuil: noop, cuilEstado: '20-33333333-4 válido', nombre: 'Paz, Lucía', onNombre: noop,
  mail: '', onMail: noop, telefono: '', onTelefono: noop, genero: '', onGenero: noop, onGuardarAlta: noop, onCrearAcceso: noop,
  arca: [
    { id: 'a', nombre: 'Sosa, Carla', cuil: '20-11111111-2', tipo: 'AT', estado: 'PENDIENTE', fecha: '01/10/2026', nroTransaccion: '' },
    { id: 'n', nombre: 'Quiroga, Kevin', cuil: '20-44444444-5', cuil11: '20444444445', tipo: 'ANULACION', estado: 'PENDIENTE', fecha: '02/10/2026', nroTransaccion: '', fechaInicioArca: '20261002', nroTransaccionAlta: '778899', venceAnulacionMs: Date.parse('2026-10-03T00:00:00-03:00') },
  ],
  nro: '', onNro: noop, arcaId: '', onArca: noop, onConfirmarArca: noop, acuse: '', onAcuse: noop, ahoraMs: Date.parse('2026-10-02T21:00:00-03:00'), elegido: null,
};

const campo = (valor, confianza = 'ALTA') => ({ valor, confianza });
const escala = createElement(EscalaMovilPanel, {
  escalas: [{
    id: 'cct1', estado: 'APROBADA', version: 1, vigenciaDesde: '2026-01-01', vigenciaHasta: '2026-06-30', confianzaGlobal: 'ALTA', historial: [],
    fuente: { disposicion: '120/2026' },
    tramos: [{
      mes: '2026-10', vigenciaDesde: '2026-10-01', vigenciaHasta: '2026-10-31', aeroportuario: campo(null), adicionalVacacionesPorDia: campo(null),
      categorias: [{ codigo: 'VIGILADOR', label: 'Vigilador', codigoArca: '033104', basico: campo(850000), presentismo: campo(42500), viatico: campo(18000), noRemunerativo: campo(12000), total: campo(922500) }],
    }],
  }],
});

const rrhhRuta = '/admin/rrhh/movil/';
const evRuta = '/admin/rrhh/eventuales/';
const paginas = [
  ['01-rrhh-hoy', { pathname: rrhhRuta, query: {} }, createElement(RrhhScreens, { ...rrhhBase, empresa: 'Bacar S.A.', panel: 'dia' }), bacar],
  ['02-rrhh-cargar', { pathname: rrhhRuta, query: { panel: 'ausencia' } }, createElement(RrhhScreens, { ...rrhhBase, empresa: 'Bacar S.A.', panel: 'ausencia' }), bacar],
  ['03-rrhh-novedades', { pathname: rrhhRuta, query: { panel: 'novedad' } }, createElement(RrhhScreens, { ...rrhhBase, empresa: 'Bacar S.A.', panel: 'novedad' }), bacar],
  ['04-rrhh-justificar', { pathname: rrhhRuta, query: {} }, createElement(RrhhScreens, { ...rrhhBase, empresa: 'Bacar S.A.', panel: 'dia', justificar: { id: '2', nombre: 'Baez, Juan · No Presentación', tipos: rrhhBase.tipos, tipoId: 'e', fotoNombre: null } }), bacar],
  ['05-rrhh-ficha', { pathname: rrhhRuta, query: {} }, createElement(RrhhScreens, { ...rrhhBase, empresa: 'Bacar S.A.', panel: 'ficha' }), bacar],
  ['06-eventuales-bolsa', { pathname: evRuta, query: {} }, createElement(EventualesScreens, { ...evBase, empresa: 'Bacar S.A.', panel: 'bolsa' }), bacar],
  ['07-eventuales-alta', { pathname: evRuta, query: { panel: 'alta' } }, createElement(EventualesScreens, { ...evBase, empresa: 'Bacar S.A.', panel: 'alta' }), bacar],
  ['08-eventuales-arca', { pathname: evRuta, query: { panel: 'arca' } }, createElement(EventualesScreens, { ...evBase, empresa: 'Bacar S.A.', panel: 'arca', arcaId: 'a' }), bacar],
  ['09-eventuales-anulacion', { pathname: evRuta, query: { panel: 'arca' } }, createElement(EventualesScreens, { ...evBase, empresa: 'Bacar S.A.', panel: 'arca', arcaId: 'n', acuse: 'ACUSE-7788' }), bacar],
  ['10-eventuales-escala', { pathname: evRuta, query: { panel: 'escala' } }, createElement(EventualesScreens, { ...evBase, empresa: 'Bacar S.A.', panel: 'escala', escala }), bacar],
  ['11-eventuales-bolsa-empresa-clara', { pathname: evRuta, query: {} }, createElement(EventualesScreens, { ...evBase, empresa: 'Grupo Norte', panel: 'bolsa' }), clara],
];

mkdirSync(outDir, { recursive: true });
mkdirSync(copia, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' }).catch(() => chromium.launch({ channel: 'chrome' }));
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  for (const [nombre, ruta, nodo, tema] of paginas) {
    globalThis.__MOVIL_ROUTE = ruta;
    const html = `<!doctype html><html style="${estilo(tema)}"><head><meta charset="utf-8"><style>html,body{margin:0;background:#f7f8fa}${css}</style></head><body>${renderToStaticMarkup(createElement('div', null, nodo, createElement(MovilBottomNav)))}</body></html>`;
    const file = join(outdir, `${nombre}.html`);
    writeFileSync(file, html);
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    const png = join(outDir, `${nombre}.png`);
    await page.screenshot({ path: png });
    cpSync(png, join(copia, `${nombre}.png`));
    console.log(nombre);
  }
} finally {
  await browser.close();
  rmSync(outdir, { recursive: true, force: true });
}
