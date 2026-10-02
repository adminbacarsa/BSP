/**
 * Convocar guardias a un evento (EventoDetailModal → Nómina).
 *
 * Regla de Mauro (no cambia): el guardia SIN TURNO ese día o en RET se asigna directo y se le
 * avisa; el resto (franco, escuela…) tiene que aceptar la convocatoria. Acá vive solo la lectura
 * de esa regla para la UI: situación del día, qué va a pasar con cada seleccionado, texto del
 * botón, etiquetas del estado y mensajes de error entendibles. Las escrituras siguen en
 * `assignGuardToEvent` / `solicitudes_evento`.
 */

export type AccionConvocatoria = 'NOTIFICAR' | 'CONVOCAR';

/** Códigos sin turno productivo: se pueden seleccionar. */
export const DISPONIBLE_CODES = new Set(['libre', 'RET', 'F', 'FF', 'FP', 'ESC']);
export const FRANCO_CODES = new Set(['F', 'FF', 'FP']);
export const CON_TURNO_CODES = new Set(['M', 'T', 'N', 'D12', 'N12', 'ESC', 'REF']);

const SITUACION_LABEL: Record<string, string> = {
  libre: 'Libre',
  RET: 'RET',
  F: 'F',
  FF: 'FF',
  FP: 'FP',
  ESC: 'ESC',
  M: 'M',
  T: 'T',
  N: 'N',
  D12: 'D12',
  N12: 'N12',
  REF: 'REF',
  V: 'Vacaciones',
  L: 'Licencia',
  E: 'Enfermedad',
  A: 'Autorizada',
  PG: 'Permiso gremial',
  AA: 'Ausencia',
  EV: 'Evento',
  ocupado: 'Ocupado',
};

const SITUACION_DESCRIPCION: Record<string, string> = {
  libre: 'sin turno ese día',
  RET: 'retén',
  F: 'franco',
  FF: 'franco feriado',
  FP: 'franco permuta',
  ESC: 'escuela',
  M: 'mañana',
  T: 'tarde',
  N: 'noche',
  D12: 'diurno 12 h',
  N12: 'nocturno 12 h',
  REF: 'refuerzo',
  EV: 'otro evento',
};

export type SituacionDia = {
  code: string;
  /** Lo que se muestra: «Libre», «RET», «F», «M 07–15». */
  label: string;
  /** Texto largo para el título: «mañana 07–15». */
  descripcion: string;
  horario: string;
  accion: AccionConvocatoria | null;
  seleccionable: boolean;
};

/** Hora `HH:MM` → `HH`, y `HH:MM`–`HH:MM` → `07–15` / `07:30–15:30`. */
export function horarioCorto(inicio: string, fin: string): string {
  const a = String(inicio || '').slice(0, 5);
  const b = String(fin || '').slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(a) || !/^\d{2}:\d{2}$/.test(b)) return '';
  const enPunto = a.endsWith(':00') && b.endsWith(':00');
  return enPunto ? `${a.slice(0, 2)}–${b.slice(0, 2)}` : `${a}–${b}`;
}

/** Libre o RET = asignación directa (se notifica). Cualquier otro código disponible = tiene que aceptar. */
export function accionParaCodigo(code: string): AccionConvocatoria | null {
  const c = String(code || 'libre').trim();
  if (!c || c.toLowerCase() === 'libre' || c.toUpperCase() === 'RET') return 'NOTIFICAR';
  if (DISPONIBLE_CODES.has(c)) return 'CONVOCAR';
  return null;
}

export function situacionDelDia(code: string, horario = ''): SituacionDia {
  const c = String(code || 'libre').trim() || 'libre';
  const normal = c.toLowerCase() === 'libre' ? 'libre' : c.toUpperCase();
  const base = SITUACION_LABEL[normal] || normal;
  const conHorario = horario && normal !== 'libre' && !FRANCO_CODES.has(normal) && normal !== 'RET';
  const accion = accionParaCodigo(normal);
  return {
    code: normal,
    label: conHorario ? `${base} ${horario}` : base,
    descripcion: `${SITUACION_DESCRIPCION[normal] || base.toLowerCase()}${conHorario ? ` ${horario}` : ''}`,
    horario,
    accion,
    seleccionable: accion !== null,
  };
}

