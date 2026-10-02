/**
 * Cupo por género en servicios de eventos.
 *
 * Un servicio tiene cupo «Indistinto» (N pax, como siempre) o «Por género» (N hombres + M mujeres,
 * total = suma). El cupo se llena POR ORDEN DE ACEPTACIÓN dentro de cada grupo: se puede convocar a
 * más gente que el cupo; quedan confirmados los primeros que aceptan (o las asignaciones directas,
 * que cuentan al momento). Cuando un grupo se llena, las convocatorias pendientes de ese grupo se
 * cierran como «Cupo completo».
 *
 * Lógica pura, sin Firestore. La usan el formulario del servicio, el modal de convocatoria
 * (Nómina y Eventuales), el estado/cronograma y, en el servidor (copia por sync), la transacción
 * de aceptación y la cascada del hueco.
 *
 * Género: 'M' | 'F' | '' (sin especificar), igual que `genderPreference.ts` del legajo.
 */

export const CUPO_MODO_INDISTINTO = 'INDISTINTO';
export const CUPO_MODO_POR_GENERO = 'POR_GENERO';
export const CUPO_MODOS = [CUPO_MODO_INDISTINTO, CUPO_MODO_POR_GENERO];

export const GRUPO_TODOS = 'TODOS';
export const GRUPOS_GENERO = ['M', 'F'];
export const GRUPO_LABEL = { TODOS: 'Cupo', M: 'Hombres', F: 'Mujeres' };
export const GRUPO_LABEL_CORTO = { TODOS: 'pax', M: 'H', F: 'M' };
export const GENERO_LABEL = { M: 'Masculino', F: 'Femenino', '': 'Sin especificar' };

/** Estado de `solicitudes_evento` cuando el grupo se llenó antes de que respondiera. */
export const STATUS_CUPO_COMPLETO = 'cupo_completo';
export const MENSAJE_CUPO_COMPLETO = 'Ya se cubrió el cupo, gracias.';
export const TITULO_CUPO_COMPLETO = 'Cupo completo';
/** Tipo de `user_notifications` para la app del guardia / eventual. */
export const NOTIF_CUPO_COMPLETO = 'EVENTO_CUPO_COMPLETO';

export const CUPO_MOTIVOS = {
  CUPO_COMPLETO: MENSAJE_CUPO_COMPLETO,
  GENERO_SIN_ESPECIFICAR: 'El servicio tiene cupo por género y la persona no tiene el género cargado. Completá el legajo o la ficha.',
  GENERO_NO_COINCIDE: 'El hueco es de otro grupo (género).',
};

/** 'M' | 'F' | ''. Acepta variantes de importación (H, hombre, masculino, mujer, femenino…). */
export function normalizarGenero(valor) {
  const v = String(valor ?? '').trim().toUpperCase();
  if (!v) return '';
  if (v === 'M' || v === 'H' || v.startsWith('MASC') || v.startsWith('HOM') || v === 'VARON' || v === 'VARÓN' || v === 'MALE') return 'M';
  if (v === 'F' || v.startsWith('FEM') || v.startsWith('MUJ') || v === 'FEMALE') return 'F';
  return '';
}

