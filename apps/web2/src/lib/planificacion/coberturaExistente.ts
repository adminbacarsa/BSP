/**
 * Cobertura que ya existe el día que se abre el modal: Operaciones (ops_cov / coveredBy del
 * titular), la planificada guardada en el cronograma, o la consulta. No escribe nada.
 */
import {
  vacancyDayHasCoverage,
  type VacancyDayCoverage,
} from '@/lib/planificacion/vacancyCoverage';
import type { ConsultaResumenIn } from '@/lib/planificacion/coberturaEventualesUx';

export type TurnoDiaIn = {
  id?: string;
  employeeId?: string;
  employeeName?: string;
  code?: string;
  origin?: string;
  status?: string;
  isDeleted?: boolean;
  coverageStatus?: string;
  coverageType?: string;
  coverageSegmentRole?: string;
  coveredBy?: string;
  coveredByEmployeeId?: string;
  coveredByEmployeeName?: string;
  coveredAt?: unknown;
  operacionallyCovered?: boolean;
  resolvedBy?: string;
  coverageDocId?: string;
  absenceShiftId?: string;
  coveredShiftId?: string;
  coversEmployeeId?: string;
  comments?: string;
  coverageSuperseded?: boolean;
  isExtended?: boolean;
  isEarlyStart?: boolean;
  realStartTime?: unknown;
  checkInAt?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  originalCode?: string;
  originalPositionName?: string;
  positionName?: string;
  hours?: number;
  isAbsent?: boolean;
  codigoOriginal?: string;
  deploymentBand?: string;
  coversBandCode?: string;
};

export type CoberturaExistente =
  | { origen: 'ninguna' }
  | { origen: 'consulta'; status: 'ABIERTA' | 'ACEPTO'; texto: string }
  | {
      origen: 'operaciones';
      estado: 'CUBIERTO' | 'PARCIAL';
      nombre: string;
      codigo: string | null;
      desdeHm: string | null;
      tramoFaltante: string | null;
      employeeId: string | null;
      texto: string;
    }
  | { origen: 'planificada'; cobertura: Exclude<VacancyDayCoverage, { mode: 'none' }>; texto: string };

export type DraftCobertura = 'none' | 'nuevo' | 'igual' | 'quitada';

export type DecisionDia = {
  activo: boolean;
  /** CUBIERTO o PARCIAL de Operaciones. La planificada no entra acá. */
  ops: 'CUBIERTO' | 'PARCIAL' | null;
  consulta: boolean;
  planificada: boolean;
  draft: DraftCobertura;
};

function apellidoCorto(nombre: string): string {
  const limpio = String(nombre || '').trim();
  if (!limpio) return '';
  const antes = limpio.split(',')[0].trim();
  return antes.split(/\s+/)[0] || antes;
}

function msDe(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v > 0 ? v : null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'object') {
    const o = v as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
    if (typeof o.toMillis === 'function') {
      const n = o.toMillis();
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (typeof o.toDate === 'function') {
      const d = o.toDate();
      return d && !Number.isNaN(d.getTime()) ? d.getTime() : null;
    }
    if (typeof o.seconds === 'number') return o.seconds > 0 ? o.seconds * 1000 : null;
  }
  if (typeof v === 'string') {
    if (/^\d{1,2}:\d{2}$/.test(v.trim())) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}

function hmAr(ms: number): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(ms));
}

export function esOpsCoverageDoc(t: TurnoDiaIn | null | undefined): boolean {
  if (!t || t.isDeleted || t.coverageSuperseded === true) return false;
  if (String(t.status || '').toUpperCase() === 'CANCELLED') return false;
  return String(t.origin || '').toUpperCase() === 'OPERATIONS_COVERAGE';
}

