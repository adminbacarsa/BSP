/**
 * Lectura del día de un objetivo: primero los turnos custom (Rondín, Encargada, códigos
 * propios), después los juegos de 24 h contra lo que pide el servicio, banda por banda.
 * Lo que no tiene puesto no se suma a ninguno. La falta de una banda se cierra con el
 * par de 12 h (la misma regla que el + del modo rápido).
 */
import { proponerCierre12h, apellidoCorto, type Cambio12h, type Propuesta12h, type TurnoPuesto12 } from './cierre12h';

export const SIN_PUESTO = 'sin puesto';
const BANDAS = new Set(['M', 'T', 'N', 'D12', 'N12']);
const NO_CUENTA = new Set(['F', 'FF', 'FP', 'FT', 'RET', 'REF', 'ESC', 'EV', 'AA', 'V', 'L', 'E', 'A', 'PG', 'ART', 'SGS', 'SUS', 'LT']);

export type Banda = 'M' | 'T' | 'N';

export type TurnoDia = {
  empId: string;
  nombre: string;
  code: string;
  positionName?: string;
  hours?: number;
  startTime?: string;
};

export type PuestoServicio = {
  positionName: string;
  qty?: number;
  coverageType?: string;
  exigeCobertura?: boolean;
  shifts?: Array<{ code?: string; hours?: number; startTime?: string; endTime?: string; quantity?: number }>;
};

export type CuentasBanda = { M: number; T: number; N: number };

export type LecturaDia = {
  mostrar: boolean;
  custom: Array<{ banda: Banda; cantidad: number; etiquetas: string[] }>;
  cuentas: CuentasBanda;
  crudo: { M: number; T: number; N: number };
  juegosPedidos: number;
  puestos24: number;
  paxServicio: number;
  paxVisto: number;
  falta: CuentasBanda;
  sobra: CuentasBanda;
  avisoServicio: string | null;
  horasTrabajadas: number;
  horasVendidas: number;
  sobranHoras: number;
  turnosFuera: number;
  sinPuesto: TurnoDia[];
  texto: string;
  textoCorto: string;
  /** «48/48 h · 2 puestos de 24 h». */
  textoHoras: string;
  /** La T (u otra banda) cierra entre puestos. Null si hay falta real. */
  cubiertoEntre: string | null;
  /** Todos los puestos de 24 h tienen gente y la suma de bandas cubre lo vendido. */
  reconcilia: boolean;
};

export type FaltanteBanda = {
  dateStr: string;
  positionName: string;
  banda: Banda;
  propuesta: Propuesta12h | null;
  consultarFranco: boolean;
  francos: Array<{ empId: string; nombre: string }>;
  texto: string;
};

export type Liberacion =
  | { ok: true; cambios: Cambio12h[]; texto: string }
  | { ok: false; motivo: string };

function up(v: unknown): string {
  return String(v || '').trim().toUpperCase();
}

