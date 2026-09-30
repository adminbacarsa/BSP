/**
 * Textos y planes de la ficha de RRHH → Eventuales. Sin ids internos y sin Node:
 * lo usan la pantalla y gestionarEventual.
 */
import { normalizeCuil } from './cuil.mjs';
import { GRUPO_EVENTUALES_EMPRESA_IDS, GRUPO_EVENTUALES_ID } from './grupo.mjs';
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

const CAMPOS_NOMINA = ['cuil', 'nombre', 'dni', 'legajo', 'ingreso', 'mail', 'telefono', 'domicilio', 'localidad', 'rnos', 'empresas', 'credencial', 'apto', 'observaciones'];

/** Encabezados de la plantilla, en este orden. El paréntesis le dice al que carga qué va. */
export const ENCABEZADOS_NOMINA = [
  'LEGAJO',
  'APELLIDO Y NOMBRE',
  'CUIL',
  'DNI',
  'FECHA 1º INGRESO (dd/mm/aaaa)',
  'MAIL',
  'TELÉFONO',
  'DOMICILIO',
  'LOCALIDAD',
  'OBRA SOCIAL RNOS (vacío = 122807 SUVICO)',
  'EMPRESAS HABILITADAS (nombres separados por coma)',
  'CREDENCIAL VENCE',
  'APTO VENCE',
  'OBSERVACIONES',
];

const CAMPO_DE_ENCABEZADO = {
  LEGAJO: 'legajo',
  'APELLIDO Y NOMBRE': 'nombre',
  CUIL: 'cuil',
  DNI: 'dni',
  'FECHA 1º INGRESO (dd/mm/aaaa)': 'ingreso',
  MAIL: 'mail',
  'TELÉFONO': 'telefono',
  DOMICILIO: 'domicilio',
  LOCALIDAD: 'localidad',
  'OBRA SOCIAL RNOS (vacío = 122807 SUVICO)': 'rnos',
  'EMPRESAS HABILITADAS (nombres separados por coma)': 'empresas',
  'CREDENCIAL VENCE': 'credencial',
  'APTO VENCE': 'apto',
  OBSERVACIONES: 'observaciones',
};

/** Fila de ejemplo de la plantilla. CUIL de prueba, no es una persona real. */
export const EJEMPLO_NOMINA = {
  LEGAJO: '1001',
  'APELLIDO Y NOMBRE': 'PEREZ, ANA',
  CUIL: '20-11111111-2',
  DNI: '11111111',
  'FECHA 1º INGRESO (dd/mm/aaaa)': '15/02/2024',
  MAIL: 'ana.perez@ejemplo.com',
  'TELÉFONO': '3515550000',
  DOMICILIO: 'Calle Falsa 123',
  LOCALIDAD: 'Córdoba',
  'OBRA SOCIAL RNOS (vacío = 122807 SUVICO)': '',
  'EMPRESAS HABILITADAS (nombres separados por coma)': 'Bacar SA, Grupo Bacar sa.',
  'CREDENCIAL VENCE': '01/03/2027',
  'APTO VENCE': '01/06/2027',
  OBSERVACIONES: 'Fila de ejemplo: se puede borrar',
};

