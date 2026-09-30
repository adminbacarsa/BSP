/**
 * Contrato marco (papel) y anexo por convocatoria (aceptación en la app).
 * No hay OTP de teléfono en el proyecto: el código sale por mail o WhatsApp.
 */
import { Readable } from 'stream';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

const CUENTA_DRIVE = 'comtroldata@appspot.gserviceaccount.com';
const callable = functions.runWith({ serviceAccount: CUENTA_DRIVE }).https;

const SUPER = ['SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP'];

function db() {
  return admin.firestore();
}

async function exigirRrhh(context: functions.https.CallableContext) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const role = String(context.auth.token.role || '');
  if (SUPER.includes(role)) return context.auth;
  const sys = await db().collection('system_users').doc(context.auth.uid).get();
  const roleId = String(sys.data()?.role || role);
  if (SUPER.includes(roleId)) return context.auth;
  const rol = roleId ? await db().collection('roles').doc(roleId).get() : null;
  const acciones = (rol?.data()?.permissions?.EVENTUALES || []) as string[];
  if (acciones.includes('update') || acciones.includes('create')) return context.auth;
  throw new functions.https.HttpsError('permission-denied', 'No tenés permiso de eventuales.');
}

async function lib() {
  return import('../../../web2/src/lib/eventuales/marcoAnexo.mjs') as Promise<{
    textoMarco: (i: Record<string, string>) => string;
    textoAnexo: (i: Record<string, unknown>) => string;
    textoConstancia: (i: Record<string, unknown>) => string;
    pdfDeTexto: (t: string) => Buffer;
    sha256: (v: Buffer | string) => string;
    planMarco: (i: Record<string, unknown>) => { estado: string; vencimiento: string | null; avisar: boolean };
    nombreCarpetaPersona: (i: { cuil: string; nombre: string; legajo?: string }) => string;
    nombreArchivo: (i: { tipo: string; fecha: string; lugar?: string; empresa?: string }) => string;
    planRenombre: (actual: string, nuevo: string) => { renombrar: boolean; nombre: string };
    legajoDe: (bolsa: Record<string, unknown>) => string;
    DRIVE_ROOT_EVENTUALES_DEFAULT: string;
    CARPETA_EVENTUALES: string;
    destinoGuardado: (folderId: string) => string;
    nuevoCodigoAnexo: () => string;
    hashCodigo: (codigo: string, salt: string) => string;
    planConfirmarAnexo: (i: Record<string, unknown>) => { ok: boolean; codigo?: string };
    canalCodigo: (i: { mail?: string; telefono?: string }) => { ok: boolean; codigo?: string; canales?: string[] };
    CODIGO_ANEXO_MINUTOS: number;
    VIGENCIA_MARCO_DIAS: number;
  }>;
}

async function raizDrive() {
  const m = await lib();
  const snap = await db().collection('config').doc('eventuales').get();
  const guardado = String(snap.data()?.driveRootFolderId || '').trim();
  return { rootId: guardado || m.DRIVE_ROOT_EVENTUALES_DEFAULT, eventualesFolderId: String(snap.data()?.driveEventualesFolderId || '') };
}

async function clienteDrive() {
  const { google } = await import('googleapis');
  const { resolveOrCreateDriveFolder } = await import('../backup/backup.service');
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] });
  return { drive: google.drive({ version: 'v3', auth }), resolveOrCreateDriveFolder };
}

async function carpetaPersona(cuil: string, bolsa: Record<string, unknown>) {
  const m = await lib();
  const { rootId, eventualesFolderId } = await raizDrive();
  const { drive, resolveOrCreateDriveFolder } = await clienteDrive();
  let padre = eventualesFolderId;
  if (!padre) {
    padre = await resolveOrCreateDriveFolder(drive, rootId, m.CARPETA_EVENTUALES);
    await db().collection('config').doc('eventuales').set({ driveRootFolderId: rootId, driveEventualesFolderId: padre }, { merge: true });
  }
  const nombre = m.nombreCarpetaPersona({ cuil, nombre: String(bolsa.nombre || ''), legajo: m.legajoDe(bolsa) });
  const actualId = String(bolsa.driveFolderId || '');
  const plan = m.planRenombre(String(bolsa.driveFolderName || ''), nombre);
  if (actualId) {
    if (plan.renombrar) {
      await drive.files.update({ fileId: actualId, supportsAllDrives: true, requestBody: { name: plan.nombre } });
    }
    await db().collection('eventuales_bolsa').doc(cuil).set({ driveFolderId: actualId, driveFolderName: plan.nombre }, { merge: true });
    return { folderId: actualId, nombre: plan.nombre };
  }
  const folderId = await resolveOrCreateDriveFolder(drive, padre, nombre);
  await db().collection('eventuales_bolsa').doc(cuil).set({ driveFolderId: folderId, driveFolderName: nombre }, { merge: true });
  return { folderId, nombre };
}

