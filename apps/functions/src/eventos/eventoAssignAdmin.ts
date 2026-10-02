import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { asignarGuardiaAEvento } from './turnoEvento';
import { camposCupoTurno, cerrarPendientesPorCupo, liberarReservaCupo, reservarCupo } from './cupoEvento';

export type AssignGuardToEventParams = {
  empresaId: string;
  empleadoId: string;
  empleadoNombre: string;
  empleadoObjectiveId?: string;
  empleadoObjectiveName?: string;
  eventoId: string;
  eventoNombre: string;
  clienteId?: string;
  clienteNombre?: string;
  servicioId: string;
  servicioNombre: string;
  servicioFecha: string;
  horaInicio: string;
  horaFin: string;
  horas: number;
  solicitudId?: string;
  respondidoPor?: string;
  /** La aceptación ya reservó el cupo en su transacción: no volver a chequear. */
  cupoReservado?: boolean;
  /** Campos extra del turno EV (`cupoGrupo`, `genero`). */
  extraTurno?: Record<string, unknown>;
};

const SUPER = ['SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP'];

/**
 * Escritor del panel y de la aceptación en la app. Delega en el escritor único.
 * Asignación directa (libre / RET / aprobar pedido del guardia): cuenta contra el cupo al momento.
 */
export async function assignGuardToEventAdmin(
  db: admin.firestore.Firestore,
  params: AssignGuardToEventParams,
): Promise<{ turnoId: string }> {
  let extraTurno = params.extraTurno || {};
  if (!params.cupoReservado) {
    const reserva = await reservarCupo(db, {
      eventoId: params.eventoId,
      servicioId: params.servicioId,
      solicitudId: params.solicitudId || null,
      empleadoId: params.empleadoId,
      esEventual: false,
    });
    if (!reserva.ok) throw new functions.https.HttpsError('failed-precondition', reserva.mensaje, { codigo: reserva.motivo, grupo: reserva.grupo });
    extraTurno = { ...camposCupoTurno(reserva), ...extraTurno };
  }
  let out: { turnoId: string };
  try {
    out = await asignarGuardiaAEvento(db, { ...params, extraTurno });
  } catch (err) {
    if (!params.cupoReservado) await liberarReservaCupo(db, params.solicitudId);
    throw err;
  }
  await cerrarPendientesPorCupo(db, { eventoId: params.eventoId, servicioId: params.servicioId, actor: params.respondidoPor || 'PANEL' });
  return out;
}

/** El panel no escribe el turno: llama acá. */
export const asignarGuardiaEvento = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const role = String(context.auth.token.role || '');
  if (!SUPER.includes(role)) {
    const sys = await admin.firestore().collection('system_users').doc(context.auth.uid).get();
    if (!sys.exists) throw new functions.https.HttpsError('permission-denied', 'No tenés acceso al panel.');
  }
  const params = data as AssignGuardToEventParams;
  if (!params?.empleadoId || !params?.eventoId || !params?.servicioId || !params?.servicioFecha) {
    throw new functions.https.HttpsError('invalid-argument', 'Faltan empleado, evento, servicio o fecha.');
  }
  const out = await assignGuardToEventAdmin(admin.firestore(), { ...params, cupoReservado: false, respondidoPor: params.respondidoPor || context.auth.uid });
  return { ok: true, turnoId: out.turnoId };
});
