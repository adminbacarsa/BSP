/**
 * Escala salarial del CCT 422/05 (SUVICO – CAESI, vigiladores de Córdoba).
 * Lógica pura, sin Firebase: parser del anexo oficial con capa de texto (Disposición DNRYRT),
 * normalización de la lectura de Gemini sobre el PDF escaneado de SUVICO y confianza por campo.
 * La propuesta nace siempre en estado PROPUESTA: la aprueba RRHH, nunca este módulo.
 */
import { createHash } from 'node:crypto';

export const CCT_422 = 'CCT_422_05' as const;

export type Confianza = 'ALTA' | 'MEDIA' | 'BAJA';
export type Extraccion = 'TEXTO_OFICIAL' | 'GEMINI_VISION';

export interface Campo {
  valor: number | null;
  confianza: Confianza;
  motivo?: string;
}

export interface CategoriaCct422 {
  codigo: string;
  label: string;
  codigoArca: string | null;
  alias: string[];
}

/** Las 14 categorías del anexo. Solo Vigilador tiene código ARCA confirmado (`empresas.arcaEventuales.categoria`). */
export const CATEGORIAS_422: CategoriaCct422[] = [
  { codigo: 'VIGILADOR', label: 'Vigilador', codigoArca: '033104', alias: ['vigilador', 'vigilador general', 'vigilador en general'] },
  { codigo: 'VIGILADOR_BOMBERO', label: 'Vigilador Bombero', codigoArca: null, alias: ['vigilador bombero'] },
  { codigo: 'ADMINISTRATIVO', label: 'Administrativo', codigoArca: null, alias: ['administrativo'] },
  { codigo: 'ENCARGADO_TURNO', label: 'Encargado de turno', codigoArca: null, alias: ['encargado de turno'] },
  {
    codigo: 'CONTROLADOR_ADMISION',
    label: 'Controlador de admisión y permanencia gral',
    codigoArca: null,
    alias: ['controlador de admision y permanencia gral', 'controlador de admision y permanencia general', 'controlador de admision y permanencia', 'controlador de admision'],
  },
  { codigo: 'ACUDE_ALARMA', label: 'Acude alarma', codigoArca: null, alias: ['acude alarma', 'acude alarmas'] },
  { codigo: 'GUIA_TECNICO', label: 'Guía Técnico', codigoArca: null, alias: ['guia tecnico'] },
  {
    codigo: 'INSTALADOR_SEG_ELECTRONICA',
    label: 'Inst. de elem. de Seg. Electrónica',
    codigoArca: null,
    alias: ['inst. de elem. de seg. electronica', 'inst de elem de seg electronica', 'instalador de elementos de seguridad electronica', 'instalador de elem. de seg. electronica', 'instalador'],
  },
  { codigo: 'PERSONAL_MONITOREO', label: 'Personal de Monitoreo', codigoArca: null, alias: ['personal de monitoreo', 'operador de monitoreo'] },
  { codigo: 'SUPERVISION_ALARMA', label: 'Supervisión de Alarma', codigoArca: null, alias: ['supervision de alarma', 'supervision de alarmas'] },
  { codigo: 'INVESTIGADOR', label: 'Investigador', codigoArca: null, alias: ['investigador'] },
  { codigo: 'CUSTODIO_PRIMERA', label: 'Custodio de Primera', codigoArca: null, alias: ['custodio de primera', 'custodio de 1ra', 'custodio de 1°'] },
  { codigo: 'CUSTODIO_BRIGADA', label: 'Custodio Brigada', codigoArca: null, alias: ['custodio brigada', 'custodio de brigada'] },
  { codigo: 'SUPERVISOR_GENERAL', label: 'Supervisor General', codigoArca: null, alias: ['supervisor general', 'supervisor gral'] },
];

export const CONCEPTOS_422 = {
  basico: 'REMUNERATIVO_MENSUAL',
  presentismo: 'REMUNERATIVO_FIJO_MENSUAL',
  viatico: 'NO_REMUNERATIVO_MENSUAL_ART_106_LCT',
  noRemunerativo: 'NO_REMUNERATIVO_MENSUAL_ACUERDO',
  total: 'BRUTO_CONFORMADO_SIN_ANTIGUEDAD',
  aeroportuario: 'ADICIONAL_REMUNERATIVO_MENSUAL',
  adicionalVacacionesPorDia: 'ADICIONAL_REMUNERATIVO_POR_DIA_VACACIONES_TOPE_21',
} as const;