const INSTRUCCIONES_NOMINA = [
  ['Columna', 'Qué va'],
  ['LEGAJO', 'Número de legajo de la planilla. Si todavía no tiene, escribí PENDIENTE: en la ficha se ve «Legajo pendiente».'],
  ['APELLIDO Y NOMBRE', 'Apellido y nombre, como en el legajo. Obligatorio si la persona no está en la bolsa.'],
  ['CUIL', 'Con o sin guiones. Si no cierra el dígito verificador, la fila queda en error y no se escribe.'],
  ['DNI', 'Solo el número. Vacío no borra el DNI que ya está cargado.'],
  ['FECHA 1º INGRESO (dd/mm/aaaa)', 'Día/mes/año. Es el primer ingreso del eventual. Vacío no pisa la fecha que ya tiene.'],
  ['MAIL', 'Correo, con @. Vacío no borra el mail. Sin @ la fila queda en error.'],
  ['TELÉFONO', 'Celular o teléfono. Vacío no borra el que ya está.'],
  ['DOMICILIO', 'Calle y número. Vacío no borra el domicilio.'],
  ['LOCALIDAD', 'Ciudad o localidad. Vacío no borra la que ya está.'],
  ['OBRA SOCIAL RNOS (vacío = 122807 SUVICO)', 'Código RNOS de 6 dígitos. Si lo dejás vacío se usa 122807 (SUVICO) y no se pisa un RNOS ya cargado.'],
  ['EMPRESAS HABILITADAS (nombres separados por coma)', 'Nombres de las empresas de la plataforma, separados por coma (Bacar SA, Grupo Bacar sa.). Un nombre que no existe deja la fila en error. Vacío no quita las empresas que ya tiene. Nunca saca una empresa: solo agrega.'],
  ['CREDENCIAL VENCE', 'Vencimiento de la credencial, dd/mm/aaaa. Vacío no borra la fecha.'],
  ['APTO VENCE', 'Vencimiento del apto psicofísico, dd/mm/aaaa. Vacío no borra la fecha.'],
  ['OBSERVACIONES', 'Nota libre. Vacío no borra la observación.'],
  ['Cómo se aplica', 'Primero ves cada fila: nuevo, actualiza o error (CUIL inválido, duplicado en el archivo, planta permanente, empresa desconocida). Nada se escribe hasta Aplicar. No se borra una ficha ni se pisa un dato con una celda vacía.'],
];

export function plantillaNomina() {
  return {
    hoja: 'Nómina',
    encabezados: ENCABEZADOS_NOMINA.slice(),
    ejemplo: { ...EJEMPLO_NOMINA },
    instrucciones: INSTRUCCIONES_NOMINA.map((fila) => fila.slice()),
  };
}

const ALIAS = {
  cuil: 'cuil', cuit: 'cuil',
  mail: 'mail', email: 'mail', correo: 'mail',
  telefono: 'telefono', tel: 'telefono', celular: 'telefono', whatsapp: 'telefono',
  domicilio: 'domicilio', direccion: 'domicilio', dire: 'domicilio',
  localidad: 'localidad',
  dni: 'dni',
  legajo: 'legajo',
  apellidoynombre: 'nombre', nombre: 'nombre',
  observaciones: 'observaciones', observacion: 'observaciones',
  credencialvence: 'credencial',
  aptovence: 'apto',
};

function clave(raw) {
  return String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

for (const [encabezado, campo] of Object.entries(CAMPO_DE_ENCABEZADO)) ALIAS[clave(encabezado)] = campo;

function celda(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = String(value.getDate()).padStart(2, '0');
    const m = String(value.getMonth() + 1).padStart(2, '0');
    return `${d}/${m}/${value.getFullYear()}`;
  }
  return String(value ?? '').trim();
}

/** Una fila de Excel → campos de la nómina. Celda vacía queda en ''. */
export function filaNomina(row) {
  const out = Object.fromEntries(CAMPOS_NOMINA.map((c) => [c, '']));
  if (!row || typeof row !== 'object') return out;
  for (const [k, v] of Object.entries(row)) {
    const campo = ALIAS[clave(k)];
    if (campo && !out[campo]) out[campo] = celda(v);
  }
  return out;
}

/** Compatibilidad: las columnas viejas de contacto siguen leyéndose. */
export function filaContacto(row) {
  const fila = filaNomina(row);
  return { cuil: fila.cuil, mail: fila.mail, telefono: fila.telefono, domicilio: fila.domicilio };
}

/** dd/mm/aaaa o aaaa-mm-dd. '' si está vacía; null si no se puede leer. */
export function fechaNomina(raw) {
  const s = celda(raw);
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  const y = iso ? iso[1] : dmy ? dmy[3] : '';
  const m = iso ? iso[2] : dmy ? dmy[2].padStart(2, '0') : '';
  const d = iso ? iso[3] : dmy ? dmy[1].padStart(2, '0') : '';
  if (!y) return null;
  const armada = `${y}-${m}-${d}`;
  const dt = new Date(`${armada}T00:00:00Z`);
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() + 1 !== Number(m) || dt.getUTCDate() !== Number(d)) return null;
  return armada;
}

