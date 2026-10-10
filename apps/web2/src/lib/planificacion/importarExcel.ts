/**
 * Importar una planilla Excel de cronograma a la grilla, como borrador.
 * La lectura del .xlsx está en importarExcelXlsx.ts; acá no hay red ni nombres de archivo.
 */
import { CODIGOS_LICENCIA_RAPIDA, HORARIO_ESTANDAR, horasEntre } from './modoRapido';

export type ColorCelda = 'none' | 'red' | string;

export type CeldaPlano = {
  fila: number;
  col: number;
  valor: string | number;
  color: ColorCelda;
};

export type TurnoServicio = {
  positionName: string;
  code: string;
  startTime: string;
  endTime: string;
  quantity?: number | null;
  dias?: string[];
};

export type EmpleadoCruce = {
  id: string;
  nombre: string;
  legajo?: string;
  empresaId?: string;
  objetivoPreferido?: string;
};

export type Referencia = {
  codigo: string;
  desc: string;
  inicio: string;
  fin: string;
  horas: number;
  color: ColorCelda;
};

export type CeldaFila = { dia: number; raw: string; color: ColorCelda };

export type FilaPlanilla = {
  fila: number;
  nombre: string;
  legajo: string;
  puesto: string;
  celdas: CeldaFila[];
};

export type CuadroPlanilla = {
  indice: number;
  titulo: string;
  letras: string;
  avisoMes: string | null;
  filas: FilaPlanilla[];
  referencias: Referencia[];
  avisos: string[];
};

export type AccionMapeo = 'turno' | 'doce' | 'franco' | 'licencia' | 'ret' | 'ignorar';

export type ReglaMapeo = {
  clave: string;
  codigo: string;
  color: ColorCelda;
  muestras: number;
  accion: AccionMapeo;
  /** Código COSP. En `doce`, la banda de origen (M/N/T). */
  code: string;
  nota: string;
};

export type CruceFila = {
  fila: number;
  nombrePlanilla: string;
  legajo: string;
  estado: 'encontrado' | 'dudoso' | 'no';
  employeeId: string | null;
  nota: string;
  candidatos: Array<{ id: string; nombre: string; legajo: string }>;
};

export type FranjaPerfil = {
  puesto: string;
  code: string;
  startTime: string;
  endTime: string;
  cantidad: number;
};

export type ComparacionServicio = {
  veredicto: 'coincide' | 'difiere' | 'sin_servicio';
  planilla: FranjaPerfil[];
  diferencias: string[];
};

export type DestinoCelda = {
  accion: 'turno' | 'franco' | 'licencia' | 'ret' | 'ignorar';
  code: string;
  nombre: string;
  positionName: string;
  startTime: string;
  endTime: string;
  hours: number;
};

export type ItemPreview = {
  employeeId: string;
  nombre: string;
  dateStr: string;
  dia: number;
  destino: DestinoCelda;
  estado: 'nueva' | 'cambia' | 'igual' | 'no_toca';
  motivo: string;
  codeActual: string;
};

const LETRAS_SEMANA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const LICENCIAS: Record<string, string> = { ...CODIGOS_LICENCIA_RAPIDA, SUS: 'Suspensión' };

