/**
 * Un código de planilla que no se reconoce se define en el resumen.
 * FT/N es franco trabajado en la N. VF/T, BANCO, STOCK y parecidos son otro objetivo:
 * la celda de este cronograma queda vacía.
 */

export type ParteDefinicion =
  | { tipo: 'catalogo'; code: string }
  | { tipo: 'banda'; code: string }
  | { tipo: 'franja'; code: string; inicio: string; fin: string; nueva: boolean }
  | { tipo: 'otro_objetivo'; etiqueta: string };

export type PropuestaCodigo = {
  texto: string;
  partes: ParteDefinicion[];
  vaciar: boolean;
  nota: string;
};

const OTRO = /^(VF|BANCO|STOCK|DECAT|MISE|PM)(\b|[\d/])/i;

function limpio(raw: string): string {
  return String(raw || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function etiquetaOtro(texto: string): string {
  const base = texto.split('/')[0].trim();
  if (base.startsWith('VF')) return 'Vifood';
  if (base.startsWith('MISE')) return 'Misericordia';
  return base;
}

/** Propuesta al abrir «Definir». El planificador puede cambiar las partes. */
export function proponerDefinicion(raw: string): PropuestaCodigo {
  const texto = limpio(raw);
  const ft = texto.match(/^FT\s*\/\s*(M|T|N|D12|N12)$/);
  if (ft) {
    return {
      texto,
      vaciar: false,
      nota: `Franco trabajado en el turno ${ft[1]}`,
      partes: [{ tipo: 'catalogo', code: 'FT' }, { tipo: 'banda', code: ft[1] }],
    };
  }
  if (OTRO.test(texto.replace(/\s+/g, ''))) {
    const et = etiquetaOtro(texto);
    return {
      texto,
      vaciar: true,
      nota: `Trabaja en otro objetivo (${et}). La celda queda vacía en este cronograma.`,
      partes: [{ tipo: 'otro_objetivo', etiqueta: et }],
    };
  }
  return {
    texto,
    vaciar: false,
    nota: 'Elegí a qué equivale',
    partes: [],
  };
}

export function textoCeldasVacias(codigo: string, cantidad: number, etiqueta: string): string {
  return `Se dejan vacías ${cantidad} celdas: trabajan en otro objetivo (${codigo} → ${etiqueta})`;
}

export type EquivalenciaGuardada = {
  clave: string;
  codigo: string;
  color: 'red' | 'none';
  code: string;
  startTime: string;
  endTime: string;
  muestras: number;
  otroObjetivo?: string;
  partes?: string[];
};

/** Lo definido se guarda en la tabla del objetivo y se aplica a todas las celdas de esa sigla. */
export function equivalenciaDeDefinicion(texto: string, prop: PropuestaCodigo, rojo = false): EquivalenciaGuardada {
  const codigo = limpio(texto).replace(/[\s.\-]/g, '');
  if (prop.vaciar) {
    const et = prop.partes.find((p) => p.tipo === 'otro_objetivo');
    return {
      clave: `${codigo}|${rojo ? 'red' : 'none'}`,
      codigo,
      color: rojo ? 'red' : 'none',
      code: '',
      startTime: '',
      endTime: '',
      muestras: 1,
      otroObjetivo: et && et.tipo === 'otro_objetivo' ? et.etiqueta : etiquetaOtro(texto),
    };
  }
  const banda = prop.partes.find((p) => p.tipo === 'banda' || p.tipo === 'franja' || p.tipo === 'catalogo');
  const code = banda && 'code' in banda ? banda.code : '';
  const franja = prop.partes.find((p) => p.tipo === 'franja');
  return {
    clave: `${codigo}|${rojo ? 'red' : 'none'}`,
    codigo,
    color: rojo ? 'red' : 'none',
    code,
    startTime: franja && franja.tipo === 'franja' ? franja.inicio : '',
    endTime: franja && franja.tipo === 'franja' ? franja.fin : '',
    muestras: 1,
    partes: prop.partes.map((p) => p.tipo === 'otro_objetivo' ? p.etiqueta : p.code),
  };
}

export function yaDefinido(codigo: string, tabla: readonly { codigo?: string; clave?: string; otroObjetivo?: string; code?: string }[]): boolean {
  const c = limpio(codigo).replace(/[\s.\-]/g, '');
  return tabla.some((e) => {
    const k = String(e.codigo || e.clave || '').split('|')[0];
    return k === c && (e.otroObjetivo || e.code);
  });
}
