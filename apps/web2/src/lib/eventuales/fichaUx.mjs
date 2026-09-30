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

/** Empresas a dejar habilitadas. Reemplaza la lista; solo ids del grupo. */
export function planAsignarEmpresas(empresas) {
  const empresasHabilitadas = [...new Set((empresas || []).map(String))].filter((id) => GRUPO_EVENTUALES_EMPRESA_IDS.includes(id));
  if (!empresasHabilitadas.length) return { ok: false, codigo: 'SIN_EMPRESA' };
  return { ok: true, empresasHabilitadas };
}
