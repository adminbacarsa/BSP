/**
 * Laboratorio: lee la escala del CCT 422/05 y la imprime como tabla. No escribe Firestore ni producción.
 *
 *   node scripts/escalas-cct/extraer-escala-422.mjs --pdf escala-suvico.pdf [--modelo gemini-2.5-flash] [--out salida.json] [--comparar oficial.json]
 *   node scripts/escalas-cct/extraer-escala-422.mjs --texto anexo-disposicion.txt [--out salida.json]
 *
 * GEMINI_API_KEY: variable de entorno o apps/functions/.env (misma clave que el asistente en el emulador).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(dir, '..', '..');
const core = await import(`file://${resolve(raiz, 'apps/functions/src/escalas/escalaCct422Core.ts').replace(/\\/g, '/')}`);

/** Misma llamada que `escalaCct422Gemini.ts` (la callable); acá sin TypeScript para correr suelto con Node. */
async function leerConGemini({ pdfBase64, apiKey, model, fuenteUrl, titulo }) {
  const modelo = model || process.env.GEMINI_MODEL_ESCALAS || 'gemini-2.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'application/pdf', data: pdfBase64 } }, { text: core.GEMINI_PROMPT_422 }] }],
      generationConfig: { temperature: 0, response_mime_type: 'application/json', response_schema: core.GEMINI_RESPONSE_SCHEMA_422 },
    }),
  });
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${bodyText.slice(0, 400)}`);
  const body = JSON.parse(bodyText);
  const texto = (body.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!texto.trim()) throw new Error(`Gemini sin contenido (${body.candidates?.[0]?.finishReason ?? '?'})`);
  const crudo = JSON.parse(texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  const documentoHash = core.sha256Hex(Buffer.from(pdfBase64, 'base64'));
  const propuesta = core.armarPropuesta422(core.lecturaDesdeGemini(crudo), { extraccion: 'GEMINI_VISION', documentoHash, fuenteUrl, titulo });
  return { propuesta, crudo, modelo, documentoHash, usage: { totalTokens: body.usageMetadata?.totalTokenCount } };
}

function arg(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  for (const f of ['apps/functions/.env.local', 'apps/functions/.env']) {
    const p = resolve(raiz, f);
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/^GEMINI_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
}

const pdf = arg('pdf');
const texto = arg('texto');
const out = arg('out');
const comparar = arg('comparar');
if (!pdf && !texto) {
  console.error('Uso: --pdf <escaneado.pdf> | --texto <anexo.txt> [--out salida.json] [--comparar oficial.json] [--modelo ...]');
  process.exit(2);
}

let propuesta;
let crudo = null;
if (texto) {
  const r = core.parsearAnexoOficial422(readFileSync(texto, 'utf8'), { fuenteUrl: arg('fuente'), titulo: texto });
  if (!core.esPropuesta(r)) {
    console.error('No se pudo leer el anexo:', r.codigo);
    process.exit(1);
  }
  propuesta = r;
} else {
  const key = apiKey();
  if (!key) {
    console.error('Falta GEMINI_API_KEY (entorno o apps/functions/.env)');
    process.exit(2);
  }
  const t0 = Date.now();
  const r = await leerConGemini({
    pdfBase64: readFileSync(pdf).toString('base64'),
    apiKey: key,
    model: arg('modelo') || undefined,
    fuenteUrl: arg('fuente'),
    titulo: pdf,
  });
  propuesta = r.propuesta;
  crudo = r.crudo;
  console.log(`Gemini ${r.modelo} · ${Math.round((Date.now() - t0) / 1000)} s · tokens ${r.usage?.totalTokens ?? '?'} · hash ${r.documentoHash.slice(0, 12)}`);
}

console.log(core.tablaPropuesta(propuesta));

if (comparar) {
  const leido = JSON.parse(readFileSync(comparar, 'utf8'));
  const oficial = leido.propuesta ?? leido;
  const difs = core.compararPropuestas(oficial, propuesta);
  console.log('');
  console.log(`Comparación contra ${comparar}: ${difs.length} diferencia(s)`);
  for (const d of difs) console.log(`  ${d.mes} ${d.codigo} ${d.campo}: oficial ${d.a ?? '—'} / leído ${d.b ?? '—'}`);
}

if (out) {
  writeFileSync(out, JSON.stringify(crudo ? { propuesta, geminiCrudo: crudo } : { propuesta }, null, 2));
  console.log(`\nJSON: ${join(out)}`);
}
