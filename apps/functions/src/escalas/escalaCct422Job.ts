/**
 * Job diario de la escala 422/05: mira las fuentes (PDF directo o página con links a PDF), compara el
 * hash del documento contra lo ya conocido y, si hay uno nuevo, lo lee (Gemini visión) y lo deja como
 * PROPUESTA con aviso a Eventuales. Si una fuente no responde, se anota y se sigue: nunca rompe nada.
 * Lógica pura separada (`planChequeo`, `linksPdfDe`) para probarla sin red con fixtures.
 */
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { sha256Hex, type PropuestaEscala422 } from './escalaCct422Core';
import { avisarEscalaCct, guardarPropuestaEscala, NOVEDAD_ESCALA_PROPUESTA } from './escalaCctStore';

export interface FuenteEscala {
  id: string;
  url: string;
  tipo: 'PDF' | 'HTML';
  titulo?: string | null;
  activa?: boolean;
}

/**
 * Fuentes por defecto. El sitio de SUVICO enlaza la escala vigente (Drive); la ficha de la última
 * disposición homologatoria en argentina.gob.ar trae el PDF del anexo con capa de texto.
 * Se pisan con `config/escalas_cct.fuentes` sin redeploy.
 */
export const FUENTES_CCT_422_DEFAULT: FuenteEscala[] = [
  { id: 'suvico_home', url: 'https://www.suvico.org.ar/', tipo: 'HTML', titulo: 'SUVICO — sitio (links a la escala)', activa: true },
  { id: 'suvico_drive_escala', url: 'https://drive.google.com/uc?export=download&id=10ZbxKgonf2OtH7bCmCe-zQJYDUN02sbc', tipo: 'PDF', titulo: 'SUVICO — escala salarial (Drive)', activa: true },
  { id: 'argentina_disp_120_2026', url: 'https://www.argentina.gob.ar/normativa/nacional/disposici%C3%B3n-120-2026-426471', tipo: 'HTML', titulo: 'argentina.gob.ar — Disposición DNRYRT 120/2026 (ficha)', activa: true },
];

export const MAX_PDFS_POR_FUENTE = 3;
export const MAX_PDF_BYTES = 12 * 1024 * 1024;
export const TIMEOUT_MS = 20_000;

export interface DocumentoFuente { url: string; hash: string; bytes?: Buffer }
export interface ResultadoFuente { fuenteId: string; ok: boolean; error?: string | null; documentos: DocumentoFuente[] }
export type AccionTipo = 'FUENTE_NO_RESPONDE' | 'SIN_DOCUMENTOS' | 'SIN_CAMBIO' | 'NUEVO_DOCUMENTO';
export interface AccionFuente { fuenteId: string; accion: AccionTipo; documento?: DocumentoFuente; error?: string | null }

/** Links a PDF de una página: href absolutos/relativos y archivos de Drive (`/file/d/{id}` → descarga directa). */
export function linksPdfDe(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const texto = String(html || '');
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(texto))) {
    const href = m[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) continue;
    let abs: string;
    try { abs = new URL(href, baseUrl).toString(); } catch { continue; }
    const drive = abs.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=download&)?id=)([A-Za-z0-9_-]{20,})/);
    if (drive) { out.add(`https://drive.google.com/uc?export=download&id=${drive[1]}`); continue; }
    if (/\.pdf(\?|#|$)/i.test(abs)) out.add(abs);
  }
  return [...out];
}

/** Decide qué hacer con cada fuente según lo descargado y los hashes ya conocidos. */
export function planChequeo(resultados: ResultadoFuente[], conocidos: Set<string>): AccionFuente[] {
  const acciones: AccionFuente[] = [];
  const yaPropuestos = new Set<string>();
  for (const r of resultados) {
    if (!r.ok) { acciones.push({ fuenteId: r.fuenteId, accion: 'FUENTE_NO_RESPONDE', error: r.error || null }); continue; }
    if (!r.documentos.length) { acciones.push({ fuenteId: r.fuenteId, accion: 'SIN_DOCUMENTOS' }); continue; }
    const nuevos = r.documentos.filter((d) => d.hash && !conocidos.has(d.hash) && !yaPropuestos.has(d.hash));
    if (!nuevos.length) { acciones.push({ fuenteId: r.fuenteId, accion: 'SIN_CAMBIO' }); continue; }
    for (const d of nuevos) {
      yaPropuestos.add(d.hash);
      acciones.push({ fuenteId: r.fuenteId, accion: 'NUEVO_DOCUMENTO', documento: d });
    }
  }
  return acciones;
}

export interface LecturaPdf { propuesta: PropuestaEscala422; modelo: string | null }

export interface EscalaJobStore {
  fuentes(): Promise<FuenteEscala[]>;
  hashesConocidos(): Promise<Set<string>>;
  guardarPropuesta(p: PropuestaEscala422, meta: { fuenteId: string; modelo: string | null }): Promise<{ docId: string; yaExistia: boolean }>;
  avisar(docId: string, p: PropuestaEscala422): Promise<void>;
  registrarChequeo(fuenteId: string, estado: Record<string, unknown>): Promise<void>;
}

