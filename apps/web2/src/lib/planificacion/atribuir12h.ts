/**
 * A quién cubre un par D12+N12.
 * Se deriva del estado del día (borrador + guardado): un par tecleado cuenta igual que uno armado con +.
 * Un par cubre una sola licencia (misma banda, mismo puesto, la que empezó antes, orden de fila).
 * Sin licencia, un par ya marcado 12H queda como banda vacante. Un D12/N12 suelto no se toca.
 */

export type Licencia12 = {
  empId: string;
  nombre: string;
  /** Código de la licencia (ART, V). */
  code: string;
  /** Banda que tenía (M, T, N). Vacío si el doc no la guardó. */
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
  isFrancoTrabajado?: boolean;
};

export type Parche12 = {
  empId: string;
  limpiar: boolean;
  texto: string;
  coversEmployeeId: string;
  coversEmployeeName: string;
  coversAbsenceCode: string;
  coversBandCode: string;
  coversPositionName: string;
  coverageMode: '12H' | '';
};

const BANDA = new Set(['M', 'T', 'N']);
const NO_LICENCIA = new Set(['F', 'FF', 'FP', 'RET', 'ESC', 'REF', 'FT', 'EV', 'PU', 'M', 'T', 'N', 'D12', 'N12']);

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
  const quien = `Cubre a ${apellidoDe(p.nombre)} (${p.ausencia})`;
  const resto = [p.banda, p.puesto].map((s) => String(s || '').trim()).filter(Boolean);
  return resto.length ? `${quien} · ${resto.join(' · ')}` : quien;
}

export function textoVacante12(puesto: string): string {
  return `Banda vacante de ${puesto}`;
}

/** «REGALO D12 + HERRANTE N12 (12 h)». El tooltip le antepone «Cubierto por:». */
export function textoCubiertaPor(lados: Array<{ nombre: string; code: 'D12' | 'N12' }>): string {
  const d = lados.find((l) => l.code === 'D12');
  const n = lados.find((l) => l.code === 'N12');
  if (!d || !n) return '';
  return `${apellidoDe(d.nombre)} D12 + ${apellidoDe(n.nombre)} N12 (12 h)`;
}

function up(v: unknown): string {
  return String(v || '').trim().toUpperCase();
}

function esPataMarcada(c: CeldaDia12): boolean {
  if (c.isDeleted || c.isFrancoTrabajado) return false;
  if (up(c.coverageMode) !== '12H') return false;
  const code = up(c.code);
  return (code === 'D12' || code === 'N12') && !!up(c.coversBandCode);
}

function esPataLibre(c: CeldaDia12): boolean {
  if (c.isDeleted || c.isFrancoTrabajado) return false;
  const code = up(c.code);
  if (code !== 'D12' && code !== 'N12') return false;
  const mode = up(c.coverageMode);
  if (mode && mode !== '12H') return false;
  if (mode === '12H' && up(c.coversBandCode)) return false;
  return true;
}

function esLicenciaCelda(c: CeldaDia12): boolean {
  if (c.isDeleted) return false;
  const code = up(c.code);
  if (!code || NO_LICENCIA.has(code)) return false;
  return true;
}

function licenciasDe(celdas: readonly CeldaDia12[]): Licencia12[] {
  const out: Licencia12[] = [];
  for (const c of celdas) {
    if (!esLicenciaCelda(c)) continue;
    out.push({
      empId: c.empId,
      nombre: c.nombre,
      code: up(c.code),
      banda: bandaDeOriginal(c.originalCode || ''),
      positionName: String(c.positionName || ''),
      inicio: c.inicio || '9999-99-99',
      orden: c.orden,
    });
  }
  return out;
}

function porInicio(a: Licencia12, b: Licencia12): number {
  return a.inicio.localeCompare(b.inicio) || a.orden - b.orden;
}

