/**
 * Subida en lote de contratos marco firmados en papel.
 * `analizar`: un archivo (PDF de muchas hojas, JPG o PNG) por llamada; lee el QR de cada hoja y la deja en Storage.
 * `confirmar`: arma un PDF por persona con las hojas agrupadas y firma el marco (`firmarMarco`).
 * `descartar`: borra las hojas temporales del lote.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { exigirRrhh, firmarMarco } from '../eventuales/marcoAnexoCall';
import { extraerImagenesDePdf } from './imagenesPdf';
import { aJpeg, decodificarImagen, esJpeg, esPdf, esPng, infoJpeg, leerQr, Rgba } from './leerQr';
import { HojaJpeg, pdfDeJpegs } from './pdfDeJpegs';

const CUENTA_DRIVE = 'comtroldata@appspot.gserviceaccount.com';
const MAX_BYTES = 9 * 1024 * 1024;
const MAX_HOJAS_ARCHIVO = 200;
const MAX_LADO_GUARDADO = 2200;

type PaginaLote = { id: string; archivo: string; pagina: number; qr: string | null; sinImagen: boolean; storagePath: string };

function db() {
  return admin.firestore();
}

function prefijoLote(loteId: string) {
  return `eventuales/lotes/${loteId}/`;
}

function idSeguro(valor: unknown, max = 96): string {
  return String(valor || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, max);
}

function slug(nombre: string): string {
  return nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'archivo';
}

function reducirParaGuardar(img: Rgba): Rgba {
  const mayor = Math.max(img.width, img.height);
  if (mayor <= MAX_LADO_GUARDADO) return img;
  const factor = Math.ceil(mayor / MAX_LADO_GUARDADO);
  const width = Math.floor(img.width / factor);
  const height = Math.floor(img.height / factor);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const si = (y * factor * img.width + x * factor) * 4;
      const di = (y * width + x) * 4;
      data[di] = img.data[si]; data[di + 1] = img.data[si + 1]; data[di + 2] = img.data[si + 2]; data[di + 3] = 255;
    }
  }
  return { data, width, height };
}

async function exigirLote(loteId: string, empresaId: string, uid: string) {
  const ref = db().collection('eventuales_lotes').doc(loteId);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({ loteId, empresaId, actorUid: uid, estado: 'ANALIZANDO', archivos: 0, hojas: 0, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return ref;
  }
  const d = snap.data() || {};
  if (d.actorUid !== uid) throw new functions.https.HttpsError('permission-denied', 'Ese lote es de otro usuario.');
  if (d.empresaId !== empresaId) throw new functions.https.HttpsError('invalid-argument', 'El lote es de otra empresa.');
  if (d.estado === 'CONFIRMADO') throw new functions.https.HttpsError('failed-precondition', 'El lote ya se confirmó.');
  return ref;
}

async function analizarArchivo(loteId: string, nombre: string, bytes: Buffer): Promise<PaginaLote[]> {
  const bucket = admin.storage().bucket();
  const base = slug(nombre);
  const hojas: Array<{ jpeg: Buffer | null; rgba: Rgba | null }> = [];
  if (esPdf(bytes)) {
    const imagenes = extraerImagenesDePdf(bytes).slice(0, MAX_HOJAS_ARCHIVO);
    imagenes.forEach((img) => hojas.push({ jpeg: img.jpeg || null, rgba: img.rgba || null }));
    if (!hojas.length) hojas.push({ jpeg: null, rgba: null });
  } else if (esJpeg(bytes)) {
    hojas.push({ jpeg: bytes, rgba: null });
  } else if (esPng(bytes)) {
    hojas.push({ jpeg: null, rgba: decodificarImagen(bytes) });
  } else {
    throw new functions.https.HttpsError('invalid-argument', `${nombre}: solo PDF, JPG o PNG.`);
  }
  const salida: PaginaLote[] = [];
  for (let i = 0; i < hojas.length; i += 1) {
    const h = hojas[i];
    const id = `${base}_p${String(i + 1).padStart(3, '0')}`;
    const storagePath = `${prefijoLote(loteId)}${id}.jpg`;
    let rgba = h.rgba;
    if (!rgba && h.jpeg) rgba = decodificarImagen(h.jpeg);
    if (!rgba) {
      salida.push({ id, archivo: nombre, pagina: i + 1, qr: null, sinImagen: true, storagePath: '' });
      continue;
    }
    const qr = leerQr(rgba);
    const jpeg = h.jpeg && Math.max(rgba.width, rgba.height) <= MAX_LADO_GUARDADO * 1.5 ? h.jpeg : aJpeg(reducirParaGuardar(rgba));
    await bucket.file(storagePath).save(jpeg, { contentType: 'image/jpeg', metadata: { metadata: { loteId, archivo: nombre, pagina: String(i + 1) } } });
    salida.push({ id, archivo: nombre, pagina: i + 1, qr, sinImagen: false, storagePath });
  }
  return salida;
}

async function borrarLote(loteId: string) {
  try {
    await admin.storage().bucket().deleteFiles({ prefix: prefijoLote(loteId) });
  } catch (e) {
    console.warn('[marcosLote] no se pudieron borrar las hojas temporales', loteId, e instanceof Error ? e.message : e);
  }
}

export const subirMarcosLote = functions
  .runWith({ serviceAccount: CUENTA_DRIVE, timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    const auth = await exigirRrhh(context);
    const accion = String(data?.accion || '');
    const loteId = idSeguro(data?.loteId, 64);
    const empresaId = String(data?.empresaId || '').trim();
    if (loteId.length < 6) throw new functions.https.HttpsError('invalid-argument', 'Falta el lote.');
    if (!empresaId) throw new functions.https.HttpsError('invalid-argument', 'Falta la empresa.');
    const loteRef = await exigirLote(loteId, empresaId, auth.uid);

    if (accion === 'analizar') {
      const nombre = String(data?.archivo?.nombre || 'archivo').slice(0, 120);
      const raw = String(data?.archivo?.base64 || '');
      if (!raw) throw new functions.https.HttpsError('invalid-argument', `${nombre}: archivo vacío.`);
      const bytes = Buffer.from(raw, 'base64');
      if (bytes.length > MAX_BYTES) throw new functions.https.HttpsError('invalid-argument', `${nombre}: supera ${Math.round(MAX_BYTES / 1024 / 1024)} MB. Dividí el PDF.`);
      const paginas = await analizarArchivo(loteId, nombre, bytes);
      await loteRef.set({
        archivos: admin.firestore.FieldValue.increment(1),
        hojas: admin.firestore.FieldValue.increment(paginas.length),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return { ok: true, paginas: paginas.map(({ storagePath, ...p }) => p) };
    }

    if (accion === 'confirmar') {
      const fechaFirma = String(data?.fechaFirma || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaFirma)) throw new functions.https.HttpsError('invalid-argument', 'Fecha de firma inválida.');
      const vigenciaDias = Number(data?.vigenciaDias);
      const grupos = Array.isArray(data?.grupos) ? data.grupos : [];
      if (!grupos.length) throw new functions.https.HttpsError('invalid-argument', 'No hay personas para confirmar.');
      const bucket = admin.storage().bucket();
      const resultados: Array<{ cuil: string; ok: boolean; hojas: number; estado?: string; vencimiento?: string | null; link?: string | null; error?: string }> = [];
      for (const g of grupos) {
        const cuil = String(g?.cuil || '').replace(/\D/g, '');
        const paginaIds = (Array.isArray(g?.paginaIds) ? g.paginaIds : []).map((p: unknown) => idSeguro(p)).filter(Boolean) as string[];
        if (cuil.length !== 11 || !paginaIds.length) {
          resultados.push({ cuil, ok: false, hojas: paginaIds.length, error: 'CUIL u hojas inválidas.' });
          continue;
        }
        try {
          const hojas: HojaJpeg[] = [];
          for (const id of paginaIds) {
            const [jpeg] = await bucket.file(`${prefijoLote(loteId)}${id}.jpg`).download();
            const info = infoJpeg(jpeg);
            if (!info) throw new Error(`Hoja ${id} ilegible.`);
            hojas.push({ jpeg, ...info });
          }
          const marcoVersion = Number(g?.marcoVersion) > 0 ? Number(g.marcoVersion) : undefined;
          const r = await firmarMarco({ cuil, empresaId, fechaFirma, vigenciaDias, bytes: pdfDeJpegs(hojas), actorUid: auth.uid, marcoVersion, origen: 'LOTE' });
          resultados.push({ cuil, ok: true, hojas: hojas.length, estado: r.estado, vencimiento: r.vencimiento, link: r.link });
        } catch (e) {
          resultados.push({ cuil, ok: false, hojas: paginaIds.length, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const guardados = resultados.filter((r) => r.ok).length;
      await loteRef.set({
        estado: guardados === resultados.length ? 'CONFIRMADO' : 'PARCIAL', fechaFirma, guardados, fallidos: resultados.length - guardados,
        confirmadoAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      if (guardados === resultados.length) await borrarLote(loteId);
      return { ok: true, guardados, fallidos: resultados.length - guardados, resultados };
    }

    if (accion === 'descartar') {
      await borrarLote(loteId);
      await loteRef.set({ estado: 'DESCARTADO', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return { ok: true };
    }

    throw new functions.https.HttpsError('invalid-argument', 'Acción desconocida.');
  });
