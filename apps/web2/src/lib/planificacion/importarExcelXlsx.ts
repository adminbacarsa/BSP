import * as XLSX from 'xlsx';
import { claseDeEstilo, type CeldaPlano } from './importarExcel';

function colDe(ref: string): number {
  const m = ref.match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function filaDe(ref: string): number {
  const m = ref.match(/(\d+)$/);
  return m ? Number(m[1]) : 0;
}

/** Primera hoja del .xlsx → celdas con el color de relleno (rojo = jornada de 12 h). */
export function celdasDesdeArrayBuffer(buf: ArrayBuffer | Uint8Array): CeldaPlano[] {
  const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const wb = XLSX.read(data, { type: 'array', cellStyles: true, cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const grid = new Map<string, CeldaPlano>();
  for (const key of Object.keys(ws)) {
    if (key[0] === '!') continue;
    const celda = ws[key] as { v?: unknown; s?: { patternType?: string; fgColor?: { rgb?: string; theme?: number } } };
    if (celda.v == null || celda.v === '') continue;
    const valor = typeof celda.v === 'number' || typeof celda.v === 'string' ? celda.v : String(celda.v);
    grid.set(key, { fila: filaDe(key), col: colDe(key), valor, color: claseDeEstilo(celda.s) });
  }
  for (const merge of ws['!merges'] || []) {
    const origen = grid.get(XLSX.utils.encode_cell(merge.s));
    if (!origen) continue;
    if (merge.e.r - merge.s.r > 40 || merge.e.c - merge.s.c > 40) continue;
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (!grid.has(ref)) grid.set(ref, { fila: r + 1, col: c + 1, valor: origen.valor, color: origen.color });
      }
    }
  }
  return [...grid.values()];
}
