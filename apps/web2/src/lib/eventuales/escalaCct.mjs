/**
 * Escala salarial del CCT 422/05 para el ANEXO del eventual (módulo Eventuales).
 * Lógica pura compartida por la pantalla, la callable `gestionarEscalaCct` y el job diario:
 *   - edición celda a celda con motivo y versionado (`historial`),
 *   - diferencias entre dos versiones,
 *   - traducción de una escala APROBADA a los docs `escalas_salariales` que lee remuneracion.mjs,
 *   - elección de la escala aprobada vigente a la fecha del servicio (o la de hoy, avisando).
 * No calcula liquidación ni payroll: solo el bruto del anexo.
 */

export const CCT_422_ID = 'CCT_422_05';

export const ESTADOS_ESCALA = ['PROPUESTA', 'APROBADA', 'REEMPLAZADA', 'RECHAZADA'];

export const CAMPOS_CELDA = ['basico', 'presentismo', 'viatico', 'noRemunerativo', 'total'];
export const CAMPOS_TRAMO = ['aeroportuario', 'adicionalVacacionesPorDia'];

export const ETIQUETA_CAMPO = {
  basico: 'Básico',
  presentismo: 'Presentismo',
  viatico: 'Viático art. 106',
  noRemunerativo: 'No remunerativo',
  total: 'Total conformado',
  aeroportuario: 'Adicional aeroportuario',
  adicionalVacacionesPorDia: 'Adicional vacaciones / día',
  'parametros.divisorHoras': 'Divisor de horas',
  'parametros.jornadaOrdinariaHoras': 'Jornada ordinaria (h)',
  'parametros.prorrateoDias': 'Días para prorratear mensuales',
  'parametros.recargos.nocturnoPct': 'Recargo nocturno %',
  'parametros.recargos.extra50Pct': 'Hora extra 50 %',
  'parametros.recargos.extra100Pct': 'Hora extra 100 %',
  'parametros.recargos.sabado13Pct': 'Sábado después de las 13 %',
  'parametros.recargos.domingoPct': 'Domingo %',
  'parametros.recargos.feriadoPct': 'Feriado %',
};

/**
 * Lo que el acta no trae y el bruto del anexo necesita. El nocturno queda en null a propósito:
 * el acta no fija porcentaje y RRHH lo completa con motivo (hasta entonces el cálculo avisa).
 */
export const PARAMETROS_DEFAULT = Object.freeze({
  divisorHoras: 200,
  jornadaOrdinariaHoras: 8,
  prorrateoDias: 30,
  recargos: Object.freeze({ nocturnoPct: null, extra50Pct: 50, extra100Pct: 100, sabado13Pct: 100, domingoPct: 100, feriadoPct: 100 }),
  sac: Object.freeze({ divisor: 12 }),
  vacaciones: Object.freeze({ unDiaCada: 20, divisorDiasMes: 30 }),
});

export const PARAMETROS_EDITABLES = [
  'parametros.divisorHoras',
  'parametros.jornadaOrdinariaHoras',
  'parametros.prorrateoDias',
  'parametros.recargos.nocturnoPct',
  'parametros.recargos.extra50Pct',
  'parametros.recargos.extra100Pct',
  'parametros.recargos.sabado13Pct',
  'parametros.recargos.domingoPct',
  'parametros.recargos.feriadoPct',
];

/** Alias de categoría: los contratos viejos dicen VIGILADOR_GENERAL; el acta, Vigilador. */
export const ALIAS_CATEGORIA = { VIGILADOR: ['VIGILADOR_GENERAL'] };

const clon = (v) => JSON.parse(JSON.stringify(v));

export function parametrosDe(escala) {
  const p = escala?.parametros || {};
  return {
    ...PARAMETROS_DEFAULT,
    ...p,
    recargos: { ...PARAMETROS_DEFAULT.recargos, ...(p.recargos || {}) },
    sac: { ...PARAMETROS_DEFAULT.sac, ...(p.sac || {}) },
    vacaciones: { ...PARAMETROS_DEFAULT.vacaciones, ...(p.vacaciones || {}) },
  };
}

function numeroValido(valor, { permiteNull = false } = {}) {
  if (valor === null || valor === undefined || valor === '') return permiteNull ? { ok: true, valor: null } : { ok: false };
  const n = typeof valor === 'number' ? valor : Number(String(valor).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, valor: n };
}