function codigoDe(tipo: string | null | undefined, code: string | null | undefined): string | null {
  const t = String(tipo || '').trim().toUpperCase();
  if (t === 'EXTEND' || t === 'EXTENSION' || t === 'EXT') return 'EXT';
  if (t === 'ADVANCE' || t === 'EARLY_START' || t === 'ADV') return 'ADV';
  if (t === 'SUBSTITUTE' || t === 'SPLIT' || t === 'COBERTURA' || t === 'RETENCION' || !t) {
    const c = String(code || '').trim().toUpperCase();
    return c && c.length <= 6 ? c : null;
  }
  return t;
}

function tramoFaltante(tipo: string | null, start: unknown, end: unknown): string | null {
  const a = msDe(start);
  const b0 = msDe(end);
  if (!a || !b0 || !tipo) return null;
  const b = b0 <= a ? b0 + 86400000 : b0;
  const mid = a + Math.round((b - a) / 2);
  const t = tipo.toUpperCase();
  if (t === 'EXT' || t === 'EXTEND' || t === 'EXTENSION') return `${hmAr(mid)}–${hmAr(b)}`;
  if (t === 'ADV' || t === 'ADVANCE' || t === 'EARLY_START') return `${hmAr(a)}–${hmAr(mid)}`;
  return null;
}

function textoOps(p: {
  estado: 'CUBIERTO' | 'PARCIAL';
  nombre: string;
  codigo: string | null;
  desdeHm: string | null;
  tramoFaltante: string | null;
}): string {
  const quien = apellidoCorto(p.nombre) || p.nombre || 'alguien';
  const tipo = p.codigo ? ` (${p.codigo})` : '';
  if (p.estado === 'PARCIAL') {
    return `Parcial · ${quien}${tipo} · ${p.tramoFaltante ? `falta ${p.tramoFaltante}` : 'falta un tramo'}`;
  }
  return `Cubierto · ${quien}${tipo} · desde Operaciones${p.desdeHm ? ` ${p.desdeHm}` : ''}`;
}

function ligaOps(t: TurnoDiaIn, titularShiftId: string, titularEmp: string): boolean {
  if (!esOpsCoverageDoc(t)) return false;
  if (titularShiftId && (String(t.absenceShiftId || '') === titularShiftId || String(t.coveredShiftId || '') === titularShiftId)) return true;
  if (String(t.coverageDocId || '') && titularShiftId && String(t.id || '') === String(t.coverageDocId)) return true;
  return !!titularEmp && String(t.coversEmployeeId || '') === titularEmp;
}

function opsDe(titular: TurnoDiaIn | null, turnos: TurnoDiaIn[], titularEmp: string): Extract<CoberturaExistente, { origen: 'operaciones' }> | null {
  const titularId = String(titular?.id || '').trim();
  const docs = turnos.filter((t) => ligaOps(t, titularId, titularEmp) || (titular?.coverageDocId && String(t.id || '') === String(titular.coverageDocId) && esOpsCoverageDoc(t)));
  const st = String(titular?.coverageStatus || '').toUpperCase();
  const tipo = String(titular?.coverageType || '').toUpperCase();
  const esPlan = tipo === 'SUBSTITUTE' || tipo === 'SPLIT';
  const tipoOps = ['REF', 'ESC', 'FT', 'RET', 'EXT', 'EXTEND', 'EXTENSION', 'ADV', 'ADVANCE', 'EARLY_START', 'COBERTURA'].includes(tipo);
  const marcaOps = !esPlan && (
    titular?.operacionallyCovered === true
    || String(titular?.resolvedBy || '').toUpperCase() === 'OPERACIONES'
    || st === 'PARTIAL'
    || docs.length > 0
    || (st === 'COVERED' && tipoOps)
    || String(titular?.coverageDocId || '').startsWith('ops_cov_')
  );
  if (!marcaOps) return null;
  const doc = docs[0] || null;
  const nombre = String(titular?.coveredByEmployeeName || '').trim()
    || (!String(titular?.coveredBy || '').includes(' ext ') ? String(titular?.coveredBy || '').trim() : '')
    || String(doc?.employeeName || '').trim();
  const tipoRaw = String(titular?.coverageType || doc?.coverageType || doc?.code || '').trim();
  const codigo = codigoDe(tipoRaw, doc?.code || titular?.code);
  const desdeMs = msDe(doc?.checkInAt) || msDe(doc?.realStartTime) || msDe(titular?.coveredAt) || msDe(doc?.startTime);
  const estado: 'CUBIERTO' | 'PARCIAL' = st === 'PARTIAL' ? 'PARCIAL' : 'CUBIERTO';
  const falta = estado === 'PARCIAL' ? tramoFaltante(codigo, titular?.startTime, titular?.endTime) : null;
  const out = {
    origen: 'operaciones' as const,
    estado,
    nombre: nombre || 'Operaciones',
    codigo,
    desdeHm: desdeMs ? hmAr(desdeMs) : null,
    tramoFaltante: falta,
    employeeId: String(titular?.coveredByEmployeeId || doc?.employeeId || '').trim() || null,
    texto: '',
  };
  out.texto = textoOps(out);
  return out;
}

