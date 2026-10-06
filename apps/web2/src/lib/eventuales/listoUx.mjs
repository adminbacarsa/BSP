/**
 * Pantalla Eventuales de escritorio: estado en palabras de cada fila, tarjetas-resumen,
 * guía «Cómo dejar listo a un eventual» y lista de verificación de la ficha.
 * Solo lectura sobre la ficha de la bolsa: qué es convocable lo decide `faltantesConvocable`,
 * que mira lo mismo que el motor de candidatos (`evaluarEventualParaHueco`).
 */
import { FALTANTES_VIGENCIA, faltantesConvocable, filtrarFichas, fmtFechaAr, marcoPorVencer } from './fichaUx.mjs';
import { marcoDeBolsa } from './marcoTexto.mjs';
import { vencimientosDe } from './planificacion.mjs';
import { ETIQUETA_PRUEBAS_SIN_MARCO, exigeMarco } from './pruebasSwitch.mjs';

/** Lo que falta, en palabras cortas para la fila. */
export const PALABRA_FALTA = {
  MAIL: 'mail',
  TEL: 'teléfono',
  DOM: 'domicilio',
  EMPRESA: 'empresa habilitada',
  MARCO: 'contrato marco',
  CREDENCIAL: 'credencial vigente',
  CREDENCIAL_FECHA: 'vencimiento de la credencial',
  APTO: 'apto vigente',
  APTO_FECHA: 'vencimiento del apto',
  NO_APTO: 'apto psicofísico (figura no apto)',
  HABILITACION: 'habilitación 9236 vigente',
  TOPE: 'horas en el mes (tope)',
};

export const TEXTO_LISTO = 'Listo para convocar';
export const TEXTO_NO_DISPONIBLE = 'No disponible';
export const TOOLTIP_PRUEBAS = 'Switch de pruebas: se lo puede convocar sin contrato marco vigente ni empresa habilitada.';

/**
 * UN estado por fila. `tono`: 'ok' (verde) | 'falta' (ámbar) | 'baja' (gris).
 * `faltan` son los ids de `faltantesConvocable`, para quien quiera armar el detalle.
 * `horasMes` (opcional) = `{ alcanzado, cerca }` del tope de la empresa activa.
 */
export function estadoFila(ficha, hoy, empresaId = '', horasMes = null) {
  if (ficha?.disponibilidad === 'NO_DISPONIBLE') return { tono: 'baja', texto: TEXTO_NO_DISPONIBLE, faltan: [] };
  const faltan = faltantesConvocable(ficha, hoy, empresaId, horasMes).map((c) => c.id);
  if (!faltan.length) return { tono: 'ok', texto: TEXTO_LISTO, faltan };
  return { tono: 'falta', texto: `Falta: ${faltan.map((id) => PALABRA_FALTA[id] || id.toLowerCase()).join(', ')}`, faltan };
}

/** Chip gris «Pruebas: sin exigir marco» (antes era una sigla suelta). Null si exige marco. */
export function chipPruebas(ficha) {
  if (exigeMarco(ficha)) return null;
  return { texto: ETIQUETA_PRUEBAS_SIN_MARCO, tooltip: TOOLTIP_PRUEBAS };
}

export const TARJETAS_RESUMEN = [
  { id: 'LISTOS', titulo: 'Listos para convocar', ayuda: 'Disponibles con contacto, domicilio, empresa, contrato marco, credencial, apto y habilitación al día y con horas en el mes. Lo mismo que mira Planificación.', tono: 'ok' },
  { id: 'FALTA', titulo: 'Les falta algo', ayuda: 'Disponibles a los que les falta algún dato, documento o vencimiento para convocarlos.', tono: 'falta' },
  { id: 'MARCO_VENCE', titulo: 'Contrato marco por vencer', ayuda: 'Marco vigente que vence en menos de 30 días.', tono: 'aviso' },
  { id: 'ARCA', titulo: 'ARCA pendientes', ayuda: 'Altas y bajas sin número de transacción, y anulaciones por acusar.', tono: 'arca' },
];