export interface EscalaJobDeps {
  store: EscalaJobStore;
  fetchImpl?: typeof fetch;
  /** Lee el PDF (Gemini). Si no hay clave, se omite la lectura y el documento queda anotado como pendiente. */
  leerPdf?: ((bytes: Buffer, meta: { fuenteUrl: string; titulo: string | null }) => Promise<LecturaPdf>) | null;
  now?: Date;
  log?: (msg: string) => void;
}

export interface EscalaJobResumen {
  fuentes: number;
  acciones: AccionFuente[];
  propuestas: { docId: string; fuenteId: string; vigenciaDesde: string | null }[];
  descartados: { fuenteId: string; hash: string; motivo: string }[];
  errores: { fuenteId: string; error: string }[];
}

async function descargar(fetchImpl: typeof fetch, url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow', headers: { 'user-agent': 'COSP-escalas/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_PDF_BYTES) throw new Error(`Documento de ${ab.byteLength} bytes supera el máximo`);
  return { bytes: Buffer.from(ab), contentType: String(res.headers.get('content-type') || '') };
}

const esPdf = (b: Buffer) => b.length > 100 && b.subarray(0, 5).toString('latin1') === '%PDF-';

async function leerFuente(fetchImpl: typeof fetch, f: FuenteEscala): Promise<ResultadoFuente> {
  try {
    if (f.tipo === 'PDF') {
      const { bytes } = await descargar(fetchImpl, f.url);
      if (!esPdf(bytes)) return { fuenteId: f.id, ok: true, documentos: [] };
      return { fuenteId: f.id, ok: true, documentos: [{ url: f.url, hash: sha256Hex(bytes), bytes }] };
    }
    const { bytes } = await descargar(fetchImpl, f.url);
    const links = linksPdfDe(bytes.toString('utf8'), f.url).slice(0, MAX_PDFS_POR_FUENTE);
    const documentos: DocumentoFuente[] = [];
    for (const url of links) {
      try {
        const pdf = await descargar(fetchImpl, url);
        if (esPdf(pdf.bytes)) documentos.push({ url, hash: sha256Hex(pdf.bytes), bytes: pdf.bytes });
      } catch { /* un link roto no invalida la fuente */ }
    }
    return { fuenteId: f.id, ok: true, documentos };
  } catch (e) {
    return { fuenteId: f.id, ok: false, error: (e as Error)?.message || String(e), documentos: [] };
  }
}

