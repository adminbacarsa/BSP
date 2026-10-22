import assert from 'node:assert/strict';
import test from 'node:test';
import { cctClosingMonthForDate } from '@/lib/cctPayrollPeriod';
import { liquidationCycleRange } from '@/lib/hoursPeriod';
import { armarMesDesdeServicio } from '@/lib/planificacion/armarMesServicio';
import { detectarRolesBanda } from '@/lib/planificacion/bandaFijaVolante';
import {
  diaIndex,
  proponerContinuacion,
  turnoHabilitadoPorEstructura,
  ymdDeIndex,
  type ContinuarInput,
  type PuestoSla,
  type ResultadoGuardia,
  type TurnoPrevio,
} from '@/lib/planificacion/continuarMesAnterior';
import { simularUnidad } from '@/lib/planificacion/prepararMes';

const OBJ = 'claret';
const POS = 'Vigilancia';
const LETRAS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

const estructura: PuestoSla[] = [{
  positionName: POS,
  qty: 1,
  shifts: [
    { code: 'M', name: 'Mañana', hours: 8, startTime: '07:00', endTime: '15:00', days: ['L', 'M', 'X', 'J', 'V'] },
    { code: 'T', name: 'Tarde', hours: 8, startTime: '15:00', endTime: '23:00', days: ['L', 'M', 'X', 'J', 'V'] },
    { code: 'N', name: 'Noche', hours: 9, startTime: '23:00', endTime: '08:00', days: ['L', 'M', 'X', 'J', 'V'] },
    { code: 'NE', name: 'Noche finde', hours: 9, startTime: '23:00', endTime: '08:00', days: ['S', 'D'] },
  ],
}];

const FASE = { marquez: 4, bustamante: 6, flores: 2, torre: 0 } as const;
const BANDA_FIJA = { marquez: 'M', bustamante: 'T', flores: 'N' } as const;