/** Cantidades de las 4 tarjetas. `arcaPendientes` llega del servidor (`gestionarEventual arcaPendientes`). */
export function resumenBolsa({ fichas, empresaId = '', todaLaBolsa = false, hoy, arcaPendientes = null, horasMes = null }) {
  const contar = (filtro) => filtrarFichas({ fichas, empresaId, todaLaBolsa, filtro, hoy, horasMes }).length;
  return TARJETAS_RESUMEN.map((t) => ({
    ...t,
    n: t.id === 'ARCA' ? arcaPendientes : contar(t.id),
  }));
}

/** Filtros del selector secundario (lo que no es tarjeta). */
export const FILTROS_SECUNDARIOS = [
  { id: 'DISPONIBLE', label: 'Todos los disponibles' },
  { id: 'NO_DISPONIBLE', label: 'No disponibles' },
  { id: 'VENCE', label: 'Credencial o apto vencen pronto' },
  { id: 'TODOS', label: 'Toda la lista' },
];

export const TEXTO_TODA_LA_BOLSA = 'Ver también eventuales habilitados en otras empresas del grupo';

/** Pasos de la guía. `filtro` = qué mostrar al tocar «Ver». Mismo orden que el motor de candidatos. */
export const PASOS_LISTO = [
  { id: 'CONTACTO', n: 1, titulo: 'Datos de contacto y domicilio', ayuda: 'Mail, teléfono y domicilio: sin eso no recibe la convocatoria ni se calcula la distancia.', filtro: 'FALTA_CONTACTO', accion: 'EDITAR', boton: 'Completar datos' },
  { id: 'MARCO', n: 2, titulo: 'Contrato marco firmado y cargado', ayuda: 'Se imprime, se firma en papel y se sube el escaneo. Vale un año por empresa.', filtro: 'FALTA_MARCO', accion: 'MARCO', boton: 'Cargar marco' },
  { id: 'EMPRESA', n: 3, titulo: 'Empresa habilitada', ayuda: 'Tiene que estar habilitado en la empresa que lo va a convocar.', filtro: 'FALTA_EMPRESA', accion: 'EMPRESA', boton: 'Habilitar' },
  { id: 'VIGENCIAS', n: 4, titulo: 'Credencial, apto y habilitación vigentes', ayuda: 'Credencial y apto psicofísico con fecha de vencimiento vigente, apto en estado APTO y habilitación 9236 sin vencer. Sin fecha, Planificación no lo ofrece.', filtro: 'FALTA_VIGENCIA', accion: 'EDITAR', boton: 'Cargar vencimientos' },
  { id: 'ACCESO', n: 5, titulo: 'Acceso a la app', ayuda: 'Con el acceso acepta convocatorias y firma los anexos desde el celular.', filtro: 'SIN_ACCESO', accion: 'ACCESO', boton: 'Crear acceso' },
  { id: 'HORAS', n: 6, titulo: 'Horas disponibles en el mes', ayuda: 'Cada empresa tiene un tope de horas por mes para el eventual. Dentro del margen del tope no se ofrece; una excepción con motivo lo destraba.', filtro: 'TOPE_HORAS', accion: 'TOPE', boton: 'Ver tope y excepción' },
];

function tieneContacto(f) {
  return !!String(f?.mail || '').trim() && !!String(f?.telefono || '').trim() && !!String(f?.domicilio || '').trim();
}

function habilitadasDe(f) {
  return (Array.isArray(f?.empresasHabilitadas) ? f.empresasHabilitadas : []).map(String).filter(Boolean);
}

const NOMBRE_VIGENCIA = { credencial: 'Credencial', apto: 'Apto psicofísico', habilitacion: 'Habilitación 9236' };

/**
 * Paso «Credencial, apto y habilitación vigentes»: detalle en palabras y el botón que lo resuelve.
 * Credencial y apto bloquean vencidos y sin fecha; la habilitación 9236 solo vencida (igual que el motor).
 */