const MESES: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
};
const MES_RE = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';

export interface LecturaFila {
  categoria: string;
  basico: number | null;
  presentismo: number | null;
  viatico: number | null;
  noRemunerativo: number | null;
  total: number | null;
  /** 0..1, confianza que declara el modelo. El parser de texto no la informa. */
  confianza?: number | null;
}

export interface LecturaTramo {
  mes: string | null;
  mesLabel?: string | null;
  confianzaMes?: number | null;
  mesPorPosicion?: boolean;
  filas: LecturaFila[];
  aeroportuario?: number | null;
  adicionalVacacionesPorDia?: number | null;
}

export interface FuenteEscala {
  url: string | null;
  titulo: string | null;
  disposicion: string | null;
  expediente: string | null;
  documentoRE: string | null;
  acuerdoNro: string | null;
  boletinOficial: string | null;
}

export interface Lectura {
  tramos: LecturaTramo[];
  vigenciaDesde?: string | null;
  vigenciaHasta?: string | null;
  noRemunerativoSeIncorporaAlBasicoDesde?: string | null;
  fuente?: Partial<FuenteEscala>;
  notas?: string[];
}

export interface FilaCategoria {
  codigo: string;
  label: string;
  labelLeido: string;
  codigoArca: string | null;
  basico: Campo;
  presentismo: Campo;
  viatico: Campo;
  noRemunerativo: Campo;
  total: Campo;
  totalCalculado: number | null;
  sumaCierra: boolean | null;
}

export interface Tramo {
  mes: string;
  vigenciaDesde: string;
  vigenciaHasta: string;
  mesConfianza: Confianza;
  mesMotivo?: string;
  categorias: FilaCategoria[];
  aeroportuario: Campo | null;
  adicionalVacacionesPorDia: Campo | null;
}

export interface PropuestaEscala422 {
  cct: typeof CCT_422;
  estado: 'PROPUESTA';
  extraccion: Extraccion;
  partes: ['SUVICO', 'CAESI'];
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  tramos: Tramo[];
  conceptos: typeof CONCEPTOS_422;
  noRemunerativoSeIncorporaAlBasicoDesde: string | null;
  fuente: FuenteEscala;
  documentoHash: string;
  confianzaGlobal: Confianza;
  advertencias: string[];
  generadoEn: string;
}

export interface MetaPropuesta {
  extraccion: Extraccion;
  documentoHash: string;
  fuenteUrl?: string | null;
  titulo?: string | null;
  ahora?: Date;
}

const CAMPOS_FILA = ['basico', 'presentismo', 'viatico', 'noRemunerativo', 'total'] as const;

export function sinAcento(s: string): string {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '');
}

