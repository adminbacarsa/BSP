/** Dock de Planificación: una sola pastilla y el lugar del cartel de 12 h. */

export type PestanaPanel = 'faltantes' | 'avisos' | 'consultas';

export type EstadoPaneles = {
  abierto: boolean;
  pestana: PestanaPanel;
};

export const PANELES_KEY = 'cosp-planif-paneles';

export const TEXTO_PIN_AVISOS =
  'Descanso de 8 a 12 h y tope de 200 h piden PIN al publicar; con menos de 8 h no se puede publicar.';

export type Caja = { left: number; top: number; width: number; height: number };

const PESTANAS: PestanaPanel[] = ['faltantes', 'avisos', 'consultas'];

export function leerEstadoPaneles(raw: string | null): EstadoPaneles | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { abierto?: unknown; pestana?: unknown };
    const pestana = PESTANAS.includes(data.pestana as PestanaPanel) ? (data.pestana as PestanaPanel) : 'faltantes';
    return { abierto: data.abierto === true, pestana };
  } catch {
    return null;
  }
}

export function serializarEstadoPaneles(estado: EstadoPaneles): string {
  return JSON.stringify({ abierto: estado.abierto, pestana: estado.pestana });
}

function cuenta(n: number, uno: string, muchos: string): string {
  return `${n} ${n === 1 ? uno : muchos}`;
}

/** «1 faltante · 1 aviso · 0 consultas». */
export function textoPastilla(faltantes: number, avisos: number, consultas: number): string {
  return `${cuenta(faltantes, 'faltante', 'faltantes')} · ${cuenta(avisos, 'aviso', 'avisos')} · ${cuenta(consultas, 'consulta', 'consultas')}`;
}

export function textoPestana(pestana: PestanaPanel, n: number): string {
  const label = pestana === 'faltantes' ? 'Faltantes' : pestana === 'avisos' ? 'Avisos' : 'Consultas';
  return `${label} (${n})`;
}

export function resumenFaltantes(conPropuesta: number, sinPropuesta: number): string {
  return `${conPropuesta} con propuesta de 12 h · ${sinPropuesta} para consultar franco`;
}

export function filaFaltante(f: { dateStr: string; positionName: string; banda: string; propuestaTexto: string }): string {
  const dia = `${f.dateStr.slice(8, 10)}/${f.dateStr.slice(5, 7)}`;
  const propuesta = f.propuestaTexto.trim() || 'sin par de 12 h';
  return `${dia} · ${f.positionName} · ${f.banda} · ${propuesta}`;
}

function solapa(a: Caja, b: Caja): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, max));
}

/**
 * El cartel arranca debajo de la celda. Si pisa el panel, pasa al otro lado
 * (arriba, después a la izquierda, después a la derecha).
 */
export function ubicarCierre12(input: {
  ancla: Caja;
  panel: Caja | null;
  viewport: { width: number; height: number };
  ancho: number;
  alto: number;
  margen?: number;
}): { left: number; top: number; lado: 'abajo' | 'arriba' | 'izquierda' | 'derecha' } {
  const margen = input.margen ?? 8;
  const { ancla, panel, viewport, ancho, alto } = input;
  const maxL = Math.max(margen, viewport.width - ancho - margen);
  const maxT = Math.max(margen, viewport.height - alto - margen);
  const candidatos: Array<{ left: number; top: number; lado: 'abajo' | 'arriba' | 'izquierda' | 'derecha' }> = [
    { lado: 'abajo', left: clamp(ancla.left, margen, maxL), top: clamp(ancla.top + ancla.height + 6, margen, maxT) },
    { lado: 'arriba', left: clamp(ancla.left, margen, maxL), top: clamp(ancla.top - alto - 6, margen, maxT) },
    { lado: 'izquierda', left: clamp(ancla.left - ancho - 6, margen, maxL), top: clamp(ancla.top, margen, maxT) },
    { lado: 'derecha', left: clamp(ancla.left + ancla.width + 6, margen, maxL), top: clamp(ancla.top, margen, maxT) },
  ];
  const caja = (c: { left: number; top: number }): Caja => ({ left: c.left, top: c.top, width: ancho, height: alto });
  const libre = (c: { left: number; top: number }) => !panel || !solapa(caja(c), panel);
  return candidatos.find(libre) || candidatos[0];
}