function entero(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function esPorGenero(servicio) {
  return String(servicio?.cupoModo || '').toUpperCase() === CUPO_MODO_POR_GENERO;
}

/**
 * Normaliza la configuración de cupo de un servicio para guardar: `cupo` siempre es el total.
 * Por género: `cupoPorGenero: { M, F }` y `cupo = M + F`. Indistinto: `cupoPorGenero: null`.
 */
export function normalizarCupoServicio(servicio) {
  if (esPorGenero(servicio)) {
    const pg = servicio?.cupoPorGenero || {};
    const M = entero(pg.M ?? servicio?.cupoM);
    const F = entero(pg.F ?? servicio?.cupoF);
    return { cupoModo: CUPO_MODO_POR_GENERO, cupo: M + F, cupoPorGenero: { M, F } };
  }
  return { cupoModo: CUPO_MODO_INDISTINTO, cupo: entero(servicio?.cupo), cupoPorGenero: null };
}

/** `[]` de errores para el formulario (vacío = válido). */
export function validarCupoServicio(servicio) {
  const n = normalizarCupoServicio(servicio);
  const errores = [];
  if (n.cupoModo === CUPO_MODO_POR_GENERO) {
    if (n.cupo <= 0) errores.push('Cargá al menos un cupo (hombres o mujeres).');
  } else if (n.cupo <= 0) {
    errores.push('El cupo tiene que ser mayor a 0.');
  }
  return errores;
}

/** Grupos de cupo del servicio: uno (TODOS) o dos (M, F). */
export function cuposDeServicio(servicio) {
  const n = normalizarCupoServicio(servicio);
  if (n.cupoModo === CUPO_MODO_POR_GENERO) {
    return GRUPOS_GENERO.map((g) => ({ grupo: g, label: GRUPO_LABEL[g], cupo: n.cupoPorGenero[g] }));
  }
  return [{ grupo: GRUPO_TODOS, label: GRUPO_LABEL.TODOS, cupo: n.cupo }];
}

/** Grupo de cupo al que aporta una persona con ese género. `null` = sin especificar en un servicio por género. */
export function grupoDeGenero(servicio, genero) {
  if (!esPorGenero(servicio)) return GRUPO_TODOS;
  const g = normalizarGenero(genero);
  return g === 'M' || g === 'F' ? g : null;
}

/**
 * Grupo de un ítem ya confirmado (solicitud o turno). Usa `cupoGrupo` si el servicio sigue siendo
 * por género y el grupo es M/F; si no, resuelve por `genero`.
 */
export function grupoDeItem(servicio, item) {
  if (!esPorGenero(servicio)) return GRUPO_TODOS;
  const cg = String(item?.cupoGrupo || '').toUpperCase();
  if (cg === 'M' || cg === 'F') return cg;
  return grupoDeGenero(servicio, item?.genero);
}

/** «35 pax» / «20 H · 15 M (35)». */
export function textoCupoServicio(servicio) {
  const n = normalizarCupoServicio(servicio);
  if (n.cupoModo === CUPO_MODO_POR_GENERO) return `${n.cupoPorGenero.M} H · ${n.cupoPorGenero.F} M (${n.cupo})`;
  return `${n.cupo} pax`;
}

/**
 * Ocupación por grupo. `ocupados` = personas confirmadas (`{ genero?, cupoGrupo? }`); las que no
 * caen en ningún grupo (sin especificar en servicio por género) no cuentan.
 */
export function estadoCupo(servicio, ocupados = []) {
  const grupos = cuposDeServicio(servicio).map((g) => ({ ...g, ocupados: 0, disponibles: g.cupo, completo: g.cupo <= 0 }));
  const porGrupo = new Map(grupos.map((g) => [g.grupo, g]));
  let sinGrupo = 0;
  for (const item of ocupados || []) {
    const g = grupoDeItem(servicio, item);
    const row = g ? porGrupo.get(g) : null;
    if (!row) { sinGrupo += 1; continue; }
    row.ocupados += 1;
  }
  for (const g of grupos) {
    g.disponibles = Math.max(0, g.cupo - g.ocupados);
    g.completo = g.ocupados >= g.cupo;
  }
  const cupo = grupos.reduce((a, g) => a + g.cupo, 0);
  const total = grupos.reduce((a, g) => a + g.ocupados, 0);
  return { grupos, cupo, ocupados: total, sinGrupo, completo: grupos.every((g) => g.completo) };
}

/** Grupo completo según el estado: lleno. */
export function grupoCompleto(estado, grupo) {
  const g = (estado?.grupos || []).find((x) => x.grupo === grupo);
  return !!g && g.completo;
}

/**
 * ¿Puede confirmarse (aceptar / asignar) una persona de ese género? Es la regla que corre la
 * transacción del servidor. `ocupados` NO debe incluir a la persona que se está evaluando.
 */
export function puedeConfirmar(servicio, ocupados, genero) {
  const grupo = grupoDeGenero(servicio, genero);
  if (!grupo) return { ok: false, grupo: null, motivo: 'GENERO_SIN_ESPECIFICAR', mensaje: CUPO_MOTIVOS.GENERO_SIN_ESPECIFICAR, ocupados: 0, cupo: 0 };
  const estado = estadoCupo(servicio, ocupados);
  const g = estado.grupos.find((x) => x.grupo === grupo);
  if (!g || g.completo) {
    return { ok: false, grupo, motivo: 'CUPO_COMPLETO', mensaje: MENSAJE_CUPO_COMPLETO, ocupados: g?.ocupados ?? 0, cupo: g?.cupo ?? 0 };
  }
  return { ok: true, grupo, motivo: null, mensaje: null, ocupados: g.ocupados, cupo: g.cupo };
}

/**
 * Pendientes que hay que cerrar como «Cupo completo» después de una confirmación: las solicitudes
 * convocadas del grupo que quedó lleno. Indistinto: todas las pendientes cuando se llena el cupo.
 */
export function pendientesACerrar(servicio, ocupados, pendientes) {
  const estado = estadoCupo(servicio, ocupados);
  const llenos = new Set(estado.grupos.filter((g) => g.completo).map((g) => g.grupo));
  if (!llenos.size) return [];
  return (pendientes || []).filter((p) => {
    if (String(p?.status || 'convocado') !== 'convocado') return false;
    const g = grupoDeItem(servicio, p);
    return !!g && llenos.has(g);
  });
}

/**
 * Candidatos agrupados para la pantalla «Convocar guardias» (Nómina y Eventuales): un grupo por
 * cupo, con su ocupación, y aparte los «Sin especificar» (no cuentan hasta cargar el género).
 * El orden dentro de cada grupo es el que ya traía la lista (mismo motor y puntaje).
 */
export function agruparCandidatos(servicio, candidatos, ocupados = []) {
  const estado = estadoCupo(servicio, ocupados);
  const grupos = estado.grupos.map((g) => ({ ...g, candidatos: [] }));
  const porGrupo = new Map(grupos.map((g) => [g.grupo, g]));
  const sinEspecificar = [];
  for (const c of candidatos || []) {
    const g = grupoDeGenero(servicio, c?.genero);
    const row = g ? porGrupo.get(g) : null;
    if (!row) { sinEspecificar.push(c); continue; }
    row.candidatos.push(c);
  }
  return { porGenero: esPorGenero(servicio), grupos, sinEspecificar, estado };
}

/** «Hombres 12/20» · «Mujeres 15/15 · completo» · «Cupo 3/5». */
export function textoCupoGrupo(g) {
  const base = `${GRUPO_LABEL[g.grupo] || g.label || 'Cupo'} ${g.ocupados}/${g.cupo}`;
  return g.completo ? `${base} · completo` : base;
}

/** Línea resumen para el encabezado: «Hombres 12/20 · Mujeres 15/15 completo» o «12/20». */
export function textoResumenCupo(estado) {
  if (!estado?.grupos?.length) return '';
  if (estado.grupos.length === 1) return `${estado.ocupados}/${estado.cupo}`;
  return estado.grupos.map((g) => `${GRUPO_LABEL[g.grupo]} ${g.ocupados}/${g.cupo}${g.completo ? ' completo' : ''}`).join(' · ');
}

/** Porcentaje 0–100 para la barra de un grupo. */
export function porcentajeGrupo(g) {
  if (!g || !(g.cupo > 0)) return 0;
  return Math.min(100, Math.round((g.ocupados / g.cupo) * 100));
}

/** Aviso al legajo sin género cuando el servicio es por género. */
export const AVISO_SIN_ESPECIFICAR = 'Sin género en el legajo: no cuentan para ningún cupo hasta que se cargue.';
