/**
 * Extensión y adelanto de un puesto que tapa el hueco de OTRO puesto del mismo
 * objetivo, solo en los minutos que se superponen. Cada minuto del tramo se usa
 * una vez. TURA (pedido del cliente) se factura encima de lo vendido; la
 * extensión de cobertura reemplaza el faltante y no suma por encima.
 */

export type FranjaExt = { code?: string; startTime: string; endTime: string; qty?: number };
export type PuestoExt = { positionName: string; franjas: FranjaExt[] };

export type TurnoExt = {
  positionName?: string;
  nombre?: string;
  code?: string;
  startTime?: string;
  endTime?: string;
  hours?: number;
  isExtended?: boolean;
  isEarlyStart?: boolean;
  segmentFromTime?: string;
  segmentToTime?: string;
  extExtraHours?: number;
  isTura?: boolean;
};

export type PuestoExtResultado = {
  positionName: string;
  cerrado: boolean;
  faltanHoras: number;
  facturable: number;
  vendidas: number;
  /** Horas de extensión de este puesto que se fueron a un hueco ajeno. */
  cedidasHoras: number;
  textos: string[];
};

export type ResultadoExtEntre = {
  cerrado: boolean;
  facturable: number;
  vendidas: number;
  turaHoras: number;
  /** Minutos de ext/adel que taparon un hueco (propio o ajeno). No se facturan de más. */
  extEnHuecoHoras: number;
  textos: string[];
  porPuesto: PuestoExtResultado[];
};

const DIA = 1440;
const ALTERNATIVAS_12 = new Set(['D12', 'N12']);
const NO_PRESENCIA = new Set(['F', 'FF', 'FP', 'RET', 'REF', 'ESC', 'EV', 'AA', 'V', 'L', 'E', 'A', 'PG', 'ART', 'SGS', 'SUS', 'LT']);

function up(v: unknown): string {
  return String(v || '').trim().toUpperCase();
}

