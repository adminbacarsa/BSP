/**
 * Pantalla Eventuales de escritorio: estado en palabras de cada fila, tarjetas-resumen,
 * guía «Cómo dejar listo a un eventual» y lista de verificación de la ficha.
 * Solo lectura sobre la ficha de la bolsa: no cambia qué es convocable (eso sigue en `faltantesConvocable`).
 */
import { faltantesConvocable, filtrarFichas, fmtFechaAr, marcoPorVencer } from './fichaUx.mjs';
import { marcoDeBolsa } from './marcoTexto.mjs';
import { ETIQUETA_PRUEBAS_SIN_MARCO, exigeMarco } from './pruebasSwitch.mjs';

/** Lo que falta, en palabras cortas para la fila. */
export const PALABRA_FALTA = {
  MAIL: 'mail',
  TEL: 'teléfono',
  DOM: 'domicilio',
  EMPRESA: 'empresa habilitada',
  MARCO: 'contrato marco',
  CREDENCIAL: 'credencial vigente',
  APTO: 'apto vigente',
};

export const TEXTO_LISTO = 'Listo para convocar';
export const TEXTO_NO_DISPONIBLE = 'No disponible';
export const TOOLTIP_PRUEBAS = 'Switch de pruebas: se lo puede convocar sin contrato marco vigente ni empresa habilitada.';

/**
 * UN estado por fila. `tono`: 'ok' (verde) | 'falta' (ámbar) | 'baja' (gris).
 * `faltan` son los ids de `faltantesConvocable`, para quien quiera armar el detalle.
 */
export function estadoFila(ficha, hoy, empresaId = '') {
  if (ficha?.disponibilidad === 'NO_DISPONIBLE') return { tono: 'baja', texto: TEXTO_NO_DISPONIBLE, faltan: [] };
  const faltan = faltantesConvocable(ficha, hoy, empresaId).map((c) => c.id);
  if (!faltan.length) return { tono: 'ok', texto: TEXTO_LISTO, faltan };
  return { tono: 'falta', texto: `Falta: ${faltan.map((id) => PALABRA_FALTA[id] || id.toLowerCase()).join(', ')}`, faltan };
}

/** Chip gris «Pruebas: sin exigir marco» (antes era una sigla suelta). Null si exige marco. */
export function chipPruebas(ficha) {
  if (exigeMarco(ficha)) return null;
  return { texto: ETIQUETA_PRUEBAS_SIN_MARCO, tooltip: TOOLTIP_PRUEBAS };
}

export const TARJETAS_RESUMEN = [
  { id: 'LISTOS', titulo: 'Listos para convocar', ayuda: 'Disponibles con contacto, domicilio, empresa, contrato marco, credencial y apto al día.', tono: 'ok' },
  { id: 'FALTA', titulo: 'Les falta algo', ayuda: 'Disponibles a los que les falta algún dato o documento para convocarlos.', tono: 'falta' },
  { id: 'MARCO_VENCE', titulo: 'Contrato marco por vencer', ayuda: 'Marco vigente que vence en menos de 30 días.', tono: 'aviso' },
  { id: 'ARCA', titulo: 'ARCA pendientes', ayuda: 'Altas y bajas sin número de transacción, y anulaciones por acusar.', tono: 'arca' },
];

/** Cantidades de las 4 tarjetas. `arcaPendientes` llega del servidor (`gestionarEventual arcaPendientes`). */
export function resumenBolsa({ fichas, empresaId = '', todaLaBolsa = false, hoy, arcaPendientes = null }) {
  const contar = (filtro) => filtrarFichas({ fichas, empresaId, todaLaBolsa, filtro, hoy }).length;
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

/** Pasos de la guía. `filtro` = qué mostrar al tocar «Ver». */
export const PASOS_LISTO = [
  { id: 'CONTACTO', n: 1, titulo: 'Datos de contacto y domicilio', ayuda: 'Mail, teléfono y domicilio: sin eso no recibe la convocatoria ni se calcula la distancia.', filtro: 'FALTA_CONTACTO', accion: 'EDITAR', boton: 'Completar datos' },
  { id: 'MARCO', n: 2, titulo: 'Contrato marco firmado y cargado', ayuda: 'Se imprime, se firma en papel y se sube el escaneo. Vale un año por empresa.', filtro: 'FALTA_MARCO', accion: 'MARCO', boton: 'Cargar marco' },
  { id: 'EMPRESA', n: 3, titulo: 'Empresa habilitada', ayuda: 'Tiene que estar habilitado en la empresa que lo va a convocar.', filtro: 'FALTA_EMPRESA', accion: 'EMPRESA', boton: 'Habilitar' },
  { id: 'ACCESO', n: 4, titulo: 'Acceso a la app', ayuda: 'Con el acceso acepta convocatorias y firma los anexos desde el celular.', filtro: 'SIN_ACCESO', accion: 'ACCESO', boton: 'Crear acceso' },
];

function tieneContacto(f) {
  return !!String(f?.mail || '').trim() && !!String(f?.telefono || '').trim() && !!String(f?.domicilio || '').trim();
}

function habilitadasDe(f) {
  return (Array.isArray(f?.empresasHabilitadas) ? f.empresasHabilitadas : []).map(String).filter(Boolean);
}

/**
 * Lista de verificación de una ficha para la empresa activa (vacía = cualquier habilitada).
 * Cada paso: `hecho`, `detalle` en palabras y la `accion` que lo resuelve.
 */
export function checklistFicha(ficha, hoy, empresaId = '', nombreEmpresa = '') {
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
      return { ...p, hecho: marcoOk, detalle, boton: marcoVencido ? 'Renovar marco' : p.boton, aviso: !!marcoVence };
    }
    if (p.id === 'EMPRESA') {
      return { ...p, hecho: enEmpresa, detalle: enEmpresa ? (empresaId ? `Habilitado en ${empresaTxt}.` : 'Habilitado en al menos una empresa.') : `No está habilitado en ${empresaTxt}.`, boton: empresaId ? `Habilitar en ${empresaTxt}` : p.boton };
    }
    const conAcceso = !!String(ficha?.uid || '').trim();
    const sinMail = !String(ficha?.mail || '').trim();
    return { ...p, hecho: conAcceso, detalle: conAcceso ? 'Ya entra a la app.' : (sinMail ? 'Primero cargá el mail: el link de acceso llega ahí.' : 'Todavía no tiene usuario. El link de 48 h le llega al mail.'), deshabilitado: !conAcceso && sinMail };
  });
}

/** Cuántos disponibles del alcance tienen pendiente cada paso. Para la guía del panel derecho. */
export function pasosGuia({ fichas, empresaId = '', todaLaBolsa = false, hoy }) {
  const disponibles = filtrarFichas({ fichas, empresaId, todaLaBolsa, filtro: 'DISPONIBLE', hoy }).length;
  const listos = filtrarFichas({ fichas, empresaId, todaLaBolsa, filtro: 'LISTOS', hoy }).length;
  return {
    disponibles,
    listos,
    pasos: PASOS_LISTO.map((p) => ({ ...p, pendientes: filtrarFichas({ fichas, empresaId, todaLaBolsa, filtro: p.filtro, hoy }).length })),
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