function planificadaDe(titular: TurnoDiaIn | null, turnos: TurnoDiaIn[], titularEmp: string, titularName: string): Extract<CoberturaExistente, { origen: 'planificada' }> | null {
  const needle = titularName ? `Cubriendo a ${titularName}` : '';
  const hermanos = turnos.filter((t) => {
    if (!t || t.isDeleted || String(t.employeeId || '') === titularEmp) return false;
    if (esOpsCoverageDoc(t)) return false;
    if (titularEmp && String(t.coversEmployeeId || '') === titularEmp) return true;
    return !!needle && String(t.comments || '').includes(needle);
  });
  const ext = hermanos.find((h) => h.isExtended === true || String(h.coverageSegmentRole || '').toUpperCase() === 'EXTENSION');
  const adel = hermanos.find((h) => h !== ext && (h.isEarlyStart === true || String(h.coverageSegmentRole || '').toUpperCase() === 'EARLY_START'));
  const tipo = String(titular?.coverageType || '').toUpperCase();
  if ((tipo === 'SPLIT' || (ext && adel)) && ext?.employeeId && (adel?.employeeId || hermanos.find((h) => h !== ext)?.employeeId)) {
    const segundo = adel || hermanos.find((h) => h !== ext)!;
    const cobertura: Exclude<VacancyDayCoverage, { mode: 'none' }> = {
      mode: 'split',
      extEmpId: String(ext.employeeId),
      adelEmpId: String(segundo.employeeId),
      gapBand: String(titular?.originalCode || ext.code || 'M').toUpperCase(),
      gapPosition: String(titular?.originalPositionName || ext.positionName || titular?.positionName || 'General'),
    };
    const a = apellidoCorto(String(ext.employeeName || ext.employeeId));
    const b = apellidoCorto(String(segundo.employeeName || segundo.employeeId));
    return { origen: 'planificada', cobertura, texto: `Ext+Adel · ${a} / ${b}` };
  }
  const uno = hermanos.find((h) => h.employeeId) || null;
  const empId = String(uno?.employeeId || (tipo === 'SUBSTITUTE' ? titular?.coveredByEmployeeId : '') || '').trim();
  const nombre = String(uno?.employeeName || titular?.coveredBy || '').trim();
  if (!empId && !nombre) return null;
  if (!empId) return null;
  return {
    origen: 'planificada',
    cobertura: { mode: 'substitute', employeeId: empId },
    texto: `Suplente · ${apellidoCorto(nombre || empId)}`,
  };
}

function consultaDe(consulta: ConsultaResumenIn | null | undefined): Extract<CoberturaExistente, { origen: 'consulta' }> | null {
  if (!consulta) return null;
  const acepto = (consulta.respuestas || []).find((r) => r.estado === 'ASIGNADO');
  if (acepto) return { origen: 'consulta', status: 'ACEPTO', texto: `${apellidoCorto(acepto.nombre)} aceptó${acepto.hora ? ` ${acepto.hora}` : ''}` };
  if (consulta.status === 'ABIERTA') return { origen: 'consulta', status: 'ABIERTA', texto: 'Consultando' };
  return null;
}