function norm(v: unknown): string {
  return up(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function hm(v: unknown): string {
  const m = String(v || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function aMin(h: string): number | null {
  const m = hm(h);
  if (!m) return null;
  const p = m.split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

function aHm(min: number): string {
  const v = ((min % DIA) + DIA) % DIA;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

function hora(h: string): string {
  const m = hm(h);
  if (!m) return h;
  const [hh, mm] = m.split(':');
  return mm === '00' ? hh : `${hh}:${mm}`;
}

function ventana(inicio: string, fin: string): [number, number] | null {
  const a = aMin(inicio);
  let b = aMin(fin);
  if (a == null || b == null || a === b) return null;
  if (b <= a) b += DIA;
  return [a, b];
}

function horasDe(min: number): number {
  return Math.round((min / 60) * 10) / 10;
}

/**
 * El turno entra al cruce solo si es de este objetivo.
 * Sin objectiveId no se asume: hace falta el objetivo del legajo.
 * Si marca el objetivo del hueco (`coversObjectiveId`), acredita ahí y no en el de origen.
 */
export function turnoExtDelObjetivo(
  shift: { objectiveId?: string | null; coversObjectiveId?: string | null } | null | undefined,
  objectiveId: string,
  opts?: { objetivoLegajo?: string | null },
): boolean {
  if (!shift || !objectiveId) return false;
  const cubre = String(shift.coversObjectiveId || '').trim();
  if (cubre) return cubre === String(objectiveId);
  const propio = String(shift.objectiveId || '').trim();
  if (propio) return propio === String(objectiveId);
  const legajo = String(opts?.objetivoLegajo || '').trim();
  return !!legajo && legajo === String(objectiveId);
}

/** Mismo delta que el pie de un objetivo: si el cruce cerró el puesto, suma lo que faltaba por código. */
export function deltaCierreExtEntre(
  units: { required: number; closed: number },
  cruce: { cerrado: boolean } | undefined,
): number {
  if (!cruce || !(units.required > 0) || !cruce.cerrado || units.closed >= units.required) return 0;
  return units.required - units.closed;
}

export function esExtensionTura(shift: { code?: string; isTura?: boolean } | null | undefined): boolean {
  if (!shift) return false;
  if (shift.isTura === true) return true;
  return up(shift.code) === 'TURA';
}

function turaEntero(t: TurnoExt): boolean {
  if (!esExtensionTura(t)) return false;
  if (up(t.code) === 'TURA') return true;
  return !t.isExtended && !t.isEarlyStart;
}

type Tramo = { a: number; b: number; tipo: 'ext' | 'adel'; nombre: string; origen: string; desde: string; hasta: string; tura: boolean };

function tipoDe(t: TurnoExt, a: number, b: number): 'ext' | 'adel' {
  if (t.isEarlyStart && !t.isExtended) return 'adel';
  if (t.isExtended && !t.isEarlyStart) return 'ext';
  const ini = aMin(hm(t.startTime));
  if (ini != null && b <= ini) return 'adel';
  return 'ext';
}

function tramoDe(t: TurnoExt): Tramo | null {
  const nombre = String(t.nombre || '').trim() || 'guardia';
  const origen = String(t.positionName || '');
  const desdeSeg = hm(t.segmentFromTime);
  const hastaSeg = hm(t.segmentToTime);
  if ((t.isExtended || t.isEarlyStart) && desdeSeg && hastaSeg) {
    const v = ventana(desdeSeg, hastaSeg);
    if (!v) return null;
    return { a: v[0], b: v[1], tipo: tipoDe(t, v[0], v[1]), nombre, origen, desde: desdeSeg, hasta: hastaSeg, tura: esExtensionTura(t) && !turaEntero(t) };
  }
  const extra = Number(t.extExtraHours);
  if (!(extra > 0)) return null;
  const ini = hm(t.startTime);
  const fin = hm(t.endTime);
  const mins = Math.round(extra * 60);
  if (t.isExtended && fin) {
    const desdeMin = aMin(fin);
    if (desdeMin == null) return null;
    const hasta = aHm(desdeMin + mins);
    const v = ventana(fin, hasta);
    if (!v) return null;
    return { a: v[0], b: v[1], tipo: 'ext', nombre, origen, desde: fin, hasta, tura: esExtensionTura(t) && !turaEntero(t) };
  }
  if (t.isEarlyStart && ini) {
    const hastaMin = aMin(ini);
    if (hastaMin == null) return null;
    const desde = aHm(hastaMin - mins);
    const v = ventana(desde, ini);
    if (!v) return null;
    return { a: v[0], b: v[1], tipo: 'adel', nombre, origen, desde, hasta: ini, tura: esExtensionTura(t) && !turaEntero(t) };
  }
  return null;
}

function baseDe(t: TurnoExt, extra: Tramo | null): Array<[number, number]> {
  if (turaEntero(t)) return [];
  const code = up(t.code);
  if (NO_PRESENCIA.has(code)) return [];
  const ini = hm(t.startTime);
  const fin = hm(t.endTime);
  const full = ini && fin ? ventana(ini, fin) : null;
  if (!full) return [];
  if (!extra || extra.tura) return [full];
  const [a, b] = full;
  const out: Array<[number, number]> = [];
  if (extra.b <= a || extra.a >= b) out.push([a, b]);
  else {
    if (extra.a > a) out.push([a, extra.a]);
    if (extra.b < b) out.push([extra.b, b]);
  }
  return out.filter(([x, y]) => y > x);
}

function horasTura(t: TurnoExt, extra: Tramo | null): number {
  if (extra?.tura) return (extra.b - extra.a) / 60;
  if (!turaEntero(t)) return 0;
  const ini = hm(t.startTime);
  const fin = hm(t.endTime);
  const v = ini && fin ? ventana(ini, fin) : null;
  if (v) return (v[1] - v[0]) / 60;
  const h = Number(t.hours);
  return h > 0 ? h : 0;
}

function franjasDe(p: PuestoExt): Array<{ code: string; a: number; b: number; desde: string; hasta: string; qty: number }> {
  const conHorario = p.franjas
    .map((f) => {
      const desde = hm(f.startTime);
      const hasta = hm(f.endTime);
      const v = ventana(desde, hasta);
      if (!v) return null;
      return { code: up(f.code), a: v[0], b: v[1], desde, hasta, qty: Math.max(1, Number(f.qty) || 1) };
    })
    .filter((f): f is NonNullable<typeof f> => !!f);
  const tieneOcho = conHorario.some((f) => !ALTERNATIVAS_12.has(f.code));
  return tieneOcho ? conHorario.filter((f) => !ALTERNATIVAS_12.has(f.code)) : conHorario;
}

type Donor = { tipo: 'ext' | 'adel'; nombre: string; desde: string; hasta: string };

function textoDonantes(lista: Donor[]): string {
  const vistos = new Set<string>();
  const partes: string[] = [];
  const orden = [...lista].sort((a, b) => a.desde.localeCompare(b.desde) || a.nombre.localeCompare(b.nombre));
  for (const d of orden) {
    const k = `${d.tipo}|${d.nombre}|${d.desde}|${d.hasta}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    partes.push(`${d.tipo}. de ${d.nombre} ${hora(d.desde)}–${hora(d.hasta)}`);
  }
  return partes.join(' y ');
}

function corridas(mins: number[], desde: number, hasta: number): Array<{ a: number; b: number }> {
  const out: Array<{ a: number; b: number }> = [];
  let abierta: number | null = null;
  for (let m = desde; m <= hasta; m++) {
    const falta = m < hasta && mins.includes(m);
    if (falta && abierta == null) abierta = m;
    if (!falta && abierta != null) {
      out.push({ a: abierta, b: m });
      abierta = null;
    }
  }
  return out;
}

export function acreditarExtEntrePuestos(puestos: readonly PuestoExt[], turnos: readonly TurnoExt[]): ResultadoExtEntre {
  const modelos = puestos
    .map((p) => ({ nombre: String(p.positionName || 'Puesto'), clave: norm(p.positionName), franjas: franjasDe(p) }))
    .filter((p) => p.franjas.length);
  const demanda = modelos.map(() => new Array<number>(DIA * 2).fill(0));
  const oferta = modelos.map(() => new Array<number>(DIA * 2).fill(0));
  for (let i = 0; i < modelos.length; i++) {
    for (const f of modelos[i].franjas) {
      for (let m = f.a; m < f.b; m++) demanda[i][m] += f.qty;
    }
  }
  const indice = (pos: string) => {
    const n = norm(pos);
    return n ? modelos.findIndex((p) => p.clave === n) : -1;
  };

  type Libre = Tramo & { libres: number[] };
  const libres: Libre[] = [];
  let turaMin = 0;
  for (const t of turnos) {
    const extra = tramoDe(t);
    turaMin += Math.round(horasTura(t, extra) * 60);
    const propio = indice(String(t.positionName || ''));
    for (const [a, b] of baseDe(t, extra)) {
      if (propio < 0) continue;
      for (let m = a; m < b; m++) oferta[propio][m] += 1;
    }
    if (!extra || extra.tura) continue;
    const mins: number[] = [];
    for (let m = extra.a; m < extra.b; m++) mins.push(m);
    libres.push({ ...extra, libres: mins });
  }

  const ceder = new Array<number>(modelos.length).fill(0);
  let extEnHueco = 0;
  const ajenos: Donor[][] = modelos.map(() => []);

  const tomar = (lib: Libre, destino: number, cede: boolean) => {
    const quedan: number[] = [];
    for (const m of lib.libres) {
      if (destino >= 0 && m < demanda[destino].length && oferta[destino][m] < demanda[destino][m]) {
        oferta[destino][m] += 1;
        extEnHueco += 1;
        if (cede) {
          const origen = indice(lib.origen);
          if (origen >= 0) ceder[origen] += 1;
          ajenos[destino].push({ tipo: lib.tipo, nombre: lib.nombre, desde: lib.desde, hasta: lib.hasta });
        }
      } else quedan.push(m);
    }
    lib.libres = quedan;
  };

  for (const lib of libres) tomar(lib, indice(lib.origen), false);
  for (const lib of libres) {
    for (let i = 0; i < modelos.length; i++) {
      if (!lib.libres.length) break;
      if (norm(lib.origen) === modelos[i].clave) continue;
      tomar(lib, i, true);
    }
  }

  const porPuesto: PuestoExtResultado[] = modelos.map((p, i) => {
    let vendMin = 0;
    let cubMin = 0;
    let faltMin = 0;
    const textos: string[] = [];
    // Dos franjas del mismo puesto (MM 08–20 y ME 10–14) comparten minutos.
    // La demanda de cada minuto se cuenta una sola vez.
    let desdeMin = DIA * 2;
    let hastaMin = 0;
    for (const f of p.franjas) {
      if (f.a < desdeMin) desdeMin = f.a;
      if (f.b > hastaMin) hastaMin = f.b;
    }
    for (let m = desdeMin; m < hastaMin; m++) {
      const need = demanda[i][m];
      if (!(need > 0)) continue;
      const cub = Math.min(oferta[i][m], need);
      vendMin += need;
      cubMin += cub;
      faltMin += need - cub;
    }
    for (const f of p.franjas) {
      const huecos: number[] = [];
      let foreign = 0;
      for (let m = f.a; m < f.b; m++) {
        const need = demanda[i][m];
        const cub = Math.min(oferta[i][m], need);
        const falta = need - cub;
        if (falta > 0) huecos.push(m);
        if (ajenos[i].some((d) => {
          const v = ventana(d.desde, d.hasta);
          return !!v && m >= v[0] && m < v[1];
        })) foreign += Math.min(1, cub);
      }
      const donantes = ajenos[i].filter((d) => {
        const v = ventana(d.desde, d.hasta);
        return !!v && v[0] < f.b && v[1] > f.a;
      });
      if (huecos.length === 0 && donantes.length) {
        textos.push(`${p.nombre} ${hora(f.desde)}–${hora(f.hasta)}: cubierto por ${textoDonantes(donantes)}`);
      } else if (huecos.length) {
        if (foreign > 0 && donantes.length) {
          textos.push(`${p.nombre} ${hora(f.desde)}–${hora(f.hasta)}: cubierto por ${textoDonantes(donantes)}`);
        }
        const runs = corridas(huecos, f.a, f.b);
        const donde = runs.map((r) => `${hora(aHm(r.a))}–${hora(aHm(r.b))}`).join(', ');
        textos.push(donde ? `${p.nombre} falta ${donde}` : `${p.nombre} falta ${hora(f.desde)}–${hora(f.hasta)}`);
      }
    }
    return {
      positionName: p.nombre,
      cerrado: faltMin === 0,
      faltanHoras: horasDe(faltMin),
      facturable: horasDe(cubMin),
      vendidas: horasDe(vendMin),
      cedidasHoras: horasDe(ceder[i]),
      textos,
    };
  });

  const vendidas = porPuesto.reduce((s, p) => s + p.vendidas, 0);
  const cubiertas = porPuesto.reduce((s, p) => s + p.facturable, 0);
  const turaHoras = horasDe(turaMin);
  const textos = porPuesto.flatMap((p) => p.textos);
  return {
    cerrado: porPuesto.length > 0 && porPuesto.every((p) => p.cerrado),
    facturable: horasDe(cubiertas * 60 + turaMin),
    vendidas: horasDe(vendidas * 60),
    turaHoras,
    extEnHuecoHoras: horasDe(extEnHueco),
    textos,
    porPuesto,
  };
}

export function textoFacturableCliente(r: { facturable: number; vendidas: number; turaHoras: number }): string {
  const n = (x: number) => {
    const v = Math.round(x * 10) / 10;
    return Number.isInteger(v) ? String(v) : String(v);
  };
  const cob = Math.round((r.facturable - r.turaHoras) * 10) / 10;
  const tura = r.turaHoras > 0 ? ` TURA +${n(r.turaHoras)}h, se factura.` : '';
  if (!(r.vendidas > 0)) return '';
  if (Math.abs(r.facturable - r.vendidas) < 0.05) {
    return `Facturable ${n(r.facturable)}h = vendidas. La extensión de cobertura reemplaza el faltante y no suma por encima.${tura}`;
  }
  if (r.turaHoras > 0 && Math.abs(cob - r.vendidas) < 0.05) {
    return `Facturable ${n(r.facturable)}h = vendidas ${n(r.vendidas)}h + TURA ${n(r.turaHoras)}h.`;
  }
  if (cob < r.vendidas - 0.05) {
    return `Facturable ${n(r.facturable)}h. Faltan ${n(r.vendidas - cob)}h de cobertura.${tura}`;
  }
  return `Facturable ${n(r.facturable)}h · vendidas ${n(r.vendidas)}h.${tura}`;
}
