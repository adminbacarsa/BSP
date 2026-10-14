/**
 * Turnos sueltos del mes anterior: lo que no es el ciclo de nadie pero alguien cubrió
 * (en Vifood, los VFM/VFT de fin de semana que hacían ENSABELLA, GIMENEZ u OLMEDO).
 * Si el mes nuevo deja ese turno sin gente, se sugiere repetirlo con quien lo hizo,
 * siempre destildado: el planificador decide si va el mismo o lo cubre otro.
 */
import type { CeldaPropuesta, PuestoSla, SugerenciaNivelacion } from './continuarMesAnterior';

const LETRAS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
const PLURAL: Record<string, string> = { D: 'domingos', L: 'lunes', M: 'martes', X: 'miércoles', J: 'jueves', V: 'viernes', S: 'sábados' };
const CORTO: Record<string, string> = { D: 'Dom', L: 'Lun', M: 'Mar', X: 'Mié', J: 'Jue', V: 'Vie', S: 'Sáb' };

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

function up(v: unknown): string {
  return String(v ?? '').trim().toUpperCase();
}

export function letraDia(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return LETRAS[new Date(y, m - 1, d).getDay()];
}

function restarDias(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d - n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function horas(start: string, end: string): number {
  const [a, b] = [start, end].map((t) => { const [h, mi] = t.split(':').map(Number); return h * 60 + (mi || 0); });
  const diff = b > a ? b - a : b + 1440 - a;
  return Math.round((diff / 60) * 100) / 100;
}

export function sugerenciasSueltas(input: SueltoInput): SugerenciaNivelacion[] {
  if (!input.dias.length) return [];
  const desde = restarDias(input.dias[0], 35);
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
  const enDotacion = new Map(input.resultados.map((r) => [r.employeeId, r.nombre]));
  const out: SugerenciaNivelacion[] = [];
  const usado = new Set<string>();

  for (const dateStr of input.dias) {
    if (input.diaBloqueado?.(dateStr)) continue;
    const letra = letraDia(dateStr);
    for (const pos of input.estructura) {
      for (const s of pos.shifts || []) {
        const code = up(s.code);
        if (!code || !s.startTime || !s.endTime) continue;
        if (!input.turnoHabilitado(pos.positionName, String(s.code), dateStr)) continue;
        const need = Number(s.quantity ?? pos.qty ?? 1) || 1;
        let hay = 0;
        for (const r of input.resultados) {
          const p = propuestaDe.get(`${r.employeeId}_${dateStr}`);
          const c = p && !p.isFranco ? { code: p.code, positionName: p.positionName } : input.cargado(r.employeeId, dateStr);
          if (c && up(c.code) === code && c.positionName === pos.positionName) hay += 1;
        }
        let falta = need - hay;
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
        for (const cand of candidatos) {
          if (falta <= 0) break;
          const key = `${cand.id}_${dateStr}`;
          if (usado.has(key)) continue;
          const prop = propuestaDe.get(key);
          let francoTrabajado = false;
          if (prop) {
            if (!prop.isFranco) continue;
            francoTrabajado = true;
          } else if (input.cargado(cand.id, dateStr) || !input.libre(cand.id, dateStr)) {
            continue;
          }
          usado.add(key);
          falta -= 1;
          const veces = cand.mismoDia > 0 ? `${cand.mismoDia} ${PLURAL[letra]}` : `${cand.total} vez/veces`;
          out.push({
            dateStr,
            de: francoTrabajado ? 'F' : '',
            a: code,
            tipo: 'suelto',
            francoTrabajado,
            texto: `${CORTO[letra]} ${dateStr.slice(8, 10)}/${dateStr.slice(5, 7)} · ${String(s.code)} (${pos.positionName}): en ${input.mesAnteriorLabel} lo hizo ${cand.nombre} ${veces}${francoTrabajado ? ' · es su franco: queda como franco trabajado' : ''}`,
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
