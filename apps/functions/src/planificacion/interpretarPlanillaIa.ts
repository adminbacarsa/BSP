/**
 * Callable `interpretarPlanillaIa`. Lee la grilla ya parseada (y una captura opcional) con Gemini.
 * No escribe el servicio ni las equivalencias: devuelve la lectura para que el planificador acepte cada diferencia.
 * Producción: secreto GEMINI_API_KEY. Emulador: sin runWith, la clave sale de apps/functions/.env.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { MAX_IMAGEN_BYTES, sanearGrilla } from './planillaIaCore';
import { leerPlanillaConGemini, type ImagenPlanilla } from './planillaIaGemini';

const SUPER = ['SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP'];

function db() {
  return admin.firestore();
}

async function exigirPlanificacion(context: functions.https.CallableContext): Promise<{ uid: string; email: string | null }> {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const uid = context.auth.uid;
  const email = (context.auth.token?.email as string | undefined) || null;
  const claimRole = String(context.auth.token?.role || '');
  if (SUPER.includes(claimRole)) return { uid, email };
  const sys = await db().collection('system_users').doc(uid).get();
  const roleId = String(sys.data()?.role || claimRole || '');
  if (SUPER.includes(roleId)) return { uid, email };
  if (roleId) {
    const rol = await db().collection('roles').doc(roleId).get();
    const planning = (rol.data()?.permissions?.PLANNING || []) as string[];
    if (planning.includes('update')) return { uid, email };
  }
  throw new functions.https.HttpsError('permission-denied', 'Necesitás permiso de planificación para leer la planilla.');
}

function imagenDe(data: Record<string, unknown>): ImagenPlanilla | null {
  const crudo = String(data.imagenBase64 || '').replace(/^data:image\/(png|jpeg|jpg);base64,/i, '').trim();
  if (!crudo) return null;
  const mimeDicho = String(data.imagenMime || '').toLowerCase();
  let buf: Buffer;
  try {
    buf = Buffer.from(crudo, 'base64');
  } catch {
    throw new functions.https.HttpsError('invalid-argument', 'La captura no es una imagen válida.');
  }
  if (!buf.length) return null;
  if (buf.length > MAX_IMAGEN_BYTES) {
    throw new functions.https.HttpsError('invalid-argument', 'La captura supera 5 MB.');
  }
  const png = buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!png && !jpeg) throw new functions.https.HttpsError('invalid-argument', 'La captura tiene que ser PNG o JPG.');
  if (mimeDicho && mimeDicho !== 'image/png' && mimeDicho !== 'image/jpeg' && mimeDicho !== 'image/jpg') {
    throw new functions.https.HttpsError('invalid-argument', 'La captura tiene que ser PNG o JPG.');
  }
  return { mime: png ? 'image/png' : 'image/jpeg', base64: buf.toString('base64') };
}

export async function interpretarPlanillaIaHandler(data: Record<string, unknown>, context: functions.https.CallableContext) {
  const quien = await exigirPlanificacion(context);
  const empresaId = String(data?.empresaId || '').trim();
  const objectiveId = String(data?.objectiveId || '').trim();
  if (!empresaId || !objectiveId) {
    throw new functions.https.HttpsError('invalid-argument', 'Falta la empresa o el objetivo.');
  }
  let grilla;
  try {
    grilla = sanearGrilla(data?.grilla);
  } catch (e) {
    throw new functions.https.HttpsError('invalid-argument', (e as Error).message);
  }
  if (!grilla.celdas.length && !grilla.referencias.length) {
    throw new functions.https.HttpsError('invalid-argument', 'La planilla no tiene grilla para leer.');
  }
  const imagen = imagenDe(data || {});
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    throw new functions.https.HttpsError('failed-precondition', 'GEMINI_API_KEY no configurada. La planilla se lee igual que antes.');
  }
  let lectura;
  let modelo = '';
  try {
    const res = await leerPlanillaConGemini({ grilla, apiKey, imagen });
    lectura = res.lectura;
    modelo = res.modelo;
  } catch (e) {
    const msg = (e as Error)?.message || 'No se pudo leer la planilla';
    console.error('[interpretarPlanillaIa]', msg.slice(0, 300));
    throw new functions.https.HttpsError('failed-precondition', 'No se pudo leer la planilla con IA. La planilla se lee igual que antes.');
  }
  await db().collection('audit_logs').add({
    action: 'PLANILLA_IA_LECTURA',
    module: 'PLANNING',
    empresaId,
    objectiveId,
    year: grilla.year,
    month: grilla.month,
    actorUid: quien.uid,
    actorEmail: quien.email,
    modelo,
    puestos: lectura.puestos.length,
    leyenda: lectura.leyenda.length,
    funciones: lectura.funciones.length,
    excepciones: lectura.excepcionesPorDia.length,
    dudas: lectura.dudas.length,
    conCaptura: !!imagen,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((e) => console.warn('[interpretarPlanillaIa] audit', (e as Error)?.message));
  return { lectura, modelo };
}

export const interpretarPlanillaIa =
  process.env.FUNCTIONS_EMULATOR === 'true'
    ? functions.https.onCall(interpretarPlanillaIaHandler)
    : functions
        .runWith({ secrets: ['GEMINI_API_KEY'], timeoutSeconds: 180, memory: '512MB' })
        .https.onCall(interpretarPlanillaIaHandler);