export function pasoVigencias(ficha, hoy) {
  const faltan = faltantesConvocable(ficha, hoy, '').filter((c) => FALTANTES_VIGENCIA.includes(c.id));
  const vencimientos = vencimientosDe(ficha, hoy);
  const porTipo = Object.fromEntries(vencimientos.map((v) => [v.tipo, v]));
  const problemas = [];
  const sinFecha = [];
  for (const tipo of ['credencial', 'apto']) {
    const v = porTipo[tipo];
    if (v?.estado === 'VENCIDO') problemas.push(`${NOMBRE_VIGENCIA[tipo]} vencid${tipo === 'credencial' ? 'a' : 'o'} el ${fmtFechaAr(v.fecha)}.`);
    else if (v?.estado === 'SIN_DATO') { problemas.push(`${NOMBRE_VIGENCIA[tipo]} sin fecha de vencimiento.`); sinFecha.push(tipo); }
  }
  if (faltan.some((c) => c.id === 'NO_APTO')) problemas.push('El apto psicofísico figura como no apto.');
  if (porTipo.habilitacion?.estado === 'VENCIDO') problemas.push(`Habilitación 9236 vencida el ${fmtFechaAr(porTipo.habilitacion.fecha)}.`);
  const hecho = problemas.length === 0;
  const pronto = vencimientos.filter((v) => v.estado === 'PRONTO');
  let detalle;
  if (hecho) {
    const partes = ['credencial', 'apto'].map((t) => `${t} hasta ${fmtFechaAr(porTipo[t]?.fecha)}`);
    if (porTipo.habilitacion?.estado && porTipo.habilitacion.estado !== 'SIN_DATO') partes.push(`habilitación hasta ${fmtFechaAr(porTipo.habilitacion.fecha)}`);
    detalle = `${partes.join(' · ')}${pronto.length ? ' · vence pronto.' : '.'}`;
    detalle = detalle[0].toUpperCase() + detalle.slice(1);
  } else {
    detalle = problemas.join(' ');
  }
  let boton = 'Cargar vencimientos';
  if (problemas.length === 1) {
    if (sinFecha[0] === 'credencial') boton = 'Cargar vencimiento de credencial';
    else if (sinFecha[0] === 'apto') boton = 'Cargar vencimiento del apto';
    else if (porTipo.credencial?.estado === 'VENCIDO') boton = 'Renovar credencial';
    else if (porTipo.apto?.estado === 'VENCIDO') boton = 'Renovar apto';
    else if (porTipo.habilitacion?.estado === 'VENCIDO') boton = 'Renovar habilitación';
    else boton = 'Corregir apto';
  }
  return { hecho, detalle, boton, aviso: hecho && pronto.length > 0, problemas };
}

/** Paso «Horas disponibles en el mes» a partir de `horasMes` de la empresa activa (null = sin datos). */
export function pasoHoras(horasMes) {
  if (!horasMes) return { hecho: true, detalle: 'Horas del mes: sin datos todavía.' };
  const h = horasMes;
  const texto = h.texto ? `${h.texto}.` : '';
  if (h.alcanzado) return { hecho: false, detalle: `Tope del mes alcanzado${texto ? ` (${h.texto})` : ''}: Planificación no lo ofrece. Una excepción con motivo lo destraba.` };
  if (h.cerca) return { hecho: false, detalle: `Dentro del margen del tope${texto ? ` (${h.texto})` : ''}: Planificación no lo ofrece. Una excepción con motivo lo destraba.` };
  return { hecho: true, detalle: texto || 'Con horas disponibles.', aviso: !!h.aviso };
}

/**
 * Lista de verificación de una ficha para la empresa activa (vacía = cualquier habilitada).
 * Cada paso: `hecho`, `detalle` en palabras y la `accion` que lo resuelve.
 * `horasMes` (opcional) = `{ texto, alcanzado, cerca, aviso }` de la empresa activa.
 */