export function normPlanilla(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function claveCodigo(s: unknown): string {
  return normPlanilla(s).replace(/\s+/g, '');
}

export function claseDeEstilo(style: { patternType?: string; fgColor?: { rgb?: string; theme?: number } } | null | undefined): ColorCelda {
  if (!style || style.patternType === 'none' || !style.fgColor) return 'none';
  const rgb = String(style.fgColor.rgb || '').toUpperCase();
  const hex = rgb.length >= 6 ? rgb.slice(-6) : '';
  if (!hex || hex === 'FFFFFF' || hex === '000000') return 'none';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (r > 0xb0 && g < 0x50 && b < 0x50) return 'red';
  return `rgb:${hex}`;
}

export function claveMapeo(codigo: string, color: ColorCelda): string {
  return `${claveCodigo(codigo)}|${color === 'red' ? 'red' : 'none'}`;
}

function letrasEsperadas(year: number, month: number): string {
  const dow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return LETRAS_SEMANA[dow] + LETRAS_SEMANA[(dow + 1) % 7];
}

function diasDelMes(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseHorario(txt: string): { inicio: string; fin: string; horas: number } | null {
  const t = normPlanilla(txt);
  const m = t.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(?:HS|H)?\s*A\s*(\d{1,2})(?:[:.](\d{2}))?/);
  if (!m) return null;
  const h1 = Number(m[1]);
  const m1 = Number(m[2] || 0);
  const h2 = Number(m[3]) % 24;
  const m2 = Number(m[4] || 0);
  if (h1 > 24 || h2 > 24) return null;
  const inicio = `${String(h1).padStart(2, '0')}:${String(m1).padStart(2, '0')}`;
  const fin = `${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}`;
  return { inicio, fin, horas: horasEntre(inicio, fin) };
}

function esCodigoCorto(nv: string): boolean {
  return /^[A-Z0-9][A-Z0-9 ./\-]{0,7}$/.test(nv) && nv.length <= 8 && !parseHorario(nv);
}

function armarGrid(celdas: CeldaPlano[]): Map<string, CeldaPlano> {
  const g = new Map<string, CeldaPlano>();
  for (const c of celdas) {
    if (c.valor === '' || c.valor == null) continue;
    g.set(`${c.fila},${c.col}`, c);
  }
  return g;
}

function filaVals(grid: Map<string, CeldaPlano>, fila: number): CeldaPlano[] {
  const out: CeldaPlano[] = [];
  for (const c of grid.values()) if (c.fila === fila) out.push(c);
  return out.sort((a, b) => a.col - b.col);
}

function texto(c: CeldaPlano | undefined): string {
  if (!c) return '';
  if (typeof c.valor === 'number' && Number.isInteger(c.valor)) return String(c.valor);
  return String(c.valor).replace(/\s+/g, ' ').trim();
}

function findDayRows(grid: Map<string, CeldaPlano>): Array<{ fila: number; dias: Map<number, number> }> {
  const filas = new Set<number>();
  for (const c of grid.values()) filas.add(c.fila);
  const out: Array<{ fila: number; dias: Map<number, number> }> = [];
  for (const fila of [...filas].sort((a, b) => a - b)) {
    const nums = filaVals(grid, fila).filter((c) => {
      const n = typeof c.valor === 'number' ? c.valor : Number(texto(c));
      return Number.isInteger(n) && n >= 1 && n <= 31;
    });
    if (nums.length < 28) continue;
    const dias = new Map<number, number>();
    let expect = 1;
    const start = nums.findIndex((c) => Number(c.valor) === 1 || texto(c) === '1');
    if (start < 0) continue;
    for (const c of nums.slice(start)) {
      const n = Number(c.valor);
      if (n === expect) { dias.set(expect, c.col); expect += 1; }
    }
    if (dias.size >= 28) out.push({ fila, dias });
  }
  return out;
}

function parseRefs(grid: Map<string, CeldaPlano>, desde: number, hasta: number): Referencia[] {
  const filas: CeldaPlano[][] = [];
  for (let f = desde; f < hasta && f < desde + 8; f++) {
    const vals = filaVals(grid, f).filter((c) => !/CRONOGRAMA|SUJETO A MODIFIC/.test(normPlanilla(texto(c))));
    if (!vals.length) continue;
    if (vals.some((c) => /CRONOGRAMA|SUJETO A MODIFIC/.test(normPlanilla(texto(c)))) && vals.length < 2) break;
    filas.push(vals);
  }
  const refs: Referencia[] = [];
  const vistos = new Set<string>();
  for (let i = 0; i < filas.length; i++) {
    const vals = filas[i].filter((c) => !/^REFERENCIA/.test(normPlanilla(texto(c))) || texto(c).length < 14);
    const siguiente = filas[i + 1] || [];
    const siguienteEsHora = siguiente.filter((c) => parseHorario(texto(c))).length >= Math.max(1, Math.floor(siguiente.length * 0.4));
    for (let j = 0; j < vals.length; j++) {
      const nv = normPlanilla(texto(vals[j]));
      if (!nv || /^REFERENCIA/.test(nv)) continue;
      if (nv === 'RETEN' || nv.startsWith('RETEN')) {
        refs.push({ codigo: 'R', desc: 'RETEN', inicio: '', fin: '', horas: 0, color: vals[j].color });
        continue;
      }
      const propio = parseHorario(nv);
      const m = nv.match(/^([A-Z0-9]{1,4})\s*:\s*(.+)$/);
      if (m && parseHorario(m[2])) {
        const hp = parseHorario(m[2])!;
        refs.push({ codigo: m[1], desc: '', ...hp, color: vals[j].color });
        continue;
      }
      if (!esCodigoCorto(nv) || propio || /^\d+$/.test(nv)) continue;
      if (['MANANA', 'TARDE', 'NOCHE', 'FRANCO', 'BACAR', 'PUESTO', 'RETENCION'].includes(nv)) continue;
      const descCel = vals[j + 1];
      const desc = descCel && !esCodigoCorto(normPlanilla(texto(descCel))) ? texto(descCel) : '';
      let hp = parseHorario(desc);
      if (!hp && siguienteEsHora) {
        const lim = vals[j + 2]?.col ?? 999;
        const cand = siguiente.find((c) => c.col >= vals[j].col && c.col < lim && parseHorario(texto(c)));
        if (cand) hp = parseHorario(texto(cand));
      }
      const color = vals[j].color;
      const key = `${claveCodigo(nv)}|${color}|${hp?.inicio || ''}`;
      if (vistos.has(key)) continue;
      vistos.add(key);
      refs.push({
        codigo: claveCodigo(nv),
        desc,
        inicio: hp?.inicio || '',
        fin: hp?.fin || '',
        horas: hp?.horas || 0,
        color,
      });
      if (desc) j += 1;
    }
  }
  return refs;
}

export function detectarCuadros(celdas: CeldaPlano[], year: number, month: number): CuadroPlanilla[] {
  const grid = armarGrid(celdas);
  const days = findDayRows(grid);
  const maxFila = Math.max(0, ...[...grid.values()].map((c) => c.fila));
  const esperadas = letrasEsperadas(year, month);
  const mesNombre = MESES[month - 1];
  const cuadros: CuadroPlanilla[] = [];
  days.forEach((day, indice) => {
    const limite = days[indice + 1]?.fila ?? maxFila + 1;
    const colDia1 = day.dias.get(1)!;
    let titulo = '';
    for (let f = day.fila - 1; f >= Math.max(1, day.fila - 8); f--) {
      const vals = filaVals(grid, f);
      if (vals.some((c) => normPlanilla(texto(c)) === 'BACAR')) {
        titulo = vals
          .map((c) => texto(c))
          .filter((t) => {
            const n = normPlanilla(t);
            return n && n !== 'BACAR' && n !== 'PUESTO' && !/^[A-Z]$/.test(n);
          })
          .join(' ')
          .trim();
        break;
      }
    }
    let letras = '';
    const c1 = day.dias.get(1)!;
    const c2 = day.dias.get(2)!;
    for (const f of [day.fila - 1, day.fila]) {
      const a = texto(grid.get(`${f},${c1}`));
      const b = texto(grid.get(`${f},${c2}`));
      if (/^[A-Za-z]$/.test(a) && /^[A-Za-z]$/.test(b)) { letras = (a + b).toUpperCase(); break; }
    }
    let refFila: number | null = null;
    const guardFilas: number[] = [];
    for (let f = day.fila + 1; f < limite; f++) {
      const vals = filaVals(grid, f);
      if (vals.some((c) => /^REFERENCIA/.test(normPlanilla(texto(c))))) { refFila = f; break; }
      if (vals.length) guardFilas.push(f);
    }
    const avisos: string[] = [];
    if (letras && letras !== esperadas) {
      avisos.push(`Las letras de los días arrancan en ${letras} y ${mesNombre.toLowerCase()} ${year} arranca en ${esperadas}. Puede ser la copia de otro mes.`);
    }
    const pie = filaVals(grid, refFila ?? day.fila).map((c) => normPlanilla(texto(c))).join(' ');
    const otroMes = MESES.find((m) => m !== mesNombre && pie.includes(m));
    if (otroMes) avisos.push(`El cuadro menciona ${otroMes.toLowerCase()} y el cronograma abierto es ${mesNombre.toLowerCase()}.`);
    const left = new Set<number>();
    for (const f of guardFilas) for (const c of filaVals(grid, f)) if (c.col < colDia1) left.add(c.col);
    const stats = (col: number) => {
      const vals = guardFilas.map((f) => grid.get(`${f},${col}`)).filter(Boolean) as CeldaPlano[];
      const txt = vals.filter((v) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}/.test(texto(v)));
      const num = vals.filter((v) => /^\d{1,6}$/.test(texto(v)));
      return { txt, num };
    };
    let nameCol: number | null = null;
    let best = 0;
    for (const col of left) {
      const { txt } = stats(col);
      const score = txt.filter((t) => texto(t).trim().split(/\s+/).length >= 2).length;
      if (score > best) { best = score; nameCol = col; }
    }
    let legCol: number | null = null;
    const puestoCols: number[] = [];
    for (const col of [...left].sort((a, b) => a - b)) {
      if (col === nameCol) continue;
      const { txt, num } = stats(col);
      const nums = num.map((v) => Number(texto(v))).filter((n) => Number.isFinite(n));
      const mediana = nums.length ? [...nums].sort((a, b) => a - b)[Math.floor(nums.length / 2)] : 0;
      if (nums.length && mediana >= 1000 && nums.length >= txt.length) legCol = col;
      else if (txt.length || nums.length) puestoCols.push(col);
    }
    const ultimo = diasDelMes(year, month);
    const filas: FilaPlanilla[] = [];
    for (const f of guardFilas) {
      const nombre = nameCol ? texto(grid.get(`${f},${nameCol}`)) : '';
      if (/^REFERENCIA/.test(normPlanilla(nombre))) continue;
      const legajo = legCol ? texto(grid.get(`${f},${legCol}`)) : '';
      const puesto = puestoCols.map((col) => texto(grid.get(`${f},${col}`))).filter((t) => t && normPlanilla(t) !== normPlanilla(nombre)).join(' / ');
      const celdas: CeldaFila[] = [];
      for (const [dia, col] of day.dias) {
        if (dia > ultimo) continue;
        const cel = grid.get(`${f},${col}`);
        const raw = texto(cel);
        if (!raw || /^\d+$/.test(raw)) continue;
        celdas.push({ dia, raw, color: cel?.color || 'none' });
      }
      if (!nombre && !celdas.length) continue;
      if (/^VIGILADOR\s+\d+$/.test(normPlanilla(nombre))) {
        avisos.push('Hay un cuadro plantilla (Vigilador 1, 2…) sin nombres.');
        continue;
      }
      filas.push({ fila: f, nombre, legajo, puesto, celdas });
    }
    const referencias = refFila ? parseRefs(grid, refFila, limite) : [];
    cuadros.push({ indice, titulo, letras, avisoMes: avisos[0] || null, filas, referencias, avisos });
  });
  return cuadros;
}