async function guardarPdf(cuil: string, bolsa: Record<string, unknown>, nombre: string, bytes: Buffer) {
  const storagePath = `eventuales/${cuil}/${nombre}`;
  try {
    const { drive } = await clienteDrive();
    const carpeta = await carpetaPersona(cuil, bolsa);
    const res = await drive.files.create({
      supportsAllDrives: true,
      requestBody: { name: nombre, parents: [carpeta.folderId] },
      media: { mimeType: 'application/pdf', body: Readable.from(bytes) },
      fields: 'id, webViewLink',
    });
    const driveFileId = String(res.data.id || '');
    return {
      destino: 'DRIVE',
      driveFileId,
      driveFolderId: carpeta.folderId,
      link: res.data.webViewLink || (driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : null),
      drivePendiente: false,
      storagePath: null as string | null,
    };
  } catch (e) {
    console.warn('[marcoAnexo] Sin permiso de Drive, queda en Storage', e);
    await admin.storage().bucket().file(storagePath).save(bytes, { contentType: 'application/pdf' });
    return { destino: 'STORAGE', driveFileId: null as string | null, driveFolderId: null as string | null, link: null as string | null, drivePendiente: true, storagePath };
  }
}

async function registrarDoc(cuil: string, empresaId: string, tipo: string, nombre: string, hash: string, guardado: { link: string | null; driveFileId: string | null; drivePendiente: boolean; storagePath: string | null }) {
  await db().collection('eventuales_documentos').add({
    bolsaCuil: cuil, empresaId, tipo, nombre, hash, link: guardado.link, driveFileId: guardado.driveFileId,
    drivePendiente: guardado.drivePendiente, storagePath: guardado.storagePath,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export const gestionarMarcoEventual = callable.onCall(async (data, context) => {
  const auth = await exigirRrhh(context);
  const m = await lib();
  const accion = String(data?.accion || '');
  const cuil = String(data?.cuil || '');
  const empresaId = String(data?.empresaId || '');
  if (accion === 'config') {
    const { rootId } = await raizDrive();
    if (data?.guardar === true) {
      const id = String(data?.driveRootFolderId || '').trim();
      if (!id) throw new functions.https.HttpsError('invalid-argument', 'Falta el id de la carpeta.');
      await db().collection('config').doc('eventuales').set({ driveRootFolderId: id }, { merge: true });
      return { ok: true, driveRootFolderId: id };
    }
    return { driveRootFolderId: rootId };
  }
  if (!cuil) throw new functions.https.HttpsError('invalid-argument', 'Falta el CUIL.');

  if (accion === 'listar') {
    const snap = await db().collection('contratos_marco').where('bolsaCuil', '==', cuil).get();
    const hoy = new Date().toISOString().slice(0, 10);
    return {
      marcos: snap.docs.map((d) => {
        const row = d.data();
        const plan = m.planMarco({ firmado: row.firmado === true, fechaFirma: row.fechaFirma, vigenciaDias: row.vigenciaDias, hoy });
        return { id: d.id, empresaId: row.empresaId, ...plan, link: row.link || null, hash: row.hash || null };
      }),
      documentos: (await db().collection('eventuales_documentos').where('bolsaCuil', '==', cuil).get()).docs.map((d) => {
        const row = d.data();
        return { id: d.id, tipo: row.tipo, nombre: row.nombre, empresaId: row.empresaId, link: row.link || null, drivePendiente: row.drivePendiente === true };
      }),
      driveFolderId: (await db().collection('eventuales_bolsa').doc(cuil).get()).data()?.driveFolderId || null,
    };
  }

  if (!empresaId && accion !== 'reintentar') throw new functions.https.HttpsError('invalid-argument', 'Falta la empresa.');
  const bolsaSnap = await db().collection('eventuales_bolsa').doc(cuil).get();
  if (!bolsaSnap.exists) throw new functions.https.HttpsError('not-found', 'No está en la bolsa.');
  const bolsa = bolsaSnap.data() || {};
  const empresa = (await db().collection('empresas').doc(empresaId).get()).data() || {};
  const nombre = String(bolsa.nombre || cuil);
  const empresaNombre = String(empresa.razonSocial || empresa.nombre || empresaId);

  if (accion === 'reintentar') {
    const pend = await db().collection('eventuales_documentos').where('bolsaCuil', '==', cuil).get();
    const pendientes = pend.docs.filter((d) => d.data().drivePendiente === true);
    let subidos = 0;
    for (const d of pendientes) {
      const row = d.data();
      if (!row.storagePath) continue;
      const [buf] = await admin.storage().bucket().file(String(row.storagePath)).download();
      const guardado = await guardarPdf(cuil, bolsa, String(row.nombre), buf);
      if (!guardado.drivePendiente) {
        await d.ref.set({ link: guardado.link, driveFileId: guardado.driveFileId, drivePendiente: false, storagePath: null }, { merge: true });
        subidos += 1;
      }
    }
    return { ok: true, subidos };
  }

  if (accion === 'subir') {
    const tipo = String(data?.tipo || '');
    if (tipo !== 'ANEXO' && tipo !== 'ARCA') throw new functions.https.HttpsError('invalid-argument', 'Tipo de documento inválido.');
    const raw = String(data?.pdfBase64 || '');
    if (!raw) throw new functions.https.HttpsError('invalid-argument', 'Falta el archivo.');
    const bytes = Buffer.from(raw, 'base64');
    const fecha = String(data?.fecha || new Date().toISOString().slice(0, 10));
    const nombrePdf = m.nombreArchivo({ tipo, fecha, lugar: data?.lugar, empresa: empresaNombre });
    const hash = m.sha256(bytes);
    const guardado = await guardarPdf(cuil, bolsa, nombrePdf, bytes);
    await registrarDoc(cuil, empresaId, tipo, nombrePdf, hash, guardado);
    return { ok: true, nombre: nombrePdf, ...guardado };
  }

  if (accion === 'generar') {
    const texto = m.textoMarco({
      empresaNombre: String(empresa.razonSocial || empresa.nombre || empresaId),
      empresaCuit: String(empresa.cuit || ''),
      empresaDomicilio: String(empresa.domicilio || ''),
      trabajadorNombre: nombre,
      trabajadorDni: String(bolsa.dni || ''),
      trabajadorDomicilio: String(bolsa.domicilio || ''),
      fecha: String(data?.fecha || new Date().toISOString().slice(0, 10)),
    });
    const pdf = m.pdfDeTexto(texto);
    const hash = m.sha256(pdf);
    const nombreArchivo = m.nombreArchivo({ tipo: 'MARCO', fecha: new Date().toISOString().slice(0, 10), empresa: empresaNombre });
    const guardado = await guardarPdf(cuil, bolsa, nombreArchivo, pdf);
    await registrarDoc(cuil, empresaId, 'MARCO', nombreArchivo, hash, guardado);
    await db().collection('contratos_marco').doc(`${cuil}_${empresaId}`).set({
      bolsaCuil: cuil, empresaId, firmado: false, hashBorrador: hash, linkBorrador: guardado.link, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, hash, pdfBase64: pdf.toString('base64'), ...guardado };
  }

  if (accion === 'firmar') {
    const fechaFirma = String(data?.fechaFirma || '');
    const vigenciaDias = Number(data?.vigenciaDias) > 0 ? Number(data.vigenciaDias) : m.VIGENCIA_MARCO_DIAS;
    const hoy = new Date().toISOString().slice(0, 10);
    const plan = m.planMarco({ firmado: true, fechaFirma, vigenciaDias, hoy });
    if (plan.estado === 'SIN_MARCO') throw new functions.https.HttpsError('invalid-argument', 'Falta la fecha de firma.');
    const raw = String(data?.pdfBase64 || '');
    if (!raw) throw new functions.https.HttpsError('invalid-argument', 'Falta el escaneo firmado.');
    const bytes = Buffer.from(raw, 'base64');
    const hash = m.sha256(bytes);
    const nombrePdf = m.nombreArchivo({ tipo: 'MARCO', fecha: fechaFirma, empresa: empresaNombre });
    const guardado = await guardarPdf(cuil, bolsa, nombrePdf, bytes);
    await registrarDoc(cuil, empresaId, 'MARCO', nombrePdf, hash, guardado);
    const ficha = { firmado: true, fechaFirma, vigenciaDias, vencimiento: plan.vencimiento, estado: plan.estado, hash, link: guardado.link };
    await db().collection('contratos_marco').doc(`${cuil}_${empresaId}`).set({
      bolsaCuil: cuil, empresaId, ...ficha, storagePath: guardado.storagePath, driveFileId: guardado.driveFileId, drivePendiente: guardado.drivePendiente,
      firmadoPor: auth.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await db().collection('eventuales_bolsa').doc(cuil).set({ marcos: { [empresaId]: ficha } }, { merge: true });
    await db().collection('audit_logs').add({
      action: 'EVENTUAL_MARCO', module: 'EVENTUALES', actorUid: auth.uid, bolsaCuil: cuil, empresaId,
      details: `${plan.estado} hasta ${plan.vencimiento}`, timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true, ...plan, hash, ...guardado };
  }

  throw new functions.https.HttpsError('invalid-argument', 'Acción desconocida.');
});

async function refCodigo(contratoId: string, convocatoriaId: string) {
  const id = contratoId || convocatoriaId;
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'Falta el contrato o la convocatoria.');
  return db().collection('anexo_codigos').doc(id);
}

export const pedirCodigoAnexoEventual = callable.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const m = await lib();
  const contratoId = String(data?.contratoId || '');
  const convocatoriaId = String(data?.convocatoriaId || '');
  const ref = await refCodigo(contratoId, convocatoriaId);
  const cuil = String(data?.cuil || context.auth.token.bolsaCuil || '');
  const bolsa = cuil ? (await db().collection('eventuales_bolsa').doc(cuil).get()).data() || {} : {};
  if (bolsa.uid && bolsa.uid !== context.auth.uid && String(context.auth.token.role) !== 'EVENTUAL') {
    throw new functions.https.HttpsError('permission-denied', 'El código es del eventual.');
  }
  const canal = m.canalCodigo({ mail: bolsa.mail, telefono: bolsa.telefono });
  if (!canal.ok) throw new functions.https.HttpsError('failed-precondition', 'SIN_CANAL');
  const codigo = m.nuevoCodigoAnexo();
  const salt = admin.firestore().collection('_').doc().id;
  const venceMs = Date.now() + m.CODIGO_ANEXO_MINUTOS * 60 * 1000;
  await ref.set({
    contratoId: contratoId || null,
    convocatoriaId: convocatoriaId || null,
    bolsaCuil: cuil,
    salt,
    hash: m.hashCodigo(codigo, salt),
    usado: false,
    venceMs,
    canales: canal.canales,
    pendienteEnvio: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, canales: canal.canales, venceMs, pendienteEnvio: true };
});

export const confirmarAnexoEventual = callable.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const m = await lib();
  const contratoId = String(data?.contratoId || '');
  const convocatoriaId = String(data?.convocatoriaId || '');
  const ref = await refCodigo(contratoId, convocatoriaId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'No hay un código pedido.');
  const guardado = snap.data() || {};
  const plan = m.planConfirmarAnexo({
    codigo: data?.codigo, salt: guardado.salt, hash: guardado.hash, usado: guardado.usado === true,
    venceMs: guardado.venceMs, ahoraMs: Date.now(),
  });
  if (!plan.ok) throw new functions.https.HttpsError('failed-precondition', plan.codigo || 'CODIGO');
  const cuil = String(guardado.bolsaCuil || '');
  const bolsa = (await db().collection('eventuales_bolsa').doc(cuil).get()).data() || {};
  const contrato = contratoId ? (await db().collection('contratos_eventuales').doc(contratoId).get()).data() || {} : {};
  const empresaId = String(contrato.empresaId || data?.empresaId || '');
  const marco = (bolsa.marcos || {})[empresaId] || {};
  const lugar = String(data?.lugar || contrato.lugar || contrato.objectiveName || 'convocatoria');
  const anexoTexto = m.textoAnexo({
    marcoFecha: marco.fechaFirma, causa: contrato.causa || data?.causa, jornadas: contrato.jornadas || data?.jornadas || [],
    lugar, bruto: contrato.brutoEstimado ?? data?.bruto, empresaNombre: empresaId,
  });
  const ahora = new Date().toISOString();
  const fecha = ahora.slice(0, 10);
  const empresaDoc = empresaId ? (await db().collection('empresas').doc(empresaId).get()).data() || {} : {};
  const empresaNombre = String(empresaDoc.razonSocial || empresaDoc.nombre || empresaId || 'Empresa');
  const borrador = m.pdfDeTexto(anexoTexto);
  const hashAnexo = m.sha256(borrador);
  const constancia = m.textoConstancia({
    uid: context.auth.uid, codigoVerificado: true, fechaHora: ahora, hashAnexo,
    dispositivo: data?.dispositivo, ip: context.rawRequest?.ip, ubicacion: data?.ubicacion,
  });
  const anexoPdf = m.pdfDeTexto(`${anexoTexto}\n\n${constancia}`);
  const nombreAnexo = m.nombreArchivo({ tipo: 'ANEXO', fecha, lugar, empresa: empresaNombre });
  const anexoGuardado = await guardarPdf(cuil, bolsa, nombreAnexo, anexoPdf);
  await registrarDoc(cuil, empresaId, 'ANEXO', nombreAnexo, hashAnexo, anexoGuardado);
  await ref.set({ usado: true, usadoAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  const anexoId = ref.id;
  await db().collection('anexos_eventuales').doc(anexoId).set({
    bolsaCuil: cuil, empresaId, contratoId: contratoId || null, convocatoriaId: convocatoriaId || null,
    hashAnexo, uid: context.auth.uid, fechaHora: ahora, link: anexoGuardado.link, storagePath: anexoGuardado.storagePath,
    constanciaHash: hashAnexo, constanciaLink: anexoGuardado.link, drivePendiente: anexoGuardado.drivePendiente,
  });
  return { ok: true, hashAnexo, link: anexoGuardado.link, constanciaLink: constanciaGuardada.link };
});