/**
 * Qué cobertura ya tiene ese día, en este orden: Operaciones completa, consulta aceptada o
 * abierta, Operaciones parcial, planificada del cronograma.
 */
export function coberturaExistenteDelDia(p: {
  titularEmployeeId: string;
  titularName?: string | null;
  date: string;
  titular?: TurnoDiaIn | null;
  turnosDelDia?: TurnoDiaIn[] | null;
  consulta?: ConsultaResumenIn | null;
}): CoberturaExistente {
  const emp = String(p.titularEmployeeId || '').trim();
  const titular = p.titular || null;
  const turnos = p.turnosDelDia || [];
  const ops = opsDe(titular, turnos, emp);
  if (ops?.estado === 'CUBIERTO') return ops;
  const consulta = consultaDe(p.consulta);
  if (consulta) return consulta;
  if (ops) return ops;
  return planificadaDe(titular, turnos, emp, String(p.titularName || '').trim()) || { origen: 'ninguna' };
}

export function recolectarTurnosDelDia(p: {
  date: string;
  titularEmployeeId: string;
  shiftsMap: Record<string, TurnoDiaIn | null | undefined>;
  cellTurnosMap: Record<string, TurnoDiaIn[] | null | undefined>;
  pendingChanges: Record<string, TurnoDiaIn | null | undefined>;
}): { titular: TurnoDiaIn | null; turnos: TurnoDiaIn[] } {
  const sufijo = `_${p.date}`;
  const empDe = (key: string) => (key.endsWith(sufijo) ? key.slice(0, -sufijo.length) : '');
  const porEmpleado = new Map<string, TurnoDiaIn[]>();
  for (const [key, arr] of Object.entries(p.cellTurnosMap || {})) {
    if (!key.endsWith(sufijo)) continue;
    const emp = empDe(key);
    const list = porEmpleado.get(emp) || [];
    for (const t of arr || []) list.push({ ...t, employeeId: t.employeeId || emp });
    porEmpleado.set(emp, list);
  }
  for (const [key, raw] of Object.entries(p.pendingChanges || {})) {
    if (!key.endsWith(sufijo) || !raw || raw.isDeleted) continue;
    const emp = empDe(key);
    const previos = (porEmpleado.get(emp) || []).filter((t) => esOpsCoverageDoc(t));
    porEmpleado.set(emp, [...previos, { ...raw, employeeId: raw.employeeId || emp }]);
  }
  const titularKey = `${p.titularEmployeeId}${sufijo}`;
  const persisted = p.shiftsMap?.[titularKey] || null;
  const pending = p.pendingChanges?.[titularKey];
  const titular = pending && !pending.isDeleted
    ? { ...(persisted || {}), ...pending, id: persisted?.id || pending.id, employeeId: p.titularEmployeeId }
    : (pending?.isDeleted ? null : (persisted ? { ...persisted, employeeId: persisted.employeeId || p.titularEmployeeId } : null));
  return { titular, turnos: [...porEmpleado.values()].flat() };
}

export function coberturaInicialPlanificada(
  dias: readonly string[],
  leer: (date: string) => CoberturaExistente,
): Record<string, VacancyDayCoverage> {
  const out: Record<string, VacancyDayCoverage> = {};
  for (const d of dias) {
    const ex = leer(d);
    if (ex.origen === 'planificada') out[d] = ex.cobertura;
  }
  return out;
}

function clave(c: VacancyDayCoverage | undefined): string {
  if (!c || c.mode === 'none') return 'none';
  if (c.mode === 'substitute') return `S:${c.employeeId}`;
  return `X:${c.extEmpId}|${c.adelEmpId}|${c.gapBand}|${c.gapPosition}`;
}