function leerParametro(parametros, ruta) {
  const partes = ruta.replace(/^parametros\./, '').split('.');
  let cur = parametros;
  for (const k of partes) cur = cur?.[k];
  return cur === undefined ? null : cur;
}

function escribirParametro(parametros, ruta, valor) {
  const partes = ruta.replace(/^parametros\./, '').split('.');
  let cur = parametros;
  for (const k of partes.slice(0, -1)) {
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[partes[partes.length - 1]] = valor;
}

/**
 * Aplica cambios celda a celda. Cada cambio: { mes, codigo, campo, valor } para una categoría,
 * { mes, codigo: '*', campo } para un adicional del tramo, o { campo: 'parametros.x.y', valor }.
 * Devuelve la escala nueva y la entrada de historial (quién, cuándo, qué cambió). No muta la original.
 */
export function aplicarCambios(escala, cambios, meta = {}) {
  const motivo = String(meta.motivo || '').trim();
  if (motivo.length < 3) return { ok: false, codigo: 'MOTIVO_REQUERIDO' };
  if (!Array.isArray(cambios) || !cambios.length) return { ok: false, codigo: 'SIN_CAMBIOS' };
  const nueva = clon(escala);
  nueva.parametros = parametrosDe(nueva);
  const aplicados = [];
  for (const c of cambios) {
    const campo = String(c?.campo || '');
    if (campo.startsWith('parametros.')) {
      if (!PARAMETROS_EDITABLES.includes(campo)) return { ok: false, codigo: 'CAMPO_INVALIDO', campo };
      const v = numeroValido(c.valor, { permiteNull: campo === 'parametros.recargos.nocturnoPct' });
      if (!v.ok) return { ok: false, codigo: 'VALOR_INVALIDO', campo };
      const antes = leerParametro(nueva.parametros, campo);
      if (antes === v.valor) continue;
      escribirParametro(nueva.parametros, campo, v.valor);
      aplicados.push({ mes: null, codigo: null, campo, antes, despues: v.valor });
      continue;
    }
    const tramo = (nueva.tramos || []).find((t) => t.mes === c?.mes);
    if (!tramo) return { ok: false, codigo: 'MES_INEXISTENTE', mes: c?.mes };
    const v = numeroValido(c.valor);
    if (!v.ok) return { ok: false, codigo: 'VALOR_INVALIDO', campo };
    if (c.codigo === '*' || !c.codigo) {
      if (!CAMPOS_TRAMO.includes(campo)) return { ok: false, codigo: 'CAMPO_INVALIDO', campo };
      const antes = tramo[campo]?.valor ?? null;
      if (antes === v.valor) continue;
      tramo[campo] = { valor: v.valor, confianza: 'ALTA', motivo: 'EDITADO_RRHH' };
      aplicados.push({ mes: tramo.mes, codigo: '*', campo, antes, despues: v.valor });
      continue;
    }
    const fila = (tramo.categorias || []).find((f) => f.codigo === c.codigo);
    if (!fila) return { ok: false, codigo: 'CATEGORIA_INEXISTENTE', codigoCategoria: c.codigo };
    if (!CAMPOS_CELDA.includes(campo)) return { ok: false, codigo: 'CAMPO_INVALIDO', campo };
    const antes = fila[campo]?.valor ?? null;
    if (antes === v.valor) continue;
    fila[campo] = { valor: v.valor, confianza: 'ALTA', motivo: 'EDITADO_RRHH' };
    recalcularFila(fila);
    aplicados.push({ mes: tramo.mes, codigo: fila.codigo, campo, antes, despues: v.valor });
  }
  if (!aplicados.length) return { ok: false, codigo: 'SIN_CAMBIOS' };
  const item = {
    at: meta.ahora ? new Date(meta.ahora).toISOString() : new Date().toISOString(),
    por: meta.uid || 'SYSTEM',
    porEmail: meta.email || null,
    motivo,
    cambios: aplicados,
  };
  nueva.historial = [...(escala.historial || []), item];
  nueva.confianzaGlobal = confianzaGlobalDe(nueva);
  return { ok: true, escala: nueva, historialItem: item };
}

function recalcularFila(fila) {
  const b = fila.basico?.valor; const p = fila.presentismo?.valor; const v = fila.viatico?.valor; const n = fila.noRemunerativo?.valor;
  if ([b, p, v, n].every((x) => typeof x === 'number')) {
    fila.totalCalculado = b + p + v + n;
    fila.sumaCierra = fila.total?.valor == null ? null : Math.abs(fila.totalCalculado - fila.total.valor) < 1;
  } else {
    fila.totalCalculado = null;
    fila.sumaCierra = null;
  }
}

const ORDEN_CONFIANZA = { ALTA: 0, MEDIA: 1, BAJA: 2 };
const peor = (a, b) => (ORDEN_CONFIANZA[b] > ORDEN_CONFIANZA[a] ? b : a);

export function confianzaGlobalDe(escala) {
  let c = (escala.tramos || []).length ? 'ALTA' : 'BAJA';
  for (const t of escala.tramos || []) {
    c = peor(c, t.mesConfianza || 'ALTA');
    for (const f of t.categorias || []) for (const k of CAMPOS_CELDA) c = peor(c, f[k]?.confianza || 'ALTA');
  }
  return c;
}

/** Celdas que la pantalla resalta: todo lo que no sea ALTA, con su motivo. */
export function celdasBajaConfianza(escala) {
  const out = [];
  for (const t of escala?.tramos || []) {
    if (t.mesConfianza && t.mesConfianza !== 'ALTA') out.push({ mes: t.mes, codigo: '*', campo: 'mes', confianza: t.mesConfianza, motivo: t.mesMotivo || null });
    for (const k of CAMPOS_TRAMO) {
      if (t[k] && t[k].confianza && t[k].confianza !== 'ALTA') out.push({ mes: t.mes, codigo: '*', campo: k, confianza: t[k].confianza, motivo: t[k].motivo || null });
    }
    for (const f of t.categorias || []) {
      for (const k of CAMPOS_CELDA) {
        const c = f[k];
        if (c && c.confianza && c.confianza !== 'ALTA') out.push({ mes: t.mes, codigo: f.codigo, campo: k, confianza: c.confianza, motivo: c.motivo || null });
      }
      if (f.sumaCierra === false) out.push({ mes: t.mes, codigo: f.codigo, campo: 'total', confianza: 'MEDIA', motivo: 'SUMA_NO_CIERRA' });
    }
  }
  return out;
}

/** Diferencias b − a (valores por mes/categoría/campo y parámetros). a puede ser null (primera versión). */
export function diffEscalas(a, b) {
  const out = [];
  if (!b) return out;
  const tramosA = a?.tramos || [];
  const meses = [...new Set([...tramosA.map((t) => t.mes), ...(b.tramos || []).map((t) => t.mes)])].sort();
  for (const mes of meses) {
    const ta = tramosA.find((t) => t.mes === mes);
    const tb = (b.tramos || []).find((t) => t.mes === mes);
    if (!ta || !tb) { out.push({ mes, codigo: '*', campo: 'tramo', antes: ta ? 'presente' : null, despues: tb ? 'presente' : null }); continue; }
    const codigos = [...new Set([...(ta.categorias || []).map((c) => c.codigo), ...(tb.categorias || []).map((c) => c.codigo)])];
    for (const codigo of codigos) {
      const ca = (ta.categorias || []).find((c) => c.codigo === codigo);
      const cb = (tb.categorias || []).find((c) => c.codigo === codigo);
      if (!ca || !cb) { out.push({ mes, codigo, campo: 'categoria', antes: ca ? 'presente' : null, despues: cb ? 'presente' : null }); continue; }
      for (const k of CAMPOS_CELDA) {
        const va = ca[k]?.valor ?? null; const vb = cb[k]?.valor ?? null;
        if (va !== vb) out.push({ mes, codigo, campo: k, antes: va, despues: vb });
      }
    }
    for (const k of CAMPOS_TRAMO) {
      const va = ta[k]?.valor ?? null; const vb = tb[k]?.valor ?? null;
      if (va !== vb) out.push({ mes, codigo: '*', campo: k, antes: va, despues: vb });
    }
  }
  const pa = a ? parametrosDe(a) : null;
  const pb = parametrosDe(b);
  for (const ruta of PARAMETROS_EDITABLES) {
    const va = pa ? leerParametro(pa, ruta) : null;
    const vb = leerParametro(pb, ruta);
    if (va !== vb) out.push({ mes: null, codigo: null, campo: ruta, antes: va, despues: vb });
  }
  return out;
}

/** Valores derivados por categoría que la pantalla muestra junto al acta. */
export function derivadosFila(fila, parametros) {
  const p = parametros || PARAMETROS_DEFAULT;
  const basico = fila?.basico?.valor;
  if (typeof basico !== 'number') return { valorHora: null, horaExtra50: null, horaExtra100: null, horaNocturna: null };
  const valorHora = basico / (Number(p.divisorHoras) > 0 ? Number(p.divisorHoras) : 200);
  const r = p.recargos || {};
  const pct = (k, d) => (Number.isFinite(r[k]) ? r[k] : d);
  return {
    valorHora: redondear(valorHora),
    horaExtra50: redondear(valorHora * (1 + pct('extra50Pct', 50) / 100)),
    horaExtra100: redondear(valorHora * (1 + pct('extra100Pct', 100) / 100)),
    horaNocturna: r.nocturnoPct == null ? null : redondear(valorHora * (1 + r.nocturnoPct / 100)),
  };
}

export function redondear(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function escalaSalarialDocId(convenio, categoria, vigenciaDesde) {
  return `${convenio}_${categoria}_${vigenciaDesde}`;
}

/**
 * Una escala APROBADA → docs `escalas_salariales` (uno por tramo × categoría), con lo que lee
 * remuneracion.mjs: básico/200, presentismo fijo mensual prorrateado, viático y no rem. mensuales
 * prorrateados por día trabajado, recargos y cierre (SAC, vacaciones).
 */
export function escalasSalarialesDesdeAprobada(escala, meta = {}) {
  const p = parametrosDe(escala);
  const out = [];
  for (const t of escala?.tramos || []) {
    for (const f of t.categorias || []) {
      if (typeof f.basico?.valor !== 'number') continue;
      const adicionales = [];
      if (typeof f.viatico?.valor === 'number' && f.viatico.valor > 0) {
        adicionales.push({ codigo: 'VIATICO_ART106', nombre: 'Viático art. 106 LCT (proporcional)', monto: f.viatico.valor, modo: 'MENSUAL_PRORRATEO', divisorDias: p.prorrateoDias, tipo: 'VIATICO' });
      }
      if (typeof f.noRemunerativo?.valor === 'number' && f.noRemunerativo.valor > 0) {
        adicionales.push({ codigo: 'NO_REM_ACUERDO', nombre: 'Suma no remunerativa acuerdo (proporcional)', monto: f.noRemunerativo.valor, modo: 'MENSUAL_PRORRATEO', divisorDias: p.prorrateoDias, tipo: 'NO_REMUNERATIVO' });
      }
      out.push({
        id: escalaSalarialDocId(CCT_422_ID, f.codigo, t.vigenciaDesde),
        convenio: CCT_422_ID,
        categoria: f.codigo,
        aliases: ALIAS_CATEGORIA[f.codigo] || [],
        categoriaLabel: f.label,
        codigoArca: f.codigoArca || null,
        vigenciaDesde: t.vigenciaDesde,
        vigenciaHasta: t.vigenciaHasta,
        basicoMensual: f.basico.valor,
        divisorHoras: p.divisorHoras,
        jornadaOrdinariaHoras: p.jornadaOrdinariaHoras,
        recargos: { ...p.recargos },
        presentismo: typeof f.presentismo?.valor === 'number' && f.presentismo.valor > 0
          ? { monto: f.presentismo.valor, modo: 'FIJO_MENSUAL', divisorDias: p.prorrateoDias, tipo: 'REMUNERATIVO' }
          : null,
        adicionales,
        extras: {
          totalConformado: f.total?.valor ?? null,
          aeroportuarioMensual: t.aeroportuario?.valor ?? null,
          adicionalVacacionesPorDia: t.adicionalVacacionesPorDia?.valor ?? null,
        },
        sac: { ...p.sac },
        vacaciones: { ...p.vacaciones },
        status: 'ACTIVE',
        escalaCctId: meta.escalaCctId || null,
        escalaVersion: meta.version ?? null,
        fuente: {
          disposicion: escala?.fuente?.disposicion || null,
          acuerdoNro: escala?.fuente?.acuerdoNro || null,
          url: escala?.fuente?.url || null,
        },
        aprobadoPor: meta.uid || null,
        aprobadoEn: meta.ahora ? new Date(meta.ahora).toISOString() : new Date().toISOString(),
      });
    }
  }
  return out;
}

function cubre(escala, fecha) {
  const d = String(escala.vigenciaDesde || '').slice(0, 10);
  const h = String(escala.vigenciaHasta || '').slice(0, 10);
  return !!d && d <= fecha && (!h || h >= fecha);
}

/**
 * Escala aprobada que rige en la fecha del servicio. Si no hay, la vigente hoy; si tampoco,
 * la última aprobada. `fallback` = true cuando no es la de la fecha pedida (el anexo avisa).
 */
export function elegirEscalaAprobada(escalas, fecha, hoy) {
  const aprobadas = (escalas || []).filter((e) => e && e.estado === 'APROBADA');
  const porVigencia = (a, b) => String(b.vigenciaDesde || '').localeCompare(String(a.vigenciaDesde || ''));
  const enFecha = aprobadas.filter((e) => cubre(e, fecha)).sort(porVigencia)[0];
  if (enFecha) return { escala: enFecha, fallback: false, motivo: null };
  const deHoy = hoy ? aprobadas.filter((e) => cubre(e, hoy)).sort(porVigencia)[0] : null;
  if (deHoy) return { escala: deHoy, fallback: true, motivo: 'SIN_ESCALA_EN_FECHA_USA_HOY' };
  const ultima = aprobadas.sort(porVigencia)[0];
  if (ultima) return { escala: ultima, fallback: true, motivo: 'SIN_ESCALA_EN_FECHA_USA_ULTIMA' };
  return { escala: null, fallback: true, motivo: 'SIN_ESCALA_APROBADA' };
}

/** Texto corto de la fuente para la pantalla y el anexo. */
export function rotuloFuente(escala) {
  const f = escala?.fuente || {};
  const partes = [];
  if (f.disposicion) partes.push(`Disp. ${String(f.disposicion).replace(/^DI-(\d{4})-(\d+)-.*$/, '$2/$1')}`);
  if (f.acuerdoNro) partes.push(`Acuerdo ${f.acuerdoNro}`);
  if (!partes.length && f.titulo) partes.push(String(f.titulo));
  if (!partes.length) partes.push(`${escala?.cct || CCT_422_ID} ${escala?.extraccion || ''}`.trim());
  return partes.join(' · ');
}

export function rotuloVigencia(escala) {
  const d = String(escala?.vigenciaDesde || '').slice(0, 10);
  const h = String(escala?.vigenciaHasta || '').slice(0, 10);
  const f = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
  return `${f(d)} → ${h ? f(h) : 'sin fin'}`;
}

/** Resumen de una versión para la lista de la pantalla. */
export function resumenEscala(escala) {
  return {
    id: escala?.id || null,
    estado: escala?.estado || 'PROPUESTA',
    version: escala?.version ?? null,
    vigencia: rotuloVigencia(escala),
    fuente: rotuloFuente(escala),
    url: escala?.fuente?.url || null,
    extraccion: escala?.extraccion || null,
    confianzaGlobal: escala?.confianzaGlobal || confianzaGlobalDe(escala || {}),
    meses: (escala?.tramos || []).length,
    categorias: (escala?.tramos?.[0]?.categorias || []).length,
    bajaConfianza: celdasBajaConfianza(escala).length,
    ediciones: (escala?.historial || []).length,
  };
}

/** Puede aprobarse: PROPUESTA con al menos un tramo con básico para la categoría ARCA (Vigilador). */
export function validarParaAprobar(escala) {
  if (!escala || escala.estado !== 'PROPUESTA') return { ok: false, codigo: 'NO_ES_PROPUESTA' };
  if (!(escala.tramos || []).length) return { ok: false, codigo: 'SIN_TRAMOS' };
  for (const t of escala.tramos) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.vigenciaDesde || ''))) return { ok: false, codigo: 'TRAMO_SIN_VIGENCIA', mes: t.mes };
    const vig = (t.categorias || []).find((c) => c.codigo === 'VIGILADOR');
    if (typeof vig?.basico?.valor !== 'number' || vig.basico.valor <= 0) return { ok: false, codigo: 'VIGILADOR_SIN_BASICO', mes: t.mes };
  }
  return { ok: true };
}

/** Aprobadas que solapan la vigencia de la nueva: pasan a REEMPLAZADA. */
export function aprobadasSolapadas(aprobadas, nueva) {
  const d = String(nueva.vigenciaDesde || '').slice(0, 10);
  const h = String(nueva.vigenciaHasta || '9999-12-31').slice(0, 10);
  return (aprobadas || []).filter((e) => {
    if (!e || e.estado !== 'APROBADA' || e.id === nueva.id) return false;
    const ed = String(e.vigenciaDesde || '').slice(0, 10);
    const eh = String(e.vigenciaHasta || '9999-12-31').slice(0, 10);
    return ed <= h && eh >= d;
  });
}
