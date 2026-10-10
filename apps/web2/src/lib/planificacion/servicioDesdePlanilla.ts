/**
 * Servicio (SLA) propuesto desde una planilla de cronograma: puestos, franjas,
 * cantidad y días, más las equivalencias de códigos. Sin red.
 */
import {
  claveCodigo,
  claveMapeo,
  normPlanilla,
  proponerRegla,
  type ColorCelda,
  type CuadroPlanilla,
  type Referencia,
} from './importarExcel';
import { claveEquivalencia, type EquivalenciaCodigo } from './equivalenciaCodigo';
import { HORARIO_ESTANDAR, horasEntre, type AvisoRapido } from './modoRapido';

export type DiaSemana = 'L' | 'M' | 'X' | 'J' | 'V' | 'S' | 'D';
const ORDEN_DIAS: DiaSemana[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const LETRA_UTC: DiaSemana[] = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

export type FranjaServicioPlanilla = {
  id: string;
  puesto: string;
  code: string;
  startTime: string;
  endTime: string;
  cantidad: number;
  /** Vacío = todos los días. */
  dias: DiaSemana[];
};

export type FranjaVigente = {
  puesto: string;
  code: string;
  startTime: string;
  endTime: string;
  cantidad: number;
  dias: string[];
};

export type EstadoDiff = 'coincide' | 'distinto' | 'falta' | 'sobra';

export type DiffFranja = {
  estado: EstadoDiff;
  puesto: string;
  code: string;
  startTime: string;
  endTime: string;
  cantidad: number;
  dias: DiaSemana[];
  detalle: string;
};

export type PropuestaServicio = {
  franjas: FranjaServicioPlanilla[];
  equivalencias: EquivalenciaCodigo[];
};

const EXCLUIDOS = new Set(['F', 'FF', 'FP', 'FRANCO', 'RET', 'RETEN', 'RT', 'REF', 'ESC', 'FT', 'EV', 'EVENTO', 'R']);

export function letraDia(year: number, month: number, dia: number): DiaSemana {
  const dow = new Date(Date.UTC(year, month - 1, dia)).getUTCDay();
  return LETRA_UTC[dow];
}

export function etiquetaDias(dias: readonly string[]): string {
  const set = new Set(dias);
  if (!dias.length || ORDEN_DIAS.every((d) => set.has(d))) return 'Todos';
  const lv = ['L', 'M', 'X', 'J', 'V'];
  const partes: string[] = [];
  if (lv.every((d) => set.has(d))) partes.push('L–V');
  else lv.forEach((d) => { if (set.has(d)) partes.push(d); });
  if (set.has('S')) partes.push('S');
  if (set.has('D')) partes.push('D');
  return partes.join(' · ') || 'Todos';
}

function diasDelMes(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function horarioDe(code: string, refs: Referencia[], color: ColorCelda): { inicio: string; fin: string } | null {
  const k = claveCodigo(code);
  const list = refs.filter((r) => r.codigo === k && r.inicio && r.fin);
  const ref = color === 'red'
    ? list.find((r) => r.color === 'red') || list.find((r) => r.horas >= 11)
    : list.find((r) => r.color !== 'red') || list[0];
  if (ref?.inicio && ref.fin) return { inicio: ref.inicio, fin: ref.fin };
  const est = HORARIO_ESTANDAR[code];
  return est ? { inicio: est.startTime, fin: est.endTime } : null;
}

function puestoFila(puesto: string): string {
  const t = String(puesto || '').replace(/\s+/g, ' ').trim();
  return t || 'Puesto';
}

function moda(xs: number[]): number {
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
}

function ordenarDias(dias: Iterable<string>): DiaSemana[] {
  const set = new Set(dias);
  const out = ORDEN_DIAS.filter((d) => set.has(d));
  return out.length === 7 ? [] : out;
}

/** La M/N roja es esquema de 12 h si una misma fila la repite 4 días o más, en 3 días de la semana distintos. */
function esquemasDoce(cuadro: CuadroPlanilla, year: number, month: number): Set<string> {
  const porFila = new Map<string, number[]>();
  for (const fila of cuadro.filas) {
    const puesto = puestoFila(fila.puesto);
    for (const c of fila.celdas) {
      if (c.color !== 'red') continue;
      const regla = proponerRegla(c.raw, 'red', cuadro.referencias);
      if (regla.accion !== 'doce') continue;
      const base = claveCodigo(regla.code || c.raw);
      const key = `${normPlanilla(puesto)}|${base}|${fila.fila}`;
      const list = porFila.get(key) || [];
      list.push(c.dia);
      porFila.set(key, list);
    }
  }
  const ok = new Set<string>();
  for (const [key, dias] of porFila) {
    const unicos = [...new Set(dias)];
    const letras = new Set(unicos.map((d) => letraDia(year, month, d)));
    if (unicos.length >= 4 && letras.size >= 3) ok.add(key.split('|').slice(0, 2).join('|'));
  }
  return ok;
}

export function proponerServicioDesdePlanilla(cuadro: CuadroPlanilla, year: number, month: number): PropuestaServicio {
  const esquemas = esquemasDoce(cuadro, year, month);
  const cuenta = new Map<string, Map<number, number>>();
  const meta = new Map<string, { puesto: string; code: string; startTime: string; endTime: string }>();
  const eqCuenta = new Map<string, { codigo: string; color: 'red' | 'none'; code: string; startTime: string; endTime: string; n: number }>();

  const sumar = (puesto: string, code: string, inicio: string, fin: string, dia: number, codigo: string, color: 'red' | 'none') => {
    const key = `${normPlanilla(puesto)}|${claveCodigo(code)}|${inicio}|${fin}`;
    if (!meta.has(key)) meta.set(key, { puesto, code: claveCodigo(code), startTime: inicio, endTime: fin });
    const dias = cuenta.get(key) || new Map<number, number>();
    dias.set(dia, (dias.get(dia) || 0) + 1);
    cuenta.set(key, dias);
    const ck = claveMapeo(codigo, color);
    const prev = eqCuenta.get(ck);
    if (prev) prev.n += 1;
    else eqCuenta.set(ck, { codigo: claveCodigo(codigo), color, code: claveCodigo(code), startTime: inicio, endTime: fin, n: 1 });
  };

  for (const fila of cuadro.filas) {
    const puesto = puestoFila(fila.puesto);
    for (const c of fila.celdas) {
      const color: ColorCelda = c.color === 'red' ? 'red' : 'none';
      const regla = proponerRegla(c.raw, color, cuadro.referencias);
      const codigo = claveCodigo(c.raw);
      if (EXCLUIDOS.has(codigo) || regla.accion === 'franco' || regla.accion === 'ret' || regla.accion === 'licencia' || regla.accion === 'ignorar') continue;
      if (regla.accion === 'doce') {
        const base = claveCodigo(regla.code || codigo);
        if (!esquemas.has(`${normPlanilla(puesto)}|${base}`)) continue;
        const destino = base === 'N' ? 'N12' : 'D12';
        const h = horarioDe(base, cuadro.referencias, 'red') || horarioDe(destino, cuadro.referencias, 'none');
        if (!h) continue;
        sumar(puesto, destino, h.inicio, h.fin, c.dia, codigo, 'red');
        continue;
      }
      if (EXCLUIDOS.has(claveCodigo(regla.code))) continue;
      const h = horarioDe(regla.code || codigo, cuadro.referencias, color) || horarioDe(codigo, cuadro.referencias, color);
      if (!h) continue;
      sumar(puesto, regla.code || codigo, h.inicio, h.fin, c.dia, codigo, color === 'red' ? 'red' : 'none');
    }
  }

  const ultimo = diasDelMes(year, month);
  const franjas: FranjaServicioPlanilla[] = [];
  for (const [key, porDia] of cuenta) {
    const m = meta.get(key)!;
    const porLetra = new Map<DiaSemana, number[]>();
    for (let dia = 1; dia <= ultimo; dia++) {
      const letra = letraDia(year, month, dia);
      const list = porLetra.get(letra) || [];
      list.push(porDia.get(dia) || 0);
      porLetra.set(letra, list);
    }
    const grupos = new Map<number, DiaSemana[]>();
    for (const letra of ORDEN_DIAS) {
      const q = moda(porLetra.get(letra) || []);
      if (q <= 0) continue;
      const list = grupos.get(q) || [];
      list.push(letra);
      grupos.set(q, list);
    }
    for (const [cantidad, dias] of grupos) {
      const lista = ordenarDias(dias);
      franjas.push({
        id: `${key}|${lista.join('') || 'todos'}|${cantidad}`,
        puesto: m.puesto,
        code: m.code,
        startTime: m.startTime,
        endTime: m.endTime,
        cantidad,
        dias: lista,
      });
    }
  }
  franjas.sort((a, b) => a.puesto.localeCompare(b.puesto, 'es') || a.startTime.localeCompare(b.startTime) || a.code.localeCompare(b.code) || etiquetaDias(a.dias).localeCompare(etiquetaDias(b.dias)));

  const equivalencias: EquivalenciaCodigo[] = [...eqCuenta.values()]
    .map((e) => ({
      clave: claveEquivalencia(e.codigo, e.color === 'red'),
      codigo: e.codigo,
      color: e.color,
      code: e.code,
      startTime: e.startTime,
      endTime: e.endTime,
      muestras: e.n,
    }))
    .sort((a, b) => b.muestras - a.muestras || a.codigo.localeCompare(b.codigo));

  return { franjas, equivalencias };
}

function normDias(dias: readonly string[]): string {
  const set = new Set(dias.map((d) => d.toUpperCase()));
  if (!dias.length || ORDEN_DIAS.every((d) => set.has(d))) return 'TODOS';
  return ORDEN_DIAS.filter((d) => set.has(d)).join('');
}

function minDe(hm: string): number {
  const [h, m] = String(hm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function compararConVigente(propuesta: FranjaServicioPlanilla[], vigente: FranjaVigente[]): DiffFranja[] {
  const usados = new Set<number>();
  const out: DiffFranja[] = [];
  const candidatos = (f: FranjaServicioPlanilla) => vigente
    .map((v, i) => ({ v, i }))
    .filter((x) => !usados.has(x.i) && normPlanilla(x.v.puesto) === normPlanilla(f.puesto) && claveCodigo(x.v.code) === claveCodigo(f.code))
    .map((x) => {
      const dStart = Math.abs(minDe(x.v.startTime) - minDe(f.startTime));
      const diasP = new Set(normDias(f.dias) === 'TODOS' ? ORDEN_DIAS : f.dias);
      const diasV = normDias(x.v.dias) === 'TODOS' ? ORDEN_DIAS : ORDEN_DIAS.filter((d) => new Set(x.v.dias).has(d));
      const overlap = diasV.filter((d) => diasP.has(d)).length;
      return { ...x, dStart, overlap };
    })
    .filter((x) => x.dStart <= 180)
    .sort((a, b) => b.overlap - a.overlap || a.dStart - b.dStart);

  for (const f of propuesta) {
    const hit = candidatos(f)[0];
    if (!hit) {
      out.push({ estado: 'falta', puesto: f.puesto, code: f.code, startTime: f.startTime, endTime: f.endTime, cantidad: f.cantidad, dias: f.dias, detalle: `${f.puesto} · ${f.code} ${f.startTime}–${f.endTime} ×${f.cantidad} · ${etiquetaDias(f.dias)}: está en la planilla y no en el servicio` });
      continue;
    }
    usados.add(hit.i);
    const v = hit.v;
    const cambios: string[] = [];
    if (Math.abs(minDe(v.startTime) - minDe(f.startTime)) > 0 || Math.abs(minDe(v.endTime) - minDe(f.endTime)) > 0) cambios.push(`horario ${v.startTime}–${v.endTime} → ${f.startTime}–${f.endTime}`);
    if ((v.cantidad || 0) !== f.cantidad) cambios.push(`cantidad ×${v.cantidad ?? 0} → ×${f.cantidad}`);
    if (normDias(v.dias) !== normDias(f.dias)) cambios.push(`días ${etiquetaDias(v.dias)} → ${etiquetaDias(f.dias)}`);
    out.push({
      estado: cambios.length ? 'distinto' : 'coincide',
      puesto: f.puesto,
      code: f.code,
      startTime: f.startTime,
      endTime: f.endTime,
      cantidad: f.cantidad,
      dias: f.dias,
      detalle: cambios.length
        ? `${f.puesto} · ${f.code}: ${cambios.join('; ')}`
        : `${f.puesto} · ${f.code} ${f.startTime}–${f.endTime} ×${f.cantidad} · ${etiquetaDias(f.dias)}`,
    });
  }
  vigente.forEach((v, i) => {
    if (usados.has(i)) return;
    out.push({
      estado: 'sobra',
      puesto: v.puesto,
      code: v.code,
      startTime: v.startTime,
      endTime: v.endTime,
      cantidad: v.cantidad,
      dias: ordenarDias(v.dias),
      detalle: `${v.puesto} · ${v.code} ${v.startTime}–${v.endTime} ×${v.cantidad} · ${etiquetaDias(v.dias)}: está en el servicio y no en la planilla`,
    });
  });
  return out;
}

export function lineasConfirmacion(diff: DiffFranja[], accion: 'crear' | 'actualizar', mes: string): string[] {
  const cabeza = accion === 'crear'
    ? `Se va a crear el servicio de ${mes}`
    : `Se van a aplicar estos cambios al servicio de ${mes}`;
  const cuerpo = diff
    .filter((d) => d.estado !== 'coincide')
    .map((d) => `${d.estado === 'falta' ? 'Se agrega' : d.estado === 'sobra' ? 'Se quita' : 'Cambia'} · ${d.detalle}`);
  if (!cuerpo.length) return [cabeza, 'No hay diferencias con el servicio de este mes.'];
  return [cabeza, ...cuerpo];
}

export type TurnoServicioDoc = {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  hours: number;
  quantity: number;
  days?: DiaSemana[];
};

export type PosicionServicioDoc = {
  id: string;
  name: string;
  coverageType: 'custom';
  quantity: number;
  activeDays: string[];
  allowedShiftTypes: TurnoServicioDoc[];
  status: 'ACTIVE';
};

export function posicionesDesdeFranjas(
  franjas: FranjaServicioPlanilla[],
  actuales: Array<PosicionServicioDoc & Record<string, unknown>> = [],
): PosicionServicioDoc[] {
  const porPuesto = new Map<string, FranjaServicioPlanilla[]>();
  for (const f of franjas) {
    const k = normPlanilla(f.puesto);
    const list = porPuesto.get(k) || [];
    list.push(f);
    porPuesto.set(k, list);
  }
  const out: PosicionServicioDoc[] = [];
  let n = 0;
  for (const [k, list] of porPuesto) {
    n += 1;
    const previa = actuales.find((p) => normPlanilla(p.name) === k);
    const shifts: TurnoServicioDoc[] = list.map((f) => ({
      code: f.code,
      name: f.code,
      startTime: f.startTime,
      endTime: f.endTime,
      hours: horasEntre(f.startTime, f.endTime),
      quantity: Math.max(1, Math.round(f.cantidad) || 1),
      ...(f.dias.length ? { days: f.dias } : {}),
    }));
    const dias = ordenarDias(list.flatMap((f) => (f.dias.length ? f.dias : ORDEN_DIAS)));
    out.push({
      id: String(previa?.id || `planilla_${n}`),
      name: previa?.name || list[0].puesto,
      coverageType: 'custom',
      quantity: Math.max(...list.map((f) => f.cantidad), 1),
      activeDays: dias,
      allowedShiftTypes: shifts,
      status: 'ACTIVE',
    });
  }
  return out;
}

export function horasMesDeFranjas(franjas: FranjaServicioPlanilla[], year: number, month: number): number {
  const ultimo = diasDelMes(year, month);
  let total = 0;
  for (const f of franjas) {
    const horas = horasEntre(f.startTime, f.endTime);
    const set = new Set(f.dias);
    let dias = 0;
    for (let d = 1; d <= ultimo; d++) {
      if (!f.dias.length || set.has(letraDia(year, month, d))) dias += 1;
    }
    total += horas * f.cantidad * dias;
  }
  return Math.round(total * 10) / 10;
}

export function rangoMes(year: number, month: number): { startDate: string; endDate: string } {
  const ultimo = diasDelMes(year, month);
  const mm = String(month).padStart(2, '0');
  return { startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-${String(ultimo).padStart(2, '0')}` };
}

export type FranjaAviso = {
  positionName: string;
  code: string;
  startTime?: string;
  endTime?: string;
  days?: string[];
};

/** Código que no está en el puesto, horario distinto o día no habilitado. La cantidad la marca la fila Cobertura. */
export function avisosFueraDeServicio(input: {
  filas: Array<{ id: string; nombre: string }>;
  claves: Set<string>;
  turnoDe: (empId: string, dateStr: string) => { code: string; startTime?: string; endTime?: string; trabajo: boolean; positionName?: string } | null;
  franjas: FranjaAviso[];
}): AvisoRapido[] {
  if (!input.franjas.length) return [];
  const out: AvisoRapido[] = [];
  for (const fila of input.filas) {
    for (const key of input.claves) {
      if (!key.startsWith(`${fila.id}_`)) continue;
      const dateStr = key.slice(fila.id.length + 1);
      const t = input.turnoDe(fila.id, dateStr);
      if (!t?.trabajo || !t.code) continue;
      const puesto = t.positionName || '';
      const delPuesto = input.franjas.filter((f) => !puesto || normPlanilla(f.positionName) === normPlanilla(puesto));
      const pool = delPuesto.length ? delPuesto : input.franjas;
      const mismo = pool.filter((f) => claveCodigo(f.code) === claveCodigo(t.code));
      const dia = dateStr.slice(8, 10);
      const mes = dateStr.slice(5, 7);
      const etiqueta = `${fila.nombre.split(',')[0].trim().split(/\s+/)[0].toUpperCase()} · ${dia}/${mes}`;
      if (!mismo.length) {
        out.push({ tipo: 'SERVICIO', empId: fila.id, nombre: fila.nombre, dateStr, code: 'CODIGO', texto: `${etiqueta}: ${t.code} no está en el servicio${puesto ? ` de ${puesto}` : ''}` });
        continue;
      }
      const letra = letraDia(Number(dateStr.slice(0, 4)), Number(mes), Number(dia));
      const habilitada = mismo.filter((f) => !f.days?.length || f.days.map((d) => d.toUpperCase()).includes(letra));
      if (!habilitada.length) {
        out.push({ tipo: 'SERVICIO', empId: fila.id, nombre: fila.nombre, dateStr, code: 'DIA', texto: `${etiqueta}: ${t.code} no está habilitado el ${letra}` });
        continue;
      }
      if (t.startTime && t.endTime) {
        const horaOk = habilitada.some((f) => f.startTime && f.endTime && Math.abs(minDe(f.startTime) - minDe(t.startTime!)) <= 30 && Math.abs(minDe(f.endTime) - minDe(t.endTime!)) <= 30);
        if (!horaOk) {
          const h = habilitada.find((f) => f.startTime && f.endTime) || habilitada[0];
          out.push({ tipo: 'SERVICIO', empId: fila.id, nombre: fila.nombre, dateStr, code: 'HORARIO', texto: `${etiqueta}: ${t.code} ${t.startTime}–${t.endTime} y el servicio tiene ${h.startTime || ''}–${h.endTime || ''}` });
        }
      }
    }
  }
  return out;
}