export function etiquetaAccion(accion: AccionConvocatoria | null): string {
  if (accion === 'NOTIFICAR') return 'Se notifica';
  if (accion === 'CONVOCAR') return 'Se convoca';
  return 'No disponible';
}

export function explicacionAccion(accion: AccionConvocatoria | null): string {
  if (accion === 'NOTIFICAR') return 'Libre o RET: se asigna directo y se le avisa. No tiene que aceptar.';
  if (accion === 'CONVOCAR') return 'Tiene franco o escuela: recibe la convocatoria y tiene que aceptar.';
  return 'Con turno productivo o licencia: no se puede convocar al evento.';
}

export type PersonaPlan = { id: string; nombre: string; situacion: SituacionDia; grupo?: string | null };

export type PlanConvocatoria = {
  notificar: PersonaPlan[];
  convocar: PersonaPlan[];
  /** Seleccionados que no entran en el cupo disponible (se omiten, en orden de selección). */
  omitidosPorCupo: PersonaPlan[];
};

/** Cupo que queda: un número (indistinto) o por grupo (`{ M: 3, F: 0 }`). Infinity = sin tope. */
export type CupoDisponible = number | Record<string, number>;

/**
 * Divide la selección en los dos grupos. El cupo se llena POR ORDEN DE ACEPTACIÓN: se puede
 * convocar a más gente que el cupo (quedan los primeros que aceptan). Lo que sí cuenta al momento
 * es la asignación directa (libre / RET): entran los primeros N en orden de selección por grupo;
 * el resto se omite. Con cupo por género, cada persona lleva su `grupo` ('M' / 'F'); sin grupo en
 * un servicio por género queda omitida (hay que completar el legajo).
 */
export function armarPlanConvocatoria(
  seleccion: { id: string; nombre: string; code: string; horario?: string; grupo?: string | null }[],
  cupoDisponible: CupoDisponible,
): PlanConvocatoria {
  const personas: PersonaPlan[] = seleccion.map((s) => ({ id: s.id, nombre: s.nombre, situacion: situacionDelDia(s.code, s.horario || ''), grupo: s.grupo ?? null }));
  const porGrupo = typeof cupoDisponible === 'object' && cupoDisponible !== null;
  const restante: Record<string, number> = porGrupo
    ? Object.fromEntries(Object.entries(cupoDisponible).map(([g, n]) => [g, Number.isFinite(n) ? Math.max(0, n) : Number.POSITIVE_INFINITY]))
    : { TODOS: Number.isFinite(cupoDisponible as number) ? Math.max(0, cupoDisponible as number) : Number.POSITIVE_INFINITY };
  const notificar: PersonaPlan[] = [];
  const convocar: PersonaPlan[] = [];
  const omitidosPorCupo: PersonaPlan[] = [];
  for (const p of personas) {
    const grupo = porGrupo ? String(p.grupo || '') : 'TODOS';
    if (porGrupo && !(grupo in restante)) { omitidosPorCupo.push(p); continue; }
    if (p.situacion.accion === 'CONVOCAR') { convocar.push(p); continue; }
    if (p.situacion.accion !== 'NOTIFICAR') continue;
    if (restante[grupo] > 0) {
      restante[grupo] -= 1;
      notificar.push(p);
    } else {
      omitidosPorCupo.push(p);
    }
  }
  return { notificar, convocar, omitidosPorCupo };
}

export function textoBotonPlan(plan: Pick<PlanConvocatoria, 'notificar' | 'convocar'>): string {
  const n = plan.notificar.length;
  const m = plan.convocar.length;
  if (n > 0 && m > 0) return 'Notificar y convocar';
  if (n > 0) return `Notificar${n > 1 ? ` (${n})` : ''}`;
  if (m > 0) return `Convocar${m > 1 ? ` (${m})` : ''}`;
  return 'Continuar';
}

export function tituloGrupoNotificar(n: number): string {
  return `Se asignan y se notifican (${n})`;
}