export function normalizarLabel(label: string): string {
  return sinAcento(label).toLowerCase().replace(/\s+/g, ' ').replace(/[“”"]/g, '').trim();
}

export function categoriaPorLabel(label: string): CategoriaCct422 | null {
  const n = normalizarLabel(label).replace(/\.$/, '');
  if (!n) return null;
  const candidatos: { cat: CategoriaCct422; alias: string }[] = [];
  for (const cat of CATEGORIAS_422) for (const alias of cat.alias) candidatos.push({ cat, alias });
  candidatos.sort((a, b) => b.alias.length - a.alias.length);
  for (const { cat, alias } of candidatos) if (n === alias) return cat;
  for (const { cat, alias } of candidatos) {
    if (alias.length >= 10 && (n.startsWith(alias) || alias.startsWith(n))) return cat;
  }
  return null;
}

export function pesos(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw) : null;
  const limpio = String(raw).replace(/\$/g, '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number(limpio);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function ultimoDiaDelMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${mes}-${String(d).padStart(2, '0')}`;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function mesDesdeNombre(nombre: string, anio: string | number): string | null {
  const mm = MESES[sinAcento(nombre).toLowerCase()];
  return mm && String(anio) ? `${anio}-${mm}` : null;
}

function peor(a: Confianza, b: Confianza): Confianza {
  const orden: Confianza[] = ['ALTA', 'MEDIA', 'BAJA'];
  return orden[Math.max(orden.indexOf(a), orden.indexOf(b))];
}

/**
 * Confianza que aporta la fuente antes de la verificación aritmética. El texto oficial es ALTA.
 * Con Gemini manda la confianza que declara el modelo; si no la declara, `sinDeclarar`
 * (ALTA para filas cuya suma cierra, MEDIA para rótulos y adicionales que no se pueden verificar).
 */
function confianzaBase(extraccion: Extraccion, declarada: number | null | undefined, sinDeclarar: Confianza = 'MEDIA'): Confianza {
  if (extraccion === 'TEXTO_OFICIAL') return 'ALTA';
  if (typeof declarada !== 'number' || !Number.isFinite(declarada)) return sinDeclarar;
  if (declarada >= 0.85) return 'ALTA';
  if (declarada >= 0.6) return 'MEDIA';
  return 'BAJA';
}

function armarFila(fila: LecturaFila, extraccion: Extraccion, advertencias: string[], mes: string): FilaCategoria {
  const cat = categoriaPorLabel(fila.categoria);
  const base = confianzaBase(extraccion, fila.confianza, 'ALTA');
  const valores = {
    basico: pesos(fila.basico),
    presentismo: pesos(fila.presentismo),
    viatico: pesos(fila.viatico),
    noRemunerativo: pesos(fila.noRemunerativo),
    total: pesos(fila.total),
  };
  const sumables = [valores.basico, valores.presentismo, valores.viatico, valores.noRemunerativo];
  const totalCalculado = sumables.every((v) => v != null) ? sumables.reduce((a, b) => (a as number) + (b as number), 0) : null;
  const sumaCierra = totalCalculado != null && valores.total != null ? totalCalculado === valores.total : null;

  const campo = (k: (typeof CAMPOS_FILA)[number]): Campo => {
    const valor = valores[k];
    if (valor == null) return { valor: null, confianza: 'BAJA', motivo: 'SIN_VALOR' };
    if (sumaCierra === false) return { valor, confianza: 'BAJA', motivo: 'SUMA_NO_CIERRA' };
    if (sumaCierra === null) return { valor, confianza: peor(base, 'MEDIA'), motivo: 'SUMA_NO_VERIFICABLE' };
    return { valor, confianza: base };
  };

  if (!cat) advertencias.push(`${mes}: categoría no reconocida «${fila.categoria}»`);
  if (sumaCierra === false) advertencias.push(`${mes} ${cat?.label ?? fila.categoria}: la suma de conceptos (${totalCalculado}) no coincide con el total (${valores.total})`);

  return {
    codigo: cat ? cat.codigo : `DESCONOCIDA_${normalizarLabel(fila.categoria).replace(/[^a-z0-9]+/g, '_').toUpperCase()}`,
    label: cat ? cat.label : String(fila.categoria || '').trim(),
    labelLeido: String(fila.categoria || '').trim(),
    codigoArca: cat ? cat.codigoArca : null,
    basico: campo('basico'),
    presentismo: campo('presentismo'),
    viatico: campo('viatico'),
    noRemunerativo: campo('noRemunerativo'),
    total: campo('total'),
    totalCalculado,
    sumaCierra,
  };
}

function campoSimple(valor: unknown, extraccion: Extraccion, declarada: number | null | undefined): Campo | null {
  const v = pesos(valor);
  if (v == null) return null;
  return { valor: v, confianza: confianzaBase(extraccion, declarada) };
}

function mesSiguiente(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Lectura (texto o Gemini) → propuesta con confianza por campo. Siempre PROPUESTA. */
export function armarPropuesta422(lectura: Lectura, meta: MetaPropuesta): PropuestaEscala422 {
  const advertencias: string[] = [...(lectura.notas || [])];
  const tramosLeidos = (lectura.tramos || []).map((t) => ({ ...t }));
  const ocupados = new Set(tramosLeidos.map((t) => t.mes).filter((m): m is string => !!m));
  let cursor: string | null = lectura.vigenciaDesde?.slice(0, 7) || tramosLeidos.find((t) => t.mes)?.mes || null;
  for (const t of tramosLeidos) {
    if (t.mes || !cursor) continue;
    while (ocupados.has(cursor)) cursor = mesSiguiente(cursor);
    t.mes = cursor;
    t.mesPorPosicion = true;
    ocupados.add(cursor);
    cursor = mesSiguiente(cursor);
  }

  const tramos: Tramo[] = tramosLeidos
    .filter((t): t is LecturaTramo & { mes: string } => !!t.mes && /^\d{4}-\d{2}$/.test(t.mes))
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .map((t) => {
      const mesConfianza: Confianza = t.mesPorPosicion ? 'MEDIA' : confianzaBase(meta.extraccion, t.confianzaMes);
      const categorias = (t.filas || []).map((f) => armarFila(f, meta.extraccion, advertencias, t.mes));
      if (categorias.length !== CATEGORIAS_422.length) {
        advertencias.push(`${t.mes}: se leyeron ${categorias.length} categorías, el anexo trae ${CATEGORIAS_422.length}`);
      }
      return {
        mes: t.mes,
        vigenciaDesde: `${t.mes}-01`,
        vigenciaHasta: ultimoDiaDelMes(t.mes),
        mesConfianza,
        ...(t.mesPorPosicion ? { mesMotivo: 'MES_POR_POSICION' } : {}),
        categorias,
        aeroportuario: campoSimple(t.aeroportuario, meta.extraccion, t.confianzaMes),
        adicionalVacacionesPorDia: campoSimple(t.adicionalVacacionesPorDia, meta.extraccion, t.confianzaMes),
      };
    });

  if (!tramos.length) advertencias.push('No se leyó ningún tramo mensual');
  for (let i = 1; i < tramos.length; i += 1) {
    const prev = tramos[i - 1];
    const cur = tramos[i];
    if (cur.mes !== mesSiguiente(prev.mes)) advertencias.push(`Salto de meses entre ${prev.mes} y ${cur.mes}`);
    for (const fila of cur.categorias) {
      const anterior = prev.categorias.find((c) => c.codigo === fila.codigo);
      if (anterior?.basico.valor != null && fila.basico.valor != null && fila.basico.valor < anterior.basico.valor) {
        fila.basico = { ...fila.basico, confianza: peor(fila.basico.confianza, 'MEDIA'), motivo: 'BASICO_MENOR_AL_MES_ANTERIOR' };
        advertencias.push(`${cur.mes} ${fila.label}: básico ${fila.basico.valor} menor al de ${prev.mes} (${anterior.basico.valor})`);
      }
    }
  }

  const vigenciaDesde = lectura.vigenciaDesde || (tramos.length ? tramos[0].vigenciaDesde : null);
  const vigenciaHasta = lectura.vigenciaHasta || (tramos.length ? tramos[tramos.length - 1].vigenciaHasta : null);
  if (tramos.length && lectura.vigenciaDesde && lectura.vigenciaDesde !== tramos[0].vigenciaDesde) {
    advertencias.push(`La vigencia declarada (${lectura.vigenciaDesde}) no coincide con el primer tramo (${tramos[0].vigenciaDesde})`);
  }

  let confianzaGlobal: Confianza = tramos.length ? 'ALTA' : 'BAJA';
  for (const t of tramos) {
    confianzaGlobal = peor(confianzaGlobal, t.mesConfianza);
    for (const c of t.categorias) for (const k of CAMPOS_FILA) confianzaGlobal = peor(confianzaGlobal, c[k].confianza);
  }

  return {
    cct: CCT_422,
    estado: 'PROPUESTA',
    extraccion: meta.extraccion,
    partes: ['SUVICO', 'CAESI'],
    vigenciaDesde,
    vigenciaHasta,
    tramos,
    conceptos: CONCEPTOS_422,
    noRemunerativoSeIncorporaAlBasicoDesde: lectura.noRemunerativoSeIncorporaAlBasicoDesde || null,
    fuente: {
      url: meta.fuenteUrl ?? lectura.fuente?.url ?? null,
      titulo: meta.titulo ?? lectura.fuente?.titulo ?? null,
      disposicion: lectura.fuente?.disposicion ?? null,
      expediente: lectura.fuente?.expediente ?? null,
      documentoRE: lectura.fuente?.documentoRE ?? null,
      acuerdoNro: lectura.fuente?.acuerdoNro ?? null,
      boletinOficial: lectura.fuente?.boletinOficial ?? null,
    },
    documentoHash: meta.documentoHash,
    confianzaGlobal,
    advertencias,
    generadoEn: (meta.ahora || new Date()).toISOString(),
  };
}

const NUM = '(\\d{1,3}(?:\\.\\d{3})+|\\d{3,})';
const FILA_TABLA_RE = new RegExp(`^\\s*(\\p{L}[\\p{L}\\s.°]*?)\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s*$`, 'u');
const CABECERA_TABLA_RE = /categor[ií]a\s+sueldo\s+b[aá]sico/i;

/**
 * Anexo de la disposición homologatoria con capa de texto (pypdf). Una tabla por mes, 14 filas,
 * columnas Básico / Presentismo / Viático / Adic. no rem. / Total. Los rótulos de mes del anexo
 * salen desordenados en la capa de texto: los tramos se asignan por posición dentro de la vigencia.
 */
export function parsearAnexoOficial422(
  texto: string,
  meta: { fuenteUrl?: string | null; titulo?: string | null } = {},
): PropuestaEscala422 | { ok: false; codigo: string } {
  const crudo = String(texto || '');
  if (crudo.replace(/\s+/g, '').length < 80) return { ok: false, codigo: 'SIN_CAPA_DE_TEXTO' };
  const plano = sinAcento(crudo).replace(/\s+/g, ' ');
  if (!/422\s*\/\s*05/.test(plano)) return { ok: false, codigo: 'CONVENIO_NO_RECONOCIDO' };

  const lineas = crudo.split(/\r?\n/);
  const tablas: LecturaFila[][] = [];
  let actual: LecturaFila[] | null = null;
  for (const linea of lineas) {
    if (CABECERA_TABLA_RE.test(linea)) {
      actual = [];
      tablas.push(actual);
      continue;
    }
    const m = linea.match(FILA_TABLA_RE);
    if (!m) continue;
    if (!actual) {
      actual = [];
      tablas.push(actual);
    }
    actual.push({
      categoria: m[1].trim(),
      basico: pesos(m[2]),
      presentismo: pesos(m[3]),
      viatico: pesos(m[4]),
      noRemunerativo: pesos(m[5]),
      total: pesos(m[6]),
    });
  }
  const tablasConFilas = tablas.filter((t) => t.length);
  if (!tablasConFilas.length) return { ok: false, codigo: 'SIN_TABLAS' };

  const anioMatch = plano.match(new RegExp(`meses de (${MES_RE}) a (${MES_RE}) de (\\d{4})`, 'i'));
  const desdeMatch = plano.match(/a partir del (\d{2})\/(\d{2})\/(\d{4})/i);
  const anio = anioMatch?.[3] || desdeMatch?.[3] || '';
  let mesesVigencia: string[] = [];
  if (anioMatch) {
    const ini = mesDesdeNombre(anioMatch[1], anioMatch[3]);
    const fin = mesDesdeNombre(anioMatch[2], anioMatch[3]);
    if (ini && fin) {
      let cur = ini;
      while (cur <= fin) {
        mesesVigencia.push(cur);
        cur = mesSiguiente(cur);
      }
    }
  }
  const rotulos = [...sinAcento(crudo).matchAll(new RegExp(`ESCALA SALARIAL SUVICO\\s*-\\s*(${MES_RE})(?:\\s+(\\d{4}))?`, 'gi'))]
    .map((r) => mesDesdeNombre(r[1], r[2] || anio))
    .filter((x): x is string => !!x && /^\d{4}-\d{2}$/.test(x))
    .sort();
  if (!mesesVigencia.length && rotulos.length) mesesVigencia = [...new Set(rotulos)];

  const notas: string[] = [];
  if (mesesVigencia.length && mesesVigencia.length !== tablasConFilas.length) {
    notas.push(`El acta declara ${mesesVigencia.length} meses y el anexo trae ${tablasConFilas.length} tablas`);
  }
  if (rotulos.length && mesesVigencia.length && rotulos.join(',') !== mesesVigencia.join(',')) {
    notas.push('Los rótulos de mes del anexo no coinciden con los meses del acta');
  }

  const lineasPlanas = sinAcento(crudo).split(/\r?\n/);
  const cabeceraMeses = lineasPlanas
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && l.split(/\s+/).every((w) => MESES[w] !== undefined) && l.split(/\s+/).length >= 2)
    .map((l) => l.split(/\s+/))[0] || [];
  const filaAdicional = (nombre: RegExp): number[] => {
    const l = lineasPlanas.find((x) => nombre.test(x));
    if (!l) return [];
    return [...l.matchAll(/\$\s*([\d.]+)/g)].map((r) => pesos(r[1]) as number);
  };
  const aero = filaAdicional(/^\s*aeroportuario/i);
  const vac = filaAdicional(/^\s*adicional vacaciones/i);
  const mesesAdic = cabeceraMeses.map((n) => mesDesdeNombre(n, anio)).filter((x): x is string => !!x);

  const tramos: LecturaTramo[] = tablasConFilas.map((filas, i) => {
    const mes = mesesVigencia[i] || null;
    const idx = mes ? mesesAdic.indexOf(mes) : -1;
    return {
      mes,
      mesPorPosicion: true,
      filas,
      aeroportuario: idx >= 0 ? aero[idx] ?? null : null,
      adicionalVacacionesPorDia: idx >= 0 ? vac[idx] ?? null : null,
    };
  });

  const incorpora = plano.match(new RegExp(`incorporara a los salarios basicos en el mes de (${MES_RE})(?: de)? (\\d{4})`, 'i'));
  const di = plano.match(/DI-\d{4}-\d+-APN-[A-Z0-9#]+/);
  const ex = plano.match(/EX-\d{4}-\d+-\s*-?\s*APN-[A-Z0-9#]+/);
  const re = plano.match(/RE-\d{4}-\d+-APN-[A-Z0-9#]+/);
  const acu = plano.match(/registrado bajo el numero\s*(\d+\/\d{2})/i);
  const incorporaMes = incorpora ? mesDesdeNombre(incorpora[1], incorpora[2]) : null;

  const lectura: Lectura = {
    tramos,
    vigenciaDesde: desdeMatch ? `${desdeMatch[3]}-${desdeMatch[2]}-${desdeMatch[1]}` : mesesVigencia[0] ? `${mesesVigencia[0]}-01` : null,
    vigenciaHasta: mesesVigencia.length ? ultimoDiaDelMes(mesesVigencia[mesesVigencia.length - 1]) : null,
    noRemunerativoSeIncorporaAlBasicoDesde: incorporaMes ? `${incorporaMes}-01` : null,
    fuente: {
      disposicion: di ? di[0] : null,
      expediente: ex ? ex[0].replace(/\s+/g, '').replace(/--/g, '-') : null,
      documentoRE: re ? re[0] : null,
      acuerdoNro: acu ? acu[1] : null,
    },
    notas,
  };
  return armarPropuesta422(lectura, {
    extraccion: 'TEXTO_OFICIAL',
    documentoHash: sha256Hex(crudo),
    fuenteUrl: meta.fuenteUrl ?? null,
    titulo: meta.titulo ?? null,
  });
}

export function esPropuesta(x: unknown): x is PropuestaEscala422 {
  return !!x && typeof x === 'object' && (x as PropuestaEscala422).estado === 'PROPUESTA';
}

/** Prompt y esquema de respuesta para leer el PDF escaneado con Gemini (visión). */
export const GEMINI_PROMPT_422 = [
  'Sos un extractor de tablas salariales. El PDF adjunto es la escala salarial escaneada del CCT 422/05 (SUVICO – CAESI, vigiladores de Córdoba, Argentina).',
  'Cada tabla corresponde a un mes y tiene 14 categorías con las columnas Básico, Presentismo, Viático (Art. 106 LCT), Adicional No Remunerativo y Total Bruto.',
  'Devolvé exclusivamente JSON con el esquema indicado. Reglas:',
  '- Importes en pesos como enteros sin puntos ni símbolo (ej. 867200). Si una celda no se lee, poné null y bajá la confianza de la fila.',
  '- No inventes valores ni completes por cálculo: copiá lo que está impreso. El total es el impreso, no la suma.',
  '- "mes" en formato YYYY-MM tomado del rótulo de la tabla (ej. "ENERO 2026" → "2026-01"); si el rótulo no trae año, inferilo del título o de la vigencia y bajá confianzaMes.',
  '- "categoria" es el texto tal cual aparece en la primera columna.',
  '- "confianza" (0 a 1) por fila: qué tan legible y segura es la lectura de esa fila. "confianzaMes" lo mismo para el rótulo del mes.',
  '- Si la página trae Adicional Aeroportuario o Adicional por Vacaciones (por día) para ese mes, informalos en el tramo; si no, null.',
  '- "vigenciaDesde"/"vigenciaHasta" (YYYY-MM-DD) solo si el documento lo dice; si no, null.',
  '- En "notas" anotá cualquier cosa que RRHH deba revisar (celdas borrosas, páginas incompletas, tablas duplicadas).',
].join('\n');

export const GEMINI_RESPONSE_SCHEMA_422 = {
  type: 'OBJECT',
  properties: {
    convenio: { type: 'STRING', nullable: true },
    vigenciaDesde: { type: 'STRING', nullable: true },
    vigenciaHasta: { type: 'STRING', nullable: true },
    tramos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          mes: { type: 'STRING', nullable: true },
          mesLabel: { type: 'STRING', nullable: true },
          confianzaMes: { type: 'NUMBER' },
          aeroportuario: { type: 'INTEGER', nullable: true },
          adicionalVacacionesPorDia: { type: 'INTEGER', nullable: true },
          filas: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                categoria: { type: 'STRING' },
                basico: { type: 'INTEGER', nullable: true },
                presentismo: { type: 'INTEGER', nullable: true },
                viatico: { type: 'INTEGER', nullable: true },
                noRemunerativo: { type: 'INTEGER', nullable: true },
                total: { type: 'INTEGER', nullable: true },
                confianza: { type: 'NUMBER' },
              },
              required: ['categoria', 'confianza'],
            },
          },
        },
        required: ['filas', 'confianzaMes'],
      },
    },
    notas: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['tramos'],
} as const;

/** Respuesta JSON de Gemini → Lectura. Tolera meses sin año y rótulos en texto. */
export function lecturaDesdeGemini(json: unknown): Lectura {
  const raw = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const tramosRaw = Array.isArray(raw.tramos) ? raw.tramos : [];
  const notas = Array.isArray(raw.notas) ? raw.notas.map(String) : [];
  const anioDeclarado = String(raw.vigenciaDesde || '').match(/^(\d{4})-/)?.[1] || null;
  const tramos: LecturaTramo[] = tramosRaw.map((t) => {
    const tr = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
    let mes: string | null = typeof tr.mes === 'string' && /^\d{4}-\d{2}$/.test(tr.mes) ? tr.mes : null;
    if (!mes && typeof tr.mesLabel === 'string') {
      const m = sinAcento(tr.mesLabel).match(new RegExp(`(${MES_RE})\\s*(?:de\\s*)?(\\d{4})?`, 'i'));
      const anioLabel = m?.[2] || anioDeclarado;
      if (m && anioLabel) mes = mesDesdeNombre(m[1], anioLabel);
    }
    const filas = (Array.isArray(tr.filas) ? tr.filas : []).map((f) => {
      const fr = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
      return {
        categoria: String(fr.categoria ?? ''),
        basico: pesos(fr.basico),
        presentismo: pesos(fr.presentismo),
        viatico: pesos(fr.viatico),
        noRemunerativo: pesos(fr.noRemunerativo),
        total: pesos(fr.total),
        confianza: typeof fr.confianza === 'number' ? fr.confianza : null,
      };
    });
    return {
      mes,
      mesLabel: typeof tr.mesLabel === 'string' ? tr.mesLabel : null,
      confianzaMes: typeof tr.confianzaMes === 'number' ? tr.confianzaMes : null,
      filas,
      aeroportuario: pesos(tr.aeroportuario),
      adicionalVacacionesPorDia: pesos(tr.adicionalVacacionesPorDia),
    };
  });
  const convenio = String(raw.convenio || '');
  if (convenio && !/422/.test(convenio)) notas.push(`El modelo leyó convenio «${convenio}», no 422/05`);
  return {
    tramos,
    vigenciaDesde: typeof raw.vigenciaDesde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.vigenciaDesde) ? raw.vigenciaDesde : null,
    vigenciaHasta: typeof raw.vigenciaHasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.vigenciaHasta) ? raw.vigenciaHasta : null,
    notas,
  };
}

export interface DiferenciaEscala {
  mes: string;
  codigo: string;
  campo: string;
  a: number | null;
  b: number | null;
}

/** Compara dos propuestas campo a campo (por mes y categoría). Sirve para validar Gemini contra el anexo oficial. */
export function compararPropuestas(a: PropuestaEscala422, b: PropuestaEscala422): DiferenciaEscala[] {
  const out: DiferenciaEscala[] = [];
  const meses = new Set([...a.tramos.map((t) => t.mes), ...b.tramos.map((t) => t.mes)]);
  for (const mes of [...meses].sort()) {
    const ta = a.tramos.find((t) => t.mes === mes);
    const tb = b.tramos.find((t) => t.mes === mes);
    if (!ta || !tb) {
      out.push({ mes, codigo: '*', campo: 'tramo', a: ta ? 1 : null, b: tb ? 1 : null });
      continue;
    }
    const codigos = new Set([...ta.categorias.map((c) => c.codigo), ...tb.categorias.map((c) => c.codigo)]);
    for (const codigo of codigos) {
      const ca = ta.categorias.find((c) => c.codigo === codigo);
      const cb = tb.categorias.find((c) => c.codigo === codigo);
      if (!ca || !cb) {
        out.push({ mes, codigo, campo: 'categoria', a: ca ? 1 : null, b: cb ? 1 : null });
        continue;
      }
      for (const k of CAMPOS_FILA) if (ca[k].valor !== cb[k].valor) out.push({ mes, codigo, campo: k, a: ca[k].valor, b: cb[k].valor });
    }
    for (const k of ['aeroportuario', 'adicionalVacacionesPorDia'] as const) {
      const va = ta[k]?.valor ?? null;
      const vb = tb[k]?.valor ?? null;
      if (va !== vb) out.push({ mes, codigo: '*', campo: k, a: va, b: vb });
    }
  }
  return out;
}

function fmt(n: number | null): string {
  return n == null ? '—' : n.toLocaleString('es-AR');
}

/** Tabla de texto para consola o log: una línea por categoría y mes, con la confianza más baja de la fila. */
export function tablaPropuesta(p: PropuestaEscala422): string {
  const lineas: string[] = [];
  lineas.push(`${p.cct} · ${p.extraccion} · ${p.estado} · vigencia ${p.vigenciaDesde ?? '?'} → ${p.vigenciaHasta ?? '?'} · confianza ${p.confianzaGlobal}`);
  if (p.fuente.disposicion || p.fuente.acuerdoNro) {
    lineas.push(`Fuente: ${p.fuente.disposicion ?? ''}${p.fuente.acuerdoNro ? ` · Acuerdo ${p.fuente.acuerdoNro}` : ''} ${p.fuente.expediente ?? ''}`.trim());
  }
  for (const t of p.tramos) {
    lineas.push('');
    const extras = [
      t.aeroportuario ? `aeroportuario ${fmt(t.aeroportuario.valor)}` : '',
      t.adicionalVacacionesPorDia ? `vacaciones/día ${fmt(t.adicionalVacacionesPorDia.valor)}` : '',
    ].filter(Boolean).join(' · ');
    lineas.push(`— ${t.mes} (mes ${t.mesConfianza}${t.mesMotivo ? ` ${t.mesMotivo}` : ''})${extras ? ` · ${extras}` : ''}`);
    lineas.push(`${'Categoría'.padEnd(44)} ${'ARCA'.padEnd(6)} ${'Básico'.padStart(11)} ${'Present.'.padStart(10)} ${'Viático'.padStart(10)} ${'No rem.'.padStart(9)} ${'Total'.padStart(11)}  Conf.`);
    for (const c of t.categorias) {
      const conf = CAMPOS_FILA.map((k) => c[k].confianza).reduce(peor, 'ALTA');
      const motivo = CAMPOS_FILA.map((k) => c[k].motivo).find((m) => m && m !== 'SUMA_NO_VERIFICABLE');
      lineas.push(`${c.label.padEnd(44)} ${(c.codigoArca ?? '').padEnd(6)} ${fmt(c.basico.valor).padStart(11)} ${fmt(c.presentismo.valor).padStart(10)} ${fmt(c.viatico.valor).padStart(10)} ${fmt(c.noRemunerativo.valor).padStart(9)} ${fmt(c.total.valor).padStart(11)}  ${conf}${motivo ? ` (${motivo})` : ''}`);
    }
  }
  if (p.advertencias.length) {
    lineas.push('');
    lineas.push('Advertencias:');
    for (const a of p.advertencias) lineas.push(`  · ${a}`);
  }
  return lineas.join('\n');
}