function parcheDe(c: CeldaDia12, tit: Licencia12 | null, banda: string, puesto: string): Parche12 {
  if (!tit) {
    return {
      empId: c.empId,
      limpiar: true,
      texto: textoVacante12(puesto),
      coversEmployeeId: '',
      coversEmployeeName: '',
      coversAbsenceCode: '',
      coversBandCode: banda,
      coversPositionName: puesto,
      coverageMode: '12H',
    };
  }
  return {
    empId: c.empId,
    limpiar: false,
    texto: textoCubre12({ nombre: tit.nombre, ausencia: tit.code, banda: banda || tit.banda, puesto: puesto || tit.positionName }),
    coversEmployeeId: tit.empId,
    coversEmployeeName: tit.nombre,
    coversAbsenceCode: tit.code,
    coversBandCode: banda || tit.banda,
    coversPositionName: puesto || tit.positionName,
    coverageMode: '12H',
  };
}

function elegirLibre(licencias: readonly Licencia12[], puesto: string, usadas: Set<string>): Licencia12 | null {
  const libres = licencias.filter((l) => !usadas.has(l.empId));
  if (!libres.length) return null;
  const p = puesto.trim().toUpperCase();
  const mismo = p ? libres.filter((l) => String(l.positionName || '').trim().toUpperCase() === p) : [];
  if (mismo.length) return [...mismo].sort(porInicio)[0];
  const sinPuesto = libres.filter((l) => !String(l.positionName || '').trim());
  if (sinPuesto.length) return [...sinPuesto].sort(porInicio)[0];
  if (!p) return [...libres].sort(porInicio)[0];
  return null;
}

