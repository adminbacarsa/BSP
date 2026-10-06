/**
 * Eventuales de escritorio (/admin/rrhh/eventuales): render de las piezas de la UX rediseñada.
 * Tarjetas-resumen, estado en palabras de la fila, guía «Cómo dejar listo a un eventual» y checklist de la ficha.
 *   node scripts/eval-eventuales-ux.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../apps/web2/package.json'));
const ts = require('typescript');
const root = join(here, '../apps/web2/src');
const outdir = join(here, '../apps/web2/.eventuales-ux-eval');
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const listoUxUrl = pathToFileURL(join(root, 'lib/eventuales/listoUx.mjs')).href;

function compile(file, name, transform = (src) => src) {
  const js = ts.transpileModule(transform(readFileSync(file, 'utf8')), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    fileName: name,
  }).outputText;
  const out = join(outdir, name.replace(/\.tsx?$/, '.mjs'));
  writeFileSync(out, js);
  return out;
}

const uiFile = compile(join(root, 'components/eventuales/EventualesUx.tsx'), 'EventualesUx.tsx', (src) =>
  src.replace("from '@/lib/eventuales/listoUx.mjs'", `from ${JSON.stringify(listoUxUrl)}`));

const L = await import(listoUxUrl);
const UI = await import(pathToFileURL(uiFile).href);
const { createElement: h } = await import(pathToFileURL(require.resolve('react')).href);
const { renderToStaticMarkup } = await import(pathToFileURL(require.resolve('react-dom/server')).href);

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) { failed += 1; console.error('FAIL', name, detail); } else { console.log('OK', name); }
}

const hoy = '2026-10-02';
const lista = {
  id: '20111111119', nombre: 'PEREZ, Ana', disponibilidad: 'DISPONIBLE', mail: 'ana@bacar.com', telefono: '351', domicilio: 'Calle 1',
  empresasHabilitadas: ['bacarsa'], uid: 'uid-ana', legajoPlanilla: '120', primerIngreso: '2024-03-01',
  credencialVencimiento: '2027-01-01', aptoPsicofisico: { vencimiento: '2027-01-01' },
  marcos: { bacarsa: { firmado: true, fechaFirma: '2026-09-01', vigenciaDias: 365 } },
};
const falta = { ...lista, id: '20222222223', nombre: 'GOMEZ, Juan', mail: '', telefono: '', domicilio: '', marcos: {}, uid: '' };
const vence = { ...lista, id: '20333333334', nombre: 'LOPEZ, Eva', marcos: { bacarsa: { firmado: true, fechaFirma: '2025-10-20', vigenciaDias: 365 } } };
const pruebas = { ...falta, id: '20444444445', nombre: 'SOSA, Leo', exigirMarco: false };
/** Captura 06/10: todo cargado menos la fecha de la credencial; Planificación lo bloquea. */
const sinFechaCredencial = { ...lista, id: '20555555556', nombre: 'ABALLAY, Ro', credencialVencimiento: '' };
const fichas = [lista, falta, vence];

