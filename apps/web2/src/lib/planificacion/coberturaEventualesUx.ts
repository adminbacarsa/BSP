/**
 * Solapa «Eventuales (bolsa)» del modal de cobertura: dos modos (preguntar o asignar directo),
 * elegibles arriba y bloqueados aparte, y el estado de la consulta en el resumen del día.
 * Sin Firestore: lo que decide la pantalla se prueba acá.
 */

export type ModoEventuales = 'preguntar' | 'asignar';

export const ESPERA_OPCIONES: { minutos: number; label: string }[] = [
  { minutos: 30, label: '30 min' },
  { minutos: 60, label: '1 h' },
  { minutos: 120, label: '2 h' },
  { minutos: 0, label: 'hasta el inicio' },
];
export const ESPERA_DEFAULT_MIN = 30;

export const TEXTO_MODO_PREGUNTAR = 'Se les manda la consulta a la app. El primero que acepte queda como suplente.';
export const TEXTO_MODO_ASIGNAR = 'No se le pregunta: al tocar la tarjeta queda asignado.';

type CandidatoBase = { elegible: boolean; motivoCodigo?: string | null };

const MOTIVOS_TOPE = new Set(['TOPE_HORAS', 'TOPE_CERCA']);

/** Elegibles primero. Los bloqueados van a «No disponibles»; los del tope siguen en su propia línea. */
export function separarCandidatos<T extends CandidatoBase>(rows: T[]): { elegibles: T[]; noDisponibles: T[]; ocultosTope: T[] } {
  const elegibles: T[] = [];
  const noDisponibles: T[] = [];
  const ocultosTope: T[] = [];
  for (const r of rows) {
    if (MOTIVOS_TOPE.has(String(r.motivoCodigo || ''))) ocultosTope.push(r);
    else if (r.elegible) elegibles.push(r);
    else noDisponibles.push(r);
  }
  return { elegibles, noDisponibles, ocultosTope };
}

export function textoNoDisponibles(n: number): string {
  return `No disponibles (${n})`;
}

const ACCION_POR_MOTIVO: Record<string, string> = {
  SIN_MARCO: 'Cargar marco',
  CREDENCIAL_VENCIDA: 'Cargar vencimiento de credencial',
  APTO_VENCIDO: 'Cargar apto psicofísico',
  NO_APTO: 'Ver ficha',
  HABILITACION_VENCIDA: 'Cargar habilitación 9236',
  EMPRESA_NO_HABILITADA: 'Habilitar en la empresa',
  NO_DISPONIBLE: 'Ver ficha',
};

/** Lo que resuelve el bloqueo desde la ficha; null si no se resuelve ahí (superposición, descanso, género). */
export function accionParaMotivo(motivoCodigo: string | null | undefined): string | null {
  return ACCION_POR_MOTIVO[String(motivoCodigo || '')] || null;
}

export function linkFichaEventual(cuil: string): string {
  return `/admin/rrhh/eventuales/?cuil=${encodeURIComponent(String(cuil || ''))}`;
}

export type JornadaCorta = { fecha: string; code?: string | null; horaInicio: string; horaFin: string; horas?: number };

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function ddmm(fecha: string): string {
  const [, m, d] = String(fecha || '').split('-');
  return d && m ? `${d}/${m}` : String(fecha || '');
}