/** Recalcula la atribución del día a partir de las celdas (licencias + D12/N12). */
export function recalcularDia12(celdas: readonly CeldaDia12[]): Parche12[] {
  const licencias = licenciasDe(celdas);
  const usadas = new Set<string>();
  for (const c of celdas) {
    if (c.isDeleted || !c.coversEmployeeId) continue;
    if (esPataMarcada(c) || esPataLibre(c)) continue;
    usadas.add(c.coversEmployeeId);
  }
  const parches: Parche12[] = [];
  const grupos = new Map<string, CeldaDia12[]>();
  for (const c of celdas) {
    if (!esPataMarcada(c)) continue;
    const banda = up(c.coversBandCode);
    const puesto = String(c.coversPositionName || c.positionName || '');
    const k = `${banda}|${puesto.toUpperCase()}`;
    const lista = grupos.get(k) || [];
    lista.push(c);
    grupos.set(k, lista);
  }
  for (const lista of grupos.values()) {
    const banda = up(lista[0].coversBandCode);
    const puesto = String(lista[0].coversPositionName || lista[0].positionName || '');
    const tit = banda ? elegirTitular(licencias.filter((l) => !usadas.has(l.empId)), banda, puesto) : null;
    if (tit) usadas.add(tit.empId);
    for (const c of lista) parches.push(parcheDe(c, tit, banda, puesto));
  }

  const porPuesto = new Map<string, CeldaDia12[]>();
  for (const c of celdas) {
    if (!esPataLibre(c)) continue;
    const p = String(c.positionName || '').trim().toUpperCase();
    const lista = porPuesto.get(p) || [];
    lista.push(c);
    porPuesto.set(p, lista);
  }
  const pares: Array<{ d: CeldaDia12; n: CeldaDia12; puesto: string }> = [];
  const sobranD: CeldaDia12[] = [];
  const sobranN: CeldaDia12[] = [];
  for (const [puestoKey, lista] of porPuesto) {
    const d12 = lista.filter((c) => up(c.code) === 'D12').sort((a, b) => a.orden - b.orden);
    const n12 = lista.filter((c) => up(c.code) === 'N12').sort((a, b) => a.orden - b.orden);
    const n = Math.min(d12.length, n12.length);
    const puesto = String(lista[0].positionName || puestoKey);
    for (let i = 0; i < n; i++) pares.push({ d: d12[i], n: n12[i], puesto });
    sobranD.push(...d12.slice(n));
    sobranN.push(...n12.slice(n));
  }
  sobranD.sort((a, b) => a.orden - b.orden);
  sobranN.sort((a, b) => a.orden - b.orden);
  const cruz = Math.min(sobranD.length, sobranN.length);
  for (let i = 0; i < cruz; i++) {
    pares.push({
      d: sobranD[i],
      n: sobranN[i],
      puesto: String(sobranD[i].positionName || sobranN[i].positionName || ''),
    });
  }
  pares.sort((a, b) => Math.min(a.d.orden, a.n.orden) - Math.min(b.d.orden, b.n.orden));
  for (const par of pares) {
    const tit = elegirLibre(licencias, par.puesto, usadas);
    if (!tit) continue;
    usadas.add(tit.empId);
    const banda = tit.banda;
    const puesto = par.puesto || tit.positionName;
    parches.push(parcheDe(par.d, tit, banda, puesto));
    parches.push(parcheDe(par.n, tit, banda, puesto));
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
  if (!s || up(s.coverageMode) !== '12H') return '';
  const puesto = String(s.coversPositionName || '').trim();
  const banda = up(s.coversBandCode);
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
  coversEmployeeName?: string;
  coversAbsenceCode?: string;
  coversBandCode?: string;
  coversPositionName?: string;
  employeeName?: string;
  originalCode?: string;
  originalPositionName?: string;
  positionName?: string;
  isDeleted?: boolean;
  isFrancoTrabajado?: boolean;
};

export type OptsCeldas12 = {
  ordenDe?: (empId: string) => number;
  nombreDe?: (empId: string, raw: Turno12 | null | undefined) => string;
};

function diaMenos(ds: string): string {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function diaIndex(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000);
}

function claveDia(key: string): { empId: string; dateStr: string } | null {
  const m = key.match(/^(.*)_(\d{4}-\d{2}-\d{2})$/);
  if (!m || !m[1]) return null;
  return { empId: m[1], dateStr: m[2] };
}

function leerRaw(
  pending: Record<string, Turno12 | null | undefined>,
  shifts: Record<string, Turno12 | null | undefined>,
  key: string,
): Turno12 | null | undefined {
  if (Object.prototype.hasOwnProperty.call(pending, key)) return pending[key];
  return shifts[key];
}

function heredarBanda(
  pending: Record<string, Turno12 | null | undefined>,
  shifts: Record<string, Turno12 | null | undefined>,
  empId: string,
  dateStr: string,
  code: string,
): { code: string; position: string } {
  const want = up(code);
  let mejor: { dist: number; code: string; position: string } | null = null;
  const mirar = (key: string, raw: Turno12 | null | undefined) => {
    const p = claveDia(key);
    if (!p || p.empId !== empId || p.dateStr === dateStr || !raw || raw.isDeleted) return;
    if (up(raw.code) !== want) return;
    const banda = bandaDeOriginal(String(raw.originalCode || ''));
    const pos = String(raw.originalPositionName || raw.positionName || '').trim();
    if (!banda && !pos) return;
    const dist = Math.abs(diaIndex(p.dateStr) - diaIndex(dateStr));
    if (!mejor || dist < mejor.dist) mejor = { dist, code: banda ? String(raw.originalCode) : '', position: pos };
  };
  for (const [k, raw] of Object.entries(pending)) mirar(k, raw);
  for (const [k, raw] of Object.entries(shifts)) {
    if (Object.prototype.hasOwnProperty.call(pending, k)) continue;
    mirar(k, raw);
  }
  return { code: mejor?.code || '', position: mejor?.position || '' };
}

function inicioDeCodigo(
  pending: Record<string, Turno12 | null | undefined>,
  shifts: Record<string, Turno12 | null | undefined>,
  empId: string,
  dateStr: string,
  code: string,
): string {
  let cur = dateStr;
  let inicio = dateStr;
  const want = up(code);
  for (let i = 0; i < 40; i++) {
    const prev = diaMenos(cur);
    const raw = leerRaw(pending, shifts, `${empId}_${prev}`);
    if (!raw || raw.isDeleted || up(raw.code) !== want) break;
    inicio = prev;
    cur = prev;
  }
  return inicio;
}

/** Celdas de un día, borrador encima de lo guardado. */
export function celdasDelDia(
  pending: Record<string, Turno12 | null | undefined>,
  shifts: Record<string, Turno12 | null | undefined>,
  dateStr: string,
  opts: OptsCeldas12 = {},
): CeldaDia12[] {
  const ids = new Set<string>();
  const tomar = (key: string) => {
    const p = claveDia(key);
    if (p && p.dateStr === dateStr) ids.add(p.empId);
  };
  for (const k of Object.keys(pending)) tomar(k);
  for (const k of Object.keys(shifts)) tomar(k);
  const out: CeldaDia12[] = [];
  for (const empId of ids) {
    const raw = leerRaw(pending, shifts, `${empId}_${dateStr}`);
    if (!raw || raw.isDeleted) continue;
    const code = String(raw.code || '');
    let originalCode = String(raw.originalCode || '');
    let positionName = String(raw.originalPositionName || raw.positionName || '');
    if ((!originalCode || !positionName) && code && !NO_LICENCIA.has(up(code))) {
      const h = heredarBanda(pending, shifts, empId, dateStr, code);
      if (!originalCode) originalCode = h.code;
      if (!positionName) positionName = h.position;
    }
    out.push({
      empId,
      nombre: opts.nombreDe?.(empId, raw) || String(raw.employeeName || empId),
      code,
      positionName,
      originalCode,
      coverageMode: raw.coverageMode,
      coversBandCode: raw.coversBandCode,
      coversPositionName: raw.coversPositionName,
      coversEmployeeId: raw.coversEmployeeId,
      orden: opts.ordenDe?.(empId) ?? 999,
      inicio: inicioDeCodigo(pending, shifts, empId, dateStr, code),
      isFrancoTrabajado: raw.isFrancoTrabajado === true,
    });
  }
  return out;
}

function ladosDe(celdas: readonly CeldaDia12[], parches: readonly Parche12[], titularId: string) {
  const lados: Array<{ nombre: string; code: 'D12' | 'N12' }> = [];
  const visto = new Set<string>();
  for (const p of parches) {
    if (p.limpiar || p.coversEmployeeId !== titularId) continue;
    const celda = celdas.find((c) => c.empId === p.empId);
    const code = up(celda?.code);
    if ((code !== 'D12' && code !== 'N12') || visto.has(code)) continue;
    visto.add(code);
    lados.push({ code, nombre: String(celda?.nombre || '') });
  }
  return textoCubiertaPor(lados);
}

function textoGuardado(
  pending: Record<string, Turno12 | null | undefined>,
  shifts: Record<string, Turno12 | null | undefined>,
  titularId: string,
  dateStr: string,
): string {
  const lados: Array<{ nombre: string; code: 'D12' | 'N12' }> = [];
  const visto = new Set<string>();
  const mirar = (raw: Turno12 | null | undefined, key: string) => {
    if (!raw || raw.isDeleted) return;
    if (up(raw.coverageMode) !== '12H') return;
    if (String(raw.coversEmployeeId || '') !== titularId) return;
    if (!key.endsWith(`_${dateStr}`)) return;
    const code = up(raw.code);
    if (code !== 'D12' && code !== 'N12') return;
    if (visto.has(code)) return;
    visto.add(code);
    lados.push({ code, nombre: String(raw.employeeName || '') });
  };
  for (const [k, raw] of Object.entries(pending)) mirar(raw, k);
  for (const [k, raw] of Object.entries(shifts)) {
    if (Object.prototype.hasOwnProperty.call(pending, k)) continue;
    mirar(raw, k);
  }
  return textoCubiertaPor(lados);
}

/** «REGALO D12 + HERRANTE N12 (12 h)» si el día tiene el par de ese titular. */
export function textoLicencia12(
  pending: Record<string, Turno12 | null | undefined>,
  shifts: Record<string, Turno12 | null | undefined>,
  titularId: string,
  dateStr: string,
  opts: OptsCeldas12 = {},
): string {
  const celdas = celdasDelDia(pending, shifts, dateStr, opts);
  const derivado = ladosDe(celdas, recalcularDia12(celdas), titularId);
  return derivado || textoGuardado(pending, shifts, titularId, dateStr);
}

/** «Cubre a BAIGORRIA (V) · T · Puesto 1» de esa pata, derivado del día. */
export function textoPata12(
  pending: Record<string, Turno12 | null | undefined>,
  shifts: Record<string, Turno12 | null | undefined>,
  empId: string,
  dateStr: string,
  opts: OptsCeldas12 = {},
): string {
  const celdas = celdasDelDia(pending, shifts, dateStr, opts);
  const p = recalcularDia12(celdas).find((x) => x.empId === empId);
  if (!p || p.limpiar) return '';
  return p.texto;
}

export type ParcheDia12 = Parche12 & { dateStr: string };

export function parchesAtribucion(
  pending: Record<string, Turno12 | null | undefined>,
  shifts: Record<string, Turno12 | null | undefined>,
  opts: OptsCeldas12 = {},
): ParcheDia12[] {
  const fechas = new Set<string>();
  const tomar = (key: string) => {
    const p = claveDia(key);
    if (p) fechas.add(p.dateStr);
  };
  for (const k of Object.keys(pending)) tomar(k);
  for (const k of Object.keys(shifts)) tomar(k);
  const out: ParcheDia12[] = [];
  for (const dateStr of fechas) {
    const celdas = celdasDelDia(pending, shifts, dateStr, opts);
    for (const p of recalcularDia12(celdas)) {
      if (p.limpiar || !p.coversEmployeeId) continue;
      out.push({ ...p, dateStr });
    }
  }
  return out;
}

/** Deja en el borrador los covers* del par, para que el guardado se los lleve al turno. */
export function aplicarAtribucionAlGuardar(
  pending: Record<string, any>,
  shifts: Record<string, any>,
  opts: OptsCeldas12 & { hm?: (v: unknown) => string } = {},
): Record<string, any> {
  const parches = parchesAtribucion(pending, shifts, opts);
  if (!parches.length) return pending;
  const next = { ...pending };
  let cambio = false;
  const hm = opts.hm || ((v: unknown) => (typeof v === 'string' ? v : ''));
  for (const p of parches) {
    const key = `${p.empId}_${p.dateStr}`;
    const base = next[key] !== undefined ? next[key] : shifts[key];
    if (!base || base.isDeleted) continue;
    if (
      String(base.coversEmployeeId || '') === p.coversEmployeeId
      && up(base.coverageMode) === '12H'
      && String(base.coversBandCode || '') === p.coversBandCode
      && String(base.coversPositionName || '') === p.coversPositionName
      && String(base.coversDateStr || '') === p.dateStr
      && String(base.coversEmployeeName || '') === p.coversEmployeeName
    ) continue;
    const startTime = typeof base.startTime === 'string' ? base.startTime : hm(base.startTime);
    const endTime = typeof base.endTime === 'string' ? base.endTime : hm(base.endTime);
    next[key] = {
      ...base,
      startTime,
      endTime,
      employeeName: base.employeeName || opts.nombreDe?.(p.empId, base) || p.empId,
      coverageMode: '12H',
      coversEmployeeId: p.coversEmployeeId,
      coversEmployeeName: p.coversEmployeeName,
      coversAbsenceCode: p.coversAbsenceCode,
      coversBandCode: p.coversBandCode,
      coversPositionName: p.coversPositionName,
      coversDateStr: p.dateStr,
      coversVacante: false,
    };
    cambio = true;
  }
  return cambio ? next : pending;
}

/** Copia en memoria los covers* derivados, para la tarjeta y el modal. No escribe. */
export function atribuirEnTurnos<T extends Turno12 & { employeeId?: string }>(turnos: readonly T[]): T[] {
  if (!turnos.length) return [...turnos];
  const celdas: CeldaDia12[] = [];
  turnos.forEach((t, i) => {
    const empId = String(t.employeeId || '').trim();
    if (!empId || t.isDeleted) return;
    celdas.push({
      empId,
      nombre: String(t.employeeName || empId),
      code: String(t.code || ''),
      positionName: String(t.originalPositionName || t.positionName || ''),
      originalCode: String(t.originalCode || ''),
      coverageMode: t.coverageMode,
      coversBandCode: t.coversBandCode,
      coversPositionName: t.coversPositionName,
      coversEmployeeId: t.coversEmployeeId,
      orden: i,
      isFrancoTrabajado: t.isFrancoTrabajado === true,
    });
  });
  const porEmp = new Map<string, Parche12>();
  for (const p of recalcularDia12(celdas)) {
    if (!p.limpiar && p.coversEmployeeId) porEmp.set(p.empId, p);
  }
  if (!porEmp.size) return [...turnos];
  return turnos.map((t) => {
    const p = porEmp.get(String(t.employeeId || ''));
    if (!p) return t;
    return {
      ...t,
      coverageMode: '12H',
      coversEmployeeId: p.coversEmployeeId,
      coversEmployeeName: p.coversEmployeeName,
      coversAbsenceCode: p.coversAbsenceCode,
      coversBandCode: p.coversBandCode,
      coversPositionName: p.coversPositionName,
    };
  });
}
