/**
 * Lectura de planilla que devuelve la IA, y el armado del texto que se le manda.
 * Sin Firebase: lo usan la callable y el navegador (validar, anonimizar, comparar).
 */

export const TIPOS_PUESTO_IA = ['PUESTO', 'FUNCION', 'REFUERZO', 'CUSTOM'] as const;
export const TIPOS_LEYENDA_IA = ['TURNO', 'REFUERZO', 'FRANCO', 'EVENTO', '12H', 'LICENCIA', 'RETEN', 'OTRO_OBJETIVO'] as const;
export const MAX_IMAGEN_BYTES = 5 * 1024 * 1024;

export type TipoPuestoIa = (typeof TIPOS_PUESTO_IA)[number];
export type TipoLeyendaIa = (typeof TIPOS_LEYENDA_IA)[number];

export type PuestoIa = { nombre: string; filas: number[]; tipo: TipoPuestoIa; confianza: number };
export type LeyendaIa = {
  codigo: string;
  color?: string;
  puesto?: string;
  banda?: string;
  inicio: string;
  fin: string;
  tipo: TipoLeyendaIa;
  confianza: number;
};
export type FuncionIa = { nombre: string; cubre: string[]; confianza: number };
export type ExcepcionDiaIa = {
  dia: number;
  filas?: number[];
  codigo: string;
  inicio: string;
  fin: string;
  fuente: 'nota' | 'color';
  confianza: number;
};

export type LecturaPlanillaIa = {
  puestos: PuestoIa[];
  leyenda: LeyendaIa[];
  funciones: FuncionIa[];
  excepcionesPorDia: ExcepcionDiaIa[];
  dudas: string[];
};

export type CeldaIa = { fila: number; col: number; texto: string; fondo?: string; letra?: string };
export type GrillaPlanillaIa = {
  year: number;
  month: number;
  titulo?: string;
  celdas: CeldaIa[];
  combinadas: Array<{ fila: number; col: number; filas: number; cols: number }>;
  bloquesPuesto: Array<{ nombre: string; desde: number; hasta: number }>;
  notas: Array<{ fila: number; texto: string }>;
  referencias: Array<{ codigo: string; desc?: string; inicio: string; fin: string; color?: string }>;
  /** Fila de la grilla sin el nombre: la etiqueta es «fila N» y el legajo queda. */
  dotacion: Array<{ fila: number; etiqueta: string; legajo?: string }>;
};

const NO_PERSONA = new Set([
  'PUESTO', 'PLAYA', 'CORTINA', 'REFUERZO', 'RELEVANTE', 'VOLANTE', 'RETEN', 'RETENIDO',
  'REFERENCIAS', 'REFERENCIA', 'NOTA', 'NOTAS', 'FRANCO', 'SABADO', 'DOMINGO', 'FINDE',
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE',
  'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'MANANA', 'TARDE', 'NOCHE', 'TURNO', 'OBJETIVO',
  'CLIENTE', 'SERVICIO', 'HORARIO', 'DESDE', 'HASTA', 'LEGAJO', 'NOMBRE', 'APELLIDO',
  'DESC', 'HS', 'HORAS', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES',
]);

export function pareceNombrePersona(texto: string): boolean {
  const limpio = String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (!limpio || limpio.length > 48) return false;
  const parts = limpio.split(' ').filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  if (parts.some((p) => NO_PERSONA.has(p) || /\d/.test(p))) return false;
  return parts.every((p) => /^[A-Z]{2,}$/.test(p));
}

export function sanearTexto(texto: string, reemplazo: string): string {
  const t = String(texto ?? '');
  return pareceNombrePersona(t) ? reemplazo : t;
}

export function contieneNombrePersona(value: unknown): boolean {
  if (typeof value === 'string') return pareceNombrePersona(value);
  if (Array.isArray(value)) return value.some((v) => contieneNombrePersona(v));
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some((v) => contieneNombrePersona(v));
  return false;
}

