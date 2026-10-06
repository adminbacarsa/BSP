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

type JornadaCorta = { fecha: string; code?: string | null; horaInicio: string; horaFin: string };

export function textoJornadaCorta(j: JornadaCorta): string {
  const [, m, d] = String(j.fecha || '').split('-');
  const dia = d && m ? `${d}/${m}` : String(j.fecha || '');
  const code = String(j.code || '').trim();
  return `${dia} · ${code ? `${code} ` : ''}${String(j.horaInicio || '').slice(0, 5)}–${String(j.horaFin || '').slice(0, 5)}`;
}

/** Siempre un lugar por día: el primero que acepte cubre. Con varios días, los cubre todos. */
export function textoBarraPreguntar(n: number, jornadas: JornadaCorta[]): string {
  if (n <= 0) return 'Marcá a quién preguntar';
  const que = jornadas.length === 1
    ? textoJornadaCorta(jornadas[0])
    : `los ${jornadas.length} días marcados`;
  return `Preguntar a ${n} · el primero que acepte cubre ${que}`;
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
