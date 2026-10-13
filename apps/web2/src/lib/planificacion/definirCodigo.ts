/**
 * Un código de planilla que no se reconoce se define en el resumen.
 * FT/N es franco trabajado en la N. VF/T, BANCO, STOCK y parecidos son otro objetivo:
 * la celda de este cronograma queda vacía.
 */

export type ParteDefinicion =
  | { tipo: 'catalogo'; code: string }
  | { tipo: 'banda'; code: string }
  | { tipo: 'franja'; code: string; inicio: string; fin: string; nueva: boolean }
  | { tipo: 'otro_objetivo'; etiqueta: string };

export type PropuestaCodigo = {
  texto: string;
  partes: ParteDefinicion[];
  vaciar: boolean;
  nota: string;
};

const OTRO = /^(VF|BANCO|STOCK|DECAT|MISE|PM)(\b|[\d/])/i;

function limpio(raw: string): string {
  return String(raw || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function etiquetaOtro(texto: string): string {
  const base = texto.split('/')[0].trim();
  if (base.startsWith('VF')) return 'Vifood';
  if (base.startsWith('MISE')) return 'Misericordia';
  return base;
}

/** Propuesta al abrir «Definir». El planificador puede cambiar las partes. */
export function proponerDefinicion(raw: string): PropuestaCodigo {
  const texto = limpio(raw);
  const ft = texto.match(/^FT\s*\/\s*(M|T|N|D12|N12)$/);
  if (ft) {
    return {
      texto,
      vaciar: false,
      nota: `Franco trabajado en el turno ${ft[1]}`,
      partes: [{ tipo: 'catalogo', code: 'FT' }, { tipo: 'banda', code: ft[1] }],
    };
  }
  if (OTRO.test(texto.replace(/\s+/g, ''))) {
    const et = etiquetaOtro(texto);
    return {
      texto,
      vaciar: true,
      nota: `Trabaja en otro objetivo (${et}). La celda queda vacía en este cronograma.`,
      partes: [{ tipo: 'otro_objetivo', etiqueta: et }],
    };
  }
  return {
    texto,
    vaciar: false,
    nota: 'Elegí a qué equivale',
    partes: [],
  };
}

export function textoCeldasVacias(codigo: string, cantidad: number, etiqueta: string): string {
  return `Se dejan vacías ${cantidad} celdas: trabajan en otro objetivo (${codigo} → ${etiqueta})`;
}

export type EquivalenciaGuardada = {
  clave: string;
  codigo: string;
  color: 'red' | 'none';
  code: string;
  startTime: string;
  endTime: string;
  muestras: number;
  otroObjetivo?: string;
  partes?: string[];
  /** Puesto del servicio cuando se definió a mano («P2 T» → Puesto 2). */
  positionName?: string;
};

/** Lo definido se guarda en la tabla del objetivo y se aplica a todas las celdas de esa sigla. */
export function equivalenciaDeDefinicion(texto: string, prop: PropuestaCodigo, rojo = false): EquivalenciaGuardada {
  const codigo = limpio(texto).replace(/[\s.\-]/g, '');
  if (prop.vaciar) {
    const et = prop.partes.find((p) => p.tipo === 'otro_objetivo');
    return {
      clave: `${codigo}|${rojo ? 'red' : 'none'}`,
      codigo,
      color: rojo ? 'red' : 'none',
      code: '',
      startTime: '',
      endTime: '',
      muestras: 1,
      otroObjetivo: et && et.tipo === 'otro_objetivo' ? et.etiqueta : etiquetaOtro(texto),
    };
  }
  const banda = prop.partes.find((p) => p.tipo === 'banda' || p.tipo === 'franja' || p.tipo === 'catalogo');
  const code = banda && 'code' in banda ? banda.code : '';
  const franja = prop.partes.find((p) => p.tipo === 'franja');
  return {
    clave: `${codigo}|${rojo ? 'red' : 'none'}`,
    codigo,
    color: rojo ? 'red' : 'none',
    code,
    startTime: franja && franja.tipo === 'franja' ? franja.inicio : '',
    endTime: franja && franja.tipo === 'franja' ? franja.fin : '',
    muestras: 1,
    partes: prop.partes.map((p) => p.tipo === 'otro_objetivo' ? p.etiqueta : p.code),
  };
}

export function yaDefinido(codigo: string, tabla: readonly { codigo?: string; clave?: string; otroObjetivo?: string; code?: string }[]): boolean {
  const c = limpio(codigo).replace(/[\s.\-]/g, '');
  return tabla.some((e) => {
    const k = String(e.codigo || e.clave || '').split('|')[0];
    return k === c && (e.otroObjetivo || e.code);
  });
}

export type PuestoConFranjas = { positionName: string; shifts: Array<{ code: string; startTime?: string; endTime?: string }> };

export type DefinicionManual = {
  puesto: string;
  code: string;
  inicio: string;
  fin: string;
  /** El puesto o el turno no están en el servicio del mes. */
  faltaEnServicio: boolean;
};

const ESTANDAR: Record<string, [string, string]> = {
  M: ['07:00', '15:00'], T: ['15:00', '23:00'], N: ['23:00', '07:00'], D12: ['07:00', '19:00'], N12: ['19:00', '07:00'],
};

/** Puestos de una sola letra o sigla que se usan en las planillas. */
const SIGLAS: Record<string, { puesto: string; inicio: string; fin: string }> = {
  C: { puesto: 'Cortina', inicio: '07:00', fin: '15:00' },
  CS: { puesto: 'Cortina', inicio: '07:00', fin: '11:00' },
  RO: { puesto: 'Rondín', inicio: '', fin: '' },
  EN: { puesto: 'Encargado', inicio: '', fin: '' },
};

function norm(s: string): string {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function numeroDe(nombre: string): string {
  const m = norm(nombre).match(/^(?:P|PTO|PUESTO|PSTO)\.?\s*(\d+)$/);
  return m ? String(Number(m[1])) : '';
}

function franjaDe(puestos: readonly PuestoConFranjas[], puesto: string, code: string) {
  const p = puestos.find((x) => norm(x.positionName) === norm(puesto));
  return { p, s: p?.shifts.find((s) => norm(s.code) === norm(code)) };
}

/**
 * «P2 T» → Puesto 2 · T; «PL M» → Playa · M; «C» → Cortina · C 07–15.
 * Toma el horario del servicio si el puesto ya tiene ese turno; si no, el estándar de la banda.
 */
export function proponerPuestoYBanda(raw: string, puestos: readonly PuestoConFranjas[]): DefinicionManual {
  const t = norm(raw);
  const compact = t.replace(/[\s.\-/]/g, '');
  let puesto = '';
  let code = '';
  let inicio = '';
  let fin = '';
  const m = t.match(/^(P\d+|PL|[A-Z]{2,})\s*(D12|N12|M|T|N)$/) || compact.match(/^(P\d+|PL)(D12|N12|M|T|N)$/);
  if (m) {
    const sigla = m[1];
    code = m[2];
    const n = sigla.match(/^P(\d+)$/)?.[1];
    if (n) puesto = puestos.find((p) => numeroDe(p.positionName) === String(Number(n)))?.positionName || `Puesto ${Number(n)}`;
    else if (sigla === 'PL') puesto = puestos.find((p) => norm(p.positionName).startsWith('PLAYA'))?.positionName || 'Playa';
    else puesto = puestos.find((p) => norm(p.positionName).startsWith(sigla))?.positionName || sigla;
    [inicio, fin] = ESTANDAR[code] || ['', ''];
  } else if (SIGLAS[compact]) {
    const s = SIGLAS[compact];
    puesto = puestos.find((p) => norm(p.positionName).startsWith(norm(s.puesto).slice(0, 5)))?.positionName || s.puesto;
    code = compact;
    inicio = s.inicio;
    fin = s.fin;
  } else {
    puesto = puestos[0]?.positionName || '';
    code = compact;
  }
  const { p, s } = franjaDe(puestos, puesto, code);
  if (s?.startTime && s?.endTime) { inicio = s.startTime; fin = s.endTime; }
  return { puesto, code, inicio, fin, faltaEnServicio: !p || !s };
}

export function equivalenciaManual(texto: string, d: Pick<DefinicionManual, 'puesto' | 'code' | 'inicio' | 'fin'>, rojo = false): EquivalenciaGuardada & { positionName: string } {
  const codigo = limpio(texto).replace(/[\s.\-]/g, '');
  return {
    clave: `${codigo}|${rojo ? 'red' : 'none'}`,
    codigo,
    color: rojo ? 'red' : 'none',
    code: norm(d.code).replace(/\s+/g, ''),
    startTime: d.inicio,
    endTime: d.fin,
    muestras: 1,
    positionName: d.puesto.trim(),
  };
}

export function equivalenciaOtroObjetivo(texto: string, rojo = false): EquivalenciaGuardada {
  return equivalenciaDeDefinicion(texto, { texto, vaciar: true, nota: '', partes: [{ tipo: 'otro_objetivo', etiqueta: etiquetaOtro(limpio(texto)) }] }, rojo);
}

type ShiftDoc = { code?: string; name?: string; startTime?: string; endTime?: string; hours?: number; quantity?: number };
type PosDoc = { id?: string; name?: string; positionName?: string; allowedShiftTypes?: ShiftDoc[]; shifts?: ShiftDoc[]; [k: string]: unknown };

function horas(inicio: string, fin: string): number {
  const [h1, m1] = inicio.split(':').map(Number);
  const [h2, m2] = fin.split(':').map(Number);
  if ([h1, m1, h2, m2].some((v) => Number.isNaN(v))) return 0;
  let min = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (min <= 0) min += 24 * 60;
  return Math.round((min / 60) * 100) / 100;
}

/** Suma al servicio los puestos y turnos definidos que no estaban. Devuelve null si no cambia nada. */
export function agregarFranjasAPosiciones(positions: readonly PosDoc[], franjas: ReadonlyArray<{ puesto: string; code: string; inicio: string; fin: string }>): { positions: PosDoc[]; agregadas: string[] } | null {
  const out: PosDoc[] = positions.map((p) => ({ ...p, allowedShiftTypes: [...(p.allowedShiftTypes || [])], ...(p.shifts ? { shifts: [...p.shifts] } : {}) }));
  const agregadas: string[] = [];
  for (const f of franjas) {
    const code = norm(f.code).replace(/\s+/g, '');
    if (!f.puesto.trim() || !code || !f.inicio || !f.fin) continue;
    const turno: ShiftDoc = { code, name: code, startTime: f.inicio, endTime: f.fin, hours: horas(f.inicio, f.fin), quantity: 1 };
    let pos = out.find((p) => norm(String(p.name || p.positionName || '')) === norm(f.puesto));
    if (!pos) {
      pos = { id: `definir_${out.length + 1}_${Date.now()}`, name: f.puesto.trim(), coverageType: 'custom', quantity: 1, activeDays: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], allowedShiftTypes: [], status: 'ACTIVE' };
      out.push(pos);
    }
    const lista = pos.allowedShiftTypes || [];
    if (lista.some((s) => norm(String(s.code || '')) === code)) continue;
    pos.allowedShiftTypes = [...lista, turno];
    if (pos.shifts) pos.shifts = [...pos.shifts, turno];
    agregadas.push(`${pos.name || f.puesto} · ${code} ${f.inicio}–${f.fin}`);
  }
  return agregadas.length ? { positions: out, agregadas } : null;
}