function norm(v: unknown): string {
  return up(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function mismo(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

function bandaPlana(code: string): string | null {
  const c = up(code).replace(/\s+/g, '');
  if (BANDAS.has(c)) return c;
  const m = c.match(/^(?:P\d+|PL)(D12|N12|M|T|N)$/);
  return m ? m[1] : null;
}

export function esFranjaPropia(pos: PuestoServicio): boolean {
  const tipo = String(pos.coverageType || '').toLowerCase();
  if (tipo === 'encargado' || tipo === 'eventos') return true;
  const nombre = norm(pos.positionName);
  if (nombre === 'RO' || nombre === 'EN' || /RONDIN|ENCARGAD|CORTINA/.test(nombre)) return true;
  const codes = [...new Set((pos.shifts || []).map((s) => up(s.code)).filter(Boolean))];
  const planas = codes.map((c) => bandaPlana(c)).filter((c): c is string => !!c);
  if (codes.length > 0 && planas.length === 0) return true;
  const es24 = tipo === '24hs' || tipo === '24' || tipo === '24h';
  const bandas = planas.filter((c) => c === 'M' || c === 'T' || c === 'N' || c === 'D12' || c === 'N12');
  return !es24 && bandas.length <= 1 && codes.length > 0;
}

export function esPuesto24(pos: PuestoServicio): boolean {
  if (pos.exigeCobertura === false) return false;
  if (esFranjaPropia(pos)) return false;
  const tipo = String(pos.coverageType || '').toLowerCase();
  if (tipo === 'encargado' || tipo === 'eventos') return false;
  return true;
}

function puestoDe(turnos: TurnoDia['positionName'], puestos: readonly PuestoServicio[]): PuestoServicio | null {
  const nombre = String(turnos || '').trim();
  if (!nombre) return null;
  return puestos.find((p) => mismo(p.positionName, nombre)) || null;
}

export function turnoSinPuesto(positionName: unknown): boolean {
  return !String(positionName || '').trim();
}

function esCustom(t: TurnoDia, puestos: readonly PuestoServicio[]): boolean {
  const pos = puestoDe(t.positionName, puestos);
  if (pos && esFranjaPropia(pos)) return true;
  const code = up(t.code);
  if (bandaPlana(code) || NO_CUENTA.has(code)) return false;
  return code.length > 0;
}

function bandaDe(t: TurnoDia): Banda {
  const code = up(t.code);
  const plana = bandaPlana(code);
  if (plana === 'M' || plana === 'D12') return 'M';
  if (plana === 'T') return 'T';
  if (plana === 'N' || plana === 'N12') return 'N';
  const hm = String(t.startTime || '');
  const h = Number(hm.slice(0, 2));
  if (hm.includes(':') && h >= 12 && h < 20) return 'T';
  if (hm.includes(':') && (h >= 20 || h < 5)) return 'N';
  return 'M';
}

function horasDe(t: TurnoDia): number {
  const n = Number(t.hours);
  if (n > 0) return n;
  const code = up(t.code);
  const plana = bandaPlana(code);
  if (plana === 'D12' || plana === 'N12') return 12;
  return 8;
}

function etiquetaCustom(t: TurnoDia): string {
  const pos = String(t.positionName || '').replace(/^P\s+/i, '').trim();
  return pos || up(t.code);
}

/**
 * D12 cubre la M (y 4 h de la T, que no cierran la T solas).
 * N12 cubre la N (y las otras 4 h de la T).
 * La T de 8 h se cierra con un T o con un par D12+N12, aunque sean de puestos distintos.
 */
export function contarEstandar(turnos: readonly TurnoDia[]): { cuentas: CuentasBanda; crudo: { M: number; T: number; N: number; D12: number; N12: number } } {
  let M = 0;
  let T = 0;
  let N = 0;
  let D12 = 0;
  let N12 = 0;
  for (const t of turnos) {
    const c = bandaPlana(up(t.code)) || up(t.code);
    if (c === 'M') M += 1;
    else if (c === 'T') T += 1;
    else if (c === 'N') N += 1;
    else if (c === 'D12') D12 += 1;
    else if (c === 'N12') N12 += 1;
  }
  const pares = Math.min(D12, N12);
  return {
    cuentas: { M: M + D12, T: T + pares, N: N + N12 },
    crudo: { M, T, N, D12, N12 },
  };
}

/** Lo que un puesto acredita a las bandas de 8 h. Un D12 no dice «falta M»; un N12 no dice «falta N». */
export function acreditarCodigos(codeCounts: Record<string, number>): Record<string, number> {
  const d12 = codeCounts.D12 || 0;
  const n12 = codeCounts.N12 || 0;
  return {
    ...codeCounts,
    M: (codeCounts.M || 0) + d12,
    T: (codeCounts.T || 0) + Math.min(d12, n12),
    N: (codeCounts.N || 0) + n12,
  };
}

function delta(cuentas: CuentasBanda, juegos: number): { falta: CuentasBanda; sobra: CuentasBanda } {
  return deltaContra(cuentas, { M: juegos, T: juegos, N: juegos });
}

function deltaContra(cuentas: CuentasBanda, pedidos: CuentasBanda): { falta: CuentasBanda; sobra: CuentasBanda } {
  const falta: CuentasBanda = { M: 0, T: 0, N: 0 };
  const sobra: CuentasBanda = { M: 0, T: 0, N: 0 };
  (['M', 'T', 'N'] as Banda[]).forEach((b) => {
    falta[b] = Math.max(0, pedidos[b] - cuentas[b]);
    sobra[b] = Math.max(0, cuentas[b] - pedidos[b]);
  });
  return { falta, sobra };
}

function cantidadExplicita(pos: PuestoServicio): boolean {
  return (pos.shifts || []).some((s) => s.quantity != null && Number(s.quantity) > 0);
}

/** Lo que pide cada banda. Con quantity en el turno, no usa el PAX del puesto. */
function pedidosDe(puestos24: readonly PuestoServicio[]): CuentasBanda {
  const out: CuentasBanda = { M: 0, T: 0, N: 0 };
  for (const p of puestos24) {
    const q = Math.max(1, Number(p.qty) || 1);
    if (!cantidadExplicita(p)) {
      out.M += q;
      out.T += q;
      out.N += q;
      continue;
    }
    for (const b of ['M', 'T', 'N'] as Banda[]) {
      const sh = (p.shifts || []).find((s) => up(s.code) === b);
      if (!sh) continue;
      const n = sh.quantity != null && Number(sh.quantity) > 0 ? Math.floor(Number(sh.quantity)) : q;
      out[b] += n;
    }
  }
  return out;
}

function pideBanda(pos: PuestoServicio, banda: Banda): number {
  return pedidosDe([pos])[banda];
}

function horasBanda(s: { code?: string; hours?: number }): number {
  const n = Number(s.hours);
  if (n > 0) return n;
  const plana = bandaPlana(up(s.code));
  return plana === 'D12' || plana === 'N12' ? 12 : 8;
}

/** Sin cantidad por banda: 24 × PAX. Con cantidad: suma horas × cantidad (1×M 2×T 2×N = 40, no 24 × 2). M+T+N mandan sobre D12/N12. */
function horasVendidasDePuesto(p: PuestoServicio): number {
  const qPuesto = Math.max(1, Number(p.qty) || 1);
  if (!cantidadExplicita(p)) return qPuesto * 24;
  const shifts = p.shifts || [];
  const deBanda = (b: string) => shifts.find((s) => bandaPlana(up(s.code)) === b);
  const m = deBanda('M');
  const t = deBanda('T');
  const n = deBanda('N');
  const d12 = deBanda('D12');
  const n12 = deBanda('N12');
  const base = m && t && n ? [m, t, n] : d12 && n12 ? [d12, n12] : shifts.filter((s) => !!bandaPlana(up(s.code)));
  return base.reduce((acc, s) => {
    const q = s.quantity != null && Number(s.quantity) > 0 ? Math.floor(Number(s.quantity)) : qPuesto;
    return acc + horasBanda(s) * q;
  }, 0);
}

function textoFaltaSobra(falta: CuentasBanda, sobra: CuentasBanda): string {
  const partes: string[] = [];
  (['M', 'T', 'N'] as Banda[]).forEach((b) => {
    if (falta[b] > 0) partes.push(`falta ${falta[b]} ${b}`);
    if (sobra[b] > 0) partes.push(`sobra ${sobra[b]} ${b}`);
  });
  return partes.join(' · ');
}

function textoCustom(custom: LecturaDia['custom']): string {
  if (!custom.length) return '';
  return custom.map((g) => `${g.cantidad} pax custom ${g.banda} (${g.etiquetas.join(', ')})`).join(' · ');
}

function sumarCuentas(a: CuentasBanda, b: CuentasBanda): CuentasBanda {
  return { M: a.M + b.M, T: a.T + b.T, N: a.N + b.N };
}

function siglaPuesto(name: string): string {
  const m = String(name || '').match(/(\d+)\s*$/);
  return m ? `P${m[1]}` : String(name || '').trim();
}

/** D12 de un puesto + N12 de otro: cubren la T aunque no estén en el mismo puesto. */
export function apellido(nombre: string): string {
  const limpio = String(nombre || '').replace(/,/g, ' ').trim();
  return (limpio.split(/\s+/)[0] || '').toUpperCase();
}

/** Con un D12 suelto y la T abierta, el cartel dice a quién pasar a N12 (y al revés). */
export function textoCompletarPar(turnos: readonly TurnoDia[], falta: CuentasBanda, puesto = ''): string {
  if (falta.T <= 0) return '';
  const d12 = turnos.filter((t) => up(t.code) === 'D12');
  const n12 = turnos.filter((t) => up(t.code) === 'N12');
  const de = (lista: TurnoDia[]) => lista.map((t) => apellido(t.nombre)).filter(Boolean).slice(0, 3).join(', ');
  const donde = puesto ? ` en ${puesto}` : '';
  if (d12.length > n12.length) {
    const ns = de(turnos.filter((t) => up(t.code) === 'N'));
    const quien = apellido(d12[0]?.nombre || '') || 'un D12';
    return `falta T${donde}: con D12 de ${quien}, completá con N12 de un N${ns ? ` (${ns})` : ''}`;
  }
  if (n12.length > d12.length) {
    const ms = de(turnos.filter((t) => up(t.code) === 'M' || up(t.code) === 'T'));
    const quien = apellido(n12[0]?.nombre || '') || 'un N12';
    return `falta T: con N12 de ${quien}, completá con D12 de un M o T${ms ? ` (${ms})` : ''}`;
  }
  return '';
}

function textoEntrePuestos(turnos: readonly TurnoDia[]): string | null {
  const d12 = turnos.filter((t) => up(t.code) === 'D12' && String(t.positionName || '').trim());
  const n12 = turnos.filter((t) => up(t.code) === 'N12' && String(t.positionName || '').trim());
  for (const d of d12) {
    const n = n12.find((x) => !mismo(String(x.positionName || ''), String(d.positionName || '')));
    if (!n) continue;
    return `cubierto entre puestos (D12 ${siglaPuesto(String(d.positionName))} + N12 ${siglaPuesto(String(n.positionName))})`;
  }
  return null;
}

/** Suma la cuenta de cada puesto. Un D12 y un N12 de puestos distintos no se descuentan entre sí. */
function contarSumandoPuestos(turnos: readonly TurnoDia[]): { cuentas: CuentasBanda; crudo: { M: number; T: number; N: number; D12: number; N12: number } } {
  const grupos = new Map<string, TurnoDia[]>();
  for (const t of turnos) {
    const k = norm(t.positionName || '');
    const list = grupos.get(k) || [];
    list.push(t);
    grupos.set(k, list);
  }
  let cuentas: CuentasBanda = { M: 0, T: 0, N: 0 };
  const crudo = { M: 0, T: 0, N: 0, D12: 0, N12: 0 };
  for (const list of grupos.values()) {
    const c = contarEstandar(list);
    cuentas = sumarCuentas(cuentas, c.cuentas);
    crudo.M += c.crudo.M;
    crudo.T += c.crudo.T;
    crudo.N += c.crudo.N;
    crudo.D12 += c.crudo.D12;
    crudo.N12 += c.crudo.N12;
  }
  return { cuentas, crudo };
}

export function leerDia(input: { turnos: readonly TurnoDia[]; puestos: readonly PuestoServicio[] }): LecturaDia {
  const puestos24 = input.puestos.filter(esPuesto24);
  const mostrar = puestos24.length > 0;
  const juegosPedidos = puestos24.reduce((s, p) => s + Math.max(1, Number(p.qty) || 1), 0);
  const paxServicio = puestos24.length ? juegosPedidos / puestos24.length : 0;
  const trabajo = input.turnos.filter((t) => {
    const code = up(t.code);
    return code && !NO_CUENTA.has(code);
  });
  const sinPuesto = trabajo.filter((t) => turnoSinPuesto(t.positionName) && !esCustom(t, input.puestos));
  const conPuesto = trabajo.filter((t) => !turnoSinPuesto(t.positionName));
  const customTurnos = conPuesto.filter((t) => esCustom(t, input.puestos));
  const estandar = conPuesto.filter((t) => !esCustom(t, input.puestos));
  const local = contarSumandoPuestos(estandar);
  const bolsa = contarEstandar(estandar);
  const cuentas = bolsa.cuentas;
  const crudo = bolsa.crudo;
  const pedidos = pedidosDe(puestos24);
  const porBanda = puestos24.some(cantidadExplicita);
  const { falta, sobra } = porBanda ? deltaContra(cuentas, pedidos) : delta(cuentas, juegosPedidos);
  const faltaLocalDelta = (porBanda ? deltaContra(local.cuentas, pedidos) : delta(local.cuentas, juegosPedidos)).falta;
  const faltaLocal = puestos24.some((pos) => {
    const del = estandar.filter((t) => mismo(t.positionName || '', pos.positionName));
    if (!del.length) return false;
    const loc = porBanda
      ? deltaContra(contarEstandar(del).cuentas, pedidosDe([pos])).falta
      : delta(contarEstandar(del).cuentas, Math.max(1, Number(pos.qty) || 1)).falta;
    return loc.M + loc.T + loc.N > 0;
  });
  const entre = textoEntrePuestos(estandar);
  const objetivoCubre = falta.M + falta.T + falta.N === 0;
  const pareceFaltar = faltaLocalDelta.M + faltaLocalDelta.T + faltaLocalDelta.N > 0 || faltaLocal;
  const cubiertoEntre = objetivoCubre && pareceFaltar
    ? (entre || 'cubierto entre puestos')
    : null;
  const puestosConGente = puestos24.filter((pos) => estandar.some((t) => mismo(t.positionName || '', pos.positionName))).length;
  const reconcilia = mostrar && puestos24.length > 0 && puestosConGente === puestos24.length && objetivoCubre;
  const vals = [cuentas.M, cuentas.T, cuentas.N].slice().sort((a, b) => a - b);
  const mediana = vals[1] ?? 0;
  const paxVisto = puestos24.length ? Math.round(mediana / puestos24.length) : 0;
  const avisoServicio = mostrar && paxServicio > 0 && paxVisto > paxServicio
    ? `El servicio parece tener ${paxVisto} pax por puesto: revisalo en Servicios`
    : null;
  const customMap = new Map<string, { banda: Banda; etiquetas: string[] }>();
  for (const t of customTurnos) {
    const banda = bandaDe(t);
    const et = etiquetaCustom(t);
    const prev = customMap.get(banda) || { banda, etiquetas: [] };
    if (!prev.etiquetas.includes(et)) prev.etiquetas.push(et);
    customMap.set(banda, prev);
  }
  const custom = [...customMap.values()].map((g) => ({ ...g, cantidad: customTurnos.filter((t) => bandaDe(t) === g.banda).length }));
  // Custom cierra en su franja. El volante sin puesto no suma: no infla el sobrante si cada puesto está justo.
  const horasTrabajadas = estandar.reduce((s, t) => s + horasDe(t), 0);
  const horasVendidas = mostrar ? puestos24.reduce((s, p) => s + horasVendidasDePuesto(p), 0) : 0;
  const sobranHoras = mostrar ? Math.max(0, Math.round((horasTrabajadas - horasVendidas) * 100) / 100) : 0;
  const turnosFuera = sobranHoras > 0 ? Math.round(sobranHoras / 8) : 0;
  const fs = textoFaltaSobra(falta, sobra);
  const customTxt = textoCustom(custom);
  const lineaBanda = fs || cubiertoEntre || '';
  const textoHoras = mostrar ? `${horasTrabajadas}/${horasVendidas} h · ${puestos24.length} puestos de 24 h` : '';
  const puestoFaltaT = puestos24.find((pos) => {
    const del = estandar.filter((t) => mismo(t.positionName || '', pos.positionName));
    return contarEstandar(del).cuentas.T < pideBanda(pos, 'T');
  })?.positionName || '';
  const completar = textoCompletarPar(estandar, falta, puestoFaltaT);
  const lineaCantidad = porBanda
    ? `M ${cuentas.M}/${pedidos.M} · T ${cuentas.T}/${pedidos.T} · N ${cuentas.N}/${pedidos.N}`
    : '';
  const base = [
    customTxt,
    lineaCantidad || `M ${crudo.M} · T ${crudo.T} · N ${crudo.N}`,
    lineaBanda,
    porBanda ? '' : (mostrar ? `servicio: ${puestos24.length} puestos × ${paxServicio} pax` : ''),
    avisoServicio || '',
  ].filter(Boolean).join(' · ');
  const sobraTxt = mostrar && sobranHoras > 0
    ? `Sobran ${sobranHoras} h: ${turnosFuera} turnos de 8 h fuera del servicio`
    : '';
  const texto = [textoHoras, base, completar, cubiertoEntre && fs ? cubiertoEntre : '', sobraTxt].filter(Boolean).join(' · ');
  const textoCorto = [customTxt, fs || cubiertoEntre || 'en línea', completar, cubiertoEntre && fs ? cubiertoEntre : '', avisoServicio || ''].filter(Boolean).join(' · ');
  return {
    mostrar,
    custom,
    cuentas,
    crudo: { M: crudo.M, T: crudo.T, N: crudo.N },
    juegosPedidos,
    puestos24: puestos24.length,
    paxServicio,
    paxVisto,
    falta,
    sobra,
    avisoServicio,
    horasTrabajadas,
    horasVendidas,
    sobranHoras,
    turnosFuera,
    sinPuesto,
    texto,
    textoCorto,
    textoHoras,
    cubiertoEntre,
    reconcilia,
  };
}

/** El puesto de 24 h que todavía tiene lugar en esa banda. */
export function puestoConLugar(banda: Banda, puestos: readonly PuestoServicio[], turnos: readonly TurnoDia[]): string | null {
  for (const pos of puestos.filter(esPuesto24)) {
    const { cuentas } = contarEstandar(turnos.filter((t) => mismo(t.positionName || '', pos.positionName) && !esCustom(t, puestos)));
    if (cuentas[banda] < pideBanda(pos, banda)) return pos.positionName;
  }
  return null;
}

export type GuardiaSobra = { empId: string; nombre: string; code: string; positionName: string };

export type LineaSobra = {
  puesto: string;
  banda: string;
  hay: number;
  cupo: number;
  sobra: number;
  guardias: GuardiaSobra[];
  entrePuestos: boolean;
  texto: string;
};

function apellidoSobra(nombre: string): string {
  return String(nombre || '').split(',')[0].trim().split(/\s+/)[0].toUpperCase();
}

function alimentaBanda(banda: Banda, code: string): boolean {
  if (banda === 'M') return code === 'M' || code === 'D12';
  if (banda === 'N') return code === 'N' || code === 'N12';
  return code === 'T' || code === 'D12' || code === 'N12';
}

/** Quién sobra, por puesto y banda. Si el exceso es del objetivo, nombra la banda y quién la arma. */
export function lineasDeSobra(puestos: readonly PuestoServicio[], turnos: readonly TurnoDia[]): LineaSobra[] {
  const cuenta = turnos.filter((t) => !NO_CUENTA.has(up(t.code)) && !turnoSinPuesto(t.positionName) && !esCustom(t, puestos));
  const lineas: LineaSobra[] = [];
  for (const pos of puestos.filter(esPuesto24)) {
    const qtyPuesto = Math.max(1, Number(pos.qty) || 1);
    const del = cuenta.filter((t) => mismo(t.positionName || '', pos.positionName));
    for (const code of ['M', 'T', 'N', 'D12', 'N12'] as const) {
      const qty = code === 'M' || code === 'T' || code === 'N' ? pideBanda(pos, code) : qtyPuesto;
      const gente = del.filter((t) => up(t.code) === code);
      if (gente.length <= qty) continue;
      const sobra = gente.length - qty;
      const quienes = gente.map((g) => `${apellidoSobra(g.nombre)} ${code}`).join(', ');
      lineas.push({
        puesto: pos.positionName,
        banda: code,
        hay: gente.length,
        cupo: qty,
        sobra,
        guardias: gente.map((g) => ({ empId: g.empId, nombre: g.nombre, code, positionName: pos.positionName })),
        entrePuestos: false,
        texto: `${pos.positionName} · ${code}: ${gente.length} de ${qty} → sobra ${sobra} (${quienes})`,
      });
    }
  }
  const lectura = leerDia({ turnos, puestos });
  if (lectura.mostrar) {
    for (const b of ['M', 'T', 'N'] as const) {
      if (lectura.sobra[b] <= 0) continue;
      if (lineas.some((l) => !l.entrePuestos && alimentaBanda(b, l.banda))) continue;
      const gente = cuenta.filter((t) => alimentaBanda(b, up(t.code)));
      if (!gente.length) continue;
      const quienes = gente.map((g) => `${apellidoSobra(g.nombre)} ${up(g.code)} (${g.positionName})`).join(' + ');
      lineas.push({
        puesto: '',
        banda: b,
        hay: gente.length,
        cupo: 0,
        sobra: lectura.sobra[b],
        guardias: gente.map((g) => ({ empId: g.empId, nombre: g.nombre, code: up(g.code), positionName: String(g.positionName || '') })),
        entrePuestos: true,
        texto: `${b} del objetivo: la arman ${quienes}`,
      });
    }
  }
  return lineas;
}

export function avisosDesdeLectura(dateStr: string, lectura: LecturaDia, turnos: readonly TurnoDia[], puestos: readonly PuestoServicio[]): Array<{
  tipo: 'SOBRECOBERTURA' | 'SIN_PUESTO';
  empId: string;
  nombre: string;
  dateStr: string;
  texto: string;
  puestoSugerido?: string;
  guardiasSobra?: GuardiaSobra[];
}> {
  const out: Array<{ tipo: 'SOBRECOBERTURA' | 'SIN_PUESTO'; empId: string; nombre: string; dateStr: string; texto: string; puestoSugerido?: string; guardiasSobra?: GuardiaSobra[] }> = [];
  if (lectura.mostrar && lectura.sobranHoras > 0) {
    const dia = `${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`;
    const lineas = lineasDeSobra(puestos, turnos);
    if (lineas.length) {
      for (const linea of lineas) {
        const g = linea.guardias[0];
        out.push({
          tipo: 'SOBRECOBERTURA',
          empId: g?.empId || `dia-${dateStr}`,
          nombre: g?.nombre || 'Cobertura',
          dateStr,
          texto: `${dia}: ${linea.texto}`,
          guardiasSobra: linea.guardias,
        });
      }
    } else {
      out.push({
        tipo: 'SOBRECOBERTURA',
        empId: `dia-${dateStr}`,
        nombre: 'Cobertura',
        dateStr,
        texto: `${dia}: ${lectura.texto}`,
      });
    }
  }
  for (const t of lectura.sinPuesto) {
    const banda = bandaDe(t);
    const sugerido = puestoConLugar(banda, puestos, turnos);
    out.push({
      tipo: 'SIN_PUESTO',
      empId: t.empId,
      nombre: t.nombre,
      dateStr,
      puestoSugerido: sugerido || undefined,
      texto: sugerido
        ? `${t.nombre} · ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}: sin puesto · hay lugar en ${sugerido} (${banda})`
        : `${t.nombre} · ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}: sin puesto`,
    });
  }
  return out;
}

function fmtDia(dateStr: string): string {
  return `${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`;
}

function textoPropuesta(prop: Propuesta12h | null): string {
  if (!prop || prop.cambios.length < 2) return '';
  const mixto = prop.cambios.some((c) => c.coversPositionName || c.coversObjectiveId);
  return prop.cambios.map((c) => {
    const pos = mixto && c.positionName ? ` (${c.positionName})` : '';
    return `${apellidoCorto(c.nombre)} ${c.code}${pos}`;
  }).join(' + ');
}

/**
 * Una fila por banda que falta en un puesto. Quién pasa a 12 h: el de menos horas
 * del mismo puesto (el llamador ordena `turnos`). Sin par válido, se ofrece el franco.
 */
export function faltantesDelDia(input: {
  dateStr: string;
  puestos: readonly PuestoServicio[];
  turnos: readonly TurnoDia[];
  turnos12: TurnoPuesto12[];
  horasMes?: Record<string, number>;
  francos?: ReadonlyArray<{ empId: string; nombre: string; delObjetivo?: boolean }>;
  slaDe?: (positionName: string) => ReadonlyArray<{ code?: string; startTime?: string; endTime?: string; hours?: number }>;
}): FaltanteBanda[] {
  const lectura = leerDia({ turnos: input.turnos, puestos: input.puestos });
  if (!lectura.mostrar) return [];
  const francos = [...(input.francos || [])].sort((a, b) => Number(!!b.delObjetivo) - Number(!!a.delObjetivo));
  const out: FaltanteBanda[] = [];
  const horas = input.horasMes || {};
  for (const pos of input.puestos.filter(esPuesto24)) {
    const qty = Math.max(1, Number(pos.qty) || 1);
    const delPuesto = input.turnos.filter((t) => mismo(t.positionName || '', pos.positionName) && !esCustom(t, input.puestos) && !turnoSinPuesto(t.positionName));
    const { cuentas } = contarEstandar(delPuesto);
    if (cuentas.M + cuentas.T + cuentas.N === 0) continue;
    const { falta } = cantidadExplicita(pos)
      ? deltaContra(cuentas, pedidosDe([pos]))
      : delta(cuentas, qty);
    const pool = input.turnos12
      .slice()
      .sort((a, b) => (horas[a.empId] || 0) - (horas[b.empId] || 0) || a.nombre.localeCompare(b.nombre, 'es'));
    const cupos: Record<string, number> = {};
    for (const p of input.puestos.filter(esPuesto24)) cupos[norm(p.positionName)] = Math.max(1, Number(p.qty) || 1);
    const usados = new Set<string>();
    (['T', 'M', 'N'] as Banda[]).forEach((banda) => {
      if (lectura.falta[banda] === 0) return;
      for (let i = 0; i < falta[banda]; i += 1) {
        const disponibles = pool.filter((t) => !usados.has(`${t.empId}|${up(t.code)}`));
        const prop = proponerCierre12h({
          dateStr: input.dateStr,
          positionName: pos.positionName,
          faltantes: [banda],
          turnos: disponibles,
          sla: input.slaDe?.(pos.positionName),
          cupos,
        });
        const par = !!(prop && prop.modo === 'par' && prop.cambios.length >= 2);
        if (par && prop) {
          for (const c of prop.cambios) {
            const origen = disponibles.find((t) => t.empId === c.empId && !usados.has(`${t.empId}|${up(t.code)}`));
            if (origen) usados.add(`${origen.empId}|${up(origen.code)}`);
          }
        }
        const quienes = textoPropuesta(par ? prop : null);
        out.push({
          dateStr: input.dateStr,
          positionName: pos.positionName,
          banda,
          propuesta: par ? prop : null,
          consultarFranco: !par,
          francos: par ? [] : francos.map((f) => ({ empId: f.empId, nombre: f.nombre })),
          texto: par
            ? `${fmtDia(input.dateStr)} · ${pos.positionName} · falta ${banda} · ${quienes}`
            : `${fmtDia(input.dateStr)} · ${pos.positionName} · falta ${banda} · pasar a FT a ${francos.map((f) => f.nombre).filter(Boolean).join(', ') || 'un franco'}`,
        });
      }
    });
  }
  return out;
}

/** El liberado pasa a RET. Los otros dos del puesto cierran su banda con 12 h. Sin par, no se libera. */
export function proponerLiberar(input: {
  empId: string;
  dateStr: string;
  code: string;
  positionName: string;
  turnos: readonly TurnoPuesto12[];
  sla?: ReadonlyArray<{ code?: string; startTime?: string; endTime?: string; hours?: number }>;
  cupos?: Readonly<Record<string, number>>;
  objectiveId?: string;
}): Liberacion {
  const banda = up(input.code);
  if (banda !== 'M' && banda !== 'T' && banda !== 'N') {
    return { ok: false, motivo: 'Solo se libera un turno de mañana, tarde o noche.' };
  }
  const resto = input.turnos.filter((t) => !(t.empId === input.empId && t.dateStr === input.dateStr));
  const prop = proponerCierre12h({
    dateStr: input.dateStr,
    positionName: input.positionName,
    faltantes: [banda],
    turnos: resto,
    sla: input.sla,
    cupos: input.cupos,
    objectiveId: input.objectiveId,
  });
  if (!prop || prop.modo !== 'par' || prop.cambios.length < 2) {
    return { ok: false, motivo: prop?.texto || `No hay par de 12 h para cubrir la ${banda}. No se libera.` };
  }
  const mixto = prop.cambios.some((c) => c.coversPositionName || c.coversObjectiveId);
  const quienes = prop.cambios.map((c) => {
    const pos = mixto && c.positionName ? ` (${c.positionName})` : '';
    return `${apellidoCorto(c.nombre)} ${c.code}${pos}`;
  }).join(' + ');
  return {
    ok: true,
    cambios: prop.cambios,
    texto: `Liberar a RET y cerrar la ${banda} con ${quienes}`,
  };
}

export type FranjaLectura = { puesto: string; code: string; cantidad: number; dias: readonly string[]; startTime?: string };

function puestosDeFranjas(franjas: readonly FranjaLectura[], pax: number): PuestoServicio[] {
  const map = new Map<string, PuestoServicio>();
  for (const f of franjas) {
    const prev = map.get(f.puesto) || { positionName: f.puesto, qty: pax, coverageType: '24hs', shifts: [] };
    prev.shifts = [...(prev.shifts || []), { code: f.code, startTime: f.startTime }];
    if (!BANDAS.has(up(f.code))) prev.coverageType = 'custom';
    map.set(f.puesto, prev);
  }
  const puestos = [...map.values()];
  for (const p of puestos) if (esPuesto24(p)) p.qty = pax;
  return puestos;
}

/** Cómo se lee la planilla (o la copia) por día de la semana: juegos, custom y lo que falta. */
export type TramoReloj = { inicio: string; fin: string };

function minutosHm(hm: string): number {
  const m = String(hm || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Un día de 24 h queda cerrado si los tramos no dejan minutos libres. fin <= inicio cruza medianoche. */
export function cubreDia24(tramos: readonly TramoReloj[]): { cubierto: boolean; huecoMin: number } {
  const marcas = new Array(24 * 60).fill(0);
  for (const t of tramos) {
    const a = minutosHm(t.inicio);
    let b = minutosHm(t.fin);
    if (a < 0 || b < 0) continue;
    if (b <= a) b += 24 * 60;
    for (let m = a; m < b; m++) marcas[m % (24 * 60)] = 1;
  }
  const huecoMin = marcas.filter((x) => !x).length;
  return { cubierto: huecoMin === 0, huecoMin };
}

function tramosDe(turnos: readonly TurnoDia[]): TramoReloj[] {
  const out: TramoReloj[] = [];
  for (const t of turnos) {
    if (!t.startTime) continue;
    const a = minutosHm(t.startTime);
    if (a < 0) continue;
    const fin = t.startTime && Number(t.hours) > 0
      ? (a + Math.round(Number(t.hours) * 60)) % (24 * 60)
      : -1;
    if (fin < 0) continue;
    out.push({
      inicio: String(t.startTime).slice(0, 5),
      fin: `${String(Math.floor(fin / 60)).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}`,
    });
  }
  return out;
}

/**
 * Un puesto de 24 h cierra por bandas (M+T+N o D12+N12) o por el reloj
 * (06–14 / 14–22 / 22–06, o cualquier suma sin huecos). Las dos lecturas coinciden
 * cuando los códigos son las bandas y los horarios cubren el día.
 */
export function puesto24Cerrado(turnos: readonly TurnoDia[]): { porBandas: boolean; porHoras: boolean; cerrado: boolean } {
  const { cuentas } = contarEstandar(turnos);
  const porBandas = Math.min(cuentas.M, cuentas.T, cuentas.N) >= 1;
  const tramos = tramosDe(turnos);
  const porHoras = tramos.length > 0 && cubreDia24(tramos).cubierto;
  return { porBandas, porHoras, cerrado: porBandas || porHoras };
}

export function textoLecturaFranjas(franjas: readonly FranjaLectura[], puestosFijos?: readonly PuestoServicio[]): string {
  const letras = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const turnosDe = (letra: string): TurnoDia[] => {
    const out: TurnoDia[] = [];
    for (const f of franjas) {
      if (f.dias.length && !f.dias.includes(letra)) continue;
      for (let i = 0; i < Math.max(0, f.cantidad); i += 1) {
        out.push({ empId: `${f.puesto}-${f.code}-${i}`, nombre: f.code, code: f.code, positionName: f.puesto, startTime: f.startTime });
      }
    }
    return out;
  };
  let pax = 1;
  if (!puestosFijos) {
    const muestra = turnosDe('L').length ? turnosDe('L') : turnosDe('M');
    const borrador = puestosDeFranjas(franjas, 1);
    const n = borrador.filter(esPuesto24).length;
    if (n > 0 && muestra.length) {
      const est = muestra.filter((t) => !esCustom(t, borrador));
      const { cuentas } = contarEstandar(est);
      const vals = [cuentas.M, cuentas.T, cuentas.N].sort((a, b) => a - b);
      pax = Math.max(1, Math.round((vals[1] || 0) / n));
    }
  }
  const puestos = puestosFijos || puestosDeFranjas(franjas, pax);
  const partes: string[] = [];
  for (const letra of letras) {
    const turnos = turnosDe(letra);
    if (!turnos.length) continue;
    const lectura = leerDia({ turnos, puestos });
    partes.push(`${letra}: ${lectura.textoCorto}`);
  }
  return partes.join(' · ');
}
