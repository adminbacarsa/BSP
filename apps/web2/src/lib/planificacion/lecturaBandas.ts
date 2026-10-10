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
  shifts?: Array<{ code?: string; hours?: number; startTime?: string }>;
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

export function esFranjaPropia(pos: PuestoServicio): boolean {
  const tipo = String(pos.coverageType || '').toLowerCase();
  if (tipo === 'encargado' || tipo === 'eventos') return true;
  if (/RONDIN|ENCARGAD|CORTINA/.test(norm(pos.positionName))) return true;
  const codes = (pos.shifts || []).map((s) => up(s.code)).filter(Boolean);
  return codes.length > 0 && codes.every((c) => !BANDAS.has(c));
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
  if (BANDAS.has(code) || NO_CUENTA.has(code)) return false;
  return code.length > 0;
}

function bandaDe(t: TurnoDia): Banda {
  const code = up(t.code);
  if (code === 'M' || code === 'D12') return 'M';
  if (code === 'T') return 'T';
  if (code === 'N' || code === 'N12') return 'N';
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
  if (code === 'D12' || code === 'N12') return 12;
  return 8;
}

function etiquetaCustom(t: TurnoDia): string {
  const pos = String(t.positionName || '').replace(/^P\s+/i, '').trim();
  return pos || up(t.code);
}

/** D12 cubre M y T; N12 cubre T y N. Un par D12+N12 es un solo juego (la T no se cuenta dos veces). */
export function contarEstandar(turnos: readonly TurnoDia[]): { cuentas: CuentasBanda; crudo: { M: number; T: number; N: number; D12: number; N12: number } } {
  let M = 0;
  let T = 0;
  let N = 0;
  let D12 = 0;
  let N12 = 0;
  for (const t of turnos) {
    const c = up(t.code);
    if (c === 'M') M += 1;
    else if (c === 'T') T += 1;
    else if (c === 'N') N += 1;
    else if (c === 'D12') D12 += 1;
    else if (c === 'N12') N12 += 1;
  }
  const pares = Math.min(D12, N12);
  return {
    cuentas: { M: M + D12, T: T + (D12 + N12 - pares), N: N + N12 },
    crudo: { M, T, N, D12, N12 },
  };
}

function delta(cuentas: CuentasBanda, juegos: number): { falta: CuentasBanda; sobra: CuentasBanda } {
  const falta: CuentasBanda = { M: 0, T: 0, N: 0 };
  const sobra: CuentasBanda = { M: 0, T: 0, N: 0 };
  (['M', 'T', 'N'] as Banda[]).forEach((b) => {
    falta[b] = Math.max(0, juegos - cuentas[b]);
    sobra[b] = Math.max(0, cuentas[b] - juegos);
  });
  return { falta, sobra };
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
  const { cuentas, crudo } = contarEstandar(estandar);
  const { falta, sobra } = delta(cuentas, juegosPedidos);
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
  const horasTrabajadas = trabajo.reduce((s, t) => s + horasDe(t), 0);
  const horasVendidas = mostrar ? puestos24.reduce((s, p) => s + Math.max(1, Number(p.qty) || 1) * 24, 0) : 0;
  const sobranHoras = mostrar ? Math.max(0, Math.round((horasTrabajadas - horasVendidas) * 100) / 100) : 0;
  const turnosFuera = sobranHoras > 0 ? Math.round(sobranHoras / 8) : 0;
  const fs = textoFaltaSobra(falta, sobra);
  const customTxt = textoCustom(custom);
  const base = [
    customTxt,
    `M ${crudo.M} · T ${crudo.T} · N ${crudo.N}`,
    fs,
    mostrar ? `servicio: ${puestos24.length} puestos × ${paxServicio} pax` : '',
    avisoServicio || '',
  ].filter(Boolean).join(' · ');
  const sobraTxt = mostrar && sobranHoras > 0
    ? `Sobran ${sobranHoras} h: ${turnosFuera} turnos de 8 h fuera del servicio`
    : '';
  const texto = [base, sobraTxt].filter(Boolean).join(' · ');
  const textoCorto = [customTxt, fs || 'en línea', avisoServicio || ''].filter(Boolean).join(' · ');
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
  };
}

/** El puesto de 24 h que todavía tiene lugar en esa banda. */
export function puestoConLugar(banda: Banda, puestos: readonly PuestoServicio[], turnos: readonly TurnoDia[]): string | null {
  for (const pos of puestos.filter(esPuesto24)) {
    const qty = Math.max(1, Number(pos.qty) || 1);
    const { cuentas } = contarEstandar(turnos.filter((t) => mismo(t.positionName || '', pos.positionName) && !esCustom(t, puestos)));
    if (cuentas[banda] < qty) return pos.positionName;
  }
  return null;
}

export function avisosDesdeLectura(dateStr: string, lectura: LecturaDia, turnos: readonly TurnoDia[], puestos: readonly PuestoServicio[]): Array<{
  tipo: 'SOBRECOBERTURA' | 'SIN_PUESTO';
  empId: string;
  nombre: string;
  dateStr: string;
  texto: string;
  puestoSugerido?: string;
}> {
  const out: Array<{ tipo: 'SOBRECOBERTURA' | 'SIN_PUESTO'; empId: string; nombre: string; dateStr: string; texto: string; puestoSugerido?: string }> = [];
  if (lectura.mostrar && lectura.sobranHoras > 0) {
    out.push({
      tipo: 'SOBRECOBERTURA',
      empId: `dia-${dateStr}`,
      nombre: 'Cobertura',
      dateStr,
      texto: `${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}: ${lectura.texto}`,
    });
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
  return prop.cambios.map((c) => `${apellidoCorto(c.nombre)} ${c.code}`).join(' + ');
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
    const { falta } = delta(cuentas, qty);
    const pool = input.turnos12
      .filter((t) => mismo(t.positionName, pos.positionName))
      .slice()
      .sort((a, b) => (horas[a.empId] || 0) - (horas[b.empId] || 0) || a.nombre.localeCompare(b.nombre, 'es'));
    const usados = new Set<string>();
    (['T', 'M', 'N'] as Banda[]).forEach((banda) => {
      for (let i = 0; i < falta[banda]; i += 1) {
        const disponibles = pool.filter((t) => !usados.has(`${t.empId}|${up(t.code)}`));
        const prop = proponerCierre12h({
          dateStr: input.dateStr,
          positionName: pos.positionName,
          faltantes: [banda],
          turnos: disponibles,
          sla: input.slaDe?.(pos.positionName),
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
            : `${fmtDia(input.dateStr)} · ${pos.positionName} · falta ${banda} · Consultar franco (FT)`,
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
  });
  if (!prop || prop.modo !== 'par' || prop.cambios.length < 2) {
    return { ok: false, motivo: prop?.texto || `No hay par de 12 h para cubrir la ${banda}. No se libera.` };
  }
  const quienes = prop.cambios.map((c) => `${apellidoCorto(c.nombre)} ${c.code}`).join(' + ');
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