export async function runEscalaCct422Job(deps: EscalaJobDeps): Promise<EscalaJobResumen> {
  const fetchImpl = deps.fetchImpl || fetch;
  const log = deps.log || ((m: string) => console.log(m));
  const now = deps.now || new Date();
  const resumen: EscalaJobResumen = { fuentes: 0, acciones: [], propuestas: [], descartados: [], errores: [] };
  const fuentes = (await deps.store.fuentes()).filter((f) => f && f.activa !== false && /^https?:\/\//.test(String(f.url || '')));
  resumen.fuentes = fuentes.length;
  if (!fuentes.length) return resumen;
  const conocidos = await deps.store.hashesConocidos();
  const resultados: ResultadoFuente[] = [];
  for (const f of fuentes) resultados.push(await leerFuente(fetchImpl, f));
  const acciones = planChequeo(resultados, conocidos);
  resumen.acciones = acciones.map((a) => ({ ...a, documento: a.documento ? { url: a.documento.url, hash: a.documento.hash } : undefined }));

  const porFuente = new Map<string, Record<string, unknown>>();
  for (const a of acciones) {
    const estado = porFuente.get(a.fuenteId) || { ultimoChequeo: now.toISOString(), ultimoResultado: a.accion, ultimoError: null, hashesVistos: [] as string[], documentos: [] as unknown[] };
    estado.ultimoResultado = a.accion;
    if (a.accion === 'FUENTE_NO_RESPONDE') {
      estado.ultimoError = a.error || 'sin detalle';
      resumen.errores.push({ fuenteId: a.fuenteId, error: a.error || 'sin detalle' });
      porFuente.set(a.fuenteId, estado);
      continue;
    }
    if (a.accion !== 'NUEVO_DOCUMENTO' || !a.documento) { porFuente.set(a.fuenteId, estado); continue; }
    const doc = a.documento;
    (estado.hashesVistos as string[]).push(doc.hash);
    const fuente = fuentes.find((f) => f.id === a.fuenteId)!;
    if (!deps.leerPdf) {
      (estado.documentos as unknown[]).push({ url: doc.url, hash: doc.hash, estado: 'PENDIENTE_LECTURA', motivo: 'SIN_LECTOR' });
      resumen.descartados.push({ fuenteId: a.fuenteId, hash: doc.hash, motivo: 'SIN_LECTOR' });
      porFuente.set(a.fuenteId, estado);
      continue;
    }
    try {
      const lectura = await deps.leerPdf(doc.bytes || Buffer.alloc(0), { fuenteUrl: doc.url, titulo: fuente.titulo || null });
      const p = lectura.propuesta;
      const sirve = p && Array.isArray(p.tramos) && p.tramos.length > 0 && !!p.vigenciaDesde
        && p.tramos.every((t) => t.categorias.some((c) => c.codigo === 'VIGILADOR' && typeof c.basico.valor === 'number'));
      if (!sirve) {
        (estado.documentos as unknown[]).push({ url: doc.url, hash: doc.hash, estado: 'DESCARTADO', motivo: 'NO_ES_ESCALA_422' });
        resumen.descartados.push({ fuenteId: a.fuenteId, hash: doc.hash, motivo: 'NO_ES_ESCALA_422' });
        porFuente.set(a.fuenteId, estado);
        continue;
      }
      const guardado = await deps.store.guardarPropuesta({ ...p, documentoHash: doc.hash, fuente: { ...p.fuente, url: p.fuente?.url || doc.url } }, { fuenteId: a.fuenteId, modelo: lectura.modelo });
      (estado.documentos as unknown[]).push({ url: doc.url, hash: doc.hash, estado: guardado.yaExistia ? 'YA_EXISTIA' : 'PROPUESTA', docId: guardado.docId });
      if (!guardado.yaExistia) {
        resumen.propuestas.push({ docId: guardado.docId, fuenteId: a.fuenteId, vigenciaDesde: p.vigenciaDesde });
        await deps.store.avisar(guardado.docId, p).catch((e) => log(`[escalaCct422Job] aviso: ${(e as Error)?.message}`));
      }
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      (estado.documentos as unknown[]).push({ url: doc.url, hash: doc.hash, estado: 'ERROR_LECTURA', motivo: msg });
      resumen.errores.push({ fuenteId: a.fuenteId, error: msg });
      // Un PDF que no se pudo leer no queda como visto: se reintenta mañana.
      estado.hashesVistos = (estado.hashesVistos as string[]).filter((h) => h !== doc.hash);
    }
    porFuente.set(a.fuenteId, estado);
  }
  for (const [fuenteId, estado] of porFuente) {
    await deps.store.registrarChequeo(fuenteId, estado).catch((e) => log(`[escalaCct422Job] estado ${fuenteId}: ${(e as Error)?.message}`));
  }
  log(`[escalaCct422Job] fuentes=${resumen.fuentes} propuestas=${resumen.propuestas.length} descartados=${resumen.descartados.length} errores=${resumen.errores.length}`);
  return resumen;
}

/** Store real: `config/escalas_cct` (fuentes), `escalas_cct` (hashes), `escalas_cct_fuentes/{id}` (estado del chequeo). */
export function firestoreEscalaJobStore(db: Firestore): EscalaJobStore {
  return {
    async fuentes() {
      const cfg = await db.collection('config').doc('escalas_cct').get();
      const lista = cfg.data()?.fuentes;
      if (Array.isArray(lista) && lista.length) return lista as FuenteEscala[];
      return FUENTES_CCT_422_DEFAULT;
    },
    async hashesConocidos() {
      const set = new Set<string>();
      const escalas = await db.collection('escalas_cct').select('documentoHash').get();
      escalas.docs.forEach((d) => { const h = d.data()?.documentoHash; if (typeof h === 'string' && h) set.add(h); });
      const fuentes = await db.collection('escalas_cct_fuentes').get();
      fuentes.docs.forEach((d) => { for (const h of (d.data()?.hashesVistos || []) as string[]) if (h) set.add(h); });
      return set;
    },
    async guardarPropuesta(p, meta) {
      return guardarPropuestaEscala(db, p, { uid: 'SYSTEM', email: null, empresaId: null, modelo: meta.modelo, origen: 'JOB_DIARIO' });
    },
    async avisar(docId, p) {
      await avisarEscalaCct(db, NOVEDAD_ESCALA_PROPUESTA, docId, p as unknown as Record<string, unknown>);
    },
    async registrarChequeo(fuenteId, estado) {
      const hashes = ((estado.hashesVistos as string[]) || []).filter(Boolean);
      const documentos = ((estado.documentos as unknown[]) || []).map((d) => JSON.parse(JSON.stringify(d)));
      const { hashesVistos: _h, documentos: _d, ...resto } = estado;
      void _h; void _d;
      await db.collection('escalas_cct_fuentes').doc(fuenteId).set({
        ...resto,
        ...(hashes.length ? { hashesVistos: admin.firestore.FieldValue.arrayUnion(...hashes) } : {}),
        ...(documentos.length ? { documentos: admin.firestore.FieldValue.arrayUnion(...documentos) } : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    },
  };
}

/** Lector real: Gemini visión. Sin GEMINI_API_KEY devuelve null y el job deja el documento como pendiente de lectura. */
export async function lectorGemini(apiKey: string | undefined): Promise<EscalaJobDeps['leerPdf']> {
  if (!apiKey) return null;
  const { leerEscala422ConGemini } = await import('./escalaCct422Gemini');
  return async (bytes, meta) => {
    const res = await leerEscala422ConGemini({ pdfBase64: bytes.toString('base64'), apiKey, fuenteUrl: meta.fuenteUrl, titulo: meta.titulo });
    return { propuesta: res.propuesta, modelo: res.modelo };
  };
}
