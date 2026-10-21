/**
 * Servicio (SLA) propuesto desde una planilla de cronograma: puestos, franjas,
 * cantidad y días, más las equivalencias de códigos. Sin red.
 */
import {
  claveCodigo,
  claveMapeo,
  normPlanilla,
  proponerRegla,
  refPorPuestoBanda,
  siglasPuestoPlanilla,
  type ColorCelda,
  type CuadroPlanilla,
  type FilaPlanilla,
  type Referencia,
} from './importarExcel';
import { codigoEnBloque } from './codigoPuestoPlanilla';
import { claveEquivalencia, type EquivalenciaCodigo } from './equivalenciaCodigo';
import { HORARIO_ESTANDAR, horasEntre, type AvisoRapido } from './modoRapido';
import { LICENCIA_CODES } from './bandaLicencia';
import { textoLecturaFranjas } from './lecturaBandas';
import { isArgentineHoliday } from '../servicios/slaHoursCalculator';

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
  /** Fechas puntuales del mes (YYYY-MM-DD). Si hay, mandan sobre `dias` (se guardan como `specificDates`). */
  fechas?: string[];
  /** Turnos de más sobre los puestos de 24 h: la planilla no dice su horario, hay que definirlo. */
  definirHorario?: boolean;
  /** «+ feriados»: además de sus días, corre los feriados nacionales. */
  feriados?: boolean;
  /** false = el puesto no se trabaja en feriados (−F). Sin valor = se trabaja (+F). */
  trabajaFeriados?: boolean;
  /** Código que traía la planilla, cuando se conservó el del servicio. */
  codigoPlanilla?: string;
};

export type FranjaVigente = {
  puesto: string;
  code: string;
  startTime: string;
  endTime: string;
  cantidad: number;
  dias: string[];
  fechas?: string[];
  feriados?: boolean;
  trabajaFeriados?: boolean;
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
  /** Comparación por día. Se muestra cuando ya hay un servicio del mes. */
  lectura: string;
  /** Sin servicio: puestos, días y funciones. No el detalle de bandas faltantes. */
  resumen?: string;
  /** Días de la semana que no llegan a la mitad de las ocurrencias. */
  parciales?: string[];
  /** Relevante, volante o retén: cubren otro puesto, no crean uno. */
  funciones?: string[];
};

const EXCLUIDOS = new Set(['F', 'FF', 'FP', 'FRANCO', 'RET', 'RETEN', 'RT', 'REF', 'ESC', 'FT', 'EV', 'EVENTO', 'R']);

export function letraDia(year: number, month: number, dia: number): DiaSemana {
  const dow = new Date(Date.UTC(year, month - 1, dia)).getUTCDay();
  return LETRA_UTC[dow];
}

/** «2, 3, 4, 30 y 31» para una franja con fechas puntuales. */
export function etiquetaFechas(fechas: readonly string[]): string {
  const ns = [...new Set(fechas.map((f) => Number(String(f).slice(8, 10))).filter((n) => n > 0))].sort((a, b) => a - b);
  if (!ns.length) return 'Sin fechas';
  if (ns.length === 1) return `el ${ns[0]}`;
  return `${ns.slice(0, -1).join(', ')} y ${ns[ns.length - 1]}`;
}

