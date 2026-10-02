/**
 * Job diario de la escala 422/05 sin red: fetch falso, lector falso (fixture de Gemini) y store en memoria.
 *   npx tsx scripts/escalas-cct/eval-escala-job.mjs   (npm run eval:escalas-job; el job importa módulos sin extensión)
 * Casos: fuente caída no rompe · PDF ya conocido = sin cambio · PDF nuevo → PROPUESTA + aviso (una sola vez) ·
 * página HTML con links a PDF/Drive · PDF que no es la escala se descarta · sin lector queda pendiente · error de lectura se reintenta.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const ruta = (p) => `file://${resolve(dir, p).replace(/\\/g, '/')}`;
const core = await import(ruta('../../apps/functions/src/escalas/escalaCct422Core.ts'));
const job = await import(ruta('../../apps/functions/src/escalas/escalaCct422Job.ts'));
const { lecturaDesdeGemini, armarPropuesta422, sha256Hex } = core;
const { runEscalaCct422Job, planChequeo, linksPdfDe, FUENTES_CCT_422_DEFAULT } = job;

const gemini = JSON.parse(readFileSync(join(dir, 'fixtures', 'suvico-ene-jun-2026.gemini.json'), 'utf8'));
const PDF_ESCALA = Buffer.concat([Buffer.from('%PDF-1.4 escala suvico ene-jun 2026 '), Buffer.alloc(200, 1)]);
const PDF_OTRO = Buffer.concat([Buffer.from('%PDF-1.4 otro documento '), Buffer.alloc(200, 2)]);
const HASH_ESCALA = sha256Hex(PDF_ESCALA);

function memStore({ fuentes, conocidos = [] } = {}) {
  const st = { propuestas: [], avisos: [], chequeos: {}, conocidos: new Set(conocidos) };
  return {
    st,
    store: {
      fuentes: async () => fuentes,
      hashesConocidos: async () => new Set(st.conocidos),
      guardarPropuesta: async (p, meta) => {
        const docId = `CCT_422_05_${p.vigenciaDesde}_${p.documentoHash.slice(0, 8)}`;
        if (st.propuestas.some((x) => x.docId === docId)) return { docId, yaExistia: true };
        st.propuestas.push({ docId, p, meta });
        st.conocidos.add(p.documentoHash);
        return { docId, yaExistia: false };
      },
      avisar: async (docId) => { st.avisos.push(docId); },
      registrarChequeo: async (id, estado) => { st.chequeos[id] = estado; },
    },
  };
}

const fetchDe = (mapa) => async (url) => {
  const r = mapa[url];
  if (r === undefined) throw new Error(`ENOTFOUND ${url}`);
  if (r instanceof Error) throw r;
  const body = typeof r === 'string' ? Buffer.from(r, 'utf8') : r;
  return { ok: true, status: 200, headers: { get: () => 'application/octet-stream' }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
};

const leerFixture = async (bytes, meta) => {
  if (bytes.equals(PDF_OTRO)) {
    return { propuesta: armarPropuesta422({ tramos: [] }, { extraccion: 'GEMINI_VISION', documentoHash: sha256Hex(bytes), fuenteUrl: meta.fuenteUrl }), modelo: 'fixture' };
  }
  const lectura = lecturaDesdeGemini(gemini);
  return { propuesta: armarPropuesta422(lectura, { extraccion: 'GEMINI_VISION', documentoHash: sha256Hex(bytes), fuenteUrl: meta.fuenteUrl, titulo: meta.titulo, ahora: new Date('2026-10-02T12:30:00Z') }), modelo: 'fixture' };
};

const silencio = () => {};
let casos = 0;
const ok = (n) => { casos += 1; console.log(`  ✔ ${n}`); };

// 1. Puro: plan de chequeo.
{
  const plan = planChequeo([
    { fuenteId: 'a', ok: false, error: 'timeout', documentos: [] },
    { fuenteId: 'b', ok: true, documentos: [] },
    { fuenteId: 'c', ok: true, documentos: [{ url: 'u', hash: 'h1' }] },
    { fuenteId: 'd', ok: true, documentos: [{ url: 'u2', hash: 'h2' }, { url: 'u3', hash: 'h1' }] },
    { fuenteId: 'e', ok: true, documentos: [{ url: 'u4', hash: 'h2' }] },
  ], new Set(['h1']));
  assert.deepEqual(plan.map((a) => `${a.fuenteId}:${a.accion}`), ['a:FUENTE_NO_RESPONDE', 'b:SIN_DOCUMENTOS', 'c:SIN_CAMBIO', 'd:NUEVO_DOCUMENTO', 'e:SIN_CAMBIO']);
  assert.equal(plan[3].documento.hash, 'h2');
  ok('planChequeo: caída, sin docs, conocido, nuevo una sola vez aunque esté en dos fuentes');
}

// 2. Puro: links a PDF y Drive desde HTML.
{
  const html = `<a href="/docs/disp120.pdf">Anexo</a> <a href='https://drive.google.com/file/d/10ZbxKgonf2OtH7bCmCe-zQJYDUN02sbc/view?usp=sharing'>Escala</a>
    <a href="#top">x</a> <a href="mailto:a@b">m</a> <a href="https://x.org/otra.PDF?v=2">p</a> <a href="/nota.html">n</a>`;
  assert.deepEqual(linksPdfDe(html, 'https://www.suvico.org.ar/escalas/'), [
    'https://www.suvico.org.ar/docs/disp120.pdf',
    'https://drive.google.com/uc?export=download&id=10ZbxKgonf2OtH7bCmCe-zQJYDUN02sbc',
    'https://x.org/otra.PDF?v=2',
  ]);
  assert.ok(FUENTES_CCT_422_DEFAULT.length >= 2 && FUENTES_CCT_422_DEFAULT.every((f) => /^https:\/\//.test(f.url)));
  ok('linksPdfDe: relativos, Drive → descarga directa, ignora ancla/mailto/html');
}

// 3. Sin red: todas las fuentes caen → nada roto, errores anotados, cero propuestas.
{
  const fuentes = [{ id: 'f1', url: 'https://a/escala.pdf', tipo: 'PDF' }, { id: 'f2', url: 'https://b/', tipo: 'HTML' }];
  const { store, st } = memStore({ fuentes });
  const r = await runEscalaCct422Job({ store, fetchImpl: fetchDe({}), leerPdf: leerFixture, log: silencio });
  assert.equal(r.fuentes, 2);
  assert.equal(r.propuestas.length, 0);
  assert.deepEqual(r.acciones.map((a) => a.accion), ['FUENTE_NO_RESPONDE', 'FUENTE_NO_RESPONDE']);
  assert.equal(r.errores.length, 2);
  assert.equal(st.chequeos.f1.ultimoResultado, 'FUENTE_NO_RESPONDE');
  assert.match(st.chequeos.f1.ultimoError, /ENOTFOUND/);
  ok('sin red: la fuente que no responde queda anotada y no rompe');
}

// 4. PDF nuevo → una PROPUESTA con aviso; segunda corrida = SIN_CAMBIO sin avisar de nuevo.
{
  const fuentes = [{ id: 'drive', url: 'https://drive.google.com/uc?export=download&id=X', tipo: 'PDF', titulo: 'SUVICO Drive' }];
  const { store, st } = memStore({ fuentes });
  const f = fetchDe({ 'https://drive.google.com/uc?export=download&id=X': PDF_ESCALA });
  const r1 = await runEscalaCct422Job({ store, fetchImpl: f, leerPdf: leerFixture, log: silencio });
  assert.equal(r1.propuestas.length, 1);
  assert.equal(r1.propuestas[0].vigenciaDesde, '2026-01-01');
  assert.equal(st.propuestas[0].p.documentoHash, HASH_ESCALA);
  assert.equal(st.propuestas[0].p.estado, 'PROPUESTA');
  assert.equal(st.propuestas[0].p.extraccion, 'GEMINI_VISION');
  assert.equal(st.propuestas[0].p.tramos.length, 6);
  assert.equal(st.propuestas[0].p.fuente.url, 'https://drive.google.com/uc?export=download&id=X');
  assert.equal(st.propuestas[0].meta.fuenteId, 'drive');
  assert.deepEqual(st.avisos, [r1.propuestas[0].docId]);
  assert.deepEqual(st.chequeos.drive.hashesVistos, [HASH_ESCALA]);
  assert.equal(st.chequeos.drive.documentos[0].estado, 'PROPUESTA');
  const r2 = await runEscalaCct422Job({ store, fetchImpl: f, leerPdf: leerFixture, log: silencio });
  assert.equal(r2.propuestas.length, 0);
  assert.deepEqual(r2.acciones.map((a) => a.accion), ['SIN_CAMBIO']);
  assert.equal(st.avisos.length, 1);
  ok('PDF nuevo → PROPUESTA + aviso; al día siguiente sin cambio y sin segundo aviso');
}

// 5. Página HTML con link al PDF (y un link roto) → se descarga el PDF y nace la propuesta.
{
  const fuentes = [{ id: 'home', url: 'https://www.suvico.org.ar/', tipo: 'HTML' }];
  const { store, st } = memStore({ fuentes });
  const f = fetchDe({
    'https://www.suvico.org.ar/': '<html><a href="/roto.pdf">roto</a><a href="https://drive.google.com/file/d/10ZbxKgonf2OtH7bCmCe-zQJYDUN02sbc/view">Escala vigente</a></html>',
    'https://www.suvico.org.ar/roto.pdf': new Error('HTTP 404'),
    'https://drive.google.com/uc?export=download&id=10ZbxKgonf2OtH7bCmCe-zQJYDUN02sbc': PDF_ESCALA,
  });
  const r = await runEscalaCct422Job({ store, fetchImpl: f, leerPdf: leerFixture, log: silencio });
  assert.equal(r.propuestas.length, 1);
  assert.equal(st.propuestas[0].p.fuente.url, 'https://drive.google.com/uc?export=download&id=10ZbxKgonf2OtH7bCmCe-zQJYDUN02sbc');
  ok('HTML: sigue el link de Drive, ignora el roto y propone');
}

// 6. Documento conocido (ya en escalas_cct) → sin cambio; documento nuevo que no es la escala → descartado y no se vuelve a leer.
{
  const fuentes = [{ id: 'p', url: 'https://a/escala.pdf', tipo: 'PDF' }, { id: 'q', url: 'https://a/otro.pdf', tipo: 'PDF' }];
  const { store, st } = memStore({ fuentes, conocidos: [HASH_ESCALA] });
  const f = fetchDe({ 'https://a/escala.pdf': PDF_ESCALA, 'https://a/otro.pdf': PDF_OTRO });
  const r = await runEscalaCct422Job({ store, fetchImpl: f, leerPdf: leerFixture, log: silencio });
  assert.deepEqual(r.acciones.map((a) => a.accion), ['SIN_CAMBIO', 'NUEVO_DOCUMENTO']);
  assert.equal(r.propuestas.length, 0);
  assert.deepEqual(r.descartados.map((d) => d.motivo), ['NO_ES_ESCALA_422']);
  assert.deepEqual(st.chequeos.q.hashesVistos, [sha256Hex(PDF_OTRO)]);
  assert.equal(st.avisos.length, 0);
  ok('conocido = sin cambio; PDF que no es la escala = descartado sin aviso y marcado como visto');
}

// 7. Sin lector (sin GEMINI_API_KEY): el documento queda pendiente, nada rompe. Error de lectura: no se marca visto (reintenta mañana).
{
  const fuentes = [{ id: 'p', url: 'https://a/escala.pdf', tipo: 'PDF' }];
  const { store, st } = memStore({ fuentes });
  const f = fetchDe({ 'https://a/escala.pdf': PDF_ESCALA });
  const r = await runEscalaCct422Job({ store, fetchImpl: f, leerPdf: null, log: silencio });
  assert.equal(r.propuestas.length, 0);
  assert.deepEqual(r.descartados.map((d) => d.motivo), ['SIN_LECTOR']);
  assert.equal(st.chequeos.p.documentos[0].estado, 'PENDIENTE_LECTURA');
  const otro = memStore({ fuentes });
  const r2 = await runEscalaCct422Job({ store: otro.store, fetchImpl: f, leerPdf: async () => { throw new Error('Gemini 503'); }, log: silencio });
  assert.equal(r2.errores.length, 1);
  assert.match(r2.errores[0].error, /503/);
  assert.deepEqual(otro.st.chequeos.p.hashesVistos, []);
  assert.equal(otro.st.chequeos.p.documentos[0].estado, 'ERROR_LECTURA');
  ok('sin clave → pendiente; error del lector → se reintenta (no queda visto)');
}

// 8. Fuentes inactivas o con URL inválida se ignoran.
{
  const fuentes = [{ id: 'x', url: 'ftp://nada', tipo: 'PDF' }, { id: 'y', url: 'https://a/escala.pdf', tipo: 'PDF', activa: false }];
  const { store } = memStore({ fuentes });
  const r = await runEscalaCct422Job({ store, fetchImpl: fetchDe({}), leerPdf: leerFixture, log: silencio });
  assert.equal(r.fuentes, 0);
  assert.equal(r.acciones.length, 0);
  ok('fuentes inactivas o no http se ignoran');
}

console.log(`\neval-escala-job: ${casos}/8 OK`);