export function elegirCuadro(cuadros: CuadroPlanilla[], nombreObjetivo: string): number {
  const n = normPlanilla(nombreObjetivo);
  const i = cuadros.findIndex((c) => n && normPlanilla(c.titulo).includes(n.slice(0, 12)));
  return i >= 0 ? i : 0;
}

/** Cuadros con el mismo personal son versiones: queda la última. Los que no comparten nombres se importan juntos. */
export function sugerirCuadros(cuadros: CuadroPlanilla[]): number[] {
  const usados = new Set<number>();
  const elegidos: number[] = [];
  for (let i = cuadros.length - 1; i >= 0; i--) {
    if (usados.has(i)) continue;
    const nombres = new Set(cuadros[i].filas.map((f) => normPlanilla(f.nombre)).filter(Boolean));
    for (let j = i - 1; j >= 0; j--) {
      if (usados.has(j)) continue;
      const otros = cuadros[j].filas.map((f) => normPlanilla(f.nombre)).filter(Boolean);
      if (!otros.length || !nombres.size) continue;
      const hit = otros.filter((n) => nombres.has(n)).length;
      if (hit / otros.length >= 0.6) usados.add(j);
    }
    usados.add(i);
    elegidos.push(i);
  }
  return elegidos.sort((a, b) => a - b);
}

const STOP_DESTINO = new Set([
  ...MESES, 'XLSX', 'XLS', 'BANCO', 'BANCOS', 'PLANILLA', 'CRONOGRAMA', 'SUCURSAL', 'SUCURSALES',
  'DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'EN', 'SA', 'SRL', 'HS', 'SEDE', 'SEDES', 'INTERIOR', 'CAPITAL',
]);

const ALIAS_DESTINO: Record<string, string> = { NVO: 'NUEVO', NVA: 'NUEVA', EDIF: 'EDIFICIO' };

export type ObjetivoCatalogo = {
  id: string;
  nombre: string;
  clienteId: string;
  clienteNombre: string;
};

export type PropuestaDestino = {
  objectiveId: string;
  clienteId: string;
  nombre: string;
  clienteNombre: string;
  confianza: number;
  motivo: string;
};

export type BloqueDestino = {
  key: string;
  cuadroIndice: number;
  titulo: string;
  etiqueta: string;
  filas: FilaPlanilla[];
};

