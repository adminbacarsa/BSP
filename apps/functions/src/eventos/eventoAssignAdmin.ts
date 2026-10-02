import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { asignarGuardiaAEvento } from './turnoEvento';

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
};

const SUPER = ['SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP'];

/** Escritor del panel y de la aceptación en la app. Delega en el escritor único. */
export async function assignGuardToEventAdmin(
  db: admin.firestore.Firestore,
  params: AssignGuardToEventParams,
): Promise<void> {
  await asignarGuardiaAEvento(db, params);
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
  const out = await asignarGuardiaAEvento(admin.firestore(), params);
  return { ok: true, turnoId: out.turnoId };
});