function ordenarJornadas<T extends { fecha: string }>(jornadas: T[]): T[] {
  return [...jornadas].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

function horasReloj(j: { horaInicio?: string; horaFin?: string }): number {
  const ini = String(j.horaInicio || '').slice(0, 5).split(':').map(Number);
  const fin = String(j.horaFin || '').slice(0, 5).split(':').map(Number);
  if (ini.length < 2 || fin.length < 2 || ini.some((n) => !Number.isFinite(n)) || fin.some((n) => !Number.isFinite(n))) return 0;
  let span = (fin[0] * 60 + fin[1]) - (ini[0] * 60 + ini[1]);
  if (span <= 0) span += 24 * 60;
  return Math.round((span / 60) * 100) / 100;
}

function fmtHoras(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isFinite(r) ? String(r) : '0';
}

export function horasDeJornadaCorta(j: JornadaCorta): number {
  const directo = Number(j.horas);
  if (Number.isFinite(directo) && directo > 0) return Math.round(directo * 100) / 100;
  return horasReloj(j);
}

/** Suma de las jornadas del bloque (las horas del turno, o el reloj si faltan). */
export function horasDelBloque(jornadas: JornadaCorta[]): number {
  return Math.round(jornadas.reduce((acc, j) => acc + horasDeJornadaCorta(j), 0) * 100) / 100;
}

export function textoHorasBloque(horas: number): string {
  return horas > 0 ? `El bloque suma ${fmtHoras(horas)} h` : '';
}

function nombreMes(yyyyMm: string): string {
  const [y, m] = String(yyyyMm || '').split('-');
  const nombre = MESES[Number(m) - 1] || yyyyMm;
  return y ? `${nombre} ${y}` : nombre;
}

/** Meses calendario distintos. Un bloque que cruza de mes son dos contratos (cada mes, su alta). */
export function textoDosContratos(jornadas: JornadaCorta[]): string | null {
  const porMes = new Map<string, number>();
  for (const j of jornadas) {
    const mes = String(j.fecha || '').slice(0, 7);
    if (mes.length < 7) continue;
    porMes.set(mes, (porMes.get(mes) || 0) + horasDeJornadaCorta(j));
  }
  const meses = [...porMes.keys()].sort();
  if (meses.length < 2) return null;
  const partes = meses.map((mes) => `${nombreMes(mes)} ${fmtHoras(porMes.get(mes) || 0)} h`);
  if (meses.length === 2) return `Son dos contratos (${partes[0]} y ${partes[1]}).`;
  return `Son ${meses.length} contratos (${partes.join(', ')}).`;
}

export function textoJornadaCorta(j: JornadaCorta): string {
  const dia = ddmm(j.fecha);
  const code = String(j.code || '').trim();
  return `${dia} · ${code ? `${code} ` : ''}${String(j.horaInicio || '').slice(0, 5)}–${String(j.horaFin || '').slice(0, 5)}`;
}

function horarioDelBloque(jornadas: JornadaCorta[]): string {
  const clave = (j: JornadaCorta) => `${String(j.code || '').trim().toUpperCase()}|${String(j.horaInicio || '').slice(0, 5)}|${String(j.horaFin || '').slice(0, 5)}`;
  const primero = jornadas[0];
  if (jornadas.every((j) => clave(j) === clave(primero))) {
    const code = String(primero.code || '').trim();
    return `${code ? `${code} ` : ''}${String(primero.horaInicio || '').slice(0, 5)}–${String(primero.horaFin || '').slice(0, 5)}`;
  }
  return jornadas.map(textoJornadaCorta).join(' · ');
}

/**
 * Siempre un lugar: el primero que acepte cubre.
 * Con varios días la consulta es el bloque entero (06/10 → 15/10). Si los horarios difieren, se listan.
 */
export function textoBarraPreguntar(n: number, jornadas: JornadaCorta[]): string {
  if (n <= 0) return 'Marcá a quién preguntar';
  const orden = ordenarJornadas(jornadas);
  if (orden.length <= 1) {
    return `Preguntar a ${n} · el primero que acepte cubre ${orden[0] ? textoJornadaCorta(orden[0]) : 'el turno'}`;
  }
  const desde = ddmm(orden[0].fecha);
  const hasta = ddmm(orden[orden.length - 1].fecha);
  const contratos = textoDosContratos(orden);
  const base = `Preguntar a ${n} · El primero que acepte cubre los ${orden.length} días marcados (${desde} → ${hasta}) · ${horarioDelBloque(orden)}`;
  return contratos ? `${base} · ${contratos.replace(/\.$/, '')}` : base;
}

/**
 * Marca de la tarjeta: el bloque (mismo mes) no entra en el tope.
 * Si cruza de mes, el tope lo resuelve el servidor por período; acá no se suma todo contra un solo mes.
 */
export function textoTopeBloque(
  horasMes: { usadas: number; tope: number } | null | undefined,
  jornadas: JornadaCorta[],
): string | null {
  if (!horasMes || !(Number(horasMes.tope) > 0) || jornadas.length === 0) return null;
  const meses = new Set(jornadas.map((j) => String(j.fecha || '').slice(0, 7)).filter((m) => m.length >= 7));
  if (meses.size !== 1) return null;
  const horas = horasDelBloque(jornadas);
  if (!(horas > 0)) return null;
  if (Number(horasMes.usadas) + horas <= Number(horasMes.tope) + 1e-9) return null;
  return `El bloque (${fmtHoras(horas)} h) no entra en el tope (${fmtHoras(Number(horasMes.usadas))}/${fmtHoras(Number(horasMes.tope))} h)`;
}

export function textoBotonEnviar(n: number): string {
  return n > 0 ? `Enviar consulta (${n})` : 'Marcá a quién preguntar';
}

export function apellidoDe(nombre: string): string {
  return String(nombre || '').split(',')[0].trim() || String(nombre || '').trim();
}

export function textoConfirmarAsignacion(nombre: string): string {
  return `Asignar a ${apellidoDe(nombre)} sin preguntarle. Se arma el contrato y el alta ARCA al guardar.`;
}

export type ConsultaResumenIn = {
  status: string;
  venceAtMs?: number | null;
  jornadas?: { fecha: string }[];
  respuestas: { nombre: string; estado: string; hora?: string | null }[];
};

export function horaArDe(ms: number | null | undefined): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(n));
}

