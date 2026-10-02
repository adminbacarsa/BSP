/**
 * Eventos → «Convocar guardias» (Nómina): regla libre/RET = asignación directa (se notifica),
 * el resto tiene que aceptar (se convoca). Lógica pura + render de las piezas de UI.
 *   node scripts/eval-eventos-convocar.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../apps/web2/package.json'));
const ts = require('typescript');
const root = join(here, '../apps/web2/src');
const outdir = join(here, '../apps/web2/.eventos-eval');
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

function compile(file, name, transform = (src) => src) {
  const js = ts.transpileModule(transform(readFileSync(file, 'utf8')), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    fileName: name,
  }).outputText;
  const out = join(outdir, name.replace(/\.tsx?$/, '.mjs'));
  writeFileSync(out, js);
  return out;
}

const planFile = compile(join(root, 'lib/eventos/convocatoriaPlan.ts'), 'convocatoriaPlan.ts');
const uiFile = compile(join(root, 'components/servicios/EventoConvocarResumen.tsx'), 'EventoConvocarResumen.tsx', (src) =>
  src.replace("from '@/lib/eventos/convocatoriaPlan'", `from ${JSON.stringify(pathToFileURL(planFile).href)}`));

const P = await import(pathToFileURL(planFile).href);
const UI = await import(pathToFileURL(uiFile).href);
const { createElement } = await import(pathToFileURL(require.resolve('react')).href);
const { renderToStaticMarkup } = await import(pathToFileURL(require.resolve('react-dom/server')).href);

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) {
    failed += 1;
    console.error('FAIL', name, detail);
  } else {
    console.log('OK', name);
  }
}

// ── Regla: libre / RET se notifica, F / FF / FP / ESC se convoca, con turno no se puede ──
check('libre y RET = Se notifica', P.accionParaCodigo('libre') === 'NOTIFICAR' && P.accionParaCodigo('') === 'NOTIFICAR' && P.accionParaCodigo('RET') === 'NOTIFICAR' && P.accionParaCodigo('ret') === 'NOTIFICAR');
check('franco y escuela = Se convoca', ['F', 'FF', 'FP', 'ESC'].every((c) => P.accionParaCodigo(c) === 'CONVOCAR'));
check('con turno o licencia no se convoca', ['M', 'T', 'N', 'D12', 'N12', 'V', 'E', 'EV', 'ocupado'].every((c) => P.accionParaCodigo(c) === null));
check('etiquetas', P.etiquetaAccion('NOTIFICAR') === 'Se notifica' && P.etiquetaAccion('CONVOCAR') === 'Se convoca' && P.etiquetaAccion(null) === 'No disponible');

// ── Situación del día con horario ──
check('horario corto', P.horarioCorto('07:00', '15:00') === '07–15' && P.horarioCorto('07:30', '15:30') === '07:30–15:30' && P.horarioCorto('', '15:00') === '');
const m = P.situacionDelDia('M', '07–15');
check('M 07–15', m.label === 'M 07–15' && m.accion === null && !m.seleccionable && m.descripcion === 'mañana 07–15');
check('Libre sin horario', P.situacionDelDia('libre', '').label === 'Libre' && P.situacionDelDia('libre', '').seleccionable);
check('RET y F no muestran horario', P.situacionDelDia('RET', '08–16').label === 'RET' && P.situacionDelDia('F', '00–23').label === 'F');

// ── Plan en dos grupos + cupo ──
const plan = P.armarPlanConvocatoria([
  { id: 'a', nombre: 'Baez, Juan', code: 'libre' },
  { id: 'b', nombre: 'Guerrero, Martín', code: 'F' },
  { id: 'c', nombre: 'Fontana, Ana', code: 'RET', horario: '08–16' },
  { id: 'd', nombre: 'Lopez, Luis', code: 'ESC', horario: '07–15' },
  { id: 'e', nombre: 'Sosa, Carla', code: 'FF' },
], 4);
check('grupos y cupo', plan.notificar.map((p) => p.id).join(',') === 'a,c' && plan.convocar.map((p) => p.id).join(',') === 'b,d' && plan.omitidosPorCupo.map((p) => p.id).join(',') === 'e');
check('sin cupo (Infinity) entran todos', P.armarPlanConvocatoria([{ id: 'x', nombre: 'X', code: 'F' }], Infinity).convocar.length === 1);
check('botón: Notificar y convocar', P.textoBotonPlan(plan) === 'Notificar y convocar');
check('botón: solo Notificar', P.textoBotonPlan({ notificar: plan.notificar, convocar: [] }) === 'Notificar (2)' && P.textoBotonPlan({ notificar: [plan.notificar[0]], convocar: [] }) === 'Notificar');
check('botón: solo Convocar', P.textoBotonPlan({ notificar: [], convocar: plan.convocar }) === 'Convocar (2)');
check('títulos de grupo', P.tituloGrupoNotificar(2) === 'Se asignan y se notifican (2)' && P.tituloGrupoConvocar(3) === 'Se convocan, tienen que aceptar (3)');
check('resumen del envío', P.resumenEnvio(plan) === '2 asignados y notificados · 2 convocados (tienen que aceptar) · 1 omitido por cupo');

// ── Aviso al guardia ──
const ctx = { evento: 'Recital Plaza', servicio: 'Acceso', fecha: '04/10/26', horario: '18:00–02:00' };
const avisoN = P.textoAvisoGuardia('NOTIFICAR', ctx);
const avisoC = P.textoAvisoGuardia('CONVOCAR', ctx);
check('aviso asignado: Fuiste asignado a…', avisoN.title === 'Fuiste asignado a Recital Plaza' && avisoN.body.includes('Acceso · 04/10/26 · 18:00–02:00') && avisoN.body.includes('no hace falta que respondas'));
check('aviso convocado: aceptar/rechazar', avisoC.title === 'Convocatoria: Recital Plaza' && avisoC.body.includes('Aceptá o rechazá'));

// ── Estado convocatoria ──
check('Asignado (notificado) ≠ Aceptó', P.estadoSolicitudUi({ status: 'aprobada', tipo: 'admin_asigna' }).label === 'Asignado (notificado)' && P.estadoSolicitudUi({ status: 'aprobada', tipo: 'admin_convoca' }).label === 'Aceptó');
check('Pendiente / Rechazó', P.estadoSolicitudUi({ status: 'convocado', tipo: 'admin_convoca' }).label === 'Pendiente' && P.estadoSolicitudUi({ status: 'pendiente', tipo: 'guardia_solicita' }).label === 'Pendiente' && P.estadoSolicitudUi({ status: 'rechazada' }).label === 'Rechazó');

// ── Errores entendibles ──
const internal = Object.assign(new Error('INTERNAL'), { code: 'functions/internal' });
check('INTERNAL → mensaje entendible', P.mensajeErrorCallable(internal, 'No se pudo cargar la bolsa de eventuales.') === 'No se pudo cargar la bolsa de eventuales. El servidor no pudo completar la operación. Reintentá.');
check('internal en minúscula sin code', P.mensajeErrorCallable(new Error('internal'), 'No se pudo asignar.') === 'No se pudo asignar. El servidor no pudo completar la operación. Reintentá.');
check('mensaje propio del servidor se respeta', P.mensajeErrorCallable(Object.assign(new Error('Sin contrato marco vigente para esta empresa.'), { code: 'functions/failed-precondition' }), 'X') === 'Sin contrato marco vigente para esta empresa.');
check('error vacío', P.mensajeErrorCallable({}, 'No se pudo enviar la convocatoria.') === 'No se pudo enviar la convocatoria. Reintentá.');
check('deadline', P.mensajeErrorCallable(Object.assign(new Error('deadline-exceeded'), { code: 'functions/deadline-exceeded' }), 'No se pudo cargar la bolsa de eventuales.').includes('tardó demasiado'));

// ── Render ──
const noop = () => {};
const resumen = renderToStaticMarkup(createElement(UI.ConvocatoriaResumen, { plan, servicio: { nombre: 'Acceso', fecha: '04/10/26', horario: '18:00–02:00' }, sending: false, onCancelar: noop, onConfirmar: noop }));
check('resumen: dos grupos con títulos y personas', resumen.includes('Se asignan y se notifican (2)') && resumen.includes('Se convocan, tienen que aceptar (2)') && resumen.includes('Baez, Juan') && resumen.includes('Fontana, Ana') && resumen.includes('Guerrero, Martín') && resumen.includes('Lopez, Luis') && resumen.includes('data-grupo="notificar"') && resumen.includes('data-grupo="convocar"'));
check('resumen: omitidos por cupo y botón combinado', resumen.includes('Sosa, Carla') && resumen.includes('data-grupo="omitidos"') && resumen.includes('data-boton-plan="Notificar y convocar"') && resumen.includes('>Volver<'));
const soloN = renderToStaticMarkup(createElement(UI.ConvocatoriaResumen, { plan: { notificar: plan.notificar, convocar: [], omitidosPorCupo: [] }, servicio: { nombre: 'Acceso', fecha: '04/10/26', horario: '18–02' }, sending: false, onCancelar: noop, onConfirmar: noop }));
check('resumen: solo Notificar sin grupo convocar', soloN.includes('data-boton-plan="Notificar (2)"') && !soloN.includes('data-grupo="convocar"'));
const soloC = renderToStaticMarkup(createElement(UI.ConvocatoriaResumen, { plan: { notificar: [], convocar: [plan.convocar[0]], omitidosPorCupo: [] }, servicio: { nombre: 'Acceso', fecha: '04/10/26', horario: '18–02' }, sending: true, onCancelar: noop, onConfirmar: noop }));
check('resumen: solo Convocar y enviando', soloC.includes('Enviando…') && !soloC.includes('data-grupo="notificar"') && soloC.includes('data-boton-plan="Convocar"'));

const fila = (code, horario, yaEnviado = null) => renderToStaticMarkup(createElement(UI.SituacionAccionBadges, { situacion: P.situacionDelDia(code, horario), yaEnviado }));
check('fila: Libre → Se notifica', fila('libre', '').includes('>Libre<') && fila('libre', '').includes('data-accion="NOTIFICAR"') && fila('libre', '').includes('Se notifica'));
check('fila: RET → Se notifica', fila('RET', '08–16').includes('>RET<') && fila('RET', '08–16').includes('Se notifica'));
check('fila: F → Se convoca', fila('F', '').includes('>F<') && fila('F', '').includes('data-accion="CONVOCAR"') && fila('F', '').includes('Se convoca'));
check('fila: M 07–15 → No disponible', fila('M', '07–15').includes('>M 07–15<') && fila('M', '07–15').includes('No disponible'));
check('fila: ya asignado vs ya convocado', fila('libre', '', 'ASIGNADO').includes('Asignado (notificado)') && fila('F', '', 'CONVOCADO').includes('>Convocado<') && !fila('F', '', 'CONVOCADO').includes('Se convoca'));

const chip = (sol) => renderToStaticMarkup(createElement(UI.EstadoSolicitudChip, { sol }));
check('chips de estado', chip({ status: 'aprobada', tipo: 'admin_asigna' }).includes('data-estado="ASIGNADO"') && chip({ status: 'aprobada', tipo: 'admin_convoca' }).includes('Aceptó') && chip({ status: 'convocado' }).includes('Pendiente') && chip({ status: 'rechazada' }).includes('Rechazó'));

const errBox = renderToStaticMarkup(createElement(UI.ErrorCallableBox, { mensaje: 'No se pudo cargar la bolsa de eventuales. Reintentá.', onReintentar: noop }));
check('caja de error con Reintentar', errBox.includes('role="alert"') && errBox.includes('No se pudo cargar la bolsa de eventuales. Reintentá.') && /<button[^>]*>[\s\S]*Reintentar[\s\S]*<\/button>/.test(errBox) && !errBox.includes('INTERNAL'));

// ── El modal usa las piezas (sin render: lee el fuente) ──
const modal = readFileSync(join(root, 'components/servicios/EventoDetailModal.tsx'), 'utf8');
check('modal: resumen antes de enviar y botón Revisar', modal.includes('<ConvocatoriaResumen') && modal.includes('setRevisando(true)') && modal.includes('Revisar y enviar') && !modal.includes("`Convocar${selected.size"));
check('modal: avisos por textoAvisoGuardia y tipo EVENTO_CONFIRMADO / CONVOCATORIA_EVENTO', modal.includes("textoAvisoGuardia('NOTIFICAR'") && modal.includes("textoAvisoGuardia('CONVOCAR'") && modal.includes("type: 'EVENTO_CONFIRMADO'") && modal.includes("type: 'CONVOCATORIA_EVENTO'"));
check('modal: Estado separa asignados de aceptaron', modal.includes('Asignados (notificados) —') && modal.includes('<EstadoSolicitudChip') && modal.includes("s.tipo === 'admin_asigna'"));
check('modal: errores entendibles + Reintentar en eventuales', modal.includes('<ErrorCallableBox') && modal.includes('mensajeErrorCallable(e,') && !modal.includes('eventualErrorMessage'));
check('modal: mismas funciones (assignGuardToEvent, solicitudes_evento)', modal.includes('await assignGuardToEvent({') && modal.includes("collection(db, 'solicitudes_evento')") && modal.includes('solicitudEventoService.convocar('));
const panel = readFileSync(join(root, 'components/eventuales/EventualesCandidatosPanel.tsx'), 'utf8');
check('panel eventuales: mensaje entendible + Reintentar', panel.includes("mensajeErrorCallable(e, 'No se pudo cargar la bolsa de eventuales.')") && panel.includes('Reintentar') && panel.includes('setIntento'));

// ── Circuito eventual en evento: convocar → aceptar; estados Venció / anexo / ARCA; switch de pruebas ──
check('estado: vencida → Venció', P.estadoSolicitudUi({ status: 'vencida' }).key === 'VENCIO' && chip({ status: 'vencida' }).includes('data-estado="VENCIO"') && chip({ status: 'vencida' }).includes('Venció'));
check('estado: cancelada → No puede asistir', P.estadoSolicitudUi({ status: 'cancelada' }).key === 'NO_VA' && chip({ status: 'cancelada' }).includes('No puede asistir'));
const detPend = P.detalleEventualUi({ esEventual: true, status: 'aprobada', anexoEstado: 'PENDIENTE_ACEPTACION', arcaCanal: 'URGENTE' }, { eventualAltaArcaConfirmada: false });
check('detalle eventual: anexo pendiente + ARCA pendiente urgente', detPend.anexo?.label === 'Anexo pendiente' && /ARCA pendiente/.test(detPend.arca?.label || '') && /urgente/i.test(detPend.arca?.label || '') && detPend.pruebas === null);
const detOk = P.detalleEventualUi({ esEventual: true, status: 'aprobada', anexoEstado: 'FIRMADO' }, { eventualAltaArcaConfirmada: true, nroTransaccion: 'TX-1' });
check('detalle eventual: anexo firmado + ARCA confirmada con Nº', detOk.anexo?.label === 'Anexo firmado' && detOk.anexo?.tono === 'ok' && /ARCA confirmada/.test(detOk.arca?.label || '') && /TX-1/.test(detOk.arca?.label || ''));
const detPruebas = P.detalleEventualUi({ esEventual: true, status: 'aprobada', anexoEstado: 'NO_EXIGIDO', pruebasSinMarco: true, etiquetasPruebas: ['Pruebas: sin exigir marco'] }, { eventualAltaArcaConfirmada: false, eventualExigirAltaArca: false });
check('detalle eventual: pruebas → anexo no exigido, ARCA ficha igual', /no exigido/i.test(detPruebas.anexo?.label || '') && /ficha igual/i.test(detPruebas.arca?.label || '') && detPruebas.pruebas === 'Pruebas: sin exigir marco');
const linea = renderToStaticMarkup(createElement(UI.EventualEstadoLinea, { sol: { esEventual: true, status: 'aprobada', anexoEstado: 'PENDIENTE_ACEPTACION', arcaCanal: 'URGENTE', pruebasSinMarco: true }, turno: { eventualAltaArcaConfirmada: false } }));
check('línea eventual en Estado: Eventual + Pruebas + anexo + ARCA', linea.includes('data-eventual-detalle') && linea.includes('Eventual') && linea.includes('data-pruebas="sin-marco"') && linea.includes('data-anexo') && linea.includes('Anexo pendiente') && linea.includes('data-arca') && linea.includes('ARCA pendiente'));
const lineaNo = renderToStaticMarkup(createElement(UI.EventualEstadoLinea, { sol: { esEventual: false, status: 'aprobada' }, turno: null }));
check('línea eventual no se pinta para nómina', !lineaNo.includes('data-eventual-detalle'));
const badge = renderToStaticMarkup(createElement(UI.PruebasBadge, { compact: true }));
check('PruebasBadge: texto fijo', badge.includes('data-pruebas="sin-marco"') && badge.includes('Pruebas: sin exigir marco'));
check('modal: eventual se CONVOCA (no asignación directa) y Estado muestra vencidas', modal.includes('convocarEventualEvento({') && !modal.includes('asignarEventualPlanificacion(') && modal.includes('<EventualEstadoLinea') && modal.includes("s.status === 'vencida'") && modal.includes('Vencieron sin responder'));
check('panel candidatos: marca Pruebas: sin exigir marco', panel.includes('c.pruebasSinMarco') && panel.includes('<PruebasBadge'));
const csm = readFileSync(join(root, 'components/operaciones/CoverageSessionManager.tsx'), 'utf8');
check('CC: la fila del eventual marca Pruebas: sin exigir marco', csm.includes('row.pruebasSinMarco') && csm.includes('Pruebas: sin exigir marco'));
const ficha = readFileSync(join(root, 'components/eventuales/FichaEventual.tsx'), 'utf8');
check('ficha escritorio: dos switches por gestionarEventual switchesPruebas, solo con update', ficha.includes("accion: 'switchesPruebas'") && ficha.includes('Exigir contrato marco y habilitación') && ficha.includes('Exigir alta ARCA para fichar') && ficha.includes("puede('update')") && ficha.includes('data-switches-pruebas'));

rmSync(outdir, { recursive: true, force: true });
if (failed) {
  console.error(failed, 'fallos');
  process.exit(1);
}
console.log('eval-eventos-convocar ok');