export function draftDeCobertura(
  override: VacancyDayCoverage | undefined,
  existente: CoberturaExistente,
): DraftCobertura {
  if (override?.mode === 'none') return 'quitada';
  if (!override || !vacancyDayHasCoverage(override)) return 'none';
  if (existente.origen === 'planificada' && clave(override) === clave(existente.cobertura)) return 'igual';
  return 'nuevo';
}

/**
 * Todos los días activos ya cubiertos (Operaciones, consulta o plan sin cambios) → «Cerrar».
 * Un borrador nuevo o una cobertura planificada quitada → «Confirmar cobertura».
 * Algún día activo sin nada → «Dejar vacante».
 */
export function decisionPrincipalCobertura(dias: readonly DecisionDia[]): 'cerrar' | 'confirmar' | 'vacante' {
  const activos = dias.filter((d) => d.activo);
  if (activos.some((d) => d.draft === 'nuevo' || d.draft === 'quitada')) return 'confirmar';
  if (activos.some((d) => d.draft === 'none' && !d.ops && !d.consulta && !d.planificada)) return 'vacante';
  return 'cerrar';
}

export function textoDecisionCobertura(decision: 'cerrar' | 'confirmar' | 'vacante'): string {
  if (decision === 'confirmar') return 'Confirmar cobertura';
  if (decision === 'vacante') return 'Dejar vacante';
  return 'Cerrar';
}

/** Un hueco ya cubierto por Operaciones no se vuelve a ofrecer. El parcial sí: falta un tramo. */
export function seOfreceParaCubrir(existente: CoberturaExistente): boolean {
  return !(existente.origen === 'operaciones' && existente.estado === 'CUBIERTO');
}

const NO_ES_TURNO_DE_TRABAJO = new Set(['V', 'L', 'PG', 'A', 'E', 'AA', 'ART', 'F', 'FF', 'FP', 'FT', 'SGS', 'SUS', 'LT', 'PAST', 'LOCKED']);

function esTurnoDeTrabajo(code: unknown): boolean {
  const c = String(code || '').trim().toUpperCase();
  return !!c && c.length <= 8 && !NO_ES_TURNO_DE_TRABAJO.has(c);
}

function horasGuardadas(v: unknown): number | null {
  const n = Number(v);
  return n > 0 && n <= 16 ? Math.round(n * 100) / 100 : null;
}

/** Horario real del doc. `00:00–00:00` no cuenta: es el placeholder de una novedad. */
function horarioDe(start: unknown, end: unknown): { label: string; hours: number } | null {
  const hm = (v: unknown): string | null => {
    if (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v.trim())) {
      const [h, m] = v.trim().split(':');
      return `${h.padStart(2, '0')}:${m}`;
    }
    const ms = msDe(v);
    return ms ? hmAr(ms) : null;
  };
  const a = hm(start);
  const b = hm(end);
  if (!a || !b || (a === '00:00' && b === '00:00')) return null;
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  let mins = (bh * 60 + bm) - (ah * 60 + am);
  if (mins <= 0) mins += 24 * 60;
  if (mins > 16 * 60) return null;
  return { label: `${a}–${b}`, hours: Math.round((mins / 60) * 100) / 100 };
}

function horasDelTurno(guardadas: unknown, horario: { hours: number } | null): number {
  const stored = horasGuardadas(guardadas);
  if (stored != null && horario && Math.abs(stored - horario.hours) < 0.2) return stored;
  if (horario) return horario.hours;
  return stored ?? 0;
}

export type TurnoQueTenia = {
  code: string;
  positionName: string;
  scheduleLabel: string;
  hours: number;
};

export type AusenciaDiaIn = {
  shiftId?: string | null;
  type?: string | null;
  status?: string | null;
  revisionEstado?: string | null;
  absenceType?: string | null;
  avisoPortal?: boolean;
  source?: string | null;
};