/** Consultas de ese día: la abierta manda; si no, la que tenga un sí; si no, la última. */
export function consultaDelDia<T extends ConsultaResumenIn>(consultas: T[], fecha: string): T | null {
  const delDia = consultas.filter((c) => (c.jornadas || []).some((j) => j.fecha === fecha));
  if (!delDia.length) return null;
  return delDia.find((c) => c.status === 'ABIERTA')
    || delDia.find((c) => c.respuestas.some((r) => r.estado === 'ASIGNADO'))
    || delDia[delDia.length - 1];
}

/**
 * Línea del resumen del día: «Consultados: 3 · esperando respuesta (vence 11:15)»
 * y, cuando alguien acepta, «ABALLAY aceptó 10:42 → suplente».
 */
export function resumenConsultaDia(consulta: ConsultaResumenIn | null | undefined): string | null {
  if (!consulta) return null;
  const respuestas = consulta.respuestas || [];
  const aceptaron = respuestas.filter((r) => r.estado === 'ASIGNADO');
  if (aceptaron.length) {
    return aceptaron.map((r) => `${apellidoDe(r.nombre)} aceptó${r.hora ? ` ${r.hora}` : ''} → suplente`).join(' · ');
  }
  const n = respuestas.length;
  const no = respuestas.filter((r) => r.estado === 'NO').length;
  const noTxt = no ? ` · ${no} no` : '';
  if (consulta.status === 'ABIERTA') {
    const vence = horaArDe(consulta.venceAtMs);
    return `Consultados: ${n} · esperando respuesta${vence ? ` (vence ${vence})` : ''}${noTxt}`;
  }
  if (consulta.status === 'VENCIDA') return `Consultados: ${n} · venció sin respuesta${noTxt}`;
  return `Consultados: ${n} · sin suplente${noTxt}`;
}

const AUSENCIA_LOCAL = new Set(['V', 'L', 'E', 'A', 'AA', 'PG', 'ART', 'SGS', 'SUS']);