/** Tokens del archivo o del título, sin mes, año ni prefijos genéricos (BANCO-, A.). */
export function tokensDestino(texto: string): string[] {
  const limpio = normPlanilla(texto).replace(/\b20\d{2}\b/g, ' ').replace(/[^A-Z0-9 ]/g, ' ');
  const out: string[] = [];
  for (const raw of limpio.split(' ').filter(Boolean)) {
    if (/^\d+$/.test(raw)) continue;
    const t = ALIAS_DESTINO[raw] || raw;
    if (t.length < 3 || STOP_DESTINO.has(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

function pesoToken(t: string): number {
  if (t.length >= 6) return 3;
  if (t.length >= 4) return 2;
  return 1;
}

function tokenEn(t: string, otros: string[]): boolean {
  return otros.some((o) => o === t || (Math.min(t.length, o.length) >= 4 && (o.startsWith(t) || t.startsWith(o))));
}

/** Ordena los objetivos de la empresa según el archivo y el título del cuadro. */
export function proponerDestinos(textos: string[], objetivos: ObjetivoCatalogo[]): PropuestaDestino[] {
  const q = tokensDestino(textos.filter(Boolean).join(' '));
  if (!q.length) return [];
  const pesoQ = q.reduce((a, t) => a + pesoToken(t), 0);
  const ranked: PropuestaDestino[] = [];
  for (const o of objetivos) {
    const ot = tokensDestino(o.nombre);
    if (!ot.length) continue;
    const pesoO = ot.reduce((a, t) => a + pesoToken(t), 0);
    const dichos = q.filter((t) => tokenEn(t, ot));
    const hitQ = dichos.reduce((a, t) => a + pesoToken(t), 0);
    const hitO = ot.filter((t) => tokenEn(t, q)).reduce((a, t) => a + pesoToken(t), 0);
    if (!hitQ || !pesoO) continue;
    const confianza = Math.round((70 * hitQ) / pesoQ + (30 * hitO) / pesoO);
    ranked.push({
      objectiveId: o.id,
      clienteId: o.clienteId,
      nombre: o.nombre,
      clienteNombre: o.clienteNombre,
      confianza,
      motivo: `Coincide ${dichos.join(' ')}`,
    });
  }
  ranked.sort((a, b) => b.confianza - a.confianza || a.nombre.length - b.nombre.length);
  return ranked;
}

export function proponerDestino(textos: string[], objetivos: ObjetivoCatalogo[]): PropuestaDestino | null {
  return proponerDestinos(textos, objetivos)[0] || null;
}

/**
 * Un cuadro es un destino. Si cada fila trae un texto largo y distinto (una sucursal),
 * cada fila es un destino y ese texto no se usa como puesto del SLA.
 */
export function bloquesDeCuadros(cuadros: CuadroPlanilla[]): BloqueDestino[] {
  const out: BloqueDestino[] = [];
  for (const c of cuadros) {
    const puestos = c.filas.map((f) => f.puesto.trim()).filter(Boolean);
    const uniq = [...new Set(puestos.map((p) => normPlanilla(p)))];
    const lens = puestos.map((p) => p.length).sort((a, b) => a - b);
    const med = lens.length ? lens[Math.floor(lens.length / 2)] : 0;
    const porFila = puestos.length >= 3 && uniq.length >= 3 && uniq.length / puestos.length >= 0.8 && med >= 18;
    if (!porFila) {
      out.push({ key: String(c.indice), cuadroIndice: c.indice, titulo: c.titulo, etiqueta: '', filas: c.filas });
      continue;
    }
    const vistos = new Set<string>();
    c.filas.forEach((f, i) => {
      const etiqueta = f.puesto.trim() || 'Sin sucursal';
      const base = `${c.indice}::${normPlanilla(etiqueta) || i}`;
      const key = vistos.has(base) ? `${base}::${i}` : base;
      vistos.add(base);
      out.push({
        key,
        cuadroIndice: c.indice,
        titulo: c.titulo,
        etiqueta,
        filas: [{ ...f, puesto: '' }],
      });
    });
  }
  return out;
}

export function unirCuadros(cuadros: CuadroPlanilla[]): CuadroPlanilla {
  const base = cuadros[0];
  return {
    indice: -1,
    titulo: cuadros.map((c) => c.titulo).filter(Boolean).join(' · '),
    letras: base?.letras || '',
    avisoMes: cuadros.map((c) => c.avisoMes).find(Boolean) || null,
    filas: cuadros.flatMap((c) => c.filas),
    referencias: cuadros.flatMap((c) => c.referencias),
    avisos: cuadros.flatMap((c) => c.avisos),
  };
}

function toks(s: string): string[] {
  return normPlanilla(s).replace(/[,.]/g, ' ').replace(/\(.*?\)/g, ' ').split(' ').filter((t) => t.length > 1 && !['DE', 'DEL', 'LA', 'LOS', 'Y'].includes(t));
}

function partesNombre(e: EmpleadoCruce): { last: string[]; first: string[]; all: string[] } {
  const raw = e.nombre || '';
  const [ap, no] = raw.includes(',') ? raw.split(',') : [raw.split(' ').slice(-1).join(' '), raw.split(' ').slice(0, -1).join(' ')];
  const last = toks(ap);
  const first = toks(no);
  return { last, first, all: [...last, ...first] };
}

function tokHit(t: string, cands: string[]): boolean {
  return cands.some((c) => c === t || (t.length >= 3 && c.startsWith(t)) || (c.length >= 4 && t.startsWith(c)));
}

function puntaje(ptoks: string[], e: EmpleadoCruce): { sc: number; last: boolean; first: boolean } {
  if (!ptoks.length) return { sc: 0, last: false, first: false };
  const p = partesNombre(e);
  const hit = ptoks.filter((t) => tokHit(t, p.all)).length / ptoks.length;
  return { sc: hit, last: ptoks.some((t) => tokHit(t, p.last)), first: ptoks.some((t) => tokHit(t, p.first)) };
}

export function cruzarGuardias(filas: FilaPlanilla[], empleados: EmpleadoCruce[], empresaId: string): CruceFila[] {
  const activos = empleados.filter((e) => e.id);
  const porLeg = new Map<string, EmpleadoCruce[]>();
  for (const e of activos) {
    const leg = String(e.legajo || '').trim();
    if (!leg) continue;
    const arr = porLeg.get(leg) || [];
    arr.push(e);
    porLeg.set(leg, arr);
  }
  const porNombre = (ptoks: string[]): CruceFila['candidatos'] extends infer _ ? { emp: EmpleadoCruce; ok: boolean; dudoso: boolean; nota: string; via: string } | null : never => {
    if (!ptoks.length) return null;
    const scored: Array<{ rank: number; e: EmpleadoCruce }> = [];
    for (const e of activos) {
      const p = puntaje(ptoks, e);
      if (p.sc >= 0.99 && p.last && (p.first || ptoks.length === 1)) scored.push({ rank: 0, e });
      else if (p.last && p.first && p.sc >= 0.5) scored.push({ rank: 1, e });
    }
    if (!scored.length) {
      const lastOnly = activos.filter((e) => ptoks[0] && partesNombre(e).last.includes(ptoks[0]));
      if (lastOnly.length === 1 && ptoks.length >= 2) {
        return { emp: lastOnly[0], ok: false, dudoso: true, via: 'apellido', nota: `Solo coincide el apellido: ${lastOnly[0].nombre}` };
      }
      return null;
    }
    const bestRank = Math.min(...scored.map((s) => s.rank));
    const best = scored.filter((s) => s.rank === bestRank).map((s) => s.e);
    const pick = [...best].sort((a, b) => Number(a.empresaId !== empresaId) - Number(b.empresaId !== empresaId))[0];
    const distintos = new Set(best.map((e) => e.id));
    if (distintos.size > 1 && bestRank === 0) {
      return { emp: pick, ok: false, dudoso: true, via: 'nombre', nota: `Varios parecidos: ${best.slice(0, 3).map((e) => e.nombre).join('; ')}` };
    }
    return {
      emp: pick,
      ok: bestRank === 0,
      dudoso: bestRank !== 0,
      via: bestRank === 0 ? 'nombre' : 'nombre parcial',
      nota: bestRank === 0 ? '' : `Coincidencia parcial: ${pick.nombre}`,
    };
  };
  return filas.filter((f) => normPlanilla(f.nombre)).map((f) => {
    const ptoks = toks(f.nombre);
    const leg = String(f.legajo || '').trim();
    const base = { fila: f.fila, nombrePlanilla: f.nombre, legajo: leg, candidatos: [] as CruceFila['candidatos'] };
    if (leg && porLeg.has(leg)) {
      const cands = [...porLeg.get(leg)!].sort((a, b) => Number(a.empresaId !== empresaId) - Number(b.empresaId !== empresaId) || puntaje(ptoks, b).sc - puntaje(ptoks, a).sc);
      const e = cands[0];
      const p = puntaje(ptoks, e);
      if (p.sc >= 0.5 && p.last) {
        return { ...base, estado: 'encontrado' as const, employeeId: e.id, nota: '', candidatos: [{ id: e.id, nombre: e.nombre, legajo: leg }] };
      }
      const alt = porNombre(ptoks);
      if (alt?.ok) {
        return { ...base, estado: 'dudoso' as const, employeeId: alt.emp.id, nota: `El legajo ${leg} es de ${e.nombre}. Por nombre coincide ${alt.emp.nombre}.`, candidatos: [{ id: alt.emp.id, nombre: alt.emp.nombre, legajo: String(alt.emp.legajo || '') }, { id: e.id, nombre: e.nombre, legajo: leg }] };
      }
      return { ...base, estado: 'dudoso' as const, employeeId: e.id, nota: `El legajo ${leg} es de ${e.nombre} y el nombre no cierra.`, candidatos: cands.slice(0, 5).map((c) => ({ id: c.id, nombre: c.nombre, legajo: String(c.legajo || '') })) };
    }
    const alt = porNombre(ptoks);
    if (!alt) return { ...base, estado: 'no' as const, employeeId: null, nota: leg ? `Legajo ${leg} no está en la empresa.` : 'Sin coincidencia.' };
    return {
      ...base,
      estado: alt.ok && !alt.dudoso ? 'encontrado' : 'dudoso',
      employeeId: alt.emp.id,
      nota: alt.nota || (leg ? `Legajo ${leg} no está en la empresa.` : ''),
      candidatos: [{ id: alt.emp.id, nombre: alt.emp.nombre, legajo: String(alt.emp.legajo || '') }],
    };
  });
}

export function faltanEnPlanilla(cruce: CruceFila[], dotacion: EmpleadoCruce[]): EmpleadoCruce[] {
  const ids = new Set(cruce.map((c) => c.employeeId).filter(Boolean));
  return dotacion.filter((e) => !ids.has(e.id));
}

function refDe(refs: Referencia[], codigo: string, color: ColorCelda): Referencia | null {
  const k = claveCodigo(codigo);
  const list = refs.filter((r) => r.codigo === k && (r.inicio || r.desc));
  if (!list.length) return null;
  if (color === 'red') return list.find((r) => r.color === 'red') || list.find((r) => r.horas >= 11) || null;
  return list.find((r) => r.color !== 'red') || list[0];
}

function horarioBanda(code: string): { inicio: string; fin: string; horas: number } | null {
  const h = HORARIO_ESTANDAR[code];
  return h ? { inicio: h.startTime, fin: h.endTime, horas: h.hours } : null;
}

function normPuesto(s: string): string {
  return normPlanilla(s).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function puestoDeTexto(textoPuesto: string, puestos: string[]): string {
  const n = normPuesto(textoPuesto);
  if (!n) return '';
  const exact = puestos.find((p) => normPuesto(p) === n);
  if (exact) return exact;
  const contenidos = puestos.filter((p) => {
    const pn = normPuesto(p);
    return pn.length >= 3 && n.includes(pn);
  });
  if (contenidos.length) {
    contenidos.sort((a, b) => normPuesto(b).length - normPuesto(a).length);
    return contenidos[0];
  }
  const fragmentos = puestos.filter((p) => n.length >= 4 && normPuesto(p).includes(n));
  return fragmentos.length === 1 ? fragmentos[0] : '';
}

export function inferirPuesto(fila: FilaPlanilla, turnos: TurnoServicio[]): string {
  const directo = puestoDeTexto(fila.puesto, [...new Set(turnos.map((t) => t.positionName))]);
  if (directo) return directo;
  const dueño = new Map<string, Set<string>>();
  for (const t of turnos) {
    const k = claveCodigo(t.code);
    const set = dueño.get(k) || new Set<string>();
    set.add(t.positionName);
    dueño.set(k, set);
  }
  const cuenta = new Map<string, number>();
  for (const c of fila.celdas) {
    const set = dueño.get(claveCodigo(c.raw));
    if (!set || set.size !== 1) continue;
    const p = [...set][0];
    cuenta.set(p, (cuenta.get(p) || 0) + 1);
  }
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function esOtroObjetivo(raw: string, refs: Referencia[]): boolean {
  const k = claveCodigo(raw);
  if (k.length <= 6 && (refs.some((r) => r.codigo === k) || ['M', 'T', 'N', 'F', 'R', 'MM', 'ME'].includes(k))) return false;
  const n = normPlanilla(raw);
  if (n.split(' ').length >= 2 && !parseHorario(n) && k.length > 6) return true;
  return ['BANCO', 'MISE', 'NINOS', 'OBRADOR', 'TRANSITO'].some((o) => n.startsWith(o));
}

export function proponerRegla(raw: string, color: ColorCelda, refs: Referencia[]): Omit<ReglaMapeo, 'muestras' | 'clave'> {
  const codigo = claveCodigo(raw);
  const col: ColorCelda = color === 'red' ? 'red' : 'none';
  const notaColor = col === 'red' ? ' · celda roja' : '';
  const base = { codigo, color: col };
  if (['F', 'FF', 'FP', 'FRANCO'].includes(codigo)) return { ...base, accion: 'franco', code: codigo === 'FRANCO' ? 'F' : codigo, nota: 'Franco' };
  if (['RETEN', 'RET', 'RT'].includes(codigo) || (codigo === 'R' && !refs.some((r) => r.codigo === 'R' && r.inicio))) return { ...base, accion: 'ret', code: 'RET', nota: 'Retén' };
  if (codigo === 'ART') return { ...base, accion: 'licencia', code: 'A', nota: 'ART → A' };
  if (codigo === 'CM') return { ...base, accion: 'licencia', code: 'E', nota: 'CM → enfermedad' };
  if (codigo === 'VAC' || codigo.startsWith('VACACION') || codigo === 'LICANUAL' || normPlanilla(raw).startsWith('LIC ANUAL')) {
    return { ...base, accion: 'licencia', code: 'V', nota: 'Vacaciones' };
  }
  if (codigo.startsWith('SUSPEN') || codigo === 'SUSP' || codigo === 'SUS') return { ...base, accion: 'licencia', code: 'SUS', nota: 'Suspensión' };
  if (['E', 'V', 'L', 'A', 'AA', 'PG', 'SGS'].includes(codigo) && !refs.some((r) => r.codigo === codigo && r.inicio)) {
    return { ...base, accion: 'licencia', code: codigo, nota: LICENCIAS[codigo] || codigo };
  }
  if (codigo.startsWith('ESC')) return { ...base, accion: 'turno', code: 'ESC', nota: 'Escuela' };
  if (codigo === 'FT' || codigo.startsWith('F/T')) return { ...base, accion: 'ignorar', code: '', nota: 'Parece franco trabajado: elegí el código o ignoralo' };
  if (esOtroObjetivo(raw, refs)) return { ...base, accion: 'ignorar', code: '', nota: 'Parece el nombre de otro objetivo. Se ignora; podés pasarlo a RET.' };
  if (col === 'red' && ['M', 'N', 'T'].includes(codigo)) {
    return { ...base, accion: 'doce', code: codigo, nota: `Jornada de 12 h${notaColor}. En el puesto usa su turno de 12 h; si no tiene, ${codigo === 'N' ? 'N12' : 'D12'}.` };
  }
  const ref = refDe(refs, codigo, col);
  if (ref?.inicio) return { ...base, accion: 'turno', code: codigo, nota: `${ref.desc || codigo} ${ref.inicio}–${ref.fin}`.trim() };
  if (['M', 'T', 'N', 'D12', 'N12'].includes(codigo)) return { ...base, accion: 'turno', code: codigo, nota: 'Banda del puesto' };
  if (horarioBanda(codigo) || ref) return { ...base, accion: 'turno', code: codigo, nota: ref?.desc || 'Turno del servicio' };
  return { ...base, accion: 'ignorar', code: '', nota: 'Sin referencia. Elegí un turno, una licencia o ignoralo.' };
}

export function proponerReglas(cuadro: CuadroPlanilla, guardadas: ReglaMapeo[] = []): ReglaMapeo[] {
  const cuenta = new Map<string, { raw: string; color: ColorCelda; n: number }>();
  for (const f of cuadro.filas) {
    for (const c of f.celdas) {
      const color: ColorCelda = c.color === 'red' ? 'red' : 'none';
      const clave = claveMapeo(c.raw, color);
      const prev = cuenta.get(clave);
      if (prev) prev.n += 1;
      else cuenta.set(clave, { raw: c.raw, color, n: 1 });
    }
  }
  const porClave = new Map(guardadas.map((g) => [g.clave, g]));
  return [...cuenta.entries()].sort((a, b) => b[1].n - a[1].n).map(([clave, c]) => {
    const previa = porClave.get(clave);
    if (previa) return { ...previa, muestras: c.n, codigo: claveCodigo(c.raw), color: c.color };
    const p = proponerRegla(c.raw, c.color, cuadro.referencias);
    return { clave, muestras: c.n, ...p };
  });
}

function turnoDe(turnos: TurnoServicio[], puesto: string, code: string): TurnoServicio | null {
  const k = claveCodigo(code);
  const mismos = turnos.filter((t) => claveCodigo(t.code) === k);
  return mismos.find((t) => t.positionName === puesto) || mismos[0] || null;
}

/** M/T/N de la planilla es la banda de ese puesto: R1 o M1 si el puesto no tiene la letra. */
function turnoDeBanda(turnos: TurnoServicio[], puesto: string, code: string, refs: Referencia[], color: ColorCelda): TurnoServicio | null {
  const enPuesto = puesto ? turnos.filter((t) => t.positionName === puesto) : turnos;
  const exacto = enPuesto.find((t) => claveCodigo(t.code) === claveCodigo(code));
  if (exacto) return exacto;
  if (!puesto || !['M', 'T', 'N'].includes(claveCodigo(code))) return turnoDe(turnos, puesto, code);
  const ref = refDe(refs, code, color);
  const est = horarioBanda(code);
  const inicio = ref?.inicio || est?.inicio || '';
  const horas = ref?.horas || est?.horas || 8;
  if (!inicio) return null;
  const cerca = enPuesto
    .map((t) => ({
      t,
      dStart: Math.abs(minutos(t.startTime) - minutos(inicio)),
      dHoras: Math.abs(horasEntre(t.startTime, t.endTime) - horas),
    }))
    .filter((x) => x.dStart <= 120 && x.dHoras <= 3)
    .sort((a, b) => a.dStart - b.dStart || a.dHoras - b.dHoras);
  return cerca[0]?.t || null;
}

function doceDelPuesto(turnos: TurnoServicio[], puesto: string, base: string, refs: Referencia[]): TurnoServicio | null {
  const ref = refDe(refs, base, 'red');
  const inicio = ref?.inicio || (base === 'N' ? '19:00' : '07:00');
  const delPuesto = turnos.filter((t) => (!puesto || t.positionName === puesto) && horasEntre(t.startTime, t.endTime) >= 11);
  const cerca = delPuesto
    .map((t) => ({ t, d: Math.abs(minutos(t.startTime) - minutos(inicio)) }))
    .filter((x) => x.d <= 90)
    .sort((a, b) => a.d - b.d || Number(claveCodigo(a.t.code) === (base === 'N' ? 'N12' : 'D12')) - Number(claveCodigo(b.t.code) === (base === 'N' ? 'N12' : 'D12')));
  if (cerca.length) {
    const propio = cerca.find((x) => !['D12', 'N12', 'M', 'T', 'N'].includes(claveCodigo(x.t.code)));
    return (propio || cerca[0]).t;
  }
  const fijo = base === 'N' ? 'N12' : 'D12';
  return turnoDe(turnos, puesto, fijo);
}

function minutos(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function resolverDestino(regla: ReglaMapeo, puesto: string, turnos: TurnoServicio[], refs: Referencia[]): DestinoCelda {
  const vacio = { positionName: puesto, startTime: '', endTime: '', hours: 0, nombre: '' };
  if (regla.accion === 'ignorar') return { accion: 'ignorar', code: '', ...vacio };
  if (regla.accion === 'ret') return { accion: 'ret', code: 'RET', ...vacio, nombre: 'Retén', positionName: 'Retén' };
  if (regla.accion === 'franco') return { accion: 'franco', code: regla.code || 'F', ...vacio, nombre: 'Franco', hours: 0, startTime: '00:00' };
  if (regla.accion === 'licencia') {
    const code = regla.code || 'L';
    return { accion: 'licencia', code, ...vacio, nombre: LICENCIAS[code] || code, hours: 0, startTime: '00:00' };
  }
  if (regla.accion === 'doce') {
    const t = doceDelPuesto(turnos, puesto, regla.code || 'M', refs);
    const est = horarioBanda(regla.code === 'N' ? 'N12' : 'D12')!;
    const code = t?.code || (regla.code === 'N' ? 'N12' : 'D12');
    return {
      accion: 'turno', code, nombre: code,
      positionName: t?.positionName || puesto,
      startTime: t?.startTime || est.inicio,
      endTime: t?.endTime || est.fin,
      hours: t ? horasEntre(t.startTime, t.endTime) : est.horas,
    };
  }
  const t = turnoDeBanda(turnos, puesto, regla.code, refs, regla.color);
  const ref = refDe(refs, regla.codigo, regla.color);
  const est = horarioBanda(regla.code);
  const startTime = t?.startTime || ref?.inicio || est?.inicio || '';
  const endTime = t?.endTime || ref?.fin || est?.fin || '';
  return {
    accion: 'turno',
    code: t?.code || regla.code,
    nombre: t?.code || regla.code,
    positionName: t?.positionName || puesto,
    startTime,
    endTime,
    hours: startTime && endTime ? horasEntre(startTime, endTime) : 0,
  };
}

export function compararServicio(cuadro: CuadroPlanilla, turnos: TurnoServicio[], reglas: ReglaMapeo[]): ComparacionServicio {
  if (!turnos.length) {
    return { veredicto: 'sin_servicio', planilla: perfilDe(cuadro, turnos, reglas), diferencias: ['Este objetivo no tiene servicio en el mes.'] };
  }
  const planilla = perfilDe(cuadro, turnos, reglas);
  const diferencias: string[] = [];
  for (const f of planilla) {
    const hit = turnos.find((t) => (
      (!f.puesto || t.positionName === f.puesto)
      && claveCodigo(t.code) === claveCodigo(f.code)
      && Math.abs(minutos(t.startTime) - minutos(f.startTime)) <= 30
    ));
    if (!hit) diferencias.push(`${f.puesto || 'Sin puesto'} · ${f.code} ${f.startTime}–${f.endTime} ×${f.cantidad}: no está en el servicio.`);
    else if (hit.quantity != null && hit.quantity !== f.cantidad) diferencias.push(`${f.puesto} · ${f.code}: la planilla pone ×${f.cantidad} y el servicio ×${hit.quantity}.`);
  }
  return { veredicto: diferencias.length ? 'difiere' : 'coincide', planilla, diferencias };
}

function perfilDe(cuadro: CuadroPlanilla, turnos: TurnoServicio[], reglas: ReglaMapeo[]): FranjaPerfil[] {
  const porClave = new Map(reglas.map((r) => [r.clave, r]));
  const porDia = new Map<string, Map<number, number>>();
  const meta = new Map<string, FranjaPerfil>();
  for (const fila of cuadro.filas) {
    const puesto = inferirPuesto(fila, turnos);
    for (const c of fila.celdas) {
      const regla = porClave.get(claveMapeo(c.raw, c.color));
      if (!regla) continue;
      const d = resolverDestino(regla, puesto, turnos, cuadro.referencias);
      if (d.accion !== 'turno' || !d.startTime) continue;
      const key = `${d.positionName}|${d.code}|${d.startTime}|${d.endTime}`;
      if (!meta.has(key)) meta.set(key, { puesto: d.positionName, code: d.code, startTime: d.startTime, endTime: d.endTime, cantidad: 0 });
      const dias = porDia.get(key) || new Map<number, number>();
      dias.set(c.dia, (dias.get(c.dia) || 0) + 1);
      porDia.set(key, dias);
    }
  }
  for (const [key, dias] of porDia) {
    const counts = [...dias.values()];
    const mode = moda(counts);
    const f = meta.get(key)!;
    f.cantidad = mode;
  }
  return [...meta.values()].sort((a, b) => a.puesto.localeCompare(b.puesto) || a.startTime.localeCompare(b.startTime));
}

function moda(xs: number[]): number {
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 0;
}

export type CeldaActual = {
  employeeId: string;
  dateStr: string;
  code: string;
  licencia?: boolean;
  noTocar?: string;
};

export function vistaPrevia(opts: {
  year: number;
  month: number;
  cuadro: CuadroPlanilla;
  reglas: ReglaMapeo[];
  cruce: CruceFila[];
  incluirDudosos: boolean;
  turnos: TurnoServicio[];
  actuales: CeldaActual[];
  diasCerrados?: string[];
}): ItemPreview[] {
  const reglaDe = new Map(opts.reglas.map((r) => [r.clave, r]));
  const cruceDe = new Map(opts.cruce.map((c) => [c.fila, c]));
  const actualDe = new Map(opts.actuales.map((c) => [`${c.employeeId}_${c.dateStr}`, c]));
  const out: ItemPreview[] = [];
  for (const fila of opts.cuadro.filas) {
    const cr = cruceDe.get(fila.fila);
    if (!cr?.employeeId) continue;
    if (cr.estado === 'no') continue;
    if (cr.estado === 'dudoso' && !opts.incluirDudosos) continue;
    const puesto = inferirPuesto(fila, opts.turnos);
    for (const cel of fila.celdas) {
      const regla = reglaDe.get(claveMapeo(cel.raw, cel.color));
      if (!regla) continue;
      const destino = resolverDestino(regla, puesto, opts.turnos, opts.cuadro.referencias);
      const dateStr = `${opts.year}-${String(opts.month).padStart(2, '0')}-${String(cel.dia).padStart(2, '0')}`;
      const actual = actualDe.get(`${cr.employeeId}_${dateStr}`);
      let estado: ItemPreview['estado'] = 'nueva';
      let motivo = '';
      const cerrado = opts.diasCerrados?.includes(dateStr) && destino.accion !== 'franco' && destino.accion !== 'ret';
      if (destino.accion === 'ignorar') { estado = 'no_toca'; motivo = regla.nota || 'Ignorada'; }
      else if (cerrado) { estado = 'no_toca'; motivo = 'Día cerrado'; }
      else if (actual?.noTocar) { estado = 'no_toca'; motivo = actual.noTocar; }
      else if (actual?.licencia) { estado = 'no_toca'; motivo = 'Ya tiene licencia'; }
      else if (actual?.code && claveCodigo(actual.code) === claveCodigo(destino.code)) { estado = 'igual'; motivo = ''; }
      else if (actual?.code) { estado = 'cambia'; motivo = `${actual.code} → ${destino.code}`; }
      out.push({
        employeeId: cr.employeeId,
        nombre: cr.nombrePlanilla,
        dateStr,
        dia: cel.dia,
        destino,
        estado,
        motivo,
        codeActual: actual?.code || '',
      });
    }
  }
  return out;
}

export function cambioBorradorImport(
  item: ItemPreview,
  objectiveId: string,
): { key: string; change: Record<string, unknown>; novedad?: Record<string, unknown> } | null {
  if (item.estado !== 'nueva' && item.estado !== 'cambia') return null;
  const d = item.destino;
  if (d.accion === 'ignorar') return null;
  const key = `${item.employeeId}_${item.dateStr}`;
  const base = { isTemp: true, objectiveId, dateStr: item.dateStr };
  if (d.accion === 'licencia') {
    return {
      key,
      change: { ...base, code: d.code, name: d.nombre, isNovedad: true, hours: 0, startTime: '00:00' },
      novedad: {
        employeeId: item.employeeId,
        employeeName: item.nombre,
        startDate: item.dateStr,
        endDate: item.dateStr,
        type: d.nombre,
        reason: 'Importado de planilla',
        status: 'APPROVED',
      },
    };
  }
  if (d.accion === 'franco') {
    return { key, change: { ...base, code: d.code || 'F', name: 'Franco', hours: 0, startTime: '00:00', isFranco: true, positionName: d.positionName || 'General' } };
  }
  if (d.accion === 'ret') {
    return { key, change: { ...base, code: 'RET', name: 'Retén', hours: 0, startTime: '00:00', isFranco: false, positionName: 'Retén' } };
  }
  return {
    key,
    change: {
      ...base,
      code: d.code,
      name: d.code,
      hours: d.hours,
      startTime: d.startTime,
      endTime: d.endTime,
      isFranco: false,
      positionName: d.positionName || 'General',
    },
  };
}

export function resumenPreview(items: ItemPreview[]): { nuevas: number; cambian: number; iguales: number; noToca: number } {
  return {
    nuevas: items.filter((i) => i.estado === 'nueva').length,
    cambian: items.filter((i) => i.estado === 'cambia').length,
    iguales: items.filter((i) => i.estado === 'igual').length,
    noToca: items.filter((i) => i.estado === 'no_toca').length,
  };
}
