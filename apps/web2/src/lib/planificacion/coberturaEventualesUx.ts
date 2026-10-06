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