export type JornadaConsulta = { fecha: string; code?: string; horaInicio?: string; horaFin?: string };

export type ConsultaCurso = ConsultaResumenIn & {
  id: string;
  positionName?: string | null;
  objectiveName?: string | null;
  titularEmployeeId?: string | null;
  jornadas?: JornadaConsulta[];
};

export function fechaDeClavePendiente(key: string): { empId: string; fecha: string } | null {
  const m = key.match(/^(.*)_(\d{4}-\d{2}-\d{2})$/);
  if (!m) return null;
  return { empId: m[1], fecha: m[2] };
}

export function diaLoResuelveConsulta(consultas: ConsultaResumenIn[], fecha: string): boolean {
  return consultas.some((c) => c.status === 'ABIERTA' && (c.jornadas || []).some((j) => j.fecha === fecha));
}

/** Celda del titular (o, si la consulta no trae titular, la celda de licencia de ese día). */
export function consultaAbiertaEnFecha<T extends ConsultaResumenIn & { titularEmployeeId?: string | null }>(
  consultas: T[],
  fecha: string,
  empId?: string | null,
  codigoCelda?: string | null,
): T | null {
  const delDia = consultas.filter((c) => c.status === 'ABIERTA' && (c.jornadas || []).some((j) => j.fecha === fecha));
  if (!delDia.length) return null;
  if (!empId) return delDia[0];
  const propia = delDia.find((c) => c.titularEmployeeId && c.titularEmployeeId === empId);
  if (propia) return propia;
  const sinTitular = delDia.filter((c) => !c.titularEmployeeId);
  if (!sinTitular.length) return null;
  const code = String(codigoCelda || '').toUpperCase();
  return AUSENCIA_LOCAL.has(code) ? sinTitular[0] : null;
}

export function textoIndicadorConsulta(consulta: ConsultaResumenIn | null | undefined): string {
  if (!consulta) return '';
  const vence = horaArDe(consulta.venceAtMs);
  return vence ? `Consulta enviada · vence ${vence}` : 'Consulta enviada';
}

export function textoTooltipConsulta(consulta: ConsultaResumenIn): string {
  const lineas = (consulta.respuestas || []).map((r) => {
    const nombre = apellidoDe(r.nombre);
    if (r.estado === 'ASIGNADO') return `${nombre} aceptó${r.hora ? ` ${r.hora}` : ''}`;
    if (r.estado === 'NO') return `${nombre} no`;
    if (r.estado === 'CANCELADA') return `${nombre} · ya no hace falta`;
    return `${nombre} esperando`;
  });
  return [textoIndicadorConsulta(consulta), ...lineas].filter(Boolean).join('\n');
}

function esAusenciaDelTitular(
  empId: string,
  change: { code?: string; isDeleted?: boolean } | null | undefined,
  delDia: { titularEmployeeId?: string | null }[],
): boolean {
  if (!change || change.isDeleted) return false;
  const code = String(change.code || '').toUpperCase();
  if (!AUSENCIA_LOCAL.has(code)) return false;
  return delDia.some((c) => !c.titularEmployeeId || c.titularEmployeeId === empId);
}

/**
 * Saca del borrador local el turno de cobertura de un día con consulta abierta.
 * La ausencia del titular se conserva: es otro documento y no pisa el turno del eventual.
 */
export function quitarBorradorQuePisaConsulta<T extends Record<string, any>>(
  changes: T,
  consultas: (ConsultaResumenIn & { titularEmployeeId?: string | null })[],
): { changes: T; quitadas: string[] } {
  const abiertas = consultas.filter((c) => c.status === 'ABIERTA');
  const next = { ...changes } as T;
  const quitadas: string[] = [];
  for (const key of Object.keys(next)) {
    const parsed = fechaDeClavePendiente(key);
    if (!parsed) continue;
    const delDia = abiertas.filter((c) => (c.jornadas || []).some((j) => j.fecha === parsed.fecha));
    if (!delDia.length) continue;
    if (esAusenciaDelTitular(parsed.empId, next[key], delDia)) continue;
    delete next[key];
    quitadas.push(key);
  }
  return { changes: next, quitadas };
}