export function checklistFicha(ficha, hoy, empresaId = '', nombreEmpresa = '', horasMes = null) {
  const exige = exigeMarco(ficha);
  const habilitadas = habilitadasDe(ficha);
  const enEmpresa = empresaId ? habilitadas.includes(empresaId) : habilitadas.length > 0;
  const idsMarco = empresaId ? (enEmpresa ? [empresaId] : []) : habilitadas;
  const marcos = idsMarco.map((id) => marcoDeBolsa(ficha, id, hoy));
  const marcoOk = idsMarco.length > 0 && marcos.every((m) => m.estado === 'MARCO_VIGENTE');
  const marcoVencido = marcos.some((m) => m.estado === 'VENCIDO');
  const marcoVence = marcos.find((m) => m.estado === 'MARCO_VIGENTE' && m.avisar);
  const faltaContacto = ['mail', 'telefono', 'domicilio'].filter((k) => !String(ficha?.[k] || '').trim());
  const empresaTxt = nombreEmpresa || 'la empresa activa';
  return PASOS_LISTO.map((p) => {
    if (p.id === 'CONTACTO') {
      const hecho = tieneContacto(ficha);
      return { ...p, hecho, detalle: hecho ? 'Mail, teléfono y domicilio cargados.' : `Falta ${faltaContacto.map((k) => (k === 'telefono' ? 'teléfono' : k)).join(', ')}.` };
    }
    if (p.id === 'MARCO') {
      let detalle = 'Sin contrato marco firmado.';
      if (!idsMarco.length) detalle = 'Primero habilitá una empresa.';
      else if (marcoOk) detalle = marcoVence ? `Vigente hasta ${fmtFechaAr(marcoVence.vencimiento)} · vence pronto.` : `Vigente hasta ${fmtFechaAr(marcos[0].vencimiento)}.`;
      else if (marcoVencido) detalle = 'Marco vencido: hay que firmar uno nuevo.';
      if (!exige && !marcoOk) return { ...p, hecho: true, detalle: `${ETIQUETA_PRUEBAS_SIN_MARCO}: no se exige. ${detalle}`, aviso: false };
      return { ...p, hecho: marcoOk, detalle, boton: marcoVencido ? 'Renovar marco' : p.boton, aviso: !!marcoVence };
    }
    if (p.id === 'EMPRESA') {
      if (!exige && !enEmpresa) return { ...p, hecho: true, detalle: `${ETIQUETA_PRUEBAS_SIN_MARCO}: no se exige empresa habilitada.` };
      return { ...p, hecho: enEmpresa, detalle: enEmpresa ? (empresaId ? `Habilitado en ${empresaTxt}.` : 'Habilitado en al menos una empresa.') : `No está habilitado en ${empresaTxt}.`, boton: empresaId ? `Habilitar en ${empresaTxt}` : p.boton };
    }
    if (p.id === 'VIGENCIAS') {
      const v = pasoVigencias(ficha, hoy);
      return { ...p, hecho: v.hecho, detalle: v.detalle, boton: v.boton, aviso: v.aviso };
    }
    if (p.id === 'HORAS') {
      const h = pasoHoras(horasMes);
      return { ...p, hecho: h.hecho, detalle: h.detalle, aviso: !!h.aviso };
    }
    const conAcceso = !!String(ficha?.uid || '').trim();
    const sinMail = !String(ficha?.mail || '').trim();
    return { ...p, hecho: conAcceso, detalle: conAcceso ? 'Ya entra a la app.' : (sinMail ? 'Primero cargá el mail: el link de acceso llega ahí.' : 'Todavía no tiene usuario. El link de 48 h le llega al mail.'), deshabilitado: !conAcceso && sinMail };
  });
}

/** Cuántos disponibles del alcance tienen pendiente cada paso. Para la guía del panel derecho. */
export function pasosGuia({ fichas, empresaId = '', todaLaBolsa = false, hoy, horasMes = null }) {
  const disponibles = filtrarFichas({ fichas, empresaId, todaLaBolsa, filtro: 'DISPONIBLE', hoy, horasMes }).length;
  const listos = filtrarFichas({ fichas, empresaId, todaLaBolsa, filtro: 'LISTOS', hoy, horasMes }).length;
  return {
    disponibles,
    listos,
    pasos: PASOS_LISTO.map((p) => ({ ...p, pendientes: filtrarFichas({ fichas, empresaId, todaLaBolsa, filtro: p.filtro, hoy, horasMes }).length })),
  };
}

/** Texto de la línea «n listos de m disponibles». */
export function textoListos({ listos, disponibles }) {
  if (!disponibles) return 'Todavía no hay eventuales disponibles en esta empresa.';
  if (listos === disponibles) return disponibles === 1 ? 'El único disponible está listo para convocar.' : `Los ${disponibles} disponibles están listos para convocar.`;
  return `${listos} de ${disponibles} disponibles ${listos === 1 ? 'está listo' : 'están listos'} para convocar.`;
}

/** Texto del botón de impresión de marcos (barra superior). */
export function textoImprimirMarcos({ seleccionados = 0, pendientes = 0 }) {
  if (seleccionados > 0) return `Imprimir contratos marco (${seleccionados} seleccionados)`;
  return `Imprimir contratos marco (${pendientes})`;
}

export { marcoPorVencer };