export function tituloGrupoConvocar(m: number): string {
  return `Se convocan, tienen que aceptar (${m})`;
}

/** Resumen corto para el toast después de enviar. */
export function resumenEnvio(plan: PlanConvocatoria): string {
  const partes: string[] = [];
  if (plan.notificar.length) partes.push(`${plan.notificar.length} asignado${plan.notificar.length === 1 ? '' : 's'} y notificado${plan.notificar.length === 1 ? '' : 's'}`);
  if (plan.convocar.length) partes.push(`${plan.convocar.length} convocado${plan.convocar.length === 1 ? '' : 's'} (tienen que aceptar)`);
  if (plan.omitidosPorCupo.length) partes.push(`${plan.omitidosPorCupo.length} omitido${plan.omitidosPorCupo.length === 1 ? '' : 's'} por cupo`);
  return partes.join(' · ') || 'Sin cambios';
}

/** Texto del aviso que recibe el guardia. */
export function textoAvisoGuardia(
  accion: AccionConvocatoria,
  ctx: { evento: string; servicio: string; fecha: string; horario: string },
): { title: string; body: string } {
  const detalle = `${ctx.servicio} · ${ctx.fecha} · ${ctx.horario}`;
  if (accion === 'NOTIFICAR') {
    return {
      title: `Fuiste asignado a ${ctx.evento}`,
      body: `${detalle}. Quedás asignado; no hace falta que respondas.`,
    };
  }
  return {
    title: `Convocatoria: ${ctx.evento}`,
    body: `${detalle}. ¿Podés ir? Aceptá o rechazá desde la app.`,
  };
}

export type EstadoConvocatoriaUi = {
  key: 'ASIGNADO' | 'ACEPTO' | 'PENDIENTE' | 'RECHAZO' | 'VENCIO' | 'NO_VA' | 'CUPO_COMPLETO' | 'OTRO';
  label: string;
  detalle: string;
};

/**
 * Estado para la solapa «Estado convocatoria». La asignación directa (`tipo: admin_asigna`)
 * no es una aceptación: se muestra «Asignado (notificado)». `vencida` = eventual que no respondió
 * en el plazo: no se generó turno, contrato ni AT y el lugar quedó libre.
 */
export function estadoSolicitudUi(sol: { status?: string; tipo?: string; esEventual?: boolean }): EstadoConvocatoriaUi {
  const status = String(sol.status || '');
  const tipo = String(sol.tipo || '');
  if (status === 'aprobada' && tipo === 'admin_asigna') return { key: 'ASIGNADO', label: 'Asignado (notificado)', detalle: 'Libre o RET: asignación directa, no tenía que aceptar' };
  if (status === 'aprobada') return { key: 'ACEPTO', label: 'Aceptó', detalle: tipo === 'guardia_solicita' ? 'Pidió participar y fue aprobado' : 'Aceptó la convocatoria' };
  if (status === 'rechazada') return { key: 'RECHAZO', label: 'Rechazó', detalle: 'Rechazó la convocatoria' };
  if (status === 'vencida') return { key: 'VENCIO', label: 'Venció', detalle: 'No respondió en el plazo: no se generó nada y el lugar quedó libre' };
  if (status === 'cancelada') return { key: 'NO_VA', label: 'No puede asistir', detalle: 'Avisó antes del inicio: se canceló su aceptación y se reconvocó' };
  if (status === 'cupo_completo') return { key: 'CUPO_COMPLETO', label: 'Cupo completo', detalle: 'El cupo de su grupo se llenó antes de que respondiera: se le avisó y no se generó nada' };
  if (status === 'convocado' || status === 'pendiente') return { key: 'PENDIENTE', label: 'Pendiente', detalle: tipo === 'admin_convoca' ? (sol.esEventual ? 'Eventual convocado, tiene que aceptar desde la app' : 'Convocado, todavía no respondió') : 'Solicitó participar' };
  return { key: 'OTRO', label: status || '—', detalle: '' };
}

export type SolicitudEventualLike = {
  status?: string;
  esEventual?: boolean;
  pruebasSinMarco?: boolean;
  anexoEstado?: string | null;
  arcaCanal?: string | null;
  contratoId?: string | null;
};

