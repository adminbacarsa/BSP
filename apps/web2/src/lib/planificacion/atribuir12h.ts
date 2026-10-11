/**
 * A quién cubre un par D12+N12 del modo rápido.
 * Se atribuye a la licencia del titular de esa banda; si no hay, queda como banda vacante.
 * No toca coberturas elegidas en el modal (solo coverageMode 12H).
 */

export type Licencia12 = {
  empId: string;
  nombre: string;
  /** Código de la licencia (ART, V). */
  code: string;
  /** Banda que tenía (M, T, N). */
  banda: string;
  positionName: string;
  /** Primer día del rango (YYYY-MM-DD). */
  inicio: string;
  orden: number;
};

export type CeldaDia12 = {
  empId: string;
  nombre: string;
  code: string;
  positionName?: string;
  originalCode?: string;
  coverageMode?: string;
  coversBandCode?: string;
  coversPositionName?: string;
  coversEmployeeId?: string;
  orden: number;
  inicio?: string;
  isDeleted?: boolean;
};

export type Parche12 = {
  empId: string;
  limpiar: boolean;
  texto: string;
  coversEmployeeId: string;
  coversEmployeeName: string;
  coversAbsenceCode: string;
};

const BANDA = new Set(['M', 'T', 'N']);

export function apellidoDe(nombre: string): string {
  const limpio = String(nombre || '').trim();
  if (!limpio) return '';
  const antes = limpio.split(',')[0].trim();
  return antes.split(/\s+/)[0] || antes;
}

export function bandaDeOriginal(code: string): string {
  const c = String(code || '').trim().toUpperCase();
  if (BANDA.has(c)) return c;
  if (c === 'D12') return 'M';
  if (c === 'N12') return 'N';
  return '';
}

export function elegirTitular(licencias: readonly Licencia12[], banda: string, puesto: string): Licencia12 | null {
  const b = String(banda || '').trim().toUpperCase();
  const p = String(puesto || '').trim().toUpperCase();
  const deLaBanda = licencias.filter((l) => l.banda === b);
  if (!deLaBanda.length) return null;
  const mismoPuesto = deLaBanda.filter((l) => String(l.positionName || '').trim().toUpperCase() === p);
  const pool = mismoPuesto.length ? mismoPuesto : deLaBanda;
  return [...pool].sort((a, c) => a.inicio.localeCompare(c.inicio) || a.orden - c.orden)[0];
}

export function textoCubre12(p: {
  nombre: string;
  ausencia: string;
  banda: string;
  puesto: string;
}): string {
  return `Cubre a ${apellidoDe(p.nombre)} (${p.ausencia}) · ${p.banda} · ${p.puesto}`;
}

export function textoVacante12(puesto: string): string {
  return `Banda vacante de ${puesto}`;
}

export function textoCubiertaPor(lados: Array<{ nombre: string; code: 'D12' | 'N12' }>): string {
  const d = lados.find((l) => l.code === 'D12');
  const n = lados.find((l) => l.code === 'N12');
  if (!d || !n) return '';
  return `cubierta por ${apellidoDe(d.nombre)} D12 + ${apellidoDe(n.nombre)} N12`;
}

function esPar12(c: CeldaDia12): boolean {
  if (c.isDeleted) return false;
  if (String(c.coverageMode || '').toUpperCase() !== '12H') return false;
  const code = String(c.code || '').toUpperCase();
  return code === 'D12' || code === 'N12';
}

function licenciasDe(celdas: readonly CeldaDia12[]): Licencia12[] {
  const out: Licencia12[] = [];
  for (const c of celdas) {
    if (c.isDeleted) continue;
    const banda = bandaDeOriginal(c.originalCode || '');
    if (!banda) continue;
    const code = String(c.code || '').trim().toUpperCase();
    if (!code || code === 'D12' || code === 'N12' || BANDA.has(code)) continue;
    out.push({
      empId: c.empId,
      nombre: c.nombre,
      code,
      banda,
      positionName: String(c.positionName || ''),
      inicio: c.inicio || '9999-99-99',
      orden: c.orden,
    });
  }
  return out;
}

