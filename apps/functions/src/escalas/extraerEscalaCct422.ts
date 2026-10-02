/**
 * Callable `extraerEscalaCct422`: RRHH sube el PDF escaneado de SUVICO (o el anexo de la disposición)
 * y recibe la escala leída con confianza por campo. Siempre PROPUESTA. Con `guardar: true` deja el doc en
 * `escalas_cct` (estado PROPUESTA, idempotente por hash); nunca toca `escalas_salariales` ni aprueba nada.
 * Producción: secreto GEMINI_API_KEY. Emulador: sin runWith, la clave sale de apps/functions/.env.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { CCT_422, parsearAnexoOficial422, esPropuesta, type PropuestaEscala422 } from './escalaCct422Core';
import { leerEscala422ConGemini, validarPdfBase64 } from './escalaCct422Gemini';
import { sha256Hex } from './escalaCct422Core';

const SUPER = ['SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP'];
const ACCIONES_RRHH = ['create', 'update', 'adjust'];

function db() {
  return admin.firestore();
}

async function exigirRrhh(context: functions.https.CallableContext): Promise<{ uid: string; email: string | null; superAdmin: boolean }> {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const uid = context.auth.uid;
  const email = (context.auth.token?.email as string | undefined) || null;
  const claimRole = String(context.auth.token?.role || '');
  if (SUPER.includes(claimRole)) return { uid, email, superAdmin: true };
  const sys = await db().collection('system_users').doc(uid).get();
  const roleId = String(sys.data()?.role || claimRole || '');
  if (SUPER.includes(roleId)) return { uid, email, superAdmin: true };
  if (roleId) {
    const rol = await db().collection('roles').doc(roleId).get();
    const acciones = (rol.data()?.permissions?.RRHH || []) as string[];
    if (acciones.some((a) => ACCIONES_RRHH.includes(a))) return { uid, email, superAdmin: false };
  }
  throw new functions.https.HttpsError('permission-denied', 'Necesitás permiso de RRHH para leer escalas.');
}

export interface ExtraerEscalaCct422Payload {
  pdfBase64?: string;
  textoAnexo?: string;
  fileName?: string | null;
  fuenteUrl?: string | null;
  titulo?: string | null;
  empresaId?: string | null;
  guardar?: boolean;
}

export interface ExtraerEscalaCct422Result {
  propuesta: PropuestaEscala422;
  modelo: string | null;
  docId: string | null;
  yaExistia: boolean;
}

export function escalaCctDocId(p: PropuestaEscala422): string {
  return `${CCT_422}_${p.vigenciaDesde || 'sin-vigencia'}_${p.documentoHash.slice(0, 8)}`;
}

export async function extraerEscalaCct422Handler(
  data: ExtraerEscalaCct422Payload,
  context: functions.https.CallableContext,
): Promise<ExtraerEscalaCct422Result> {
  const quien = await exigirRrhh(context);
  const fuenteUrl = typeof data?.fuenteUrl === 'string' ? data.fuenteUrl.slice(0, 500) : null;
  const titulo = typeof data?.titulo === 'string' ? data.titulo.slice(0, 200) : data?.fileName ? String(data.fileName).slice(0, 200) : null;

  let propuesta: PropuestaEscala422;
  let modelo: string | null = null;
  try {
    if (typeof data?.textoAnexo === 'string' && data.textoAnexo.trim()) {
      const out = parsearAnexoOficial422(data.textoAnexo, { fuenteUrl, titulo });
      if (!esPropuesta(out)) throw new functions.https.HttpsError('failed-precondition', `No se pudo leer el anexo: ${out.codigo}`);
      propuesta = out;
    } else {
      validarPdfBase64(String(data?.pdfBase64 || ''));
      const apiKey = process.env.GEMINI_API_KEY || '';
      if (!apiKey) throw new functions.https.HttpsError('failed-precondition', 'GEMINI_API_KEY no configurada en el servidor.');
      const res = await leerEscala422ConGemini({ pdfBase64: String(data.pdfBase64), apiKey, fuenteUrl, titulo });
      propuesta = res.propuesta;
      modelo = res.modelo;
    }
  } catch (e: any) {
    if (e instanceof functions.https.HttpsError) throw e;
    console.error('[extraerEscalaCct422]', e?.message);
    throw new functions.https.HttpsError('failed-precondition', String(e?.message || 'No se pudo leer la escala'));
  }

  if (!data?.guardar) return { propuesta, modelo, docId: null, yaExistia: false };

  const docId = escalaCctDocId(propuesta);
  const ref = db().collection('escalas_cct').doc(docId);
  const existente = await ref.get();
  if (existente.exists) return { propuesta, modelo, docId, yaExistia: true };
  const empresaId = typeof data.empresaId === 'string' && data.empresaId.trim() ? data.empresaId.trim() : null;
  await ref.set({
    ...propuesta,
    estado: 'PROPUESTA',
    modelo,
    empresaId,
    creadoPor: quien.uid,
    creadoPorEmail: quien.email,
    creadoEn: admin.firestore.FieldValue.serverTimestamp(),
    aprobadoPor: null,
    aprobadoEn: null,
    payloadHash: sha256Hex(JSON.stringify(propuesta.tramos)),
  });
  await db().collection('audit_logs').add({
    action: 'ESCALA_CCT_PROPUESTA',
    collection: 'escalas_cct',
    docId,
    empresaId,
    userId: quien.uid,
    userEmail: quien.email,
    details: { cct: propuesta.cct, extraccion: propuesta.extraccion, vigenciaDesde: propuesta.vigenciaDesde, vigenciaHasta: propuesta.vigenciaHasta, confianzaGlobal: propuesta.confianzaGlobal, advertencias: propuesta.advertencias.length },
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { propuesta, modelo, docId, yaExistia: false };
}

export const extraerEscalaCct422 =
  process.env.FUNCTIONS_EMULATOR === 'true'
    ? functions.https.onCall(extraerEscalaCct422Handler)
    : functions
        .runWith({ secrets: ['GEMINI_API_KEY'], timeoutSeconds: 180, memory: '512MB' })
        .https.onCall(extraerEscalaCct422Handler);