// ── Tarjetas-resumen ──
const tarjetas = L.resumenBolsa({ fichas, empresaId: 'bacarsa', hoy, arcaPendientes: 2 });
const htmlTarjetas = renderToStaticMarkup(h(UI.TarjetasResumen, { tarjetas, activo: 'FALTA', onElegir: () => {} }));
check('4 tarjetas con título en palabras', ['Listos para convocar', 'Les falta algo', 'Contrato marco por vencer', 'ARCA pendientes'].every((t) => htmlTarjetas.includes(t)));
check('cantidades: 2 listos, 1 falta, 1 marco por vencer, 2 ARCA', htmlTarjetas.match(/data-resumen="LISTOS"[^>]*>.*?<p[^>]*>2</s) && htmlTarjetas.match(/data-resumen="FALTA"[^>]*>.*?<p[^>]*>1</s) && htmlTarjetas.match(/data-resumen="MARCO_VENCE"[^>]*>.*?<p[^>]*>1</s) && htmlTarjetas.match(/data-resumen="ARCA"[^>]*>.*?<p[^>]*>2</s), htmlTarjetas);
check('la tarjeta activa se marca', /data-resumen="FALTA" data-activa="1"/.test(htmlTarjetas) && /data-resumen="LISTOS" data-activa="0"/.test(htmlTarjetas));
check('ARCA sin dato muestra guion', renderToStaticMarkup(h(UI.TarjetasResumen, { tarjetas: L.resumenBolsa({ fichas, empresaId: 'bacarsa', hoy }), activo: '', onElegir: () => {} })).includes('>—<'));
check('tooltip en cada tarjeta', (htmlTarjetas.match(/title="/g) || []).length === 4);

// ── Fila: un solo estado en palabras ──
const filaOk = renderToStaticMarkup(h(UI.EstadoFilaChip, { estado: L.estadoFila(lista, hoy, 'bacarsa') }));
const filaFalta = renderToStaticMarkup(h(UI.EstadoFilaChip, { estado: L.estadoFila(falta, hoy, 'bacarsa') }));
check('fila lista: verde «Listo para convocar»', filaOk.includes('Listo para convocar') && filaOk.includes('data-estado-fila="ok"') && filaOk.includes('emerald'));
check('fila con faltantes: ámbar «Falta: mail, teléfono, domicilio, contrato marco»', filaFalta.includes('Falta: mail, teléfono, domicilio, contrato marco') && filaFalta.includes('data-estado-fila="falta"') && filaFalta.includes('amber'));
check('no disponible: gris', renderToStaticMarkup(h(UI.EstadoFilaChip, { estado: L.estadoFila({ ...lista, disponibilidad: 'NO_DISPONIBLE' }, hoy, 'bacarsa') })).includes('No disponible'));
const filaCred = renderToStaticMarkup(h(UI.EstadoFilaChip, { estado: L.estadoFila(sinFechaCredencial, hoy, 'bacarsa') }));
check('credencial sin fecha: la fila dice lo mismo que Planificación', filaCred.includes('Falta: vencimiento de la credencial') && filaCred.includes('data-estado-fila="falta"'));
check('tope alcanzado en la empresa activa: no está listo', renderToStaticMarkup(h(UI.EstadoFilaChip, { estado: L.estadoFila(lista, hoy, 'bacarsa', { alcanzado: true }) })).includes('Falta: horas en el mes (tope)'));
check('switch de pruebas: sin marco ni empresa igual puede estar listo salvo lo demás', L.estadoFila(pruebas, hoy, 'bacarsa').texto === 'Falta: mail, teléfono, domicilio');
const chipPr = renderToStaticMarkup(h(UI.ChipPruebas, { ficha: pruebas }));
check('«PR» pasa a chip gris «Pruebas: sin exigir marco» con tooltip', chipPr.includes('Pruebas: sin exigir marco') && chipPr.includes('slate') && /title="[^"]*sin contrato marco/.test(chipPr) && !chipPr.includes('fuchsia'));
check('sin switch no hay chip', renderToStaticMarkup(h(UI.ChipPruebas, { ficha: lista })) === '');

// ── Guía del panel derecho ──
const guia = L.pasosGuia({ fichas, empresaId: 'bacarsa', hoy });
const htmlGuia = renderToStaticMarkup(h(UI.GuiaEventuales, { guia, nombreEmpresa: 'Bacar SA', onFiltrar: () => {} }));
check('título de la guía', htmlGuia.includes('Cómo dejar listo a un eventual') && htmlGuia.includes('2 de 3 disponibles están listos para convocar.'));
check('6 pasos en orden (los del motor de candidatos)', ['Datos de contacto y domicilio', 'Contrato marco firmado y cargado', 'Empresa habilitada', 'Credencial, apto y habilitación vigentes', 'Acceso a la app', 'Horas disponibles en el mes'].map((t) => htmlGuia.indexOf(t)).every((i, k, arr) => i >= 0 && (k === 0 || i > arr[k - 1])));
check('la guía cuenta a quien le falta la fecha de la credencial', renderToStaticMarkup(h(UI.GuiaEventuales, { guia: L.pasosGuia({ fichas: [...fichas, sinFechaCredencial], empresaId: 'bacarsa', hoy }), nombreEmpresa: 'Bacar SA', onFiltrar: () => {} })).includes('data-guia-paso="VIGENCIAS" data-pendientes="1"'));
check('cuántos en cada paso y botón para filtrar', htmlGuia.includes('data-guia-paso="CONTACTO" data-pendientes="1"') && htmlGuia.includes('data-guia-filtrar="FALTA_CONTACTO"') && htmlGuia.includes('data-guia-paso="EMPRESA" data-pendientes="0"') && htmlGuia.includes('Nadie tiene este paso pendiente.') && !htmlGuia.includes('data-guia-filtrar="FALTA_EMPRESA"'));
check('con eventuales la guía no repite el alta', !htmlGuia.includes('Alta de eventual') && !htmlGuia.includes('data-guia-alta'));
check('sin eventuales: texto al alta de la barra, sin botón', (() => {
  const vacia = renderToStaticMarkup(h(UI.GuiaEventuales, { guia: L.pasosGuia({ fichas: [], empresaId: 'bacarsa', hoy }), nombreEmpresa: 'Bacar SA', onFiltrar: () => {} }));
  return vacia.includes('data-guia-alta') && vacia.includes('Usá Alta de eventual arriba') && !/<button/.test(vacia);
})());
check('voseo', htmlGuia.includes('Elegí una persona'));

// ── Ficha con checklist ──
const pasosMal = L.checklistFicha(falta, hoy, 'bacarsa', 'Bacar SA');
const htmlCheck = renderToStaticMarkup(h(UI.ChecklistEventual, { pasos: pasosMal, puedeEditar: true, onAccion: () => {} }));
check('checklist 3/6 con hecho / falta', htmlCheck.includes('data-hechos="3"') && htmlCheck.includes('3/6 pasos') && htmlCheck.includes('>Hecho<') && htmlCheck.includes('>Falta<'));
check('cada falta tiene su botón para resolverlo', htmlCheck.includes('data-check-accion="EDITAR"') && htmlCheck.includes('Completar datos') && htmlCheck.includes('data-check-accion="MARCO"') && htmlCheck.includes('Cargar marco') && htmlCheck.includes('data-check-accion="ACCESO"'));
check('acceso sin mail queda deshabilitado con explicación', /data-check-accion="ACCESO"[^>]*disabled/.test(htmlCheck) && htmlCheck.includes('Primero cargá el mail'));
const htmlOk = renderToStaticMarkup(h(UI.ChecklistEventual, { pasos: L.checklistFicha(lista, hoy, 'bacarsa', 'Bacar SA'), puedeEditar: true, onAccion: () => {} }));
check('todo hecho: 6/6 sin botones', htmlOk.includes('data-hechos="6"') && !htmlOk.includes('data-check-accion'));
const htmlCred = renderToStaticMarkup(h(UI.ChecklistEventual, { pasos: L.checklistFicha(sinFechaCredencial, hoy, 'bacarsa', 'Bacar SA'), puedeEditar: true, onAccion: () => {} }));
check('credencial sin fecha: motivo en palabras y botón «Cargar vencimiento de credencial» → editar ficha', htmlCred.includes('data-hechos="5"') && htmlCred.includes('Credencial sin fecha de vencimiento.') && /data-check-accion="EDITAR"[^>]*>Cargar vencimiento de credencial</.test(htmlCred));
const htmlTope = renderToStaticMarkup(h(UI.ChecklistEventual, { pasos: L.checklistFicha(lista, hoy, 'bacarsa', 'Bacar SA', { texto: '50/50 h este mes', alcanzado: true, cerca: true }), puedeEditar: true, onAccion: () => {} }));
check('tope alcanzado: paso de horas en falta con botón a la excepción', htmlTope.includes('data-hechos="5"') && htmlTope.includes('Tope del mes alcanzado') && htmlTope.includes('data-check-accion="TOPE"'));
check('no exigir marco (pruebas): marco y empresa quedan hechos con la aclaración', (() => {
  const html = renderToStaticMarkup(h(UI.ChecklistEventual, { pasos: L.checklistFicha(pruebas, hoy, 'bacarsa', 'Bacar SA'), puedeEditar: true, onAccion: () => {} }));
  return html.includes('Pruebas: sin exigir marco: no se exige') && !html.includes('data-check-accion="MARCO"');
})());
const htmlVence = renderToStaticMarkup(h(UI.ChecklistEventual, { pasos: L.checklistFicha(vence, hoy, 'bacarsa', 'Bacar SA'), puedeEditar: true, onAccion: () => {} }));
check('marco por vencer: hecho pero con «Renovar marco»', htmlVence.includes('vence pronto') && htmlVence.includes('Renovar marco'));
check('solo lectura: sin botones', !renderToStaticMarkup(h(UI.ChecklistEventual, { pasos: pasosMal, puedeEditar: false, onAccion: () => {} })).includes('data-check-accion'));
const sinEmpresa = L.checklistFicha({ ...lista, empresasHabilitadas: [] }, hoy, 'bacarsa', 'Bacar SA');
check('habilitar en la empresa activa desde la ficha', renderToStaticMarkup(h(UI.ChecklistEventual, { pasos: sinEmpresa, puedeEditar: true, onAccion: () => {} })).includes('Habilitar en Bacar SA'));

// ── La página no deja íconos sueltos ni la sigla ──
const pagina = readFileSync(join(root, 'pages/admin/rrhh/eventuales.tsx'), 'utf8');
check('la página ya no usa EstadoIcono ni siglaEmpresa', !pagina.includes('EstadoIcono') && !pagina.includes('siglaEmpresa'));
check('acciones de la barra, una sola vez', ['Alta de eventual', 'Importar planilla', 'Plantilla', 'Escala salarial'].every((t) => pagina.includes(t)) && (pagina.match(/Alta de eventual/g) || []).length === 1);
check('ARCA solo como tarjeta: la barra no tiene el botón', !pagina.includes('data-arca-toggle') && !pagina.includes('<Landmark'));
const guiaSrc = readFileSync(join(root, 'components/eventuales/EventualesUx.tsx'), 'utf8');
check('la guía no imprime ni sube marcos', !guiaSrc.includes('Imprimir') && !guiaSrc.includes('Subir marcos'));
check('toggle con texto explicativo', pagina.includes('TEXTO_TODA_LA_BOLSA') && pagina.includes('data-toda-la-bolsa'));
const marcos = readFileSync(join(root, 'components/eventuales/MarcosLotePanel.tsx'), 'utf8');
check('imprimir marcos con texto y cantidad', marcos.includes('textoImprimirMarcos') && marcos.includes('Subir marcos firmados'));
const fichaSrc = readFileSync(join(root, 'components/eventuales/FichaEventual.tsx'), 'utf8');
check('la ficha monta el checklist y botones rotulados', fichaSrc.includes('<ChecklistEventual') && fichaSrc.includes('label="Editar ficha"') && !fichaSrc.includes('<IconBtn'));
check('la ficha tiene Ver / Descargar del marco firmado y monta la solapa Contratos', fichaSrc.includes('label="Ver marco"') && fichaSrc.includes("accion: 'marcoPdf'") && fichaSrc.includes('<ContratosEventual'));

// ── Solapa Contratos: anexo (PDF), estado, escala y ARCA ──
const contratosFile = compile(join(root, 'components/eventuales/ContratosEventual.tsx'), 'ContratosEventual.tsx', (src) =>
  src.replace("from '@/lib/eventuales/contratoVista.mjs'", `from ${JSON.stringify(pathToFileURL(join(root, 'lib/eventuales/contratoVista.mjs')).href)}`));
const C = await import(pathToFileURL(contratosFile).href);
const contratoFirmado = {
  id: 'c1', empresaId: 'pruebas_sa', estado: 'CONFIRMADO', fechaAlta: '2026-10-02', fechaBaja: '2026-10-02',
  jornadas: [{ fecha: '2026-10-02', horaInicio: '12:00', horaFin: '20:00', horas: 8 }], anexoEstado: 'FIRMADO',
  anexo: { fechaHora: '2026-10-02T14:05:00.000Z', dispositivo: 'app Android', escalaTexto: 'Disp. 120/2026 · Acuerdo 305/26 v1', brutoTexto: '$ 85.000,00' },
};
const contratoPendiente = { ...contratoFirmado, id: 'c2', anexoEstado: 'PENDIENTE', anexo: null, anexoEscalaTexto: 'Disp. 120/2026 · Acuerdo 305/26 v1', anexoBrutoTexto: '$ 85.000,00' };
const arca = [
  { id: 'a1', tipo: 'AT', estado: 'CONFIRMADO', nroTransaccion: '12345', constanciaUrl: 'https://x/c.pdf', fechaAlta: '2026-10-02', contratoIds: ['c1'] },
  { id: 'a2', tipo: 'AT', estado: 'PENDIENTE', fechaAlta: '2026-10-02', contratoIds: ['c2'] },
];
const htmlContratos = renderToStaticMarkup(h(C.default, {
  cuil: '20111111119', exigirMarco: true, contratos: [contratoFirmado, contratoPendiente], arca, nombreEmpresa: () => 'Pruebas sa.', puedeLeer: true, puedeEditar: true, llamar: async () => ({}), recargar: () => {},
}));
check('cada contrato tiene Ver anexo y Descargar', (htmlContratos.match(/Ver anexo<\/button>/g) || []).length === 2 && (htmlContratos.match(/Descargar<\/button>/g) || []).length === 2);
check('anexo firmado: fecha, hora y dispositivo', htmlContratos.includes('data-anexo-estado="FIRMADO"') && htmlContratos.includes('Firmado 02/10 11:05 (app Android)'));
check('anexo pendiente: «Pendiente de firma» con Reenviar código', htmlContratos.includes('data-anexo-estado="PENDIENTE"') && htmlContratos.includes('Pendiente de firma') && htmlContratos.includes('Reenviar código'));
check('escala aplicada y bruto', (htmlContratos.match(/Disp\. 120\/2026 · Acuerdo 305\/26 v1/g) || []).length === 2 && htmlContratos.includes('Bruto $ 85.000,00'));
check('jornadas del contrato', htmlContratos.includes('02/10/2026 · 12:00–20:00 (8 h)'));
check('ARCA del contrato: AT confirmada con nº y constancia; la otra pendiente', htmlContratos.includes('Alta (AT) · Confirmado · nº 12345') && htmlContratos.includes('href="https://x/c.pdf"') && htmlContratos.includes('Alta (AT) · Pendiente'));
check('solo lectura: ve y descarga pero no reenvía', (() => {
  const html = renderToStaticMarkup(h(C.default, { cuil: '1', exigirMarco: true, contratos: [contratoPendiente], arca: [], nombreEmpresa: () => 'X', puedeLeer: true, puedeEditar: false, llamar: async () => ({}), recargar: () => {} }));
  return html.includes('Ver anexo') && !html.includes('Reenviar código') && html.includes('Sin envíos ARCA');
})());
check('no exigido: sin botón de reenviar', renderToStaticMarkup(h(C.default, { cuil: '1', exigirMarco: false, contratos: [{ ...contratoPendiente, anexoEstado: '', anexoExigido: false }], arca: [], nombreEmpresa: () => 'X', puedeLeer: true, puedeEditar: true, llamar: async () => ({}), recargar: () => {} })).includes('data-anexo-estado="NO_EXIGIDO"'));

rmSync(outdir, { recursive: true, force: true });
if (failed) { console.error(`\n${failed} chequeos fallaron`); process.exit(1); }
console.log('\nEventuales UX escritorio: todo OK');
