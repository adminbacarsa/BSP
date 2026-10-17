/**
 * «Armar el mes desde el servicio»: cuenta los turnos de cada puesto y franja del servicio y los completa con los
 * guardias, sin copiar el mes anterior. Reglas de Mauro (16–17/10):
 *  - Francos escalonados (6+2 si alcanza la gente, si no 5+1) para que cada día trabaje la cantidad que pide el servicio
 *    y todos queden cerca de 200 h sin pasarse.
 *  - Cada guardia conserva su turno durante el bloque (bandas fijas).
 *  - Si faltan propios: volantes del objetivo y guardias de otros objetivos con horas libres; después la extensión a
 *    12 h (D12 + N12 en un puesto de 24 h); el franco trabajado nunca (es lo más caro, va por consulta aparte).
 *  - Máx. 6 días seguidos, 48 h (56 h si la racha tiene una jornada de 12 h), descanso ≥ 12 h, tope 200 h.
 * Lógica pura: devuelve el mismo formato que «Continuar», así la vista previa y el borrador son los mismos.
 */
import type { CeldaPropuesta, ContinuarInput, PuestoSla, ResultadoGuardia, SugerenciaNivelacion } from './continuarMesAnterior';
import { codigoDeCiclo, diaIndex, turnoHabilitadoPorEstructura } from './continuarMesAnterior';
import { bandaDe } from './continuarC2';
import { getEffectiveShiftQuantityOnDate } from '../slaPlanningMatch';

export type TipoGuardiaArmado = 'propio' | 'volante' | 'otro';

export type ArmarMesInput = ContinuarInput & {
  /** propio = del objetivo; volante = volante del objetivo; otro = de otro objetivo (ayuda). Default propio. */
  tipoDe?: (employeeId: string) => TipoGuardiaArmado;
  /** Turno de trabajo en otro objetivo ese día (para descanso y choque). */
  ocupadoFuera?: (employeeId: string, dateStr: string) => { startTime: unknown; endTime: unknown; hours?: number } | null;
};

type Slot = { pos: string; code: string; name: string; startTime: string; endTime: string; dur: number; doce: boolean };

const H = 3600e3;
const TOPE = 200;

function up(v: unknown): string {
  return String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

/** Milisegundos (hora AR) de «HH:MM» en ese día, o de un Timestamp/Date. */
function msDe(v: unknown, dateStr: string): number | null {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v)) return new Date(`${dateStr}T${v.padStart(5, '0')}:00-03:00`).getTime();
  const d = (v as { toDate?: () => Date })?.toDate ? (v as { toDate: () => Date }).toDate() : v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : null;
}

function ventana(start: unknown, end: unknown, dateStr: string): { ini: number; fin: number } | null {
  const ini = msDe(start, dateStr);
  let fin = msDe(end, dateStr);
  if (ini == null || fin == null) return null;
  if (fin <= ini) fin += 24 * H;
  return { ini, fin };
}

function horasEntre(a: string, b: string): number {
  const m = (t: string) => { const [h, mi] = t.split(':').map(Number); return h * 60 + (mi || 0); };
  const d = m(b) - m(a);
  return Math.round(((d > 0 ? d : d + 1440) / 60) * 100) / 100;
}