export type ResumenAusenciaDia = {
  turno: TurnoQueTenia | null;
  cobertura: CoberturaExistente;
  /** Línea de la tarjeta. Null si no hay cobertura. */
  cubiertoPor: string | null;
  esOperaciones: boolean;
  nota: string;
  tipoNovedad: string;
  estadoNovedad: string;
};

export const TEXTO_LO_CUBRIO_OPERACIONES = 'Lo cubrió Operaciones. Para cambiarlo, hacelo desde Operaciones.';

function turnoPorId(turnos: TurnoDiaIn[], id: string): TurnoDiaIn | null {
  const sid = String(id || '').trim();
  if (!sid) return null;
  return turnos.find((t) => String(t.id || '') === sid && !esOpsCoverageDoc(t)) || null;
}

function titularDelDia(p: {
  titularEmployeeId: string;
  titular?: TurnoDiaIn | null;
  turnosDelDia?: TurnoDiaIn[] | null;
  ausencia?: AusenciaDiaIn | null;
}): TurnoDiaIn | null {
  if (p.titular && !esOpsCoverageDoc(p.titular)) return p.titular;
  const turnos = p.turnosDelDia || [];
  const porAusencia = turnoPorId(turnos, String(p.ausencia?.shiftId || ''));
  if (porAusencia) return porAusencia;
  const emp = String(p.titularEmployeeId || '').trim();
  return turnos.find((t) => String(t.employeeId || '') === emp && !esOpsCoverageDoc(t)) || null;
}

function bandaDelOps(ops: TurnoDiaIn | null): string | null {
  if (!ops) return null;
  const code = String(ops.code || ops.coversBandCode || '').trim().toUpperCase();
  const tipo = String(ops.codigoOriginal || ops.coverageType || '').trim().toUpperCase();
  if (!esTurnoDeTrabajo(code)) return null;
  if (tipo && code === tipo) return null;
  return code;
}

function turnoQueTenia(titular: TurnoDiaIn | null, turnos: TurnoDiaIn[], titularEmp: string): TurnoQueTenia | null {
  const titularId = String(titular?.id || '').trim();
  const ops = turnos.find((t) => ligaOps(t, titularId, titularEmp) || (titular?.coverageDocId && String(t.id || '') === String(titular.coverageDocId) && esOpsCoverageDoc(t))) || null;
  const code = (esTurnoDeTrabajo(titular?.originalCode) ? String(titular?.originalCode).toUpperCase() : '')
    || (esTurnoDeTrabajo(titular?.code) ? String(titular?.code).toUpperCase() : '')
    || (esTurnoDeTrabajo(titular?.deploymentBand) ? String(titular?.deploymentBand).toUpperCase() : '')
    || bandaDelOps(ops)
    || '';
  const positionName = String(titular?.originalPositionName || titular?.positionName || ops?.positionName || ops?.originalPositionName || '').trim();
  const horario = horarioDe(titular?.startTime, titular?.endTime) || horarioDe(ops?.startTime, ops?.endTime);
  const hours = horasDelTurno(titular?.hours ?? ops?.hours, horario);
  if (!code && !horario && !positionName) return null;
  return {
    code: code || '—',
    positionName: positionName || 'General',
    scheduleLabel: horario?.label || '—',
    hours,
  };
}

function apellidoDeTurno(turnos: TurnoDiaIn[], empId: string): string {
  const t = turnos.find((x) => String(x.employeeId || '') === empId);
  return apellidoCorto(String(t?.employeeName || empId)) || empId;
}

function codigoDeTurno(turnos: TurnoDiaIn[], empId: string): string {
  const t = turnos.find((x) => String(x.employeeId || '') === empId && !esOpsCoverageDoc(x));
  return String(t?.code || '').trim().toUpperCase();
}