function normNombre(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function catalogoEmpresas(ctx) {
  const lista = Array.isArray(ctx?.empresas) ? ctx.empresas : [];
  if (lista.length) {
    return lista.map((e) => (typeof e === 'string' ? { id: e, nombre: e } : { id: String(e?.id || ''), nombre: String(e?.nombre || e?.id || '') })).filter((e) => e.id);
  }
  return GRUPO_EVENTUALES_EMPRESA_IDS.map((id) => ({ id, nombre: id }));
}

/** Nombres separados por coma → ids. Vacío = no tocar. Nombre que no existe = error. */
export function resolverEmpresasNomina(texto, empresas) {
  const partes = String(texto || '').split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  if (!partes.length) return { ok: true, ids: null };
  const ids = [];
  const desconocidas = [];
  for (const parte of partes) {
    const claveParte = normNombre(parte);
    const hit = (empresas || []).find((e) => e.id === parte || normNombre(e.nombre) === claveParte || normNombre(e.id) === claveParte);
    if (!hit) desconocidas.push(parte);
    else if (!ids.includes(hit.id)) ids.push(hit.id);
  }
  if (desconocidas.length) return { ok: false, desconocidas };
  return { ok: true, ids };
}

function distinto(actual, nuevo) {
  return String(actual ?? '').trim() !== String(nuevo ?? '').trim();
}

/**
 * Plan de la nómina. No escribe.
 * Celda vacía no pisa. No borra empresas: si la celda trae nombres, se suman.
 * Errores: CUIL inválido, duplicado en el archivo, planta permanente, empresa desconocida.
 */
export function planImportNomina(filas, bolsaPorCuil, ctx = {}) {
  const bolsa = bolsaPorCuil instanceof Map ? bolsaPorCuil : new Map(Object.entries(bolsaPorCuil || {}));
  const empresas = catalogoEmpresas(ctx);
  const planta = new Set((ctx.plantaCuils || ctx.planta || []).map((c) => normalizeCuil(c) || String(c || '').replace(/\D/g, '')));
  const detalle = [];
  const vistos = new Set();
  for (const raw of filas || []) {
    const fila = filaNomina(raw);
    const cuil = normalizeCuil(fila.cuil);
    if (!cuil) {
      detalle.push({ cuil: String(fila.cuil || '').trim(), nombre: fila.nombre, ok: false, codigo: 'CUIL_INVALIDO', doc: {} });
      continue;
    }
    if (vistos.has(cuil)) {
      detalle.push({ cuil, nombre: fila.nombre, ok: false, codigo: 'DUPLICADO', doc: {} });
      continue;
    }
    vistos.add(cuil);
    if (planta.has(cuil)) {
      detalle.push({ cuil, nombre: fila.nombre, ok: false, codigo: 'PLANTA_PERMANENTE', doc: {} });
      continue;
    }
    const empresasFila = resolverEmpresasNomina(fila.empresas, empresas);
    if (!empresasFila.ok) {
      detalle.push({ cuil, nombre: fila.nombre, ok: false, codigo: 'EMPRESA_DESCONOCIDA', motivo: empresasFila.desconocidas.join(', '), doc: {} });
      continue;
    }
    const ingreso = fechaNomina(fila.ingreso);
    const credencial = fechaNomina(fila.credencial);
    const apto = fechaNomina(fila.apto);
    if (ingreso === null || credencial === null || apto === null) {
      detalle.push({ cuil, nombre: fila.nombre, ok: false, codigo: 'FECHA_INVALIDA', doc: {} });
      continue;
    }
    if (fila.mail && !fila.mail.includes('@')) {
      detalle.push({ cuil, nombre: fila.nombre, ok: false, codigo: 'MAIL_INVALIDO', doc: {} });
      continue;
    }
    const actual = bolsa.get(cuil);
    const doc = {};
    const poner = (key, value) => { if (value) doc[key] = value; };
    if (!actual) {
      if (!fila.nombre) {
        detalle.push({ cuil, nombre: '', ok: false, codigo: 'SIN_NOMBRE', doc: {} });
        continue;
      }
      doc.grupoId = GRUPO_EVENTUALES_ID;
      doc.cuil = cuil;
      doc.nombre = fila.nombre;
      doc.disponibilidad = 'DISPONIBLE';
      poner('dni', fila.dni);
      poner('legajoPlanilla', fila.legajo);
      poner('primerIngreso', ingreso);
      poner('mail', fila.mail.toLowerCase());
      poner('telefono', fila.telefono);
      poner('domicilio', fila.domicilio);
      poner('localidad', fila.localidad);
      poner('obraSocialRnos', fila.rnos.replace(/\D/g, ''));
      poner('credencialVencimiento', credencial);
      if (apto) doc.aptoPsicofisico = { vencimiento: apto };
      poner('observaciones', fila.observaciones);
      if (empresasFila.ids) doc.empresasHabilitadas = empresasFila.ids;
      detalle.push({ cuil, nombre: fila.nombre, ok: true, codigo: 'NUEVO', doc });
      continue;
    }
    if (fila.nombre && distinto(actual.nombre, fila.nombre)) doc.nombre = fila.nombre;
    if (fila.dni && distinto(actual.dni, fila.dni)) doc.dni = fila.dni;
    if (fila.legajo && distinto(actual.legajoPlanilla, fila.legajo)) doc.legajoPlanilla = fila.legajo;
    if (ingreso && distinto(actual.primerIngreso, ingreso)) doc.primerIngreso = ingreso;
    if (fila.mail && distinto(String(actual.mail || '').toLowerCase(), fila.mail.toLowerCase())) doc.mail = fila.mail.toLowerCase();
    if (fila.telefono && distinto(actual.telefono, fila.telefono)) doc.telefono = fila.telefono;
    if (fila.domicilio && distinto(actual.domicilio, fila.domicilio)) doc.domicilio = fila.domicilio;
    if (fila.localidad && distinto(actual.localidad, fila.localidad)) doc.localidad = fila.localidad;
    const rnos = fila.rnos.replace(/\D/g, '');
    if (rnos && distinto(String(actual.obraSocialRnos || '').replace(/\D/g, ''), rnos)) doc.obraSocialRnos = rnos;
    if (credencial && distinto(actual.credencialVencimiento, credencial)) doc.credencialVencimiento = credencial;
    if (apto && distinto(actual.aptoPsicofisico?.vencimiento, apto)) {
      doc.aptoPsicofisico = { ...(actual.aptoPsicofisico || {}), vencimiento: apto };
    }
    if (fila.observaciones && distinto(actual.observaciones, fila.observaciones)) doc.observaciones = fila.observaciones;
    if (empresasFila.ids) {
      const unidas = [...new Set([...(actual.empresasHabilitadas || []).map(String), ...empresasFila.ids])];
      const antes = [...(actual.empresasHabilitadas || [])].map(String).sort().join(',');
      if (unidas.slice().sort().join(',') !== antes) doc.empresasHabilitadas = unidas;
    }
    const codigo = Object.keys(doc).length ? 'ACTUALIZAR' : 'SIN_CAMBIO';
    detalle.push({ cuil, nombre: fila.nombre || actual.nombre || '', ok: true, codigo, doc });
  }
  const contar = (codigo) => detalle.filter((d) => d.codigo === codigo).length;
  return {
    detalle,
    aplicar: detalle.filter((d) => d.codigo === 'NUEVO' || d.codigo === 'ACTUALIZAR'),
    resumen: {
      nuevo: contar('NUEVO'),
      actualizar: contar('ACTUALIZAR'),
      sinCambio: contar('SIN_CAMBIO'),
      cuilInvalido: contar('CUIL_INVALIDO'),
      duplicado: contar('DUPLICADO'),
      planta: contar('PLANTA_PERMANENTE'),
      empresaDesconocida: contar('EMPRESA_DESCONOCIDA'),
      mailInvalido: contar('MAIL_INVALIDO'),
      sinNombre: contar('SIN_NOMBRE'),
      fechaInvalida: contar('FECHA_INVALIDA'),
    },
  };
}

/** El import de contacto quedó adentro de la nómina. */
export function planImportContacto(filas, bolsaPorCuil, ctx) {
  return planImportNomina(filas, bolsaPorCuil, ctx);
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

/** Legajo de la planilla. PENDIENTE se lee «Legajo pendiente»; vacío no muestra nada. */
export function textoLegajo(legajo) {
  const s = String(legajo || '').trim();
  if (!s) return '';
  if (s.toUpperCase() === 'PENDIENTE') return 'Legajo pendiente';
  return `Legajo ${s}`;
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
  return porFiltro.filter((f) => `${f.nombre || ''} ${f.id || ''} ${f.cuil || ''} ${f.dni || ''} ${f.legajoPlanilla || ''}`.toLowerCase().includes(q));
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