export type TurnoEventualLike = {
  esEventual?: boolean;
  eventualAltaArcaConfirmada?: boolean;
  eventualExigirAltaArca?: boolean;
  nroTransaccion?: string | null;
};

export type DetalleEventualUi = {
  anexo: { label: string; tono: 'ok' | 'pendiente' | 'neutro' } | null;
  arca: { label: string; tono: 'ok' | 'pendiente' | 'neutro' } | null;
  pruebas: string | null;
};

/**
 * Detalle de un eventual en «Estado convocatoria»: anexo (pendiente / firmado) y ARCA
 * (pendiente / confirmada) una vez que aceptó. El ARCA sale del turno EV (`eventualAltaArcaConfirmada`,
 * mismo dato que el gate de fichada); el anexo lo escribe el servidor en la solicitud.
 */
export function detalleEventualUi(sol: SolicitudEventualLike, turno?: TurnoEventualLike | null): DetalleEventualUi {
  const pruebas = sol.pruebasSinMarco ? 'Pruebas: sin exigir marco' : null;
  if (!sol.esEventual || String(sol.status || '') !== 'aprobada') return { anexo: null, arca: null, pruebas };
  const anexoEstado = String(sol.anexoEstado || '');
  const anexo = anexoEstado === 'FIRMADO'
    ? { label: 'Anexo firmado', tono: 'ok' as const }
    : anexoEstado === 'NO_EXIGIDO'
      ? { label: 'Anexo no exigido (pruebas)', tono: 'neutro' as const }
      : anexoEstado === 'SIN_CANAL'
        ? { label: 'Anexo sin canal (RRHH)', tono: 'pendiente' as const }
        : { label: 'Anexo pendiente', tono: 'pendiente' as const };
  const arcaConfirmada = turno?.eventualAltaArcaConfirmada === true || sol.arcaCanal === 'CONFIRMADA';
  const arca = arcaConfirmada
    ? { label: `ARCA confirmada${turno?.nroTransaccion ? ` · Nº ${turno.nroTransaccion}` : ''}`, tono: 'ok' as const }
    : turno?.eventualExigirAltaArca === false
      ? { label: 'ARCA pendiente (ficha igual, pruebas)', tono: 'neutro' as const }
      : { label: `ARCA pendiente${sol.arcaCanal === 'URGENTE' ? ' · urgente' : ''}`, tono: 'pendiente' as const };
  return { anexo, arca, pruebas };
}

const CODIGOS_CALLABLE: Record<string, string> = {
  internal: 'El servidor no pudo completar la operación.',
  unavailable: 'El servidor no está disponible en este momento.',
  'deadline-exceeded': 'El servidor tardó demasiado en responder.',
  unauthenticated: 'Tu sesión venció. Volvé a iniciar sesión.',
  'permission-denied': 'No tenés permiso para esta acción.',
  'resource-exhausted': 'Demasiados intentos. Esperá un momento.',
  'network-request-failed': 'Sin conexión con el servidor.',
};

function codigoDe(e: unknown): string {
  const raw = (e as { code?: unknown })?.code;
  const code = String(raw || '').replace(/^functions\//, '').toLowerCase();
  if (code) return code;
  const msg = String((e as { message?: unknown })?.message || '').trim().toLowerCase();
  return CODIGOS_CALLABLE[msg] ? msg : '';
}

/**
 * «INTERNAL» crudo → mensaje entendible + qué hacer. Los mensajes propios del servidor
 * (`failed-precondition`, `invalid-argument` con texto) se respetan.
 */
export function mensajeErrorCallable(e: unknown, queFallo: string): string {
  const code = codigoDe(e);
  const msg = String((e as { message?: unknown })?.message || '').trim();
  const esCrudo = !msg || msg.toLowerCase() === code || /^[A-Z_\- ]+$/.test(msg) || msg.toLowerCase() === 'internal';
  if (CODIGOS_CALLABLE[code]) return `${queFallo} ${CODIGOS_CALLABLE[code]} Reintentá.`;
  if (!esCrudo) return msg;
  return `${queFallo} Reintentá.`;
}