function lineaCubierto(ex: CoberturaExistente, turnos: TurnoDiaIn[]): string | null {
  if (ex.origen === 'operaciones') {
    if (ex.estado === 'PARCIAL') {
      const tipo = ex.codigo ? ` (${ex.codigo})` : '';
      return `Parcial · ${ex.nombre}${tipo}${ex.tramoFaltante ? ` · falta ${ex.tramoFaltante}` : ''}`;
    }
    return [ex.nombre, ex.codigo, `desde Operaciones${ex.desdeHm ? ` ${ex.desdeHm}` : ''}`].filter(Boolean).join(' · ');
  }
  if (ex.origen === 'planificada') {
    if (ex.cobertura.mode === 'split') {
      return `${apellidoDeTurno(turnos, ex.cobertura.extEmpId)} (ext) · ${apellidoDeTurno(turnos, ex.cobertura.adelEmpId)} (adel)`;
    }
    const code = codigoDeTurno(turnos, ex.cobertura.employeeId);
    return `${apellidoDeTurno(turnos, ex.cobertura.employeeId)}${code ? ` (${code})` : ''} · planificada`;
  }
  if (ex.origen === 'consulta') return ex.texto;
  return null;
}

/** Estado real de la ausencia. El aviso del portal no se muestra como Autorizada. */
export function estadoNovedadAusencia(ausencia: AusenciaDiaIn | null | undefined): { tipo: string; estado: string } {
  if (!ausencia) return { tipo: '', estado: '' };
  const tipoRaw = String(ausencia.type || '').trim();
  const status = String(ausencia.status || '').trim();
  const rev = String(ausencia.revisionEstado || '').toUpperCase();
  const esAviso = ausencia.avisoPortal === true || tipoRaw === 'Ausencia con aviso' || status === 'Avisada';
  if (esAviso) {
    if (rev === 'JUSTIFICADA') {
      return { tipo: tipoRaw && tipoRaw !== 'Ausencia con aviso' ? tipoRaw : 'Ausencia con aviso', estado: status === 'En verificación' ? 'En verificación' : (status && status !== 'Avisada' ? status : 'Justificada') };
    }
    if (rev === 'INJUSTIFICADA') return { tipo: 'Ausencia con aviso', estado: 'Injustificada' };
    if (rev === 'POR_REVISAR' || status === 'Avisada' || status === 'Pendiente' || status === '') {
      return { tipo: 'Ausencia con aviso', estado: 'Avisada · Por revisar' };
    }
    return { tipo: 'Ausencia con aviso', estado: status };
  }
  return { tipo: tipoRaw, estado: status };
}

/**
 * Lo que muestran la tarjeta del clic izquierdo y el modal para un día de ausencia:
 * el turno que tenía el titular y la cobertura que ya existe. Misma función en las dos.
 */
export function resumenAusenciaDia(p: {
  titularEmployeeId: string;
  titularName?: string | null;
  date: string;
  titular?: TurnoDiaIn | null;
  turnosDelDia?: TurnoDiaIn[] | null;
  ausencia?: AusenciaDiaIn | null;
  consulta?: ConsultaResumenIn | null;
}): ResumenAusenciaDia {
  const emp = String(p.titularEmployeeId || '').trim();
  const turnos = p.turnosDelDia || [];
  const titular = titularDelDia(p);
  const cobertura = coberturaExistenteDelDia({
    titularEmployeeId: emp,
    titularName: p.titularName,
    date: p.date,
    titular,
    turnosDelDia: turnos,
    consulta: p.consulta,
  });
  const novedad = estadoNovedadAusencia(p.ausencia);
  const esOperaciones = cobertura.origen === 'operaciones' && cobertura.estado === 'CUBIERTO';
  return {
    turno: turnoQueTenia(titular, turnos, emp),
    cobertura,
    cubiertoPor: lineaCubierto(cobertura, turnos),
    esOperaciones,
    nota: esOperaciones ? TEXTO_LO_CUBRIO_OPERACIONES : '',
    tipoNovedad: novedad.tipo,
    estadoNovedad: novedad.estado,
  };
}