export function horaIa(valor: unknown): string {
  const m = String(valor ?? '').match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function confianzaDe(valor: unknown, ruta: string): number {
  if (valor == null || valor === '') return 0.5;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${ruta}: la confianza tiene que estar entre 0 y 1`);
  return Math.round(n * 100) / 100;
}

function textoCorto(valor: unknown, ruta: string, max = 80): string {
  const t = sanearTexto(String(valor ?? '').trim(), 'fila');
  if (t.length > max) throw new Error(`${ruta}: el texto supera ${max} caracteres`);
  return t;
}

function enteros(valor: unknown, ruta: string, max: number): number[] {
  if (valor == null) return [];
  if (!Array.isArray(valor)) throw new Error(`${ruta}: se esperaba una lista de filas`);
  if (valor.length > max) throw new Error(`${ruta}: demasiadas filas`);
  return valor.map((n, i) => {
    const v = Number(n);
    if (!Number.isInteger(v) || v < 1 || v > 500) throw new Error(`${ruta}[${i}]: fila inválida`);
    return v;
  });
}

function objeto(valor: unknown, ruta: string): Record<string, unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error(`${ruta}: se esperaba un objeto`);
  return valor as Record<string, unknown>;
}

export function validarLecturaIa(raw: unknown): LecturaPlanillaIa {
  const doc = objeto(raw, 'lectura');
  const puestosRaw = Array.isArray(doc.puestos) ? doc.puestos : [];
  const leyendaRaw = Array.isArray(doc.leyenda) ? doc.leyenda : [];
  const funcionesRaw = Array.isArray(doc.funciones) ? doc.funciones : [];
  const excepcionesRaw = Array.isArray(doc.excepcionesPorDia) ? doc.excepcionesPorDia : [];
  const dudasRaw = Array.isArray(doc.dudas) ? doc.dudas : [];
  // Un ítem mal armado por el modelo (una referencia sin horario) no tira la lectura entera: se saltea y queda en dudas.
  const salteados: string[] = [];
  const cadaUno = <T,>(lista: unknown[], max: number, fn: (item: unknown, i: number) => T): T[] => {
    const out: T[] = [];
    lista.slice(0, max).forEach((item, i) => {
      try { out.push(fn(item, i)); } catch (e) { salteados.push((e as Error).message); }
    });
    return out;
  };

  const puestos: PuestoIa[] = cadaUno(puestosRaw, 40, (item, i) => {
    const o = objeto(item, `puestos[${i}]`);
    const tipo = String(o.tipo || '').toUpperCase();
    if (!TIPOS_PUESTO_IA.includes(tipo as TipoPuestoIa)) throw new Error(`puestos[${i}].tipo inválido`);
    const nombre = textoCorto(o.nombre, `puestos[${i}].nombre`);
    if (!nombre) throw new Error(`puestos[${i}].nombre vacío`);
    return { nombre, filas: enteros(o.filas, `puestos[${i}].filas`, 40), tipo: tipo as TipoPuestoIa, confianza: confianzaDe(o.confianza, `puestos[${i}]`) };
  });

  const leyenda: LeyendaIa[] = cadaUno(leyendaRaw, 80, (item, i) => {
    const o = objeto(item, `leyenda[${i}]`);
    const tipo = String(o.tipo || '').toUpperCase();
    if (!TIPOS_LEYENDA_IA.includes(tipo as TipoLeyendaIa)) throw new Error(`leyenda[${i}].tipo inválido`);
    const inicio = horaIa(o.inicio);
    const fin = horaIa(o.fin);
    if (!inicio || !fin) throw new Error(`leyenda[${i}]: falta el horario`);
    const codigo = textoCorto(o.codigo, `leyenda[${i}].codigo`, 24);
    if (!codigo) throw new Error(`leyenda[${i}].codigo vacío`);
    const out: LeyendaIa = { codigo, inicio, fin, tipo: tipo as TipoLeyendaIa, confianza: confianzaDe(o.confianza, `leyenda[${i}]`) };
    const color = textoCorto(o.color, `leyenda[${i}].color`, 32);
    const puesto = textoCorto(o.puesto, `leyenda[${i}].puesto`);
    const banda = textoCorto(o.banda, `leyenda[${i}].banda`, 16);
    if (color) out.color = color;
    if (puesto) out.puesto = puesto;
    if (banda) out.banda = banda;
    return out;
  });

  const funciones: FuncionIa[] = cadaUno(funcionesRaw, 20, (item, i) => {
    const o = objeto(item, `funciones[${i}]`);
    const nombre = textoCorto(o.nombre, `funciones[${i}].nombre`);
    if (!nombre) throw new Error(`funciones[${i}].nombre vacío`);
    const cubreRaw = Array.isArray(o.cubre) ? o.cubre : [];
    if (cubreRaw.length > 12) throw new Error(`funciones[${i}]: demasiados puestos`);
    return {
      nombre,
      cubre: cubreRaw.map((c, j) => textoCorto(c, `funciones[${i}].cubre[${j}]`)).filter(Boolean),
      confianza: confianzaDe(o.confianza, `funciones[${i}]`),
    };
  });

  const excepcionesPorDia: ExcepcionDiaIa[] = cadaUno(excepcionesRaw, 62, (item, i) => {
    const o = objeto(item, `excepcionesPorDia[${i}]`);
    const dia = Number(o.dia);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) throw new Error(`excepcionesPorDia[${i}].dia inválido`);
    const fuente = String(o.fuente || '').toLowerCase();
    if (fuente !== 'nota' && fuente !== 'color') throw new Error(`excepcionesPorDia[${i}].fuente inválida`);
    const inicio = horaIa(o.inicio);
    const fin = horaIa(o.fin);
    if (!inicio || !fin) throw new Error(`excepcionesPorDia[${i}]: falta el horario`);
    const codigo = textoCorto(o.codigo, `excepcionesPorDia[${i}].codigo`, 24);
    if (!codigo) throw new Error(`excepcionesPorDia[${i}].codigo vacío`);
    const out: ExcepcionDiaIa = { dia, codigo, inicio, fin, fuente, confianza: confianzaDe(o.confianza, `excepcionesPorDia[${i}]`) };
    const filas = enteros(o.filas, `excepcionesPorDia[${i}].filas`, 40);
    if (filas.length) out.filas = filas;
    return out;
  });

  const dudas = cadaUno(dudasRaw, 20, (d, i) => textoCorto(d, `dudas[${i}]`, 200)).filter(Boolean);
  if (salteados.length) {
    dudas.push(`La IA devolvió ${salteados.length} dato(s) incompleto(s) que no se usaron (${salteados.slice(0, 3).join('; ')}${salteados.length > 3 ? '…' : ''}).`.slice(0, 200));
  }
  return { puestos, leyenda, funciones, excepcionesPorDia, dudas };
}

function sanearValor(valor: unknown, fila: number): unknown {
  if (typeof valor === 'string') return sanearTexto(valor, `fila ${fila || ''}`.trim());
  if (Array.isArray(valor)) return valor.map((v) => sanearValor(v, fila));
  if (valor && typeof valor === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) out[k] = sanearValor(v, fila);
    return out;
  }
  return valor;
}

/** Defensa del servidor: ningún string con forma de nombre llega al modelo. */
export function sanearGrilla(raw: unknown): GrillaPlanillaIa {
  const doc = objeto(raw, 'grilla');
  const saneado = sanearValor(doc, 0) as Record<string, unknown>;
  const year = Number(saneado.year);
  const month = Number(saneado.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Año inválido');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Mes inválido');
  const celdasRaw = Array.isArray(saneado.celdas) ? saneado.celdas : [];
  if (celdasRaw.length > 4000) throw new Error('La grilla supera el tamaño que se puede leer');
  const celdas: CeldaIa[] = celdasRaw.map((item, i) => {
    const o = objeto(item, `celdas[${i}]`);
    const fila = Number(o.fila);
    const col = Number(o.col);
    if (!Number.isInteger(fila) || !Number.isInteger(col)) throw new Error(`celdas[${i}] sin fila o columna`);
    const texto = sanearTexto(String(o.texto ?? '').slice(0, 80), `fila ${fila}`);
    const celda: CeldaIa = { fila, col, texto };
    const fondo = String(o.fondo || '').slice(0, 32);
    const letra = String(o.letra || '').slice(0, 32);
    if (fondo) celda.fondo = fondo;
    if (letra) celda.letra = letra;
    return celda;
  });
  const lista = (clave: string, max: number) => {
    const arr = Array.isArray(saneado[clave]) ? saneado[clave] as unknown[] : [];
    if (arr.length > max) throw new Error(`${clave}: demasiados ítems`);
    return arr;
  };
  return {
    year,
    month,
    titulo: saneado.titulo ? String(saneado.titulo).slice(0, 80) : undefined,
    celdas,
    combinadas: lista('combinadas', 200) as GrillaPlanillaIa['combinadas'],
    bloquesPuesto: lista('bloquesPuesto', 40) as GrillaPlanillaIa['bloquesPuesto'],
    notas: lista('notas', 40) as GrillaPlanillaIa['notas'],
    referencias: lista('referencias', 80) as GrillaPlanillaIa['referencias'],
    dotacion: lista('dotacion', 400) as GrillaPlanillaIa['dotacion'],
  };
}

export const PROMPT_PLANILLA_IA = `Leé una planilla de cronograma de vigilancia ya parseada. Los nombres de las personas fueron reemplazados por «fila N»: no los inventes ni los pidas.
Devolvé solo JSON con esta forma:
- puestos[]: {nombre, filas[], tipo PUESTO|FUNCION|REFUERZO|CUSTOM, confianza 0 a 1}
- leyenda[]: {codigo, color?, puesto?, banda?, inicio HH:MM, fin HH:MM, tipo TURNO|REFUERZO|FRANCO|EVENTO|12H|LICENCIA|RETEN|OTRO_OBJETIVO, confianza}
- funciones[]: {nombre, cubre[] puestos que cubre, confianza}. Relevante, volante y retén son FUNCION, no puestos.
- excepcionesPorDia[]: {dia, filas?, codigo, inicio, fin, fuente nota|color, confianza} cuando una nota o un color pisa el horario de ese día.
- dudas[]: frases cortas de lo que no se pudo asegurar.
Reglas de estas planillas: el horario de M/T/N sale del bloque PUESTO y de REFERENCIAS de ese puesto (Puesto 1 M puede ser 08:00-15:00 y Puesto 5 M 07:00-15:00). El verde de Cortina es el sábado (CS), no el horario de lunes a viernes. Refuerzo tiene dos relojes: uno por color y otro por la nota (11:00-23:00 y 12:00-22:00). RETEN no es un puesto: tipo RETEN y horario 00:00-00:00. Una M o N roja es jornada de 12 h solo si se repite como esquema. confianza es 0 a 1 por ítem.`;

export function textoParaModelo(grilla: GrillaPlanillaIa): string {
  return `${PROMPT_PLANILLA_IA}\n\nGrilla:\n${JSON.stringify(grilla)}`;
}