function sumarDias(ds: string, n: number): string {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Franjas del día: las de 8 h de cada puesto con su cantidad; las de 12 h quedan como alternativa del puesto de 24 h. */
function slotsDelDia(estructura: PuestoSla[], dateStr: string, habilitado: (pos: string, code: string, ds: string) => boolean, doce: number): Slot[] {
  const out: Slot[] = [];
  let restantes = doce;
  for (const pos of estructura) {
    const shifts = (pos.shifts || []).filter((s) => s.code && s.startTime && s.endTime);
    const d12 = shifts.find((s) => /D12$/.test(up(s.code)));
    const n12 = shifts.find((s) => /N12$/.test(up(s.code)));
    const ocho = shifts.filter((s) => !/D12$|N12$/.test(up(s.code)));
    const bandas = new Set(ocho.map((s) => bandaDe(up(s.code))));
    const es24 = !!d12 && !!n12 && bandas.has('M') && bandas.has('T') && bandas.has('N');
    const cant = (code: string) => (habilitado(pos.positionName, code, dateStr) ? (getEffectiveShiftQuantityOnDate(pos as never, dateStr, code, pos.qty) || 0) : 0);
    let paxDoce = 0;
    if (es24 && restantes > 0) {
      const pax = Math.min(...['M', 'T', 'N'].map((b) => ocho.filter((s) => bandaDe(up(s.code)) === b).reduce((a, s) => a + cant(String(s.code)), 0)));
      paxDoce = Math.min(restantes, pax);
      restantes -= paxDoce;
    }
    const sacar: Record<string, number> = { M: paxDoce, T: paxDoce, N: paxDoce };
    for (const s of ocho) {
      let n = cant(String(s.code));
      const b = bandaDe(up(s.code));
      if (b && sacar[b] > 0) { const q = Math.min(n, sacar[b]); n -= q; sacar[b] -= q; }
      for (let i = 0; i < n; i++) {
        out.push({ pos: pos.positionName, code: String(s.code), name: String(s.name || s.code), startTime: String(s.startTime), endTime: String(s.endTime), dur: Number(s.hours) || horasEntre(String(s.startTime), String(s.endTime)), doce: false });
      }
    }
    for (let i = 0; i < paxDoce; i++) {
      for (const s of [d12!, n12!]) {
        out.push({ pos: pos.positionName, code: String(s.code), name: String(s.name || s.code), startTime: String(s.startTime), endTime: String(s.endTime), dur: Number(s.hours) || 12, doce: true });
      }
    }
  }
  return out;
}

/** Cuántos pax de 24 h se pueden pasar a 12 h ese día (puestos con D12/N12). */
function maxDoce(estructura: PuestoSla[]): number {
  let n = 0;
  for (const pos of estructura) {
    const codes = (pos.shifts || []).map((s) => up(s.code));
    if (codes.some((c) => /D12$/.test(c)) && codes.some((c) => /N12$/.test(c))) n += Math.max(1, Number(pos.qty) || 1);
  }
  return n;
}

type Estado = {
  run: number; runH: number; run12: number; fr: number; finMs: number; horas: number;
  prev: string | null; plan: Array<Slot | null>;
};

export function armarMesDesdeServicio(input: ArmarMesInput): ResultadoGuardia[] {
  const dias = input.dias;
  if (!dias.length) return [];
  const habilitado = input.turnoHabilitado
    || ((pos: string, code: string, ds: string) => turnoHabilitadoPorEstructura(input.estructura, pos, code, ds));
  const tipo = (id: string): TipoGuardiaArmado => input.tipoDe?.(id) || 'propio';
  const primero = dias[0];

  // Estado al cierre del mes anterior (racha, francos y fin del último turno).
  const est = new Map<string, Estado>();
  for (const g of input.guardias) {
    const porDia = new Map<string, { trabaja: boolean; v: { ini: number; fin: number } | null }>();
    for (const t of g.previos || []) {
      if (!t.dateStr || t.dateStr >= primero || t.dateStr < sumarDias(primero, -10)) continue;
      const code = codigoDeCiclo(t);
      if (!code) continue;
      const trabaja = code !== 'F' && code !== 'RET';
      const v = trabaja ? ventana(t.startTime, t.endTime, t.dateStr) : null;
      const prev = porDia.get(t.dateStr);
      if (!prev || (trabaja && !prev.trabaja)) porDia.set(t.dateStr, { trabaja, v });
    }
    let run = 0; let runH = 0; let fr = 0; let finMs = -Infinity;
    for (let i = 1; i <= 10; i++) { const c = porDia.get(sumarDias(primero, -i)); if (c?.trabaja && c.v) { finMs = c.v.fin; break; } }
    for (let i = 1; porDia.get(sumarDias(primero, -i))?.trabaja; i++) { run++; const v = porDia.get(sumarDias(primero, -i))!.v; runH += v ? (v.fin - v.ini) / H : 8; }
    if (!run) for (let i = 1; i <= 7 && !porDia.get(sumarDias(primero, -i))?.trabaja; i++) fr++;
    let horasFuera = 0;
    if (input.ocupadoFuera) for (const ds of dias) { const o = input.ocupadoFuera(g.id, ds); if (o) horasFuera += Number(o.hours) || ((ventana(o.startTime, o.endTime, ds)?.fin ?? 0) - (ventana(o.startTime, o.endTime, ds)?.ini ?? 0)) / H; }
    est.set(g.id, { run, runH, run12: 0, fr, finMs, horas: horasFuera, prev: null, plan: [] });
  }

  // Ritmo de los propios: 6+2 si alcanza la gente, si no 5+1. Francos escalonados para que cada día descanse parejo.
  const propios = input.guardias.filter((g) => tipo(g.id) === 'propio');
  const promedio = dias.reduce((a, ds) => a + slotsDelDia(input.estructura, ds, habilitado, 0).length, 0) / dias.length;
  const disponibles = propios.filter((g) => dias.some((ds) => input.estadoCelda(g.id, ds) === null)).length || 1;
  const [ciclo, trabaja] = promedio <= disponibles * 0.75 ? [8, 6] : [6, 5];
  const fase = new Map<string, number>();
  {
    // Fase deseada: seguir la racha con la que cerró el mes anterior; después se reparte parejo.
    const deseada = (id: string) => { const e = est.get(id)!; if (e.run >= trabaja) return trabaja; if (e.run > 0) return e.run; return e.fr === 1 && ciclo === 8 ? 7 : 0; };
    const cupo = Array.from({ length: ciclo }, (_, j) => Math.floor(propios.length / ciclo) + (j < propios.length % ciclo ? 1 : 0));
    const cuenta = Array(ciclo).fill(0);
    const pendientes: string[] = [];
    for (const g of propios) {
      const d = deseada(g.id);
      if (cuenta[d] < cupo[d]) { fase.set(g.id, d); cuenta[d]++; } else pendientes.push(g.id);
    }
    for (const id of pendientes) {
      const d = deseada(id);
      let mejor = 0; let dist = Infinity;
      for (let j = 0; j < ciclo; j++) if (cuenta[j] < cupo[j]) { const dd = Math.min((j - d + ciclo) % ciclo, (d - j + ciclo) % ciclo); if (dd < dist) { dist = dd; mejor = j; } }
      fase.set(id, mejor); cuenta[mejor]++;
    }
  }
  const enFase = (id: string, di: number) => !fase.has(id) || (di + fase.get(id)!) % ciclo < trabaja;

  const topeDoce = maxDoce(input.estructura);
  for (let di = 0; di < dias.length; di++) {
    const ds = dias[di];
    const libre = (id: string) => !input.diaBloqueado?.(ds) && input.estadoCelda(id, ds) === null;
    const puede = (id: string, s: Slot) => {
      const e = est.get(id)!;
      const v = ventana(s.startTime, s.endTime, ds)!;
      if (v.ini - e.finMs < 12 * H) return false;
      const fueraHoy = input.ocupadoFuera?.(id, ds);
      if (fueraHoy) return false;
      const fueraMan = input.ocupadoFuera?.(id, sumarDias(ds, 1));
      const vm = fueraMan ? ventana(fueraMan.startTime, fueraMan.endTime, sumarDias(ds, 1)) : null;
      if (vm && vm.ini - v.fin < 12 * H) return false;
      if (e.run >= 6) return false;
      if (e.runH + s.dur > (s.doce || e.run12 ? 56 : 48)) return false;
      if (e.horas + s.dur > TOPE) return false;
      return true;
    };
    let elegido: { asign: Map<string, Slot>; faltan: Slot[] } | null = null;
    for (let doce = 0; doce <= topeDoce; doce++) {
      const libres = slotsDelDia(input.estructura, ds, habilitado, doce);
      const asign = new Map<string, Slot>();
      const tomar = (id: string, s: Slot) => { libres.splice(libres.indexOf(s), 1); asign.set(id, s); };
      const costo = (id: string, s: Slot) => {
        const e = est.get(id)!;
        const ant = e.prev ? e.plan[e.plan.length - 1] : null;
        let c = 0;
        if (ant && ant.pos === s.pos && up(ant.code) === up(s.code)) c -= 30;
        else if (ant && bandaDe(up(ant.code)) === bandaDe(up(s.code))) c -= 12;
        else if (ant) c += 10;
        return c + e.horas / 20;
      };
      const asignarGrupo = (ids: string[]) => {
        // Quien sigue su bloque conserva su franja.
        for (const id of ids) {
          const e = est.get(id)!;
          const ant = e.prev ? e.plan[e.plan.length - 1] : null;
          if (!ant || asign.has(id)) continue;
          const s = libres.find((x) => x.pos === ant.pos && x.code === ant.code && puede(id, x));
          if (s) tomar(id, s);
        }
        // El resto: el más restringido primero, a la franja que menos le cuesta.
        let pend = ids.filter((id) => !asign.has(id));
        while (pend.length && libres.length) {
          let best: { id: string; s: Slot; k: number } | null = null;
          for (const id of pend) {
            const ops = libres.filter((s) => puede(id, s));
            if (!ops.length) continue;
            const s = ops.sort((a, b) => costo(id, a) - costo(id, b))[0];
            const k = ops.length * 100 + costo(id, s);
            if (!best || k < best.k) best = { id, s, k };
          }
          if (!best) break;
          tomar(best.id, best.s);
          pend = pend.filter((x) => x !== best!.id);
        }
      };
      // 1) Propios en su fase (si sobran, descansa el de más horas: mejor franco que RET sin usar).
      const enTurno = propios.map((g) => g.id).filter((id) => enFase(id, di) && libre(id))
        .sort((a, b) => est.get(a)!.horas - est.get(b)!.horas);
      asignarGrupo(enTurno);
      // 2) Volantes y 3) guardias de otros objetivos, el más lejos de 200 h primero.
      for (const t of ['volante', 'otro'] as const) {
        if (!libres.length) break;
        const ayuda = input.guardias.map((g) => g.id).filter((id) => tipo(id) === t && libre(id))
          .sort((a, b) => est.get(a)!.horas - est.get(b)!.horas);
        asignarGrupo(ayuda);
      }
      // 4) Propios fuera de su fase (después de las 12 h), sin pasar 6 seguidos ni 200 h.
      if (libres.length && doce === topeDoce) asignarGrupo(propios.map((g) => g.id).filter((id) => !asign.has(id) && libre(id)));
      elegido = { asign, faltan: libres };
      if (!libres.length) break;
    }
    for (const g of input.guardias) {
      const e = est.get(g.id)!;
      const s = elegido!.asign.get(g.id);
      if (s) {
        const v = ventana(s.startTime, s.endTime, ds)!;
        e.finMs = v.fin; e.run++; e.runH += s.dur; e.run12 += s.doce ? 1 : 0; e.fr = 0; e.horas += s.dur; e.prev = s.code;
        e.plan.push(s);
      } else {
        const fuera = input.ocupadoFuera?.(g.id, ds);
        const vf = fuera ? ventana(fuera.startTime, fuera.endTime, ds) : null;
        if (vf) e.finMs = vf.fin;
        e.run = vf ? e.run + 1 : 0; e.runH = 0; e.run12 = 0; e.fr = vf ? 0 : e.fr + 1; e.prev = null;
        e.plan.push(null);
      }
    }
  }

  const etiqueta = `armado desde el servicio · ${ciclo === 8 ? '6+2' : '5+1'} escalonado`;
  return input.guardias.map((g) => {
    const e = est.get(g.id)!;
    const t = tipo(g.id);
    const propuestas: CeldaPropuesta[] = [];
    let horas = 0;
    dias.forEach((ds, i) => {
      const s = e.plan[i];
      if (s) {
        propuestas.push({ employeeId: g.id, dateStr: ds, code: s.code, name: s.name, positionName: s.pos, startTime: s.startTime, endTime: s.endTime, hours: s.dur, isFranco: false });
        horas += s.dur;
      } else if (t === 'propio' && input.estadoCelda(g.id, ds) === null && !input.diaBloqueado?.(ds)) {
        propuestas.push({ employeeId: g.id, dateStr: ds, code: 'F', name: 'Franco', positionName: 'General', startTime: '00:00', endTime: '00:00', hours: 0, isFranco: true });
      }
    });
    const trabaja = propuestas.some((c) => !c.isFranco);
    return {
      employeeId: g.id,
      nombre: g.nombre,
      ciclo: trabaja ? { periodo: ciclo, fases: [], consistencia: 1, muestras: 0, ultimoDia: '', etiqueta: t === 'propio' ? etiqueta : `${t === 'volante' ? 'volante' : 'de otro objetivo'}: cubre lo que falta` } : null,
      origenCiclo: trabaja ? 'armado' : null,
      estimado: t !== 'propio',
      notaEstimado: t !== 'propio' ? (t === 'volante' ? 'volante del objetivo' : 'de otro objetivo, con horas libres') : null,
      continuaEn: '',
      motivoSinCiclo: trabaja ? null : (t === 'propio' ? 'No hace falta en el mes o está de licencia' : 'No hizo falta'),
      propuestas: trabaja ? propuestas : [],
      omitidas: { licencia: 0, ocupada: 0, bloqueada: 0, sinDato: 0, excluida: 0 },
      revisar: [],
      horasPropuestas: horas,
      plantilla: null,
      sugerencias: [],
    } as ResultadoGuardia;
  });
}

/** Turnos que quedaron sin nadie por día (para el aviso de la vista previa). */
export function huecosDelArmado(input: ArmarMesInput, resultados: ResultadoGuardia[]): Array<{ dateStr: string; positionName: string; code: string; faltan: number }> {
  const habilitado = input.turnoHabilitado
    || ((pos: string, code: string, ds: string) => turnoHabilitadoPorEstructura(input.estructura, pos, code, ds));
  const out: Array<{ dateStr: string; positionName: string; code: string; faltan: number }> = [];
  for (const ds of input.dias) {
    const hechos = new Map<string, number>();
    for (const r of resultados) for (const c of r.propuestas) if (c.dateStr === ds && !c.isFranco) hechos.set(`${c.positionName}|${up(c.code)}`, (hechos.get(`${c.positionName}|${up(c.code)}`) || 0) + 1);
    const doce = [...hechos.keys()].filter((k) => /D12$/.test(k)).reduce((a, k) => a + (hechos.get(k) || 0), 0);
    const pide = new Map<string, number>();
    for (const s of slotsDelDia(input.estructura, ds, habilitado, doce)) pide.set(`${s.pos}|${up(s.code)}`, (pide.get(`${s.pos}|${up(s.code)}`) || 0) + 1);
    for (const [k, n] of pide) {
      const f = n - (hechos.get(k) || 0);
      if (f > 0) { const [positionName, code] = k.split('|'); out.push({ dateStr: ds, positionName, code, faltan: f }); }
    }
  }
  return out;
}

export { diaIndex };

/**
 * «Continuar»: lo que la copia deja sin nadie se cubre con gente disponible antes que con 12 h. Orden: volantes del
 * objetivo → guardias de otros objetivos en la dotación → RET de otros objetivos ese día (de toda la empresa). Sin choque,
 * descanso ≥ 12 h, racha ≤ 6 y 200 h (contando su turno en otro objetivo). Van como sugerencias `disponible` (tildadas).
 */
export function cubrirHuecosConDisponibles(
  input: ArmarMesInput & {
    /** RET de otros objetivos ese día (quien no está en la dotación). */
    retFuera?: (dateStr: string) => Array<{ id: string; nombre: string; objetivo: string }>;
    /** Horas del mes en otros objetivos de quien no está en la dotación. */
    horasFueraDe?: (employeeId: string) => number;
  },
  resultados: ResultadoGuardia[],
): SugerenciaNivelacion[] {
  const dias = input.dias;
  if (!dias.length) return [];
  const tipo = (id: string): TipoGuardiaArmado => input.tipoDe?.(id) || 'propio';
  const huecos = huecosDelArmado(input, resultados);
  if (!huecos.length) return [];
  // Turno de cada uno por día: lo propuesto, lo de otro objetivo y lo que se va sugiriendo.
  const dia = new Map<string, { ini: number; fin: number } | 'F' | null>();
  const horas = new Map<string, number>();
  const k = (id: string, ds: string) => `${id}_${ds}`;
  const ventanaDe = (id: string, ds: string): { ini: number; fin: number } | 'F' | null => {
    if (dia.has(k(id, ds))) return dia.get(k(id, ds))!;
    const fuera = input.ocupadoFuera?.(id, ds);
    return fuera ? ventana(fuera.startTime, fuera.endTime, ds) : null;
  };
  for (const r of resultados) {
    let h = 0;
    for (const c of r.propuestas) {
      dia.set(k(r.employeeId, c.dateStr), c.isFranco ? 'F' : ventana(c.startTime, c.endTime, c.dateStr));
      if (!c.isFranco) h += c.hours;
    }
    horas.set(r.employeeId, h);
  }
  for (const g of input.guardias) {
    let h = horas.get(g.id) || 0;
    if (input.ocupadoFuera) for (const ds of dias) { const o = input.ocupadoFuera(g.id, ds); if (o) { const v = ventana(o.startTime, o.endTime, ds); h += Number(o.hours) || (v ? (v.fin - v.ini) / H : 8); } }
    horas.set(g.id, h);
  }
  const trabaja = (id: string, ds: string) => { const v = ventanaDe(id, ds); return !!v && v !== 'F'; };
  const puede = (id: string, ds: string, v: { ini: number; fin: number }, dur: number, horasBase: number) => {
    if (ventanaDe(id, ds)) return false;
    if (input.estadoCelda(id, ds) !== null && input.guardias.some((g) => g.id === id)) return false;
    const antes = ventanaDe(id, sumarDias(ds, -1));
    if (antes && antes !== 'F' && v.ini - antes.fin < 12 * H) return false;
    const despues = ventanaDe(id, sumarDias(ds, 1));
    if (despues && despues !== 'F' && despues.ini - v.fin < 12 * H) return false;
    let racha = 1;
    for (let i = 1; i <= 6 && trabaja(id, sumarDias(ds, -i)); i++) racha++;
    for (let i = 1; i <= 6 && trabaja(id, sumarDias(ds, i)); i++) racha++;
    if (racha > 6) return false;
    return horasBase + dur <= TOPE;
  };
  const out: SugerenciaNivelacion[] = [];
  const fecha = (ds: string) => `${ds.slice(8, 10)}/${ds.slice(5, 7)}`;
  for (const h of huecos) {
    const pos = input.estructura.find((p) => p.positionName === h.positionName);
    const sh = (pos?.shifts || []).find((s) => up(s.code) === up(h.code));
    if (!sh?.startTime || !sh?.endTime) continue;
    const v = ventana(sh.startTime, sh.endTime, h.dateStr);
    if (!v) continue;
    const dur = Number(sh.hours) || (v.fin - v.ini) / H;
    for (let n = 0; n < h.faltan; n++) {
      const enDotacion = input.guardias
        .filter((g) => tipo(g.id) !== 'propio')
        .sort((a, b) => (tipo(a.id) === 'volante' ? 0 : 1) - (tipo(b.id) === 'volante' ? 0 : 1) || (horas.get(a.id) || 0) - (horas.get(b.id) || 0))
        .map((g) => ({ id: g.id, nombre: g.nombre, origen: tipo(g.id) === 'volante' ? 'volante' : 'de otro objetivo' }));
      const rets = (input.retFuera?.(h.dateStr) || [])
        .filter((r) => !input.guardias.some((g) => g.id === r.id))
        .map((r) => ({ id: r.id, nombre: r.nombre, origen: `de RET en ${r.objetivo}` }));
      const elegido = [...enDotacion, ...rets].find((c) => {
        const base = horas.get(c.id) ?? input.horasFueraDe?.(c.id) ?? 0;
        return puede(c.id, h.dateStr, v, dur, base);
      });
      if (!elegido) break;
      dia.set(k(elegido.id, h.dateStr), v);
      horas.set(elegido.id, (horas.get(elegido.id) ?? input.horasFueraDe?.(elegido.id) ?? 0) + dur);
      out.push({
        dateStr: h.dateStr,
        de: '',
        a: String(sh.code),
        tipo: 'disponible',
        texto: `${fecha(h.dateStr)} · ${String(sh.code)} (${h.positionName}): ${elegido.nombre.split(',')[0]}, ${elegido.origen} · ${Math.round(horas.get(elegido.id) || 0)} h en el mes`,
        celda: {
          employeeId: elegido.id, dateStr: h.dateStr, code: String(sh.code), name: String(sh.name || sh.code), positionName: h.positionName,
          startTime: String(sh.startTime), endTime: String(sh.endTime), hours: dur, isFranco: false,
        },
      });
    }
  }
  return out;
}
