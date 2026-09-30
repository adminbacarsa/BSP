/**
 * Textos y planes de la ficha de RRHH → Eventuales. Sin ids internos y sin Node:
 * lo usan la pantalla y gestionarEventual.
 */
import { normalizeCuil } from './cuil.mjs';
import { GRUPO_EVENTUALES_EMPRESA_IDS } from './grupo.mjs';
import { marcoDeBolsa } from './marcoTexto.mjs';
import { vencimientosDe } from './planificacion.mjs';

const VIGENCIAS = [
  { dias: 365, label: '1 año' },
  { dias: 180, label: '6 meses' },
  { dias: 730, label: '2 años' },
];

export const VIGENCIA_MARCO_DEFAULT = 365;

export function opcionesVigenciaMarco() {
  return VIGENCIAS.map((v) => ({ ...v }));
}

export function fmtFechaAr(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : '';
}

/** Estado del marco para mostrar. Nunca el código (SIN_MARCO, MARCO_VIGENTE). */
export function textoEstadoMarco(estado, vencimiento) {
  if (estado === 'MARCO_VIGENTE') {
    const hasta = fmtFechaAr(vencimiento);
    return { texto: hasta ? `Vigente hasta ${hasta}` : 'Vigente', tono: 'ok' };
  }
  if (estado === 'VENCIDO') return { texto: 'Vencido', tono: 'malo' };
  return { texto: 'Sin contrato marco', tono: 'pendiente' };
}

/**
 * Lo que le falta para poder convocarlo. `empresaId` vacío mira todas las habilitadas.
 * Sin ninguna habilitada el aviso es «Sin empresa habilitada».
 */
export function faltantesConvocable(ficha, hoy, empresaId = '') {
  const chips = [];
  if (!String(ficha?.mail || '').trim()) chips.push({ id: 'MAIL', texto: 'falta mail' });
  if (!String(ficha?.telefono || '').trim()) chips.push({ id: 'TEL', texto: 'falta teléfono' });
  if (!String(ficha?.domicilio || '').trim()) chips.push({ id: 'DOM', texto: 'falta domicilio' });
  const habilitadas = (Array.isArray(ficha?.empresasHabilitadas) ? ficha.empresasHabilitadas : []).map(String).filter(Boolean);
  if (!habilitadas.length) {
    chips.push({ id: 'EMPRESA', texto: 'Sin empresa habilitada' });
  } else {
    const empresas = empresaId ? habilitadas.filter((id) => id === empresaId) : habilitadas;
    const sinMarco = (empresas.length ? empresas : habilitadas).some((id) => marcoDeBolsa(ficha, id, hoy).estado !== 'MARCO_VIGENTE');
    if (sinMarco) chips.push({ id: 'MARCO', texto: 'sin marco' });
  }
  const vencidos = new Set(vencimientosDe(ficha, hoy).filter((v) => v.estado === 'VENCIDO').map((v) => v.tipo));
  if (vencidos.has('credencial')) chips.push({ id: 'CREDENCIAL', texto: 'credencial vencida' });
  if (vencidos.has('apto')) chips.push({ id: 'APTO', texto: 'apto vencido' });
  return chips;
}

export function esIncompleto(ficha, hoy, empresaId = '') {
  return faltantesConvocable(ficha, hoy, empresaId).length > 0;
}

const ALIAS = {
  cuil: 'cuil', cuit: 'cuil',
  mail: 'mail', email: 'mail', correo: 'mail', 'e-mail': 'mail',
  telefono: 'telefono', tel: 'telefono', celular: 'telefono', whatsapp: 'telefono',
  domicilio: 'domicilio', direccion: 'domicilio', dire: 'domicilio',
};

