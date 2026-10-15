/**
 * Turnos sueltos del mes anterior: lo que no es el ciclo de nadie pero alguien cubrió
 * (en Vifood, los VFM/VFT de fin de semana que hacían ENSABELLA, GIMENEZ u OLMEDO).
 * Si el mes nuevo deja ese turno sin gente, se sugiere repetirlo con quien lo hizo,
 * siempre destildado: el planificador decide si va el mismo o lo cubre otro.
 *
 * Orden para no generar francos trabajados: alguien libre ese día; si no, mover su franco
 * a un día cercano donde su turno sobra (sigue 6+2, sin FT); recién al final, FT.
 */
import type { CeldaPropuesta, PuestoSla, SugerenciaNivelacion } from './continuarMesAnterior';

const LETRAS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
const PLURAL: Record<string, string> = { D: 'domingos', L: 'lunes', M: 'martes', X: 'miércoles', J: 'jueves', V: 'viernes', S: 'sábados' };
const CORTO: Record<string, string> = { D: 'dom', L: 'lun', M: 'mar', X: 'mié', J: 'jue', V: 'vie', S: 'sáb' };
const MAX_SEGUIDOS = 6;

export type SueltoInput = {
  dias: string[];
  estructura: PuestoSla[];
  turnoHabilitado: (positionName: string, code: string, dateStr: string) => boolean;
  /** Turnos del mes anterior por guardia (código y puesto como los ve la estructura). */
  historia: Array<{ employeeId: string; nombre: string; previos: Array<{ dateStr: string; code?: unknown; positionName?: unknown }> }>;
  resultados: Array<{ employeeId: string; nombre: string; propuestas: CeldaPropuesta[] }>;
  /** Turno de trabajo ya cargado en el mes nuevo (no propuesto). */
  cargado: (employeeId: string, dateStr: string) => { code: string; positionName: string } | null;
  /** La celda está vacía (sin licencia, sin turno, sin borrador). */
  libre: (employeeId: string, dateStr: string) => boolean;
  diaBloqueado?: (dateStr: string) => boolean;
  mesAnteriorLabel: string;
};

type Asignado = { code: string; positionName: string; franco: boolean; propuesto: boolean } | null;

function up(v: unknown): string {
  return String(v ?? '').trim().toUpperCase();
}

export function letraDia(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return LETRAS[new Date(y, m - 1, d).getDay()];
}

