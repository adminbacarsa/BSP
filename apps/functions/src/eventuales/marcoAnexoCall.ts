/**
 * Contrato marco (papel) y anexo por convocatoria (aceptación en la app).
 * El código de un solo uso sale por push (FCM + bandeja de Alertas) y por mail SMTP (Gmail). WhatsApp no se usa.
 */
import { Readable } from 'stream';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { MailNotConfiguredError, sendSystemMail } from '../common/mailer';

const CUENTA_DRIVE = 'comtroldata@appspot.gserviceaccount.com';
const callable = functions.runWith({ serviceAccount: CUENTA_DRIVE }).https;

const SUPER = ['SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP'];

function db() {
  return admin.firestore();
}

async function accionesEventuales(context: functions.https.CallableContext): Promise<{ super: boolean; acciones: string[] }> {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const role = String(context.auth.token.role || '');
  if (SUPER.includes(role)) return { super: true, acciones: [] };
  const sys = await db().collection('system_users').doc(context.auth.uid).get();
  const roleId = String(sys.data()?.role || role);
  if (SUPER.includes(roleId)) return { super: true, acciones: [] };
  const rol = roleId ? await db().collection('roles').doc(roleId).get() : null;
  return { super: false, acciones: (rol?.data()?.permissions?.EVENTUALES || []) as string[] };
}

export async function exigirRrhh(context: functions.https.CallableContext) {
  const p = await accionesEventuales(context);
  if (p.super || p.acciones.includes('update') || p.acciones.includes('create')) return context.auth!;
  throw new functions.https.HttpsError('permission-denied', 'No tenés permiso de eventuales.');
}

/** Solo lectura (ver o descargar PDF, listar marcos): EVENTUALES `read` alcanza. */
export async function exigirRrhhLectura(context: functions.https.CallableContext) {
  const p = await accionesEventuales(context);
  if (p.super || ['read', 'update', 'create'].some((a) => p.acciones.includes(a))) return context.auth!;
  throw new functions.https.HttpsError('permission-denied', 'No tenés permiso de eventuales.');
}