export function cambiosManualesSobreConsulta(
  prev: Record<string, any>,
  next: Record<string, any>,
  consultas: (ConsultaResumenIn & { id: string; titularEmployeeId?: string | null })[],
): { key: string; consultaId: string; fecha: string }[] {
  const abiertas = consultas.filter((c) => c.status === 'ABIERTA' && c.id);
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const out: { key: string; consultaId: string; fecha: string }[] = [];
  for (const key of keys) {
    if (JSON.stringify(prev[key] ?? null) === JSON.stringify(next[key] ?? null)) continue;
    const parsed = fechaDeClavePendiente(key);
    if (!parsed) continue;
    const delDia = abiertas.filter((c) => (c.jornadas || []).some((j) => j.fecha === parsed.fecha));
    const propia = delDia.find((c) => !c.titularEmployeeId || c.titularEmployeeId === parsed.empId);
    if (!propia) continue;
    if (esAusenciaDelTitular(parsed.empId, next[key], [propia])) continue;
    out.push({ key, consultaId: propia.id, fecha: parsed.fecha });
  }
  return out;
}

export function textoToastAcepto(nombre: string, fecha: string, code?: string | null, positionName?: string | null): string {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}` : fecha;
  const banda = code ? ` ${String(code).toUpperCase()}` : '';
  const puesto = positionName ? ` · ${positionName}` : '';
  return `${apellidoDe(nombre)} aceptó cubrir ${dia}${banda}${puesto}`;
}

export function textoToastVencida(consulta: ConsultaCurso): string {
  const j = (consulta.jornadas || [])[0];
  const dia = j?.fecha && /^\d{4}-\d{2}-\d{2}$/.test(j.fecha) ? `${j.fecha.slice(8, 10)}/${j.fecha.slice(5, 7)}` : '';
  const puesto = consulta.positionName ? ` · ${consulta.positionName}` : '';
  return `La consulta${dia ? ` del ${dia}` : ''}${puesto} venció sin respuesta.`;
}

/** Diff de dos snapshots: un sí nuevo, o una abierta que pasó a vencida sin aceptación. */
export function novedadesDeConsultas(prev: ConsultaCurso[], next: ConsultaCurso[]): { tipo: 'ACEPTO' | 'VENCIDA'; id: string; texto: string }[] {
  const antes = new Map(prev.map((c) => [c.id, c]));
  const out: { tipo: 'ACEPTO' | 'VENCIDA'; id: string; texto: string }[] = [];
  for (const c of next) {
    const p = antes.get(c.id);
    if (!p) continue;
    for (const r of c.respuestas || []) {
      if (r.estado !== 'ASIGNADO') continue;
      const ya = (p.respuestas || []).some((x) => x.nombre === r.nombre && x.estado === 'ASIGNADO');
      if (ya) continue;
      const j = (c.jornadas || [])[0];
      out.push({ tipo: 'ACEPTO', id: c.id, texto: textoToastAcepto(r.nombre, j?.fecha || '', j?.code, c.positionName) });
    }
    const acepto = (c.respuestas || []).some((r) => r.estado === 'ASIGNADO');
    if (p.status === 'ABIERTA' && c.status === 'VENCIDA' && !acepto) {
      out.push({ tipo: 'VENCIDA', id: c.id, texto: textoToastVencida(c) });
    }
  }
  return out;
}

export function consultasVisiblesEnCurso<T extends ConsultaCurso>(list: T[]): T[] {
  return list.filter((c) => c.status === 'ABIERTA' || (c.status === 'VENCIDA' && !(c.respuestas || []).some((r) => r.estado === 'ASIGNADO')));
}