function sumarDias(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function horas(start: string, end: string): number {
  const [a, b] = [start, end].map((t) => { const [h, mi] = t.split(':').map(Number); return h * 60 + (mi || 0); });
  const diff = b > a ? b - a : b + 1440 - a;
  return Math.round((diff / 60) * 100) / 100;
}

function fechaCorta(dateStr: string): string {
  return `${CORTO[letraDia(dateStr)]} ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)}`;
}

export function sugerenciasSueltas(input: SueltoInput): SugerenciaNivelacion[] {
  if (!input.dias.length) return [];
  const desde = sumarDias(input.dias[0], -35);
  const enMes = new Set(input.dias);
  const propuestaDe = new Map<string, CeldaPropuesta>();
  const codigosCiclo = new Map<string, Set<string>>();
  for (const r of input.resultados) {
    const set = new Set<string>();
    for (const c of r.propuestas) {
      propuestaDe.set(`${r.employeeId}_${c.dateStr}`, c);
      if (!c.isFranco) set.add(up(c.code));
    }
    codigosCiclo.set(r.employeeId, set);
  }
  // Lo que ya sugerí cambia las cuentas de lo que sigue.
  const ajuste = new Map<string, Asignado>();
  const asignado = (empId: string, dateStr: string): Asignado => {
    const key = `${empId}_${dateStr}`;
    if (ajuste.has(key)) return ajuste.get(key)!;
    const p = propuestaDe.get(key);
    if (p) return { code: up(p.code), positionName: p.positionName, franco: p.isFranco, propuesto: true };
    const c = input.cargado(empId, dateStr);
    return c ? { code: up(c.code), positionName: c.positionName, franco: false, propuesto: false } : null;
  };
  const turnoDe = (posName: string, code: string) =>
    input.estructura.find((p) => p.positionName === posName)?.shifts?.find((s) => up(s.code) === code);
  const cupo = (dateStr: string, posName: string, code: string): number => {
    const pos = input.estructura.find((p) => p.positionName === posName);
    const s = turnoDe(posName, code);
    if (!pos || !s || !input.turnoHabilitado(posName, String(s.code), dateStr)) return 0;
    return Number(s.quantity ?? pos.qty ?? 1) || 1;
  };
  const hay = (dateStr: string, posName: string, code: string): number => {
    let n = 0;
    for (const r of input.resultados) {
      const a = asignado(r.employeeId, dateStr);
      if (a && !a.franco && a.code === code && a.positionName === posName) n += 1;
    }
    return n;
  };
  const trabaja = (empId: string, dateStr: string) => {
    const a = asignado(empId, dateStr);
    return !!a && !a.franco;
  };
  const seguidosOk = (empId: string, centro: string): boolean => {
    let racha = 0;
    for (let i = -MAX_SEGUIDOS - 1; i <= MAX_SEGUIDOS + 1; i++) {
      if (trabaja(empId, sumarDias(centro, i))) {
        racha += 1;
        if (racha > MAX_SEGUIDOS) return false;
      } else racha = 0;
    }
    return true;
  };
  /** Día cercano en que su turno sobra: ahí pasa el franco. */
  const buscarCambioDeFranco = (empId: string, dateStr: string, workCode: string, workPos: string): string | null => {
    for (const delta of [1, -1, 2, -2, 3, -3]) {
      const otro = sumarDias(dateStr, delta);
      if (!enMes.has(otro) || input.diaBloqueado?.(otro)) continue;
      const a = asignado(empId, otro);
      if (!a || a.franco || !a.propuesto) continue;
      if (hay(otro, a.positionName, a.code) - 1 < cupo(otro, a.positionName, a.code)) continue;
      const kD = `${empId}_${dateStr}`;
      const kO = `${empId}_${otro}`;
      const prevD = ajuste.has(kD) ? ajuste.get(kD)! : undefined;
      const prevO = ajuste.has(kO) ? ajuste.get(kO)! : undefined;
      ajuste.set(kD, { code: workCode, positionName: workPos, franco: false, propuesto: true });
      ajuste.set(kO, { code: 'F', positionName: 'General', franco: true, propuesto: true });
      const ok = seguidosOk(empId, dateStr) && seguidosOk(empId, otro);
      if (prevD === undefined) ajuste.delete(kD); else ajuste.set(kD, prevD);
      if (prevO === undefined) ajuste.delete(kO); else ajuste.set(kO, prevO);
      if (ok) return otro;
    }
    return null;
  };

  const enDotacion = new Map(input.resultados.map((r) => [r.employeeId, r.nombre]));
  const out: SugerenciaNivelacion[] = [];

  for (const dateStr of input.dias) {
    if (input.diaBloqueado?.(dateStr)) continue;
    const letra = letraDia(dateStr);
    for (const pos of input.estructura) {
      for (const s of pos.shifts || []) {
        const code = up(s.code);
        if (!code || !s.startTime || !s.endTime) continue;
        const need = cupo(dateStr, pos.positionName, code);
        let falta = need - hay(dateStr, pos.positionName, code);
        if (falta <= 0) continue;
        // Quién lo hizo suelto el mes anterior: el mismo día de la semana pesa más.
        const candidatos: Array<{ id: string; nombre: string; mismoDia: number; total: number }> = [];
        for (const h of input.historia) {
          if (!enDotacion.has(h.employeeId) || codigosCiclo.get(h.employeeId)?.has(code)) continue;
          let mismoDia = 0;
          let total = 0;
          for (const t of h.previos) {
            if (t.dateStr < desde || t.dateStr >= input.dias[0]) continue;
            if (up(t.code) !== code || String(t.positionName || '') !== pos.positionName) continue;
            total += 1;
            if (letraDia(t.dateStr) === letra) mismoDia += 1;
          }
          if (total > 0) candidatos.push({ id: h.employeeId, nombre: h.nombre, mismoDia, total });
        }
        candidatos.sort((a, b) => b.mismoDia - a.mismoDia || b.total - a.total || a.nombre.localeCompare(b.nombre));
        while (falta > 0) {
          // Libre primero, después mover el franco, el FT al final.
          let mejor: { cand: (typeof candidatos)[number]; modo: 'libre' | 'mover' | 'ft'; otro?: string } | null = null;
          const rango = { libre: 0, mover: 1, ft: 2 } as const;
          for (const cand of candidatos) {
            const a = asignado(cand.id, dateStr);
            let opcion: typeof mejor = null;
            if (!a) {
              if (input.libre(cand.id, dateStr)) {
                const k = `${cand.id}_${dateStr}`;
                ajuste.set(k, { code, positionName: pos.positionName, franco: false, propuesto: true });
                if (seguidosOk(cand.id, dateStr)) opcion = { cand, modo: 'libre' };
                ajuste.delete(k);
              }
            } else if (a.franco && a.propuesto) {
              const otro = buscarCambioDeFranco(cand.id, dateStr, code, pos.positionName);
              // Sobre su franco solo en el borde del bloque (pegado a un día de trabajo), nunca entre dos francos (F R1 F).
              const antes = asignado(cand.id, sumarDias(dateStr, -1));
              const despues = asignado(cand.id, sumarDias(dateStr, 1));
              const entreFrancos = !!antes?.franco && !!despues?.franco;
              opcion = otro ? { cand, modo: 'mover', otro } : entreFrancos ? null : { cand, modo: 'ft' };
            }
            if (opcion && (!mejor || rango[opcion.modo] < rango[mejor.modo])) mejor = opcion;
            if (mejor?.modo === 'libre') break;
          }
          if (!mejor) break;
          const { cand, modo, otro } = mejor;
          ajuste.set(`${cand.id}_${dateStr}`, { code, positionName: pos.positionName, franco: false, propuesto: true });
          if (otro) ajuste.set(`${cand.id}_${otro}`, { code: 'F', positionName: 'General', franco: true, propuesto: true });
          falta -= 1;
          const veces = cand.mismoDia > 0 ? `${cand.mismoDia} ${PLURAL[letra]}` : `${cand.total} vez/veces`;
          const extra = modo === 'mover' ? ` · su franco pasa al ${fechaCorta(otro!)} (sin FT)`
            : modo === 'ft' ? ' · lo hace en su franco, como el mes anterior' : '';
          out.push({
            dateStr,
            de: modo === 'libre' ? '' : 'F',
            a: code,
            tipo: 'suelto',
            // Como en el mes anterior: el turno se escribe común, sin la marca de FT.
            francoTrabajado: false,
            ...(otro ? { francoA: otro } : {}),
            texto: `${fechaCorta(dateStr)} · ${String(s.code)} (${pos.positionName}): en ${input.mesAnteriorLabel} lo hizo ${cand.nombre} ${veces}${extra}`,
            celda: {
              employeeId: cand.id,
              dateStr,
              code: String(s.code),
              name: String(s.name || s.code),
              positionName: pos.positionName,
              startTime: String(s.startTime),
              endTime: String(s.endTime),
              hours: Number(s.hours) || horas(String(s.startTime), String(s.endTime)),
              isFranco: false,
            },
          });
        }
      }
    }
  }
  return out;
}