/** Recalcula la atribución del día. Solo pares 12H; el resto no se toca. */
export function recalcularDia12(celdas: readonly CeldaDia12[]): Parche12[] {
  const licencias = licenciasDe(celdas);
  const grupos = new Map<string, CeldaDia12[]>();
  for (const c of celdas) {
    if (!esPar12(c)) continue;
    const banda = String(c.coversBandCode || '').toUpperCase();
    const puesto = String(c.coversPositionName || c.positionName || '');
    const k = `${banda}|${puesto.toUpperCase()}`;
    const lista = grupos.get(k) || [];
    lista.push(c);
    grupos.set(k, lista);
  }
  const parches: Parche12[] = [];
  for (const lista of grupos.values()) {
    const banda = String(lista[0].coversBandCode || '').toUpperCase();
    const puesto = String(lista[0].coversPositionName || lista[0].positionName || '');
    const tit = banda ? elegirTitular(licencias, banda, puesto) : null;
    for (const c of lista) {
      if (!tit) {
        parches.push({
          empId: c.empId,
          limpiar: true,
          texto: textoVacante12(puesto),
          coversEmployeeId: '',
          coversEmployeeName: '',
          coversAbsenceCode: '',
        });
        continue;
      }
      parches.push({
        empId: c.empId,
        limpiar: false,
        texto: textoCubre12({ nombre: tit.nombre, ausencia: tit.code, banda, puesto }),
        coversEmployeeId: tit.empId,
        coversEmployeeName: tit.nombre,
        coversAbsenceCode: tit.code,
      });
    }
  }
  return parches;
}

export function textoTooltip12(s: {
  coverageMode?: string;
  coversEmployeeName?: string;
  coversAbsenceCode?: string;
  coversBandCode?: string;
  coversPositionName?: string;
  coversVacante?: boolean;
} | null | undefined): string {
  if (!s || String(s.coverageMode || '').toUpperCase() !== '12H') return '';
  const puesto = String(s.coversPositionName || '').trim();
  const banda = String(s.coversBandCode || '').trim().toUpperCase();
  if (s.coversEmployeeName) {
    return textoCubre12({
      nombre: s.coversEmployeeName,
      ausencia: String(s.coversAbsenceCode || banda),
      banda,
      puesto,
    });
  }
  return puesto ? textoVacante12(puesto) : '';
}

type Turno12 = {
  code?: string;
  coverageMode?: string;
  coversEmployeeId?: string;
  employeeName?: string;
  isDeleted?: boolean;
};

/** «cubierta por X D12 + Y N12» si las dos patas 12H apuntan a ese titular. */
export function textoLicencia12(
  pending: Record<string, Turno12 | null | undefined>,
  shifts: Record<string, Turno12 | null | undefined>,
  titularId: string,
  dateStr: string,
): string {
  const lados: Array<{ nombre: string; code: 'D12' | 'N12' }> = [];
  const visto = new Set<string>();
  const mirar = (raw: Turno12 | null | undefined, key: string) => {
    if (!raw || raw.isDeleted) return;
    if (String(raw.coverageMode || '').toUpperCase() !== '12H') return;
    if (String(raw.coversEmployeeId || '') !== titularId) return;
    if (!key.endsWith(`_${dateStr}`)) return;
    const code = String(raw.code || '').toUpperCase();
    if (code !== 'D12' && code !== 'N12') return;
    if (visto.has(code)) return;
    visto.add(code);
    lados.push({ code, nombre: String(raw.employeeName || '') });
  };
  for (const [k, raw] of Object.entries(pending)) mirar(raw, k);
  for (const [k, raw] of Object.entries(shifts)) {
    if (pending[k] !== undefined) continue;
    mirar(raw, k);
  }
  return textoCubiertaPor(lados);
}