function letra(ds: string): string {
  const [y, m, d] = ds.split('-').map(Number);
  return LETRAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function finde(ds: string): boolean {
  const l = letra(ds);
  return l === 'S' || l === 'D';
}

function diasDelMes(y: number, m: number): string[] {
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
}

function onCiclo(ds: string, phase: number): boolean {
  return (diaIndex(ds) + phase) % 8 < 6;
}

function bandaHueco(ds: string): 'M' | 'T' | 'N' | null {
  const i = diaIndex(ds) % 8;
  if (i <= 1) return 'T';
  if (i <= 3) return 'M';
  if (i <= 5) return 'N';
  return null;
}

function horario(code: string): { start: string; end: string; hours: number } {
  if (code === 'M') return { start: '07:00', end: '15:00', hours: 8 };
  if (code === 'T') return { start: '15:00', end: '23:00', hours: 8 };
  if (code === 'N' || code === 'NE') return { start: '23:00', end: '08:00', hours: 9 };
  return { start: '00:00', end: '00:00', hours: 0 };
}

function codigoOctubre(id: keyof typeof FASE, ds: string): string {
  if (!onCiclo(ds, FASE[id])) return 'F';
  const fin = finde(ds);
  if (id === 'torre') {
    const b = bandaHueco(ds);
    if (!b || (fin && b !== 'N')) return 'RET';
    return b === 'N' ? (fin ? 'NE' : 'N') : b;
  }
  if (id === 'flores') return fin ? 'NE' : 'N';
  if (fin) return 'RET';
  return BANDA_FIJA[id];
}

function previosDe(id: keyof typeof FASE, dias: string[]): TurnoPrevio[] {
  return dias.map((ds) => {
    const code = codigoOctubre(id, ds);
    const h = horario(code);
    return {
      dateStr: ds,
      code,
      positionName: code === 'F' || code === 'RET' ? 'General' : POS,
      objectiveId: OBJ,
      hours: h.hours,
      startTime: h.start,
      endTime: h.end,
    };
  });
}

function entrada(dias: string[], previosMes: string[]): ContinuarInput {
  const ids = ['marquez', 'bustamante', 'flores', 'torre'] as const;
  const nombres = { marquez: 'MARQUEZ', bustamante: 'BUSTAMANTE', flores: 'FLORES', torre: 'DE LA TORRE' };
  return {
    objectiveId: OBJ,
    dias,
    estructura,
    guardias: ids.map((id) => ({ id, nombre: nombres[id], previos: previosDe(id, previosMes), puestoPreferido: POS })),
    estadoCelda: () => null,
    diaBloqueado: () => false,
    turnoHabilitado: (pos, code, ds) => turnoHabilitadoPorEstructura(estructura, pos, code, ds),
    cupoDia: null,
    punteroPrevio: null,
  };
}

function periodo(ds: string) {
  const [y, m, d] = ds.split('-').map(Number);
  const c = cctClosingMonthForDate(new Date(y, m - 1, d));
  return liquidationCycleRange(c.closingYear, c.closingMonth);
}

function celda(r: ResultadoGuardia, ds: string) {
  return r.propuestas.find((c) => c.dateStr === ds);
}

function trabaja(c: { code: string; isFranco: boolean } | undefined): boolean {
  return !!c && !c.isFranco && c.code !== 'RET';
}

function finMs(ds: string, start: string, hours: number): number {
  return new Date(`${ds}T${start}:00-03:00`).getTime() + hours * 3600e3;
}

function verificar(res: ResultadoGuardia[], oct: string[], nov: string[]) {
  const por = new Map(res.map((r) => [r.employeeId, r]));
  for (const id of ['marquez', 'bustamante', 'flores'] as const) {
    const r = por.get(id)!;
    for (const c of r.propuestas) {
      if (!trabaja(c) || finde(c.dateStr)) continue;
      assert.equal(c.code, BANDA_FIJA[id], `${id} ${c.dateStr} salió de su banda (${c.code})`);
    }
  }
  for (const ds of nov) {
    const codigos = ['marquez', 'bustamante', 'flores', 'torre'].map((id) => {
      const c = celda(por.get(id)!, ds);
      return trabaja(c) ? c!.code : '';
    });
    if (finde(ds)) {
      assert.equal(codigos.filter((c) => c === 'NE').length, 1, `${ds} NE: ${codigos.join(',')}`);
    } else {
      assert.deepEqual(codigos.filter(Boolean).sort(), ['M', 'N', 'T'], `${ds}: ${codigos.join(',')}`);
      for (const id of ['marquez', 'bustamante', 'flores'] as const) {
        const c = celda(por.get(id)!, ds);
        if (c?.isFranco) {
          const quien = ['marquez', 'bustamante', 'flores', 'torre'].filter((oid) => celda(por.get(oid)!, ds)?.code === BANDA_FIJA[id]);
          assert.deepEqual(quien, ['torre'], `${ds} franco de ${id} lo cubre ${quien.join(',')}`);
        }
      }
    }
  }
  for (const r of res) {
    const previos = previosDe(r.employeeId as keyof typeof FASE, oct);
    for (const ds of nov) {
      const p = periodo(ds);
      let h = 0;
      for (const t of previos) {
        if (t.dateStr >= p.start && t.dateStr <= p.end) h += Number(t.hours) || 0;
      }
      for (const c of r.propuestas) {
        if (c.dateStr >= p.start && c.dateStr <= p.end && trabaja(c)) h += c.hours;
      }
      assert.ok(h <= 200, `${r.employeeId} ciclo ${p.start}: ${h} h`);
    }
    let seg = 0;
    let prev = '';
    const cola = oct.filter((d) => d >= ymdDeIndex(diaIndex(nov[0]) - 8));
    for (const ds of [...cola, ...nov]) {
      const enNov = ds >= nov[0];
      const code = enNov ? (trabaja(celda(r, ds)) ? celda(r, ds)!.code : '') : (codigoOctubre(r.employeeId as keyof typeof FASE, ds));
      const labura = code !== '' && code !== 'F' && code !== 'RET';
      if (prev && diaIndex(ds) !== diaIndex(prev) + 1) seg = 0;
      seg = labura ? seg + 1 : 0;
      prev = ds;
      assert.ok(seg <= 6, `${r.employeeId} ${ds} racha ${seg}`);
    }
    const previosTrabajo = previosDe(r.employeeId as keyof typeof FASE, oct).filter((t) => Number(t.hours) > 0);
    const ultimoPrevio = previosTrabajo[previosTrabajo.length - 1];
    const primeroNov = r.propuestas.filter((c) => trabaja(c)).sort((a, b) => a.dateStr.localeCompare(b.dateStr))[0];
    if (ultimoPrevio && primeroNov && diaIndex(primeroNov.dateStr) === diaIndex(String(ultimoPrevio.dateStr)) + 1) {
      const fin = finMs(String(ultimoPrevio.dateStr), String(ultimoPrevio.startTime), Number(ultimoPrevio.hours));
      const ini = new Date(`${primeroNov.dateStr}T${primeroNov.startTime}:00-03:00`).getTime();
      assert.ok(ini - fin >= 8 * 3600e3, `${r.employeeId} descanso al cambiar de mes`);
    }
    const orden = r.propuestas.filter((c) => trabaja(c)).sort((a, b) => a.dateStr.localeCompare(b.dateStr));
    for (let i = 1; i < orden.length; i++) {
      if (diaIndex(orden[i].dateStr) !== diaIndex(orden[i - 1].dateStr) + 1) continue;
      const fin = finMs(orden[i - 1].dateStr, orden[i - 1].startTime, orden[i - 1].hours);
      const ini = new Date(`${orden[i].dateStr}T${orden[i].startTime}:00-03:00`).getTime();
      assert.ok(ini - fin >= 8 * 3600e3, `${r.employeeId} descanso ${orden[i].dateStr}`);
      assert.ok(orden[i].hours <= 12 + 59 / 60, `${r.employeeId} jornada ${orden[i].hours}`);
    }
  }
}

test('Claret: cada fijo conserva la banda en noviembre, nadie pasa 200 h y el finde cierra', () => {
  const oct = diasDelMes(2026, 10);
  const nov = diasDelMes(2026, 11);
  const input = entrada(nov, oct);
  const roles = detectarRolesBanda(input);
  assert.ok(roles);
  const rol = (id: string) => roles!.find((r) => r.id === id)!;
  assert.equal(rol('marquez').rol, 'fijo');
  assert.equal(rol('marquez').banda, 'M');
  assert.equal(rol('marquez').phase, FASE.marquez);
  assert.equal(rol('bustamante').banda, 'T');
  assert.equal(rol('bustamante').phase, FASE.bustamante);
  assert.equal(rol('flores').banda, 'N');
  assert.equal(rol('flores').phase, FASE.flores);
  assert.equal(rol('torre').rol, 'volante');
  assert.equal(rol('torre').phase, FASE.torre);

  const copia = proponerContinuacion(input);
  const armado = armarMesDesdeServicio(input);
  verificar(copia, oct, nov);
  verificar(armado, oct, nov);

  const sim = simularUnidad({
    unidadId: OBJ,
    dias: nov,
    estructura,
    guardias: input.guardias.map((g) => ({ ...g, tipo: 'propio' as const })),
    salientes: [],
    licencia: () => false,
    turnoDelMes: () => null,
    horasFueraDe: () => 0,
    retFuera: () => [],
    diaBloqueado: () => false,
    turnoHabilitado: (pos, code, ds) => turnoHabilitadoPorEstructura(estructura, pos, code, ds),
  });
  assert.equal(sim.continuar.metricas.horasSinCubrir, 0);
  assert.equal(sim.armar.metricas.horasSinCubrir, 0);
  assert.equal(sim.continuar.metricas.horasAl50, 0);
  assert.equal(sim.armar.metricas.horasAl50, 0);
  for (const id of ['marquez', 'bustamante', 'flores'] as const) {
    for (const bolsa of [sim.continuar.celdas, sim.armar.celdas]) {
      const diasMal = bolsa.filter((c) => c.employeeId === id && !c.isFranco && c.code !== 'RET' && !finde(c.dateStr) && c.code !== BANDA_FIJA[id]);
      assert.equal(diasMal.length, 0, `${id} ${diasMal.map((c) => c.dateStr + c.code).join(' ')}`);
    }
  }
});