/** Baja el PDF guardado por `guardarPdf`: primero Storage, después Drive. Null si no se pudo. */
export async function bytesDePdfGuardado(p: { storagePath?: string | null; driveFileId?: string | null }): Promise<Buffer | null> {
  if (p.storagePath) {
    try {
      const [buf] = await admin.storage().bucket().file(String(p.storagePath)).download();
      if (buf?.length) return buf;
    } catch (e) {
      console.warn('[marcoAnexo] PDF no está en Storage:', (e as Error)?.message);
    }
  }
  if (p.driveFileId) {
    try {
      const { drive } = await clienteDrive();
      const res = await drive.files.get({ fileId: String(p.driveFileId), alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
      const buf = Buffer.from(res.data as ArrayBuffer);
      if (buf.length) return buf;
    } catch (e) {
      console.warn('[marcoAnexo] PDF no se pudo bajar de Drive:', (e as Error)?.message);
    }
  }
  return null;
}

/** El mismo PDF buscado por huella en `eventuales_documentos` (el anexo guarda link pero no el id de Drive). */
async function bytesPorHash(cuil: string, hash: string, tipo: string): Promise<{ bytes: Buffer | null; link: string | null }> {
  if (!hash) return { bytes: null, link: null };
  const docs = await db().collection('eventuales_documentos').where('bolsaCuil', '==', cuil).get();
  const fila = docs.docs.map((d) => d.data()).find((d) => String(d.hash || '') === hash && String(d.tipo || '') === tipo);
  if (!fila) return { bytes: null, link: null };
  return { bytes: await bytesDePdfGuardado({ storagePath: fila.storagePath, driveFileId: fila.driveFileId }), link: fila.link || null };
}

function nombreEmpresaDe(empresa: Record<string, unknown>, fallback: string) {
  return String(empresa.name || empresa.razonSocial || empresa.nombre || fallback);
}

/**
 * Datos del Anexo C de un contrato: los mismos para la firma (`confirmarAnexoEventual`) y para el
 * borrador «SIN FIRMAR» que ve RRHH desde la ficha. El bruto sale de la escala aprobada vigente a cada jornada.
 */
async function datosAnexoDeContrato(p: {
  contrato: Record<string, any>; contratoId: string; bolsa: Record<string, any>; cuil: string; hoy: string; lugar?: string; causa?: unknown; bruto?: unknown;
}) {
  const m = await lib();
  const empresaId = String(p.contrato.empresaId || '');
  const marco = (p.bolsa.marcos || {})[empresaId] || {};
  const empresaDoc = empresaId ? (await db().collection('empresas').doc(empresaId).get()).data() || {} : {};
  const jornadas = (p.contrato.jornadas || []) as { fecha?: string }[];
  const planMarco = m.planMarco({ firmado: marco.firmado === true, fechaFirma: marco.fechaFirma, vigenciaDias: marco.vigenciaDias, hoy: p.hoy });
  const brutoAnexo = await brutoDelAnexo(p.contrato, jornadas, p.hoy);
  const empresaNombre = nombreEmpresaDe(empresaDoc, empresaId || 'Empresa');
  const lugar = String(p.lugar || p.contrato.lugar || p.contrato.objectiveName || 'convocatoria');
  return {
    empresaId,
    empresaNombre,
    marco,
    brutoAnexo,
    lugar,
    datosAnexo: {
      numero: String(p.contrato.numero || p.contratoId || '').slice(0, 24),
      empresaNombre,
      empresaCuit: String(empresaDoc.cuit || ''),
      trabajadorNombre: String(p.bolsa.nombre || ''),
      trabajadorDni: String(p.bolsa.dni || ''),
      trabajadorCuil: p.cuil,
      marcoFecha: marco.fechaFirma,
      marcoVencimiento: planMarco.vencimiento,
      causa: p.contrato.causa || p.causa,
      lugar,
      jornadas,
      bruto: brutoAnexo.brutoTexto ?? p.contrato.brutoEstimado ?? p.bruto,
      escalaTexto: brutoAnexo.escalaTexto,
    },
  };
}

export async function lib() {
  return import('../eventuales-shared/marcoAnexo.mjs') as Promise<{
    textoMarco: (i: Record<string, string>) => string;
    datosTrabajador: (bolsa: Record<string, unknown>, cuil?: string) => {
      trabajadorNombre: string; trabajadorDni: string; trabajadorCuil: string; trabajadorDomicilio: string; telefono: string; mail: string;
    };
    textoAnexo: (i: Record<string, unknown>) => string;
    textoConstancia: (i: Record<string, unknown>) => string;
    pdfMarco: (i: Record<string, unknown>) => Promise<{ bytes: Buffer; paginas: number }>;
    pdfAnexo: (i: Record<string, unknown>) => Promise<{ bytes: Buffer; paginas: number }>;
    pdfMarcosLote: (i: Record<string, unknown>) => Promise<{ bytes: Buffer; paginas: number }>;
    pdfDeTexto: (t: string) => Buffer;
    sha256: (v: Buffer | string) => string;
    planMarco: (i: Record<string, unknown>) => { estado: string; vencimiento: string | null; avisar: boolean };
    nombreCarpetaPersona: (i: { cuil: string; nombre: string; legajo?: string }) => string;
    nombreArchivo: (i: { tipo: string; fecha: string; lugar?: string; empresa?: string }) => string;
    planRenombre: (actual: string, nuevo: string) => { renombrar: boolean; nombre: string };
    planCarpetaEventuales: (nombreRaiz: string) => { usarRaiz: boolean; nombre: string };
    legajoDe: (bolsa: Record<string, unknown>) => string;
    DRIVE_ROOT_EVENTUALES_DEFAULT: string;
    CARPETA_EVENTUALES: string;
    destinoGuardado: (folderId: string) => string;
    nuevoCodigoAnexo: () => string;
    hashCodigo: (codigo: string, salt: string) => string;
    planConfirmarAnexo: (i: Record<string, unknown>) => { ok: boolean; codigo?: string };
    canalCodigo: (i: { mail?: string; tienePush?: boolean }) => { ok: boolean; codigo?: string; canales?: string[]; mensaje?: string };
    mensajeEnvioCodigo: (i: { canales?: string[]; mail?: string }) => string;
    MENSAJE_SIN_CANAL: string;
    CODIGO_ANEXO_MINUTOS: number;
    VIGENCIA_MARCO_DIAS: number;
  }>;
}

/**
 * Bruto que va en el anexo. Toma las `escalas_salariales` ACTIVE (las escribe `gestionarEscalaCct` al
 * aprobar) vigentes a la fecha de cada jornada; si en esa fecha no hay, usa la de hoy y el anexo lo dice.
 * Si no hay ninguna escala, el anexo queda con «[monto calculado]» como antes.
 */
export async function brutoDelAnexo(
  contrato: Record<string, unknown>,
  jornadas: unknown[],
  hoy: string,
): Promise<{ bruto: number | null; brutoTexto: string | null; escalaTexto: string; escalas: string[]; escalaRespaldo: boolean }> {
  const vacio = { bruto: null, brutoTexto: null, escalaTexto: '', escalas: [] as string[], escalaRespaldo: false };
  try {
    const { calcularRemuneracionContrato, textoEscalaAplicada, formatoPesos } = await import('../eventuales-shared/remuneracion.mjs') as {
      calcularRemuneracionContrato: (i: Record<string, unknown>) => Record<string, any>;
      textoEscalaAplicada: (r: Record<string, unknown>) => string;
      formatoPesos: (n: number) => string;
    };
    const { fechasFeriadosNacionales } = await import('../eventuales-shared/plazoAnulacion.mjs') as {
      fechasFeriadosNacionales: (f: unknown[]) => string[];
    };
    const [escalasSnap, feriadosSnap] = await Promise.all([
      db().collection('escalas_salariales').where('status', '==', 'ACTIVE').get(),
      db().collection('feriados').get(),
    ]);
    if (escalasSnap.empty) return vacio;
    const feriados = fechasFeriadosNacionales(feriadosSnap.docs.map((d) => d.data()));
    let nocturnoPct: number | null = null;
    const empresaId = String(contrato.empresaId || '');
    if (empresaId) {
      const empresa = await db().collection('empresas').doc(empresaId).get();
      const n = empresa.data()?.arcaEventuales?.nocturnoPct;
      if (typeof n === 'number' && Number.isFinite(n)) nocturnoPct = n;
    }
    const r = calcularRemuneracionContrato({
      jornadas: Array.isArray(jornadas) ? jornadas : [],
      categoria: String(contrato.categoria || 'VIGILADOR_GENERAL'),
      escalas: escalasSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      feriados,
      incluirCierre: false,
      hoy,
      nocturnoPct,
    });
    if (!r.ok || !(Number(r.bruto) > 0)) return vacio;
    return {
      bruto: Number(r.bruto),
      brutoTexto: formatoPesos(Number(r.bruto)),
      escalaTexto: textoEscalaAplicada(r),
      escalas: Array.isArray(r.escalas) ? r.escalas.map(String) : [],
      escalaRespaldo: r.escalaRespaldo === true,
    };
  } catch (e) {
    console.warn('[anexo] bruto no calculado:', (e as Error)?.message);
    return vacio;
  }
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
    const raiz = await drive.files.get({ fileId: rootId, supportsAllDrives: true, fields: 'id, name' });
    const plan = m.planCarpetaEventuales(String(raiz.data.name || ''));
    padre = plan.usarRaiz ? rootId : await resolveOrCreateDriveFolder(drive, rootId, plan.nombre);
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

export async function guardarPdf(cuil: string, bolsa: Record<string, unknown>, nombre: string, bytes: Buffer) {
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

export async function registrarDoc(cuil: string, empresaId: string, tipo: string, nombre: string, hash: string, guardado: { link: string | null; driveFileId: string | null; drivePendiente: boolean; storagePath: string | null }) {
  await db().collection('eventuales_documentos').add({
    bolsaCuil: cuil, empresaId, tipo, nombre, hash, link: guardado.link, driveFileId: guardado.driveFileId,
    drivePendiente: guardado.drivePendiente, storagePath: guardado.storagePath,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/** Marco firmado en papel: guarda el escaneo, marca MARCO_VIGENTE y deja auditoría. Lo usan la ficha y el lote. */
export async function firmarMarco(params: {
  cuil: string; empresaId: string; fechaFirma: string; vigenciaDias?: number; bytes: Buffer; actorUid: string;
  marcoVersion?: number; origen?: string;
}) {
  const m = await lib();
  const { cuil, empresaId, fechaFirma, bytes, actorUid } = params;
  const vigenciaDias = Number(params.vigenciaDias) > 0 ? Number(params.vigenciaDias) : m.VIGENCIA_MARCO_DIAS;
  const hoy = new Date().toISOString().slice(0, 10);
  const plan = m.planMarco({ firmado: true, fechaFirma, vigenciaDias, hoy });
  if (plan.estado === 'SIN_MARCO') throw new functions.https.HttpsError('invalid-argument', 'Falta la fecha de firma.');
  if (!bytes?.length) throw new functions.https.HttpsError('invalid-argument', 'Falta el escaneo firmado.');
  const bolsaSnap = await db().collection('eventuales_bolsa').doc(cuil).get();
  if (!bolsaSnap.exists) throw new functions.https.HttpsError('not-found', 'No está en la bolsa.');
  const bolsa = bolsaSnap.data() || {};
  const empresa = (await db().collection('empresas').doc(empresaId).get()).data() || {};
  const empresaNombre = String(empresa.name || empresa.razonSocial || empresa.nombre || empresaId);
  const hash = m.sha256(bytes);
  const nombrePdf = m.nombreArchivo({ tipo: 'MARCO', fecha: fechaFirma, empresa: empresaNombre });
  const guardado = await guardarPdf(cuil, bolsa, nombrePdf, bytes);
  await registrarDoc(cuil, empresaId, 'MARCO', nombrePdf, hash, guardado);
  const ficha = { firmado: true, fechaFirma, vigenciaDias, vencimiento: plan.vencimiento, estado: plan.estado, hash, link: guardado.link };
  await db().collection('contratos_marco').doc(`${cuil}_${empresaId}`).set({
    bolsaCuil: cuil, empresaId, ...ficha, storagePath: guardado.storagePath, driveFileId: guardado.driveFileId, drivePendiente: guardado.drivePendiente,
    firmadoPor: actorUid, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(params.marcoVersion ? { marcoVersion: params.marcoVersion } : {}),
    ...(params.origen ? { origen: params.origen } : {}),
  }, { merge: true });
  await db().collection('eventuales_bolsa').doc(cuil).set({ marcos: { [empresaId]: ficha } }, { merge: true });
  await db().collection('audit_logs').add({
    action: 'EVENTUAL_MARCO', module: 'EVENTUALES', actorUid, bolsaCuil: cuil, empresaId,
    details: `${plan.estado} hasta ${plan.vencimiento}${params.origen ? ` (${params.origen})` : ''}`, timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, ...plan, hash, ...guardado };
}

const ACCIONES_LECTURA = ['listar', 'anexoPdf', 'marcoPdf'];

export const gestionarMarcoEventual = callable.onCall(async (data, context) => {
  const accion = String(data?.accion || '');
  const auth = ACCIONES_LECTURA.includes(accion) ? await exigirRrhhLectura(context) : await exigirRrhh(context);
  const m = await lib();
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

  if (accion === 'imprimirLote') {
    if (!empresaId) throw new functions.https.HttpsError('invalid-argument', 'Falta la empresa.');
    const crudos: unknown[] = Array.isArray(data?.cuils) ? data.cuils : [];
    const cuils = [...new Set(crudos.map((c) => String(c || '').replace(/\D/g, '')).filter((c) => c.length === 11))].slice(0, 60);
    if (!cuils.length) throw new functions.https.HttpsError('invalid-argument', 'No hay personas para imprimir.');
    const empresaDoc = (await db().collection('empresas').doc(empresaId).get()).data() || {};
    const personas = [];
    for (const id of cuils) {
      const bolsa = (await db().collection('eventuales_bolsa').doc(id).get()).data() || {};
      const trab = m.datosTrabajador(bolsa, id);
      personas.push({
        cuil: trab.trabajadorCuil || id,
        nombre: trab.trabajadorNombre,
        dni: trab.trabajadorDni,
        domicilio: trab.trabajadorDomicilio,
        telefono: trab.telefono,
        mail: trab.mail,
      });
    }
    const out = await m.pdfMarcosLote({
      empresa: {
        id: empresaId,
        nombre: String(empresaDoc.name || empresaDoc.razonSocial || empresaDoc.nombre || empresaId),
        cuit: String(empresaDoc.cuit || ''),
        domicilio: String(empresaDoc.direccion || empresaDoc.domicilio || ''),
      },
      personas,
      fecha: String(data?.fecha || new Date().toISOString().slice(0, 10)),
    });
    return { ok: true, paginas: out.paginas, pdfBase64: out.bytes.toString('base64') };
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

  // PDF del anexo de un contrato: el firmado si existe; si no, el borrador marcado «SIN FIRMAR» generado al vuelo.
  if (accion === 'anexoPdf') {
    const contratoId = String(data?.contratoId || '');
    if (!contratoId) throw new functions.https.HttpsError('invalid-argument', 'Falta el contrato.');
    const ctrSnap = await db().collection('contratos_eventuales').doc(contratoId).get();
    const contrato = (ctrSnap.data() || {}) as Record<string, any>;
    if (!ctrSnap.exists || String(contrato.bolsaCuil || '') !== cuil) {
      throw new functions.https.HttpsError('not-found', 'El contrato no es de este eventual.');
    }
    const bolsa = (await db().collection('eventuales_bolsa').doc(cuil).get()).data() || {};
    const empresaCtr = String(contrato.empresaId || '');
    const empresaDoc = empresaCtr ? (await db().collection('empresas').doc(empresaCtr).get()).data() || {} : {};
    const empresaNombre = nombreEmpresaDe(empresaDoc, empresaCtr || 'Empresa');
    const fechaCtr = String(contrato.fechaAlta || contrato.jornadas?.[0]?.fecha || '').slice(0, 10);
    const { nombrePdfAnexo } = await import('../eventuales-shared/contratoVista.mjs') as {
      nombrePdfAnexo: (i: { empresa: string; fecha: string; firmado: boolean }) => string;
    };
    const anexosSnap = await db().collection('anexos_eventuales').where('contratoId', '==', contratoId).limit(5).get();
    const firmado = anexosSnap.docs.map((d) => d.data()).sort((a, b) => String(b.fechaHora || '').localeCompare(String(a.fechaHora || '')))[0] || null;
    if (firmado) {
      let bytes = await bytesDePdfGuardado({ storagePath: firmado.storagePath, driveFileId: firmado.driveFileId });
      let link: string | null = firmado.link || null;
      if (!bytes) {
        const porHash = await bytesPorHash(cuil, String(firmado.hashAnexo || ''), 'ANEXO');
        bytes = porHash.bytes;
        link = link || porHash.link;
      }
      const nombre = nombrePdfAnexo({ empresa: empresaNombre, fecha: fechaCtr, firmado: true });
      if (bytes) return { ok: true, firmado: true, nombre, pdfBase64: bytes.toString('base64'), link };
      if (link) return { ok: true, firmado: true, nombre, pdfBase64: null, link };
      throw new functions.https.HttpsError('not-found', 'El anexo firmado no está disponible para descargar.');
    }
    const hoy = new Date().toISOString().slice(0, 10);
    const armado = await datosAnexoDeContrato({ contrato, contratoId, bolsa, cuil, hoy });
    const pdf = (await m.pdfAnexo({ ...armado.datosAnexo, sinFirmar: true, generadoEl: hoy })).bytes;
    await db().collection('audit_logs').add({
      action: 'EVENTUAL_ANEXO_BORRADOR_VISTO', module: 'EVENTUALES', actorUid: auth.uid, bolsaCuil: cuil, empresaId: empresaCtr, contratoId,
      details: 'Anexo sin firmar generado desde la ficha', timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {
      ok: true,
      firmado: false,
      nombre: nombrePdfAnexo({ empresa: empresaNombre, fecha: fechaCtr, firmado: false }),
      pdfBase64: pdf.toString('base64'),
      link: null,
      escalaTexto: armado.brutoAnexo.escalaTexto,
      brutoTexto: armado.brutoAnexo.brutoTexto,
    };
  }

  // PDF del contrato marco firmado (escaneo cargado por RRHH) de una empresa.
  if (accion === 'marcoPdf') {
    if (!empresaId) throw new functions.https.HttpsError('invalid-argument', 'Falta la empresa.');
    const marcoSnap = await db().collection('contratos_marco').doc(`${cuil}_${empresaId}`).get();
    const marco = (marcoSnap.data() || {}) as Record<string, any>;
    if (!marcoSnap.exists || marco.firmado !== true) {
      throw new functions.https.HttpsError('failed-precondition', 'No hay contrato marco firmado cargado para esta empresa.');
    }
    const empresaDoc = (await db().collection('empresas').doc(empresaId).get()).data() || {};
    const { nombrePdfMarco } = await import('../eventuales-shared/contratoVista.mjs') as {
      nombrePdfMarco: (i: { empresa: string; fecha: string }) => string;
    };
    const nombre = nombrePdfMarco({ empresa: nombreEmpresaDe(empresaDoc, empresaId), fecha: String(marco.fechaFirma || '') });
    let bytes = await bytesDePdfGuardado({ storagePath: marco.storagePath, driveFileId: marco.driveFileId });
    let link: string | null = marco.link || null;
    if (!bytes) {
      const porHash = await bytesPorHash(cuil, String(marco.hash || ''), 'MARCO');
      bytes = porHash.bytes;
      link = link || porHash.link;
    }
    if (bytes) return { ok: true, nombre, pdfBase64: bytes.toString('base64'), link, fechaFirma: marco.fechaFirma || null, vencimiento: marco.vencimiento || null };
    if (link) return { ok: true, nombre, pdfBase64: null, link, fechaFirma: marco.fechaFirma || null, vencimiento: marco.vencimiento || null };
    throw new functions.https.HttpsError('not-found', 'El marco firmado no está disponible para descargar.');
  }

  // RRHH reenvía el código del anexo (push y/o mail). Siempre genera un código nuevo.
  if (accion === 'reenviarCodigoAnexo') {
    const contratoId = String(data?.contratoId || '');
    if (!contratoId) throw new functions.https.HttpsError('invalid-argument', 'Falta el contrato.');
    const ctrRef = db().collection('contratos_eventuales').doc(contratoId);
    const ctrSnap = await ctrRef.get();
    const contrato = (ctrSnap.data() || {}) as Record<string, any>;
    if (!ctrSnap.exists || String(contrato.bolsaCuil || '') !== cuil) {
      throw new functions.https.HttpsError('not-found', 'El contrato no es de este eventual.');
    }
    if (String(contrato.anexoEstado || '') === 'FIRMADO') throw new functions.https.HttpsError('failed-precondition', 'El anexo ya está firmado.');
    if (['ANULADO', 'SUSTITUIDO'].includes(String(contrato.estado || ''))) throw new functions.https.HttpsError('failed-precondition', 'El contrato ya no está vigente.');
    const bolsa = (await db().collection('eventuales_bolsa').doc(cuil).get()).data() || {};
    const { exigeMarco } = await import('../eventuales-shared/pruebasSwitch.mjs') as { exigeMarco: (b: unknown) => boolean };
    if (!exigeMarco(bolsa)) throw new functions.https.HttpsError('failed-precondition', 'A este eventual no se le exige anexo (switch de pruebas).');
    const envio = await enviarCodigoAnexo({ contratoId, convocatoriaId: '', cuil, bolsa, uid: String(bolsa.uid || '') });
    const anexoEstado = envio.ok ? 'PENDIENTE' : 'SIN_CANAL';
    await ctrRef.set({
      anexoEstado, anexoMensaje: envio.mensaje, anexoReenviadoAt: admin.firestore.FieldValue.serverTimestamp(), anexoReenviadoPor: auth.uid,
    }, { merge: true });
    const turnos = await db().collection('turnos').where('eventualContratoId', '==', contratoId).get();
    if (!turnos.empty) {
      const batch = db().batch();
      turnos.docs.forEach((d) => { if (d.data().anexoEstado !== anexoEstado) batch.update(d.ref, { anexoEstado }); });
      await batch.commit();
    }
    await db().collection('audit_logs').add({
      action: 'EVENTUAL_ANEXO_CODIGO_REENVIADO', module: 'EVENTUALES', actorUid: auth.uid, bolsaCuil: cuil, empresaId: String(contrato.empresaId || ''), contratoId,
      details: envio.ok ? `Código reenviado por ${envio.canales.join(' y ')}` : `Sin canal: ${envio.mensaje}`, timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (!envio.ok) throw new functions.https.HttpsError('failed-precondition', envio.mensaje);
    return { ok: true, anexoEstado, canales: envio.canales, venceMs: envio.venceMs, mensaje: envio.mensaje };
  }

  if (!empresaId && accion !== 'reintentar') throw new functions.https.HttpsError('invalid-argument', 'Falta la empresa.');
  const bolsaSnap = await db().collection('eventuales_bolsa').doc(cuil).get();
  if (!bolsaSnap.exists) throw new functions.https.HttpsError('not-found', 'No está en la bolsa.');
  const bolsa = bolsaSnap.data() || {};
  const empresa = (await db().collection('empresas').doc(empresaId).get()).data() || {};
  const nombre = String(bolsa.nombre || cuil);
  const empresaNombre = String(empresa.name || empresa.razonSocial || empresa.nombre || empresaId);

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
    const trab = m.datosTrabajador(bolsa, cuil);
    const pdf = (await m.pdfMarco({
      empresaId,
      empresaNombre: String(empresa.name || empresa.razonSocial || empresa.nombre || empresaId),
      empresaCuit: String(empresa.cuit || ''),
      empresaDomicilio: String(empresa.direccion || empresa.domicilio || ''),
      ...trab,
      trabajadorNombre: trab.trabajadorNombre || nombre,
      fecha: String(data?.fecha || new Date().toISOString().slice(0, 10)),
    })).bytes;
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
    const raw = String(data?.pdfBase64 || '');
    if (!raw) throw new functions.https.HttpsError('invalid-argument', 'Falta el escaneo firmado.');
    return firmarMarco({
      cuil, empresaId, fechaFirma: String(data?.fechaFirma || ''), vigenciaDias: Number(data?.vigenciaDias),
      bytes: Buffer.from(raw, 'base64'), actorUid: auth.uid,
    });
  }

  throw new functions.https.HttpsError('invalid-argument', 'Acción desconocida.');
});

async function tieneTokenPush(uid: string): Promise<boolean> {
  if (!uid) return false;
  const [porUid, directo] = await Promise.all([
    db().collection('device_tokens').where('uid', '==', uid).limit(5).get(),
    db().collection('device_tokens').doc(uid).get(),
  ]);
  const sirve = (data: FirebaseFirestore.DocumentData | undefined) => String(data?.token || '').length > 10;
  if (porUid.docs.some((d) => sirve(d.data()))) return true;
  return sirve(directo.data());
}

async function enviarMailCodigo(destino: string, codigo: string): Promise<void> {
  try {
    await sendSystemMail({
      to: destino,
      subject: 'Código para aceptar el anexo',
      text: `Tu código de 6 dígitos para aceptar el anexo es ${codigo}. Vence en 15 minutos. Si no lo pediste, avisá a RRHH.`,
    });
  } catch (err) {
    if (err instanceof MailNotConfiguredError) {
      throw new functions.https.HttpsError('failed-precondition', 'El mail no está configurado. Contactá a RRHH.');
    }
    throw new functions.https.HttpsError('internal', err instanceof Error ? err.message : 'No se pudo enviar el mail.');
  }
}

async function refCodigo(contratoId: string, convocatoriaId: string) {
  const id = contratoId || convocatoriaId;
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'Falta el contrato o la convocatoria.');
  return db().collection('anexo_codigos').doc(id);
}

/**
 * Genera y manda el código OTP del anexo (push y/o mail) y guarda su hash en `anexo_codigos/{contratoId|convocatoriaId}`.
 * Lo usan la callable `pedirCodigoAnexoEventual` (la app), la asignación de Planificación
 * y la aceptación de un evento (`aceptarConvocatoriaEventualEvento`), vía `despacharCodigoAnexoDeContrato`.
 * Si no hay canal devuelve `{ ok: false, mensaje }` sin lanzar: quien llama decide si es error.
 */
export async function enviarCodigoAnexo(p: {
  contratoId: string;
  convocatoriaId: string;
  cuil: string;
  bolsa: Record<string, unknown>;
  uid: string;
}): Promise<{ ok: boolean; canales: string[]; venceMs: number | null; mensaje: string }> {
  const m = await lib();
  const ref = await refCodigo(p.contratoId, p.convocatoriaId);
  const mail = String(p.bolsa.mail || '');
  const canal = m.canalCodigo({ mail, tienePush: await tieneTokenPush(p.uid) });
  if (!canal.ok) return { ok: false, canales: [], venceMs: null, mensaje: canal.mensaje || m.MENSAJE_SIN_CANAL };
  const codigo = m.nuevoCodigoAnexo();
  const salt = admin.firestore().collection('_').doc().id;
  const venceMs = Date.now() + m.CODIGO_ANEXO_MINUTOS * 60 * 1000;
  const entregados: string[] = [];
  if (canal.canales?.includes('PUSH')) {
    await db().collection('user_notifications').add({
      uid: p.uid,
      title: 'Código para aceptar el anexo',
      body: `Tu código es ${codigo}. Vence en 15 minutos.`,
      type: 'CODIGO_ANEXO',
      target: 'employee',
      read: false,
      contratoId: p.contratoId || null,
      convocatoriaId: p.convocatoriaId || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    entregados.push('PUSH');
  }
  if (canal.canales?.includes('MAIL')) {
    try {
      await enviarMailCodigo(mail, codigo);
      entregados.push('MAIL');
    } catch (err) {
      if (!entregados.length) {
        const mensaje = err instanceof functions.https.HttpsError ? err.message : 'No pudimos enviar el mail. Contactá a RRHH.';
        return { ok: false, canales: [], venceMs: null, mensaje };
      }
    }
  }
  if (!entregados.length) return { ok: false, canales: [], venceMs: null, mensaje: m.MENSAJE_SIN_CANAL };
  await ref.set({
    contratoId: p.contratoId || null,
    convocatoriaId: p.convocatoriaId || null,
    bolsaCuil: p.cuil,
    salt,
    hash: m.hashCodigo(codigo, salt),
    usado: false,
    venceMs,
    canales: entregados,
    pendienteEnvio: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, canales: entregados, venceMs, mensaje: m.mensajeEnvioCodigo({ canales: entregados, mail }) };
}

export const pedirCodigoAnexoEventual = callable.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const contratoId = String(data?.contratoId || '');
  const convocatoriaId = String(data?.convocatoriaId || '');
  await refCodigo(contratoId, convocatoriaId);
  const cuil = String(data?.cuil || context.auth.token.bolsaCuil || '');
  const bolsa = cuil ? (await db().collection('eventuales_bolsa').doc(cuil).get()).data() || {} : {};
  if (bolsa.uid && bolsa.uid !== context.auth.uid && String(context.auth.token.role) !== 'EVENTUAL') {
    throw new functions.https.HttpsError('permission-denied', 'El código es del eventual.');
  }
  const uid = String(bolsa.uid || context.auth.uid || '');
  const envio = await enviarCodigoAnexo({ contratoId, convocatoriaId, cuil, bolsa, uid });
  if (!envio.ok) throw new functions.https.HttpsError('failed-precondition', envio.mensaje);
  return { ok: true, canales: envio.canales, venceMs: envio.venceMs, mensaje: envio.mensaje };
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
  if (guardado.sinEfecto === true) {
    throw new functions.https.HttpsError('failed-precondition', 'El anexo quedó sin efecto: esa prestación no se va a cumplir.');
  }
  const plan = m.planConfirmarAnexo({
    codigo: data?.codigo, salt: guardado.salt, hash: guardado.hash, usado: guardado.usado === true,
    venceMs: guardado.venceMs, ahoraMs: Date.now(),
  });
  if (!plan.ok) throw new functions.https.HttpsError('failed-precondition', plan.codigo || 'CODIGO');
  const cuil = String(guardado.bolsaCuil || '');
  const bolsa = (await db().collection('eventuales_bolsa').doc(cuil).get()).data() || {};
  const contratoCrudo = contratoId ? (await db().collection('contratos_eventuales').doc(contratoId).get()).data() || {} : {};
  const contrato = {
    ...contratoCrudo,
    empresaId: String(contratoCrudo.empresaId || data?.empresaId || ''),
    jornadas: contratoCrudo.jornadas || data?.jornadas || [],
  } as Record<string, any>;
  const ahora = new Date().toISOString();
  const fecha = ahora.slice(0, 10);
  // Bruto del anexo: escala APROBADA vigente a la fecha de cada jornada; sin escala en esa fecha, la de hoy y aviso.
  const armado = await datosAnexoDeContrato({
    contrato, contratoId: contratoId || ref.id, bolsa, cuil, hoy: fecha, lugar: data?.lugar ? String(data.lugar) : undefined, causa: data?.causa, bruto: data?.bruto,
  });
  const { empresaId, empresaNombre, marco, brutoAnexo, lugar, datosAnexo } = armado;
  const { resumirDispositivo } = await import('../eventuales-shared/contratoVista.mjs') as { resumirDispositivo: (d: unknown, ua?: unknown) => string };
  const dispositivo = resumirDispositivo(data?.dispositivo, context.rawRequest?.headers?.['user-agent']);
  const anexoTexto = m.textoAnexo(datosAnexo);
  const hashAnexo = m.sha256(anexoTexto);
  const anexoPdf = (await m.pdfAnexo({
    ...datosAnexo,
    constancia: {
      numero: datosAnexo.numero,
      marcoFecha: marco.fechaFirma,
      trabajadorNombre: datosAnexo.trabajadorNombre,
      cuil,
      mail: String(bolsa.mail || ''),
      uid: context.auth.uid,
      fechaHora: ahora,
      codigoVerificado: true,
      dispositivo: dispositivo || data?.dispositivo,
      ip: context.rawRequest?.ip,
      ubicacion: data?.ubicacion,
      hashAnexo,
    },
  })).bytes;
  const nombreAnexo = m.nombreArchivo({ tipo: 'ANEXO', fecha, lugar, empresa: empresaNombre });
  const anexoGuardado = await guardarPdf(cuil, bolsa, nombreAnexo, anexoPdf);
  await registrarDoc(cuil, empresaId, 'ANEXO', nombreAnexo, hashAnexo, anexoGuardado);
  await ref.set({ usado: true, usadoAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  const anexoId = ref.id;
  await db().collection('anexos_eventuales').doc(anexoId).set({
    bolsaCuil: cuil, empresaId, contratoId: contratoId || null, convocatoriaId: convocatoriaId || null,
    hashAnexo, uid: context.auth.uid, fechaHora: ahora, link: anexoGuardado.link, storagePath: anexoGuardado.storagePath,
    driveFileId: anexoGuardado.driveFileId, nombreArchivo: nombreAnexo,
    dispositivo: dispositivo || null, ip: context.rawRequest?.ip || null,
    constanciaHash: hashAnexo, constanciaLink: anexoGuardado.link, drivePendiente: anexoGuardado.drivePendiente,
    bruto: brutoAnexo.bruto, brutoTexto: brutoAnexo.brutoTexto, escalas: brutoAnexo.escalas, escalaRespaldo: brutoAnexo.escalaRespaldo, escalaTexto: brutoAnexo.escalaTexto || null,
  });
  // La convocatoria del evento (si la hubo) pasa a «anexo firmado» para la solapa Estado.
  if (contratoId) {
    const sols = await db().collection('solicitudes_evento').where('contratoId', '==', contratoId).get();
    for (const s of sols.docs) {
      if (s.data().esEventual !== true) continue;
      await s.ref.update({ anexoEstado: 'FIRMADO', anexoId, anexoHash: hashAnexo, anexoFirmadoAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    await db().collection('contratos_eventuales').doc(contratoId).set({ anexoEstado: 'FIRMADO' }, { merge: true });
    const turnos = await db().collection('turnos').where('eventualContratoId', '==', contratoId).get();
    if (!turnos.empty) {
      const batch = db().batch();
      turnos.docs.forEach((d) => batch.update(d.ref, { anexoEstado: 'FIRMADO' }));
      await batch.commit();
    }
  }
  return { ok: true, hashAnexo, link: anexoGuardado.link, constanciaLink: anexoGuardado.link };
});