function clave(raw) {
  return String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

/** Una fila de Excel (objeto con encabezados) → { cuil, mail, telefono, domicilio }. Celda vacía = no tocar. */
export function filaContacto(row) {
  const out = { cuil: '', mail: '', telefono: '', domicilio: '' };
  if (!row || typeof row !== 'object') return out;
  for (const [k, v] of Object.entries(row)) {
    const campo = ALIAS[clave(k)];
    if (campo && !out[campo]) out[campo] = String(v ?? '').trim();
  }
  return out;
}

/**
 * Plan de importación de contacto. No escribe.
 * Una celda vacía no pisa el dato que ya está. Mail sin @ no se aplica.
 */
export function planImportContacto(filas, bolsaPorCuil) {
  const bolsa = bolsaPorCuil instanceof Map ? bolsaPorCuil : new Map(Object.entries(bolsaPorCuil || {}));
  const detalle = [];
  for (const raw of filas || []) {
    const fila = filaContacto(raw);
    const cuil = normalizeCuil(fila.cuil);
    if (!cuil) {
      detalle.push({ cuil: String(fila.cuil || ''), ok: false, codigo: 'CUIL_INVALIDO', cambios: {} });
      continue;
    }
    const actual = bolsa.get(cuil);
    if (!actual) {
      detalle.push({ cuil, ok: false, codigo: 'NO_EN_BOLSA', cambios: {} });
      continue;
    }
    const cambios = {};
    let mailInvalido = false;
    if (fila.mail) {
      if (!fila.mail.includes('@')) mailInvalido = true;
      else if (fila.mail.toLowerCase() !== String(actual.mail || '').trim().toLowerCase()) cambios.mail = fila.mail.toLowerCase();
    }
    if (fila.telefono && fila.telefono !== String(actual.telefono || '').trim()) cambios.telefono = fila.telefono;
    if (fila.domicilio && fila.domicilio !== String(actual.domicilio || '').trim()) cambios.domicilio = fila.domicilio;
    const codigo = Object.keys(cambios).length ? 'ACTUALIZAR' : mailInvalido ? 'MAIL_INVALIDO' : 'SIN_CAMBIO';
    detalle.push({ cuil, ok: codigo === 'ACTUALIZAR' || codigo === 'SIN_CAMBIO', codigo, cambios, mailInvalido });
  }
  const contar = (codigo) => detalle.filter((d) => d.codigo === codigo).length;
  return {
    detalle,
    aplicar: detalle.filter((d) => d.codigo === 'ACTUALIZAR'),
    resumen: {
      actualizar: contar('ACTUALIZAR'),
      sinCambio: contar('SIN_CAMBIO'),
      noEnBolsa: contar('NO_EN_BOLSA'),
      cuilInvalido: contar('CUIL_INVALIDO'),
      mailInvalido: detalle.filter((d) => d.mailInvalido).length,
    },
  };
}

/** Ids válidos para habilitar: las empresas de la plataforma si se pasan; si no, las del grupo. */
export function empresasValidas(empresasPlataforma) {
  const ids = (empresasPlataforma || []).map((e) => (typeof e === 'string' ? e : e?.id)).filter(Boolean);
  return ids.length ? ids : GRUPO_EVENTUALES_EMPRESA_IDS;
}

/** Empresas a dejar habilitadas. Reemplaza la lista. */
export function planAsignarEmpresas(empresas, empresasPlataforma) {
  const validas = empresasValidas(empresasPlataforma);
  const empresasHabilitadas = [...new Set((empresas || []).map(String))].filter((id) => validas.includes(id));
  if (!empresasHabilitadas.length) return { ok: false, codigo: 'SIN_EMPRESA' };
  return { ok: true, empresasHabilitadas };
}

/** Habilitar o quitar una empresa de la ficha (guardado inmediato desde la ficha o la lista). */
export function planHabilitarEmpresa(actuales, empresaId, habilitar, empresasPlataforma) {
  const id = String(empresaId || '');
  if (!empresasValidas(empresasPlataforma).includes(id)) return { ok: false, codigo: 'EMPRESA_INVALIDA' };
  const set = new Set((actuales || []).map(String));
  if (habilitar) set.add(id); else set.delete(id);
  return { ok: true, empresasHabilitadas: [...set] };
}

/** Nombre visible de un doc de `empresas`. Nunca el id salvo que no haya nada. */
export function nombreEmpresaDoc(id, data) {
  return String(data?.name || data?.razonSocial || data?.nombre || id || '');
}

/** Empresas de la plataforma para listar: activas, con nombre, ordenadas. */
export function empresasPlataformaDeDocs(docs) {
  return (docs || [])
    .filter((d) => d && d.data?.active !== false && d.data?.status !== 'INACTIVE')
    .map((d) => ({ id: d.id, nombre: nombreEmpresaDoc(d.id, d.data) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Sigla corta para el mini-badge de empresa: «Bacar SA» → BA, «Grupo Bacar sa.» → GB. */
export function siglaEmpresa(nombre) {
  const palabras = String(nombre || '').replace(/[.,]/g, ' ').split(/\s+/).filter((p) => p && !/^(sa|srl|s\.a\.?|s\.r\.l\.?|de|del|la|el|y)$/i.test(p));
  if (!palabras.length) return '??';
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return (palabras[0][0] + palabras[1][0]).toUpperCase();
}

export function iniciales(nombre) {
  const limpio = String(nombre || '').trim();
  if (!limpio) return '?';
  const partes = limpio.includes(',') ? limpio.split(',').map((p) => p.trim()).reverse() : limpio.split(/\s+/);
  const letras = partes.filter(Boolean).map((p) => p[0]);
  return (letras.length >= 2 ? letras[0] + letras[letras.length - 1] : letras[0] || '?').toUpperCase();
}

const DISPONIBILIDAD = { DISPONIBLE: 'Disponible', NO_DISPONIBLE: 'No disponible' };

export function textoDisponibilidad(codigo) {
  return DISPONIBILIDAD[codigo] || humanizar(codigo);
}

/** ALTA_ARCA_PENDIENTE → «Alta arca pendiente». Para estados que no tienen texto propio. */
export function humanizar(codigo) {
  const txt = String(codigo || '').replace(/_/g, ' ').toLowerCase().trim();
  return txt ? txt[0].toUpperCase() + txt.slice(1) : '—';
}

export const FILTROS_LISTA = [
  { id: 'DISPONIBLE', label: 'Disponibles' },
  { id: 'NO_DISPONIBLE', label: 'No disponibles' },
  { id: 'VENCE', label: 'Vencen pronto' },
  { id: 'INCOMPLETOS', label: 'Incompletos' },
  { id: 'TODOS', label: 'Todos' },
];

function venceProntoFicha(f, hoy) {
  return vencimientosDe(f, hoy).some((v) => v.estado === 'PRONTO');
}

/**
 * Alcance + filtro + búsqueda de la lista.
 * `todaLaBolsa=false` → solo habilitados en `empresaId`. Incompletos mira lo que falta para esa empresa.
 */
export function filtrarFichas({ fichas, empresaId = '', todaLaBolsa = false, filtro = 'DISPONIBLE', buscar = '', hoy }) {
  const q = String(buscar || '').trim().toLowerCase();
  const alcance = (fichas || []).filter((f) => todaLaBolsa || !empresaId || (f.empresasHabilitadas || []).includes(empresaId));
  const porFiltro = alcance.filter((f) => {
    if (filtro === 'DISPONIBLE') return f.disponibilidad !== 'NO_DISPONIBLE';
    if (filtro === 'NO_DISPONIBLE') return f.disponibilidad === 'NO_DISPONIBLE';
    if (filtro === 'VENCE') return venceProntoFicha(f, hoy);
    if (filtro === 'INCOMPLETOS') return esIncompleto(f, hoy, todaLaBolsa ? '' : empresaId);
    return true;
  });
  if (!q) return porFiltro;
  return porFiltro.filter((f) => `${f.nombre || ''} ${f.id || ''} ${f.cuil || ''} ${f.dni || ''}`.toLowerCase().includes(q));
}

export function contadoresFiltros({ fichas, empresaId = '', todaLaBolsa = false, hoy }) {
  const out = {};
  for (const f of FILTROS_LISTA) out[f.id] = filtrarFichas({ fichas, empresaId, todaLaBolsa, filtro: f.id, hoy }).length;
  return out;
}

/** Obra social para mostrar en Datos: propia o la SUVICO por defecto. */
export function textoObraSocial(rnosPropio, rnosDefault) {
  const propio = String(rnosPropio || '').replace(/\D/g, '');
  if (propio) return `${propio}`;
  return `${rnosDefault} SUVICO (por defecto)`;
}
