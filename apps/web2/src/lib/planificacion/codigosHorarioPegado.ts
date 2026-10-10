/**
 * Tabla «Códigos de esta planilla» del pegado: sigla, equivalencia y horario editable.
 * Si el horario confirmado no es el del servicio, se puede actualizar el servicio.
 */
import { claveEquivalencia, type EquivalenciaCodigo } from './equivalenciaCodigo';

export type FranjaServicio = { code: string; startTime: string; endTime: string; positionName?: string };

const ESTANDAR: Record<string, [string, string]> = {
  M: ['07:00', '15:00'],
  T: ['15:00', '23:00'],
  N: ['23:00', '07:00'],
  D12: ['07:00', '19:00'],
  N12: ['19:00', '07:00'],
};

export type FilaCodigoPlanilla = {
  sigla: string;
  rojo: boolean;
  code: string;
  inicio: string;
  fin: string;
  origen: 'equivalencia' | 'servicio' | 'estandar';
  inicioServicio: string;
  finServicio: string;
  difiereServicio: boolean;
};

function hm(v: string): string {
  const m = String(v || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function tablaCodigosPlanilla(
  siglas: readonly { sigla: string; rojo?: boolean }[],
  equivalencias: readonly EquivalenciaCodigo[] | null | undefined,
  servicio: readonly FranjaServicio[],
): FilaCodigoPlanilla[] {
  const vistos = new Set<string>();
  const out: FilaCodigoPlanilla[] = [];
  for (const s of siglas) {
    const sigla = String(s.sigla || '').trim().toUpperCase();
    if (!sigla) continue;
    const rojo = !!s.rojo;
    const clave = `${sigla}|${rojo ? 1 : 0}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const compact = sigla.replace(/[\s.\-]/g, '');
    const eq = (equivalencias || []).find((e) => e.clave === claveEquivalencia(compact, rojo))
      || (equivalencias || []).find((e) => e.clave === claveEquivalencia(compact, false));
    const delServicio = servicio.find((f) => f.code.toUpperCase() === (eq?.code || compact).toUpperCase())
      || servicio.find((f) => f.code.toUpperCase() === compact);
    const est = ESTANDAR[compact] || ESTANDAR[eq?.code || ''];
    const code = eq?.code || delServicio?.code || (est ? compact : compact);
    const inicio = hm(eq?.startTime || '') || hm(delServicio?.startTime || '') || (est ? est[0] : '');
    const fin = hm(eq?.endTime || '') || hm(delServicio?.endTime || '') || (est ? est[1] : '');
    const inicioServicio = hm(delServicio?.startTime || '');
    const finServicio = hm(delServicio?.endTime || '');
    const origen: FilaCodigoPlanilla['origen'] = eq?.startTime ? 'equivalencia' : delServicio ? 'servicio' : 'estandar';
    const difiereServicio = !!(inicioServicio && finServicio && (inicio !== inicioServicio || fin !== finServicio));
    out.push({ sigla, rojo, code, inicio, fin, origen, inicioServicio, finServicio, difiereServicio });
  }
  return out;
}

export type CambioHorarioServicio = { code: string; antes: string; despues: string };

export function cambiosHorarioServicio(filas: readonly FilaCodigoPlanilla[]): CambioHorarioServicio[] {
  return filas.filter((f) => f.difiereServicio).map((f) => ({
    code: f.code || f.sigla,
    antes: `${f.inicioServicio}–${f.finServicio}`,
    despues: `${f.inicio}–${f.fin}`,
  }));
}

export function textoFueraDeServicio(f: FilaCodigoPlanilla): string {
  return `Fuera del servicio (horario): ${f.sigla} ${f.inicio}–${f.fin} y el servicio tiene ${f.inicioServicio}–${f.finServicio}`;
}