export function fechaDelMes(year: number, month: number, dia: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Días de la semana de las fechas, para comparar con un servicio por días. */
export function diasDeFechas(fechas: readonly string[]): DiaSemana[] {
  const set = new Set(fechas.map((f) => letraDia(Number(f.slice(0, 4)), Number(f.slice(5, 7)), Number(f.slice(8, 10)))));
  return ORDEN_DIAS.filter((d) => set.has(d));
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

const NOMBRE_DIA: Record<DiaSemana, string> = {
  L: 'lunes', M: 'martes', X: 'miércoles', J: 'jueves', V: 'viernes', S: 'sábado', D: 'domingo',
};

function horarioTexto(raw: string): { inicio: string; fin: string } | null {
  const t = normPlanilla(raw);
  const m = t.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(?:HS|H)?\s*A\s*(\d{1,2})(?:[:.](\d{2}))?/);
  if (!m) return null;
  const h1 = Number(m[1]);
  const h2 = Number(m[3]) % 24;
  if (h1 > 24 || h2 > 24) return null;
  return {
    inicio: `${String(h1).padStart(2, '0')}:${String(m[2] || 0).padStart(2, '0')}`,
    fin: `${String(h2).padStart(2, '0')}:${String(m[4] || 0).padStart(2, '0')}`,
  };
}

/** El código del servicio es la banda (M/T/N). El prefijo de la planilla solo elige el horario. C sábado y finde llevan código propio. */
function codigoDeRef(ref: Referencia, banda: string): string {
  const c = claveCodigo(ref.codigo);
  const desc = normPlanilla(ref.desc);
  const letra = ['M', 'T', 'N', 'D12', 'N12'].includes(banda) ? banda : '';
  if (/^(?:P\d+|PL)(?:D12|N12|M|T|N)$/.test(c)) return c;
  if (letra && c === letra) return letra;
  if (c === 'C' && (desc.includes('SABADO') || (ref.inicio === '07:00' && ref.fin === '11:00'))) return 'CS';
  if ((c === 'REF' || c === 'R') && (desc.includes('FINDE') || (ref.inicio === '12:00' && ref.fin === '22:00'))) return 'RF';
  if (c === 'REF' || c === 'R') return 'REF';
  if (c === 'C') return 'C';
  return letra || c;
}

function horarioDe(code: string, refs: Referencia[], color: ColorCelda, puesto = ''): { inicio: string; fin: string; code: string } | null {
  const ref = (puesto ? refPorPuestoBanda(refs, puesto, code, color) : null)
    || refs.find((r) => claveCodigo(r.codigo) === claveCodigo(code) && r.inicio && r.fin && (color === 'none' || r.color === color || r.color === 'none'));
  if (ref?.inicio && ref.fin) return { inicio: ref.inicio, fin: ref.fin, code: codigoDeRef(ref, claveCodigo(code)) };
  const est = HORARIO_ESTANDAR[code];
  return est ? { inicio: est.startTime, fin: est.endTime, code: claveCodigo(code) } : null;
}

function nombreVisible(raw: string): string {
  const n = normPlanilla(raw);
  const num = n.match(/^(?:PUESTO|PTO|PSTO)\s*(\d+)$/);
  if (num) return `Puesto ${Number(num[1])}`;
  if (n === 'PLAYA') return 'Playa';
  if (n === 'CORTINA') return 'Cortina';
  if (n === 'REFUERZO') return 'Refuerzo';
  return String(raw || '').replace(/\s+/g, ' ').trim() || 'Puesto';
}

function tipoFuncion(puesto: string): 'relevante' | 'volante' | 'reten' | null {
  const n = normPlanilla(puesto);
  if (n === 'RELEVANTE') return 'relevante';
  if (n === 'VOLANTE') return 'volante';
  if (n === 'RETEN' || n === 'RETENCION') return 'reten';
  return null;
}

function esPuestoRefuerzo(puesto: string): boolean {
  return normPlanilla(puesto) === 'REFUERZO';
}

function filaNota(fila: FilaPlanilla): boolean {
  if (String(fila.legajo || '').trim()) return false;
  const nombre = normPlanilla(fila.nombre);
  if (nombre.split(' ').length >= 2) return false;
  const horarios = fila.celdas.filter((c) => horarioTexto(c.raw)).length;
  return horarios >= 1 && horarios >= Math.ceil(fila.celdas.length * 0.5);
}

function partidoBanda(raw: string): { sigla: string; banda: string } | null {
  const visible = normPlanilla(raw);
  const spaced = visible.match(/^(P\d+|PL|[A-Z]{2,})\s+(D12|N12|M|T|N)$/);
  if (spaced) return { sigla: spaced[1], banda: spaced[2] };
  const compact = claveCodigo(raw);
  for (const banda of ['D12', 'N12', 'M', 'T', 'N'] as const) {
    if (!compact.endsWith(banda) || compact.length <= banda.length) continue;
    const sigla = compact.slice(0, compact.length - banda.length);
    if (/^(P\d+|PL|[A-Z]{2,})$/.test(sigla)) return { sigla, banda };
  }
  if (['M', 'T', 'N', 'D12', 'N12'].includes(compact)) return { sigla: '', banda: compact };
  return null;
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

function puestoPorSigla(filas: FilaPlanilla[], sigla: string): string {
  const k = claveCodigo(sigla);
  for (const f of filas) {
    if (tipoFuncion(f.puesto) || filaNota(f) || esPuestoRefuerzo(f.puesto)) continue;
    if (siglasPuestoPlanilla(f.puesto).some((s) => claveCodigo(s) === k)) return nombreVisible(f.puesto);
  }
  if (/^P\d+$/.test(k)) return `Puesto ${Number(k.slice(1))}`;
  return '';
}

function armarResumen(franjas: FranjaServicioPlanilla[], funciones: string[]): string {
  const puestos = [...new Set(franjas.map((f) => f.puesto))];
  const diasDe = (f: FranjaServicioPlanilla) => (f.dias.length ? f.dias : ORDEN_DIAS);
  const diasPuesto = (p: string) => {
    const fs = franjas.filter((f) => f.puesto === p);
    const bandas = fs.every((f) => ['M', 'T', 'N', 'D12', 'N12'].includes(f.code));
    if (bandas) return ORDEN_DIAS.filter((d) => fs.every((f) => diasDe(f).includes(d)));
    return ordenarDias(fs.flatMap((f) => diasDe(f)));
  };
  const todos = puestos.filter((p) => diasPuesto(p).length === 7);
  const resto = puestos.filter((p) => !todos.includes(p)).map((p) => `${p} ${etiquetaDias(diasPuesto(p))}`);
  const partes = [`${puestos.length} puesto${puestos.length === 1 ? '' : 's'}`];
  if (todos.length) partes.push(`${todos.join(', ')} todos los días`);
  partes.push(...resto);
  if (funciones.length) partes.push(`${funciones.length} relevante${funciones.length === 1 ? '' : 's'}`);
  return partes.join(' · ');
}

export function proponerServicioDesdePlanilla(cuadro: CuadroPlanilla, year: number, month: number): PropuestaServicio {
  const esquemas = esquemasDoce(cuadro, year, month);
  const cuenta = new Map<string, Map<number, number>>();
  const meta = new Map<string, { puesto: string; code: string; startTime: string; endTime: string }>();
  const eqCuenta = new Map<string, { codigo: string; color: 'red' | 'none'; code: string; startTime: string; endTime: string; positionName: string; n: number }>();
  const notas = new Map<string, Map<number, { inicio: string; fin: string }>>();
  const funciones = new Map<string, Set<string>>();

  for (const fila of cuadro.filas) {
    if (!filaNota(fila)) continue;
    const puesto = nombreVisible(fila.puesto);
    const dias = notas.get(normPlanilla(puesto)) || new Map<number, { inicio: string; fin: string }>();
    for (const c of fila.celdas) {
      const h = horarioTexto(c.raw);
      if (h) dias.set(c.dia, h);
    }
    if (dias.size) notas.set(normPlanilla(puesto), dias);
  }

  const sumar = (puesto: string, code: string, inicio: string, fin: string, dia: number, codigos: string[], color: 'red' | 'none') => {
    const visible = nombreVisible(puesto);
    const key = `${normPlanilla(visible)}|${claveCodigo(code)}|${inicio}|${fin}`;
    if (!meta.has(key)) meta.set(key, { puesto: visible, code: claveCodigo(code), startTime: inicio, endTime: fin });
    const dias = cuenta.get(key) || new Map<number, number>();
    dias.set(dia, (dias.get(dia) || 0) + 1);
    cuenta.set(key, dias);
    for (const codigo of [...new Set(codigos.map((c) => claveCodigo(c)).filter(Boolean))]) {
      const ck = `${claveMapeo(codigo, color)}|${normPlanilla(visible)}|${inicio}`;
      const prev = eqCuenta.get(ck);
      if (prev) prev.n += 1;
      else eqCuenta.set(ck, { codigo, color, code: claveCodigo(code), startTime: inicio, endTime: fin, positionName: visible, n: 1 });
    }
  };

  const codigosEq = (puestoFila: string, raw: string, codigo: string): string[] => {
    const out = [codigo];
    const bloque = codigoEnBloque(puestoFila, raw);
    if (bloque) out.push(claveCodigo(bloque));
    return out;
  };

  /** Por puesto y día: M/N rojas que no son esquema de 12 h (se cuentan como 8 h y cubren media T). */
  const doceSueltas = new Map<string, Map<number, number>>();
  for (const fila of cuadro.filas) {
    if (filaNota(fila)) continue;
    const funcion = tipoFuncion(fila.puesto);
    const refuerzo = esPuestoRefuerzo(fila.puesto);
    for (const c of fila.celdas) {
      const colorReal: ColorCelda = c.color === 'red' ? 'red' : (c.color || 'none');
      const colorEq: 'red' | 'none' = colorReal === 'red' ? 'red' : 'none';
      const partido = partidoBanda(c.raw);
      const codigo = claveCodigo(c.raw);
      if (['RET', 'RETEN', 'RT'].includes(codigo)) continue;
      let puestoDestino = nombreVisible(fila.puesto);
      let banda = partido?.banda || '';
      if (funcion) {
        if (!partido?.sigla) continue;
        const destino = puestoPorSigla(cuadro.filas, partido.sigla);
        if (!destino) continue;
        puestoDestino = destino;
        const cubre = funciones.get(normPlanilla(fila.puesto)) || new Set<string>();
        cubre.add(destino);
        funciones.set(normPlanilla(fila.puesto), cubre);
      } else if (partido?.sigla && !refuerzo) {
        const destino = puestoPorSigla(cuadro.filas, partido.sigla);
        if (destino) puestoDestino = destino;
      }
      if (!refuerzo && (codigo === 'REF' || codigo === 'R')) continue;
      if (refuerzo && codigo === 'C') {
        const cortina = puestoPorSigla(cuadro.filas, 'C') || puestoPorSigla(cuadro.filas, 'CO');
        if (cortina) puestoDestino = cortina;
      }
      const nota = notas.get(normPlanilla(puestoDestino))?.get(c.dia) || (refuerzo ? notas.get(normPlanilla(fila.puesto))?.get(c.dia) : undefined);
      const regla = proponerRegla(c.raw, colorReal === 'red' ? 'red' : 'none', cuadro.referencias);
      if (!nota && (regla.accion === 'franco' || regla.accion === 'ret' || regla.accion === 'licencia' || regla.accion === 'ignorar')) continue;
      if (!nota && EXCLUIDOS.has(codigo) && codigo !== 'REF') continue;
      if (!nota && regla.code === 'ESC') continue;
      if (regla.accion === 'doce' && !nota) {
        const base = claveCodigo(regla.code || codigo);
        if (!esquemas.has(`${normPlanilla(fila.puesto)}|${base}`)) {
          const kp = normPlanilla(nombreVisible(puestoDestino));
          const dd = doceSueltas.get(kp) || new Map<number, number>();
          dd.set(c.dia, (dd.get(c.dia) || 0) + 1);
          doceSueltas.set(kp, dd);
          const h8 = horarioDe(base, cuadro.referencias, 'none', puestoDestino);
          if (h8) sumar(puestoDestino, h8.code, h8.inicio, h8.fin, c.dia, codigosEq(fila.puesto, c.raw, codigo), 'none');
          continue;
        }
        const destino = base === 'N' ? 'N12' : 'D12';
        const refRoja = cuadro.referencias.find((r) => claveCodigo(r.codigo) === base && r.color === 'red' && r.inicio && r.fin)
          || refPorPuestoBanda(cuadro.referencias, puestoDestino, base, 'red');
        const h = refRoja
          ? { inicio: refRoja.inicio, fin: refRoja.fin }
          : horarioDe(destino, cuadro.referencias, 'none', puestoDestino);
        if (!h) continue;
        sumar(puestoDestino, destino, h.inicio, h.fin, c.dia, codigosEq(fila.puesto, c.raw, codigo), 'red');
        continue;
      }
      if (nota) {
        const parecida = cuadro.referencias.find((r) => r.inicio === nota.inicio && r.fin === nota.fin);
        const code = parecida ? codigoDeRef(parecida, banda || claveCodigo(parecida.codigo)) : (banda || 'REF');
        sumar(puestoDestino, code, nota.inicio, nota.fin, c.dia, codigosEq(fila.puesto, c.raw, codigo), colorEq);
        continue;
      }
      const busca = banda || claveCodigo(regla.code || codigo);
      const h = horarioDe(busca, cuadro.referencias, colorReal, puestoDestino) || horarioDe(codigo, cuadro.referencias, colorReal, puestoDestino);
      if (!h) continue;
      sumar(puestoDestino, h.code, h.inicio, h.fin, c.dia, codigosEq(fila.puesto, c.raw, codigo), colorEq);
    }
  }

  const ultimo = diasDelMes(year, month);
  const franjas: FranjaServicioPlanilla[] = [];
  const parciales: string[] = [];
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
    const parcialesKey: string[] = [];
    for (const letra of ORDEN_DIAS) {
      const xs = porLetra.get(letra) || [];
      if (!xs.length) continue;
      const conGente = xs.filter((n) => n > 0);
      if (!conGente.length) continue;
      if (conGente.length / xs.length >= 0.5) {
        const q = moda(conGente);
        const list = grupos.get(q) || [];
        list.push(letra);
        grupos.set(q, list);
      } else {
        parcialesKey.push(`${m.puesto} · ${m.code}: parcial (${conGente.length} de ${xs.length} ${NOMBRE_DIA[letra]})`);
      }
    }
    if (!grupos.size) {
      // Ningún día de la semana se repite: la franja va por fechas del mes («11 A 23» solo el 2, 3, 4, 30 y 31).
      const conGente = [...porDia.entries()].filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]);
      if (conGente.length) {
        const fechas = conGente.map(([dia]) => fechaDelMes(year, month, dia));
        franjas.push({
          id: `${key}|fechas|${conGente.map(([d]) => d).join('-')}`,
          puesto: m.puesto,
          code: m.code,
          startTime: m.startTime,
          endTime: m.endTime,
          cantidad: moda(conGente.map(([, n]) => n)),
          dias: diasDeFechas(fechas),
          fechas,
        });
        continue;
      }
    }
    parciales.push(...parcialesKey);
    for (const [cantidad, diasOn] of grupos) {
      const lista = ordenarDias(diasOn);
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
  // Puestos de 24 h por conteo de bandas: por día, min(M, T, N) con cada 12 h cubriendo media T.
  // Lo que sobra son turnos extra de una banda, con horario a definir (Obrador: 6 M · 4 T · 4 N → 4 × 24 h + 2 M).
  {
    const porPuesto = new Map<string, string[]>();
    for (const key of cuenta.keys()) {
      const p = normPlanilla(meta.get(key)!.puesto);
      porPuesto.set(p, [...(porPuesto.get(p) || []), key]);
    }
    for (const [p, keys] of porPuesto) {
      if (/RONDIN|ENCARGAD|CORTINA|REFUERZO|RELEVANTE|VOLANTE/.test(p)) continue;
      const bandaDe = (code: string) => (['M', 'T', 'N', 'D12', 'N12'].includes(code) ? code : partidoBanda(code)?.banda || '');
      const codes = keys.map((k) => bandaDe(meta.get(k)!.code));
      if (codes.some((c) => !c)) continue;
      if (!['M', 'T', 'N'].every((b) => codes.includes(b))) continue;
      const visible = meta.get(keys[0])!.puesto;
      const enDia = (dia: number, code: string) => keys
        .filter((k) => bandaDe(meta.get(k)!.code) === code)
        .reduce((a, k) => a + (cuenta.get(k)!.get(dia) || 0), 0);
      const efectivo = (dia: number) => {
        const d12 = enDia(dia, 'D12');
        const n12 = enDia(dia, 'N12');
        const sueltas = doceSueltas.get(p)?.get(dia) || 0;
        return {
          M: enDia(dia, 'M') + d12,
          T: enDia(dia, 'T') + (d12 + n12 + sueltas) / 2,
          N: enDia(dia, 'N') + n12,
        };
      };
      const kDias: number[] = [];
      const extraDias = { M: 0, T: 0, N: 0 };
      let diasConGente = 0;
      for (let dia = 1; dia <= ultimo; dia++) {
        const e = efectivo(dia);
        if (e.M + e.T + e.N <= 0) continue;
        diasConGente += 1;
        const base = Math.floor(Math.min(e.M, e.T, e.N) + 1e-9);
        kDias.push(base);
        for (const b of ['M', 'T', 'N'] as const) {
          if (Math.floor(e[b] - base + 1e-9) >= 1) extraDias[b] += 1;
        }
      }
      const k = moda(kDias);
      if (!(k >= 1)) continue;
      // 1×M 2×T 2×N: dos bandas por encima del mínimo. Es un puesto, no un 24 h más extras.
      const bandasConExtra = (['M', 'T', 'N'] as const).filter((b) => diasConGente > 0 && extraDias[b] / diasConGente >= 0.5);
      if (bandasConExtra.length >= 2) continue;
      const horarioBanda = (b: string) => {
        const mejor = keys.filter((x) => bandaDe(meta.get(x)!.code) === b)
          .sort((a, c) => [...cuenta.get(c)!.values()].reduce((s1, v) => s1 + v, 0) - [...cuenta.get(a)!.values()].reduce((s1, v) => s1 + v, 0))[0];
        return meta.get(mejor)!;
      };
      for (let i = franjas.length - 1; i >= 0; i--) if (normPlanilla(franjas[i].puesto) === p) franjas.splice(i, 1);
      for (let i = parciales.length - 1; i >= 0; i--) if (normPlanilla(parciales[i].split(' · ')[0]) === p) parciales.splice(i, 1);
      for (const b of ['M', 'T', 'N'] as const) {
        const h = horarioBanda(b);
        franjas.push({ id: `24h|${p}|${b}`, puesto: visible, code: h.code, startTime: h.startTime, endTime: h.endTime, cantidad: k, dias: [] });
      }
      const generico = !visible.trim() || /^(PUESTO|P|PTO)\.?$/.test(p);
      for (const b of ['M', 'T', 'N'] as const) {
        const h = horarioBanda(b);
        const porLetra = new Map<DiaSemana, number[]>();
        for (let dia = 1; dia <= ultimo; dia++) {
          const letra = letraDia(year, month, dia);
          porLetra.set(letra, [...(porLetra.get(letra) || []), Math.max(0, Math.floor(efectivo(dia)[b] - k + 1e-9))]);
        }
        const gruposExtra = new Map<number, DiaSemana[]>();
        for (const letra of ORDEN_DIAS) {
          const xs = porLetra.get(letra) || [];
          const con = xs.filter((n) => n > 0);
          if (!con.length || con.length / xs.length < 0.5) continue;
          const q = moda(con);
          gruposExtra.set(q, [...(gruposExtra.get(q) || []), letra]);
        }
        for (const [q, letras] of gruposExtra) {
          const lista = ordenarDias(letras);
          franjas.push({
            id: `extra|${p}|${b}|${lista.join('')}|${q}`,
            puesto: generico ? `Extra ${b}` : `${visible} extra ${b}`,
            code: h.code,
            startTime: h.startTime,
            endTime: h.endTime,
            cantidad: q,
            dias: lista.length === 7 ? [] : lista,
            definirHorario: true,
          });
        }
      }
    }
  }
  franjas.sort((a, b) => a.puesto.localeCompare(b.puesto, 'es') || a.startTime.localeCompare(b.startTime) || a.code.localeCompare(b.code));

  const porClave = new Map<string, { codigo: string; color: 'red' | 'none'; code: string; startTime: string; endTime: string; positionName: string; n: number }>();
  const gruposEq = new Map<string, Array<{ codigo: string; color: 'red' | 'none'; code: string; startTime: string; endTime: string; positionName: string; n: number }>>();
  for (const e of eqCuenta.values()) {
    const clave = claveEquivalencia(e.codigo, e.color === 'red');
    const list = gruposEq.get(clave) || [];
    list.push(e);
    gruposEq.set(clave, list);
  }
  for (const [clave, list] of gruposEq) {
    const codes = new Set(list.map((e) => e.code));
    if (codes.size > 1) continue;
    const best = list.slice().sort((a, b) => b.n - a.n)[0];
    porClave.set(clave, best);
  }
  const equivalencias: EquivalenciaCodigo[] = [...porClave.entries()]
    .map(([clave, e]) => ({
      clave,
      codigo: e.codigo,
      color: e.color,
      code: e.code,
      startTime: e.startTime,
      endTime: e.endTime,
      positionName: e.positionName,
      muestras: e.n,
    }))
    .sort((a, b) => b.muestras - a.muestras || a.codigo.localeCompare(b.codigo));

  const lectura = textoLecturaFranjas(franjas.map((f) => ({
    puesto: f.puesto,
    code: f.code,
    cantidad: f.cantidad,
    dias: f.dias,
    startTime: f.startTime,
  })));
  const listaFunciones = [...funciones.entries()].map(([k, puestos]) => {
    const etiqueta = k === 'RELEVANTE' ? 'Relevante' : k === 'VOLANTE' ? 'Volante' : 'Retén';
    return `${etiqueta}: cubre ${[...puestos].join(' y ')}`;
  });
  return { franjas, equivalencias, lectura, resumen: armarResumen(franjas, listaFunciones), parciales, funciones: listaFunciones };
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

function numeroPuesto(nombre: string): string {
  const n = normPlanilla(nombre);
  const m = n.match(/^(?:P|PTO|PUESTO|PSTO)\.?\s*(\d+)$/) || n.match(/\b(\d+)\s*$/);
  return m ? String(Number(m[1])) : '';
}

function esPuestoGenerico(nombre: string): boolean {
  return /^(P|PTO|PUESTO|PSTO)\.?$/.test(normPlanilla(nombre));
}

/**
 * Puesto de la planilla → puesto del servicio. Por nombre normalizado, por número
 * («P1», «PUESTO 1»), «Puesto» sin número = el único puesto, y por franjas parecidas.
 */
export function emparejarPuestos(
  propuesta: Array<{ puesto: string; code: string }>,
  vigente: Array<{ puesto: string; code: string }>,
): Map<string, string> {
  const out = new Map<string, string>();
  const nombresP = [...new Set(propuesta.map((f) => f.puesto))];
  const nombresV = [...new Set(vigente.map((f) => f.puesto))];
  const libres = new Set(nombresV);
  const tomar = (p: string, v: string) => { out.set(normPlanilla(p), v); libres.delete(v); };
  for (const p of nombresP) {
    const v = nombresV.find((x) => libres.has(x) && normPlanilla(x) === normPlanilla(p));
    if (v) tomar(p, v);
  }
  for (const p of nombresP) {
    if (out.has(normPlanilla(p))) continue;
    const n = numeroPuesto(p);
    if (!n) continue;
    const vs = nombresV.filter((x) => libres.has(x) && numeroPuesto(x) === n);
    if (vs.length === 1) tomar(p, vs[0]);
  }
  const sinPar = nombresP.filter((p) => !out.has(normPlanilla(p)));
  if (sinPar.length === 1 && libres.size === 1 && (esPuestoGenerico(sinPar[0]) || nombresP.length === 1)) {
    tomar(sinPar[0], [...libres][0]);
  }
  const codigos = (lista: Array<{ puesto: string; code: string }>, nombre: string) =>
    new Set(lista.filter((f) => f.puesto === nombre).map((f) => claveCodigo(f.code)));
  for (const p of nombresP) {
    if (out.has(normPlanilla(p))) continue;
    const cp = codigos(propuesta, p);
    let best: { v: string; j: number } | null = null;
    for (const v of libres) {
      const cv = codigos(vigente, v);
      const inter = [...cp].filter((c) => cv.has(c)).length;
      const j = inter / Math.max(1, new Set([...cp, ...cv]).size);
      if (j >= 0.6 && (!best || j > best.j)) best = { v, j };
    }
    if (best) tomar(p, best.v);
  }
  return out;
}

/** Renombra los puestos de la propuesta con el puesto compatible del servicio del mes. */
export function alinearPuestos(franjas: FranjaServicioPlanilla[], vigente: FranjaVigente[]): FranjaServicioPlanilla[] {
  if (!vigente.length) return franjas;
  const par = emparejarPuestos(franjas, vigente);
  return franjas.map((f) => {
    const v = par.get(normPlanilla(f.puesto));
    return v && v !== f.puesto ? { ...f, puesto: v } : f;
  });
}

/** Mismo puesto y mismo horario: se conserva el código del servicio (P1M, CO, REF) aunque la planilla diga M, C o RF. */
export function adoptarCodigoVigente(franjas: FranjaServicioPlanilla[], vigente: FranjaVigente[]): FranjaServicioPlanilla[] {
  if (!vigente.length) return franjas;
  const par = emparejarPuestos(franjas, vigente);
  const mismo = (p: string, v: string) => normPlanilla(par.get(normPlanilla(p)) || p) === normPlanilla(v);
  const usadas = new Set<number>();
  return franjas.map((f) => {
    const i = vigente.findIndex((v, idx) => !usadas.has(idx) && mismo(f.puesto, v.puesto)
      && minDe(v.startTime) === minDe(f.startTime) && minDe(v.endTime) === minDe(f.endTime));
    if (i < 0) return f;
    usadas.add(i);
    const code = claveCodigo(vigente[i].code);
    if (!code || code === claveCodigo(f.code)) return f;
    return { ...f, code, codigoPlanilla: f.codigoPlanilla || f.code };
  });
}

/** La equivalencia queda apuntando al código que se va a guardar (P1 M → P1M). */
export function equivalenciasAlCodigoServicio(
  eqs: EquivalenciaCodigo[],
  antes: FranjaServicioPlanilla[],
  despues: FranjaServicioPlanilla[],
): EquivalenciaCodigo[] {
  const cambios = antes
    .map((a, i) => ({ a, d: despues[i] }))
    .filter((x): x is { a: FranjaServicioPlanilla; d: FranjaServicioPlanilla } => !!x.d && claveCodigo(x.a.code) !== claveCodigo(x.d.code));
  if (!cambios.length) return eqs;
  return eqs.map((e) => {
    const hit = cambios.find((x) => normPlanilla(e.positionName || '') === normPlanilla(x.d.puesto)
      && claveCodigo(e.code) === claveCodigo(x.a.code)
      && e.startTime === x.a.startTime
      && e.endTime === x.a.endTime);
    return hit ? { ...e, code: hit.d.code } : e;
  });
}

export function compararConVigente(propuesta: FranjaServicioPlanilla[], vigente: FranjaVigente[]): DiffFranja[] {
  const usados = new Set<number>();
  const out: DiffFranja[] = [];
  const par = emparejarPuestos(propuesta, vigente);
  const mismoPuesto = (p: string, v: string) => normPlanilla(par.get(normPlanilla(p)) || p) === normPlanilla(v);
  const anotar = (f: FranjaServicioPlanilla, lista: Array<{ v: FranjaVigente; i: number }>) => lista
    .map((x) => {
      const dStart = Math.abs(minDe(x.v.startTime) - minDe(f.startTime));
      const diasP = new Set(normDias(f.dias) === 'TODOS' ? ORDEN_DIAS : f.dias);
      const diasV = normDias(x.v.dias) === 'TODOS' ? ORDEN_DIAS : ORDEN_DIAS.filter((d) => new Set(x.v.dias).has(d));
      const overlap = diasV.filter((d) => diasP.has(d)).length;
      return { ...x, dStart, overlap };
    });
  const candidatos = (f: FranjaServicioPlanilla) => anotar(f, vigente
    .map((v, i) => ({ v, i }))
    .filter((x) => !usados.has(x.i) && mismoPuesto(f.puesto, x.v.puesto) && claveCodigo(x.v.code) === claveCodigo(f.code)))
    .filter((x) => x.dStart <= 180)
    .sort((a, b) => b.overlap - a.overlap || a.dStart - b.dStart);
  const porHorario = (f: FranjaServicioPlanilla) => anotar(f, vigente
    .map((v, i) => ({ v, i }))
    .filter((x) => !usados.has(x.i) && mismoPuesto(f.puesto, x.v.puesto)
      && minDe(x.v.startTime) === minDe(f.startTime) && minDe(x.v.endTime) === minDe(f.endTime)
      && claveCodigo(x.v.code) !== claveCodigo(f.code)))
    .sort((a, b) => b.overlap - a.overlap);

  for (const f of propuesta) {
    const hit = candidatos(f)[0] || porHorario(f)[0];
    if (!hit) {
      out.push({ estado: 'falta', puesto: f.puesto, code: f.code, startTime: f.startTime, endTime: f.endTime, cantidad: f.cantidad, dias: f.dias, detalle: `${f.puesto} · ${f.code} ${f.startTime}–${f.endTime} ×${f.cantidad} · ${(f.fechas?.length ? `fechas ${etiquetaFechas(f.fechas)}` : etiquetaDias(f.dias))}: está en la planilla y no en el servicio` });
      continue;
    }
    usados.add(hit.i);
    const v = hit.v;
    const planilla = claveCodigo(f.codigoPlanilla || f.code);
    const servicio = claveCodigo(v.code);
    const distintoCodigo = planilla !== servicio;
    const codeOut = distintoCodigo ? servicio : f.code;
    const cambios: string[] = [];
    if (Math.abs(minDe(v.startTime) - minDe(f.startTime)) > 0 || Math.abs(minDe(v.endTime) - minDe(f.endTime)) > 0) cambios.push(`horario ${v.startTime}–${v.endTime} → ${f.startTime}–${f.endTime}`);
    if ((v.cantidad || 0) !== f.cantidad) cambios.push(`cantidad ×${v.cantidad ?? 0} → ×${f.cantidad}`);
    if (normDias(v.dias) !== normDias(f.dias)) cambios.push(`días ${etiquetaDias(v.dias)} → ${(f.fechas?.length ? `fechas ${etiquetaFechas(f.fechas)}` : etiquetaDias(f.dias))}`);
    const nota = distintoCodigo ? `${f.puesto} · ${planilla} coincide (código ${servicio} en el servicio)` : '';
    out.push({
      estado: cambios.length ? 'distinto' : 'coincide',
      puesto: f.puesto,
      code: codeOut,
      startTime: f.startTime,
      endTime: f.endTime,
      cantidad: f.cantidad,
      dias: f.dias,
      detalle: cambios.length
        ? `${f.puesto} · ${codeOut}: ${cambios.join('; ')}${distintoCodigo ? ` (código ${servicio} en el servicio)` : ''}`
        : (nota || `${f.puesto} · ${f.code} ${f.startTime}–${f.endTime} ×${f.cantidad} · ${(f.fechas?.length ? `fechas ${etiquetaFechas(f.fechas)}` : etiquetaDias(f.dias))}`),
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
  specificDates?: string[];
  feriados?: boolean;
};

export type PosicionServicioDoc = {
  id: string;
  name: string;
  coverageType: 'custom' | '24hs' | string;
  quantity: number;
  activeDays: string[];
  allowedShiftTypes: TurnoServicioDoc[];
  status: 'ACTIVE';
  /** false = −F: los feriados no exigen cobertura ni suman horas vendidas. */
  trabajaFeriados?: boolean;
};

/** Las franjas regulares del puesto cubren las 24 h del día (M+T+N, D12+N12, P1M+P1T+P1N…). */
export function cubre24Horas(franjas: ReadonlyArray<Pick<FranjaServicioPlanilla, 'startTime' | 'endTime' | 'fechas'>>): boolean {
  const cubierto = new Array<boolean>(24 * 60).fill(false);
  for (const f of franjas) {
    if (f.fechas?.length) continue;
    const ini = minDe(f.startTime);
    let fin = minDe(f.endTime);
    if (fin <= ini) fin += 24 * 60;
    for (let m = ini; m < fin; m++) cubierto[m % (24 * 60)] = true;
  }
  return cubierto.every(Boolean);
}

const PUESTO_FRANJA_PROPIA = /RONDIN|ENCARGAD|CORTINA|REFUERZO|RELEVANTE|VOLANTE/;

type FranjaBanda = Pick<FranjaServicioPlanilla, 'code' | 'startTime' | 'endTime' | 'fechas'> & { cantidad?: number };

/** M, T o N de 8 h. N12/D12 no entran (el 12 no es un sufijo de la N). */
function bandaOcho(code: string): 'M' | 'T' | 'N' | null {
  const c = claveCodigo(code);
  if (c === 'D12' || c === 'N12' || c.endsWith('D12') || c.endsWith('N12')) return null;
  if (c === 'M' || c === 'T' || c === 'N') return c;
  const m = c.match(/^(?:P\d+|PL)([MTN])$/);
  return m ? (m[1] as 'M' | 'T' | 'N') : null;
}

type ClasifMtn =
  | { tipo: '24hs'; cantidad: number }
  | { tipo: 'custom'; M: number; T: number; N: number; horasDia: number };

/** M+T+N con la misma cantidad → 24 h. Cantidades distintas → custom (1×M 2×T 2×N = 40 h, nunca 24 h × 2). */
function clasificacionMtn(puesto: string, franjas: ReadonlyArray<FranjaBanda>): ClasifMtn | null {
  if (PUESTO_FRANJA_PROPIA.test(normPlanilla(puesto))) return null;
  const cant = new Map<'M' | 'T' | 'N', number[]>();
  const horas = new Map<'M' | 'T' | 'N', number>();
  for (const f of franjas) {
    if (f.fechas?.length) continue;
    const b = bandaOcho(f.code);
    if (!b) continue;
    const q = Math.max(1, Math.round(Number(f.cantidad) || 1));
    cant.set(b, [...(cant.get(b) || []), q]);
    horas.set(b, (horas.get(b) || 0) + horasEntre(f.startTime, f.endTime) * q);
  }
  const bands = ['M', 'T', 'N'] as const;
  if (!bands.every((b) => (cant.get(b) || []).length === 1)) return null;
  const M = cant.get('M')![0];
  const T = cant.get('T')![0];
  const N = cant.get('N')![0];
  if (M === T && T === N) return cubre24Horas(franjas) ? { tipo: '24hs', cantidad: M } : null;
  const horasDia = Math.round(((horas.get('M') || 0) + (horas.get('T') || 0) + (horas.get('N') || 0)) * 10) / 10;
  return { tipo: 'custom', M, T, N, horasDia };
}

/** Tipo con el que se va a crear el puesto y por qué, para mostrarlo antes de guardar. */
export function tipoPuestoPropuesto(puesto: string, franjas: ReadonlyArray<FranjaBanda>): { tipo: '24hs' | 'custom'; motivo: string } {
  if (PUESTO_FRANJA_PROPIA.test(normPlanilla(puesto))) return { tipo: 'custom', motivo: 'franja propia (no se le piden M+T+N)' };
  const clasif = clasificacionMtn(puesto, franjas);
  if (clasif?.tipo === 'custom') return { tipo: 'custom', motivo: `M×${clasif.M} T×${clasif.T} N×${clasif.N} · ${clasif.horasDia} h/día` };
  const codigos = [...new Set(franjas.filter((f) => !f.fechas?.length).map((f) => f.code))].join('+');
  if (cubre24Horas(franjas)) return { tipo: '24hs', motivo: `${codigos} cubren el día · admite D12/N12` };
  return { tipo: 'custom', motivo: `${codigos || 'sus franjas'} no cubren las 24 h · las horas de más van como TURA` };
}

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
    const previasTurnos = ((previa?.allowedShiftTypes || []) as unknown as Array<Record<string, unknown>>);
    const shifts: TurnoServicioDoc[] = list.map((f) => {
      // Conserva lo que el editor no muestra del turno (turno cortado, nombre, etc.) y pisa lo editado.
      const prevTurno = previasTurnos.find((t) => normPlanilla(String(t.code || '')) === normPlanilla(f.code)) || {};
      const { days: _d, specificDates: _sd, feriados: _fe, ...resto } = prevTurno as Record<string, unknown>;
      return {
        ...(resto as object),
        code: f.code,
        name: String((prevTurno as { name?: unknown }).name || f.code),
        startTime: f.startTime,
        endTime: f.endTime,
        hours: horasEntre(f.startTime, f.endTime),
        quantity: Math.max(1, Math.round(f.cantidad) || 1),
        ...(f.fechas?.length ? { specificDates: [...f.fechas].sort() } : f.dias.length ? { days: f.dias } : {}),
        ...(f.feriados && !f.fechas?.length ? { feriados: true } : {}),
      } as TurnoServicioDoc;
    });
    const dias = ordenarDias(list.flatMap((f) => (f.fechas?.length ? diasDeFechas(f.fechas) : f.dias.length ? f.dias : ORDEN_DIAS)));
    const clasif = clasificacionMtn(list[0].puesto, list);
    const coverageType = clasif?.tipo
      || (previa?.coverageType && !String(previa.id || '').startsWith('planilla_') ? String(previa.coverageType) : '')
      || (!PUESTO_FRANJA_PROPIA.test(normPlanilla(list[0].puesto)) && cubre24Horas(list) ? '24hs' : 'custom');
    const sinFeriados = list.some((f) => f.trabajaFeriados === false);
    const conFeriados = list.some((f) => f.trabajaFeriados === true);
    // Todo puesto de 24 h admite D12/N12: si la planilla no los trae, salen de la mañana del puesto
    // (Casino: M 07–15 → D12 07–19 / N12 19–07, la M y la T rojas de la referencia).
    if (coverageType === '24hs') {
      const codigos = new Set(shifts.map((x) => String(x.code || '').toUpperCase()));
      const man = shifts.find((x) => /^(?:P\d+|PL)?M\d*$/.test(String(x.code || '').toUpperCase()) && x.startTime);
      if (man && !codigos.has('D12') && !codigos.has('N12')) {
        const ini = String(man.startTime).slice(0, 5);
        const doce = `${String((Number(ini.slice(0, 2)) + 12) % 24).padStart(2, '0')}${ini.slice(2)}`;
        shifts.push({ code: 'D12', name: 'D12', startTime: ini, endTime: doce, hours: 12 } as TurnoServicioDoc);
        shifts.push({ code: 'N12', name: 'N12', startTime: doce, endTime: ini, hours: 12 } as TurnoServicioDoc);
      }
    }
    out.push({
      // El puesto que ya existía conserva sus otros datos (días excluidos, bajas, exigeCobertura…).
      ...((previa || {}) as object),
      id: String(previa?.id || `planilla_${n}`),
      name: previa?.name || list[0].puesto,
      // M+T+N con cantidades distintas pisa un 24 h viejo. Sin las tres bandas, un puesto cargado a mano conserva su tipo.
      coverageType,
      quantity: clasif?.tipo === '24hs' ? clasif.cantidad : Math.max(...list.map((f) => f.cantidad), 1),
      // Los 7 días van escritos: Servicios lee la lista vacía como «0 días/semana».
      activeDays: dias.length ? dias : [...ORDEN_DIAS],
      allowedShiftTypes: shifts,
      ...((previa as { shifts?: unknown } | undefined)?.shifts ? { shifts } : {}),
      status: 'ACTIVE',
    });
    if (sinFeriados) (out[out.length - 1] as PosicionServicioDoc).trabajaFeriados = false;
    else if (conFeriados) delete (out[out.length - 1] as { trabajaFeriados?: boolean }).trabajaFeriados;
  }
  return out;
}

export function horasMesDeFranjas(franjas: FranjaServicioPlanilla[], year: number, month: number): number {
  const ultimo = diasDelMes(year, month);
  let total = 0;
  for (const f of franjas) {
    const horas = horasEntre(f.startTime, f.endTime);
    const set = new Set(f.dias);
    const mm = `${year}-${String(month).padStart(2, '0')}-`;
    const fechas = new Set((f.fechas || []).filter((x) => x.startsWith(mm)));
    let dias = 0;
    for (let d = 1; d <= ultimo; d++) {
      const ymd = `${mm}${String(d).padStart(2, '0')}`;
      // −F: el feriado no suma horas vendidas (igual que la prefactura).
      if (f.trabajaFeriados === false && isArgentineHoliday(ymd)) continue;
      // Con fechas específicas (PP del 10 al 31) cuentan solo esas; si no, los días de la semana.
      if (f.fechas?.length) { if (fechas.has(ymd)) dias += 1; continue; }
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
  specificDates?: string[];
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
      const habilitada = mismo.filter((f) => (f.specificDates?.length
        ? f.specificDates.includes(dateStr)
        : !f.days?.length || f.days.map((d) => d.toUpperCase()).includes(letra)));
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

export type TurnoServicioIn = {
  dateStr: string;
  positionName: string;
  code: string;
  startTime: string;
  endTime: string;
};

const ESTANDAR_BANDA = new Set(['M', 'T', 'N', 'D12', 'N12']);

function modaDe(vals: string[]): string {
  const c = new Map<string, number>();
  for (const v of vals) c.set(v, (c.get(v) || 0) + 1);
  let best = vals[0] || '';
  let n = 0;
  for (const [v, k] of c) if (k > n) { best = v; n = k; }
  return best;
}

function esPuestoCustom(puesto: string): boolean {
  const n = normPlanilla(puesto);
  return n === 'RO' || n === 'EN' || /RONDIN|ENCARGAD|CORTINA/.test(n);
}

/** Arma la propuesta desde los turnos ya cargados en el cronograma del mes. */
export function proponerServicioDesdeTurnos(turnos: readonly TurnoServicioIn[], _year: number, _month: number): PropuestaServicio {
  const grupos = new Map<string, TurnoServicioIn[]>();
  for (const t of turnos) {
    const code = String(t.code || '').trim().toUpperCase();
    const puesto = String(t.positionName || '').trim();
    if (!code || !puesto || !t.dateStr) continue;
    if (LICENCIA_CODES.has(code) || EXCLUIDOS.has(code)) continue;
    const k = `${normPlanilla(puesto)}|${code}`;
    const lista = grupos.get(k) || [];
    lista.push({ ...t, code, positionName: puesto });
    grupos.set(k, lista);
  }
  const franjas: FranjaServicioPlanilla[] = [];
  for (const lista of grupos.values()) {
    const code = lista[0].code;
    const puesto = lista[0].positionName;
    const diasDistintos = new Set(lista.map((t) => t.dateStr));
    const custom = esPuestoCustom(puesto) || !ESTANDAR_BANDA.has(code);
    if (!custom && (code === 'D12' || code === 'N12') && diasDistintos.size < 4) continue;
    const porDia = new Map<string, number>();
    for (const t of lista) porDia.set(t.dateStr, (porDia.get(t.dateStr) || 0) + 1);
    const cantidades = [...porDia.values()];
    const cantidad = Number(modaDe(cantidades.map(String))) || 1;
    const horarios = lista.map((t) => `${t.startTime || ''}|${t.endTime || ''}`).filter((h) => h !== '|');
    const horario = modaDe(horarios);
    const std = HORARIO_ESTANDAR[code];
    const [startTime, endTime] = horario
      ? horario.split('|')
      : [std?.startTime || '07:00', std?.endTime || '15:00'];
    const letras = new Set<DiaSemana>();
    for (const ds of diasDistintos) {
      const [y, m, d] = ds.split('-').map(Number);
      if (y && m && d) letras.add(letraDia(y, m, d));
    }
    const dias = letras.size >= 7 ? [] : ORDEN_DIAS.filter((d) => letras.has(d));
    franjas.push({
      id: `turnos|${normPlanilla(puesto)}|${code}`,
      puesto,
      code,
      startTime,
      endTime,
      cantidad,
      dias,
    });
  }
  franjas.sort((a, b) => a.puesto.localeCompare(b.puesto, 'es') || a.code.localeCompare(b.code));
  const lectura = textoLecturaFranjas(franjas.map((f) => ({
    puesto: f.puesto, code: f.code, cantidad: f.cantidad, dias: f.dias, startTime: f.startTime,
  })));
  return { franjas, equivalencias: [], lectura: lectura || 'Leído de los turnos de este mes.' };
}

export function franjasDesdeVigente(vigente: readonly FranjaVigente[]): FranjaServicioPlanilla[] {
  return vigente.map((f, i) => ({
    id: `anterior|${i}|${normPlanilla(f.puesto)}|${f.code}`,
    puesto: f.puesto,
    code: f.code,
    startTime: f.startTime,
    endTime: f.endTime,
    cantidad: f.cantidad || 1,
    dias: ORDEN_DIAS.filter((d) => (f.dias || []).map((x) => x.toUpperCase()).includes(d)),
    ...(f.fechas?.length ? { fechas: [...f.fechas] } : {}),
    ...(f.feriados ? { feriados: true } : {}),
    ...(f.trabajaFeriados === false ? { trabajaFeriados: false } : f.trabajaFeriados === true ? { trabajaFeriados: true } : {}),
  }));
}

function claveFranja(f: Pick<FranjaServicioPlanilla, 'code' | 'startTime' | 'endTime' | 'dias' | 'fechas'>): string {
  return `${claveCodigo(f.code)}|${f.startTime}|${f.endTime}|${normDias(f.dias)}|${(f.fechas || []).slice().sort().join(',')}`;
}

/** «Puesto 1 ×4» → «Puesto 1», «Puesto 2», «Puesto 3», «Puesto 4» ×1, con las mismas franjas. Salta nombres que ya usa otro puesto. */
export function separarPuesto(franjas: FranjaServicioPlanilla[], puesto: string): FranjaServicioPlanilla[] {
  const propias = franjas.filter((f) => f.puesto === puesto);
  const n = Math.max(1, ...propias.map((f) => Math.round(f.cantidad) || 1));
  if (n < 2) return franjas;
  const otros = new Set(franjas.filter((f) => f.puesto !== puesto).map((f) => normPlanilla(f.puesto)));
  const m = puesto.trim().match(/^(.*?)(\d+)\s*$/);
  const base = m ? m[1] : `${puesto.trim()} `;
  let num = m ? Number(m[2]) : 1;
  const nombres: string[] = [];
  while (nombres.length < n) {
    const nombre = `${base}${num}`.replace(/\s+/g, ' ').trim();
    if (!otros.has(normPlanilla(nombre))) nombres.push(nombre);
    num += 1;
  }
  const nuevas: FranjaServicioPlanilla[] = [];
  nombres.forEach((nombre, i) => {
    for (const f of propias) {
      if (i < (Math.round(f.cantidad) || 1)) nuevas.push({ ...f, id: `${f.id}|sep${i + 1}`, puesto: nombre, cantidad: 1 });
    }
  });
  const primero = franjas.findIndex((f) => f.puesto === puesto);
  const resto = franjas.filter((f) => f.puesto !== puesto);
  return [...resto.slice(0, primero), ...nuevas, ...resto.slice(primero)];
}

/** Junta `otro` dentro de `destino`: las franjas iguales suman cantidad. */
export function unirPuestos(franjas: FranjaServicioPlanilla[], destino: string, otro: string): FranjaServicioPlanilla[] {
  if (destino === otro) return franjas;
  const out: FranjaServicioPlanilla[] = [];
  const porClave = new Map<string, FranjaServicioPlanilla>();
  for (const f of franjas) {
    if (f.puesto !== destino && f.puesto !== otro) { out.push(f); continue; }
    const g = { ...f, puesto: destino };
    const k = claveFranja(g);
    const prev = porClave.get(k);
    if (prev) { prev.cantidad += g.cantidad; continue; }
    porClave.set(k, g);
    out.push(g);
  }
  return out;
}

export function renombrarPuesto(franjas: FranjaServicioPlanilla[], viejo: string, nuevo: string): FranjaServicioPlanilla[] {
  const n = nuevo.trim();
  if (!n || n === viejo) return franjas;
  return franjas.map((f) => (f.puesto === viejo ? { ...f, puesto: n } : f));
}
