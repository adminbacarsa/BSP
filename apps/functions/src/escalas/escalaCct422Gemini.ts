/**
 * Lectura del PDF escaneado de la escala 422/05 con Gemini (visión). Sin Firebase: lo usan la callable
 * `extraerEscalaCct422` (clave desde el secreto GEMINI_API_KEY) y el script de laboratorio.
 * Devuelve la lectura cruda y la propuesta normalizada; nunca escribe nada.
 */
import {
  GEMINI_PROMPT_422,
  GEMINI_RESPONSE_SCHEMA_422,
  armarPropuesta422,
  lecturaDesdeGemini,
  sha256Hex,
  type Lectura,
  type PropuestaEscala422,
} from './escalaCct422Core';

export const GEMINI_MODEL_ESCALAS_DEFAULT = 'gemini-2.5-flash';
export const GEMINI_PDF_MAX_BYTES = 12 * 1024 * 1024;

export interface LeerEscalaGeminiInput {
  pdfBase64: string;
  apiKey: string;
  model?: string;
  fuenteUrl?: string | null;
  titulo?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface LeerEscalaGeminiResult {
  propuesta: PropuestaEscala422;
  lectura: Lectura;
  crudo: unknown;
  modelo: string;
  documentoHash: string;
  usage?: { promptTokens?: number; candidatesTokens?: number; totalTokens?: number };
}

function extraerJson(texto: string): unknown {
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(limpio);
  } catch {
    const i = limpio.indexOf('{');
    const j = limpio.lastIndexOf('}');
    if (i >= 0 && j > i) return JSON.parse(limpio.slice(i, j + 1));
    throw new Error('Gemini no devolvió JSON');
  }
}

export function validarPdfBase64(pdfBase64: string): Buffer {
  const limpio = String(pdfBase64 || '').replace(/^data:application\/pdf;base64,/, '').trim();
  if (!limpio) throw new Error('Falta el PDF (base64)');
  const buf = Buffer.from(limpio, 'base64');
  if (buf.length < 100) throw new Error('El PDF está vacío o el base64 es inválido');
  if (buf.length > GEMINI_PDF_MAX_BYTES) throw new Error(`El PDF supera ${Math.round(GEMINI_PDF_MAX_BYTES / 1024 / 1024)} MB`);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('El archivo no es un PDF');
  return buf;
}

export async function leerEscala422ConGemini(input: LeerEscalaGeminiInput): Promise<LeerEscalaGeminiResult> {
  const apiKey = String(input.apiKey || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');
  const buf = validarPdfBase64(input.pdfBase64);
  const modelo = (input.model || process.env.GEMINI_MODEL_ESCALAS || GEMINI_MODEL_ESCALAS_DEFAULT).trim();
  const doFetch = input.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 150_000);
  let res: Response;
  try {
    res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: 'application/pdf', data: buf.toString('base64') } },
              { text: GEMINI_PROMPT_422 },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          response_mime_type: 'application/json',
          response_schema: GEMINI_RESPONSE_SCHEMA_422,
        },
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${bodyText.slice(0, 400)}`);
  const body = JSON.parse(bodyText) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };
  const texto = (body.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!texto.trim()) throw new Error(`Gemini sin contenido (finishReason ${body.candidates?.[0]?.finishReason ?? '?'})`);
  const crudo = extraerJson(texto);
  const lectura = lecturaDesdeGemini(crudo);
  const documentoHash = sha256Hex(buf);
  const propuesta = armarPropuesta422(lectura, {
    extraccion: 'GEMINI_VISION',
    documentoHash,
    fuenteUrl: input.fuenteUrl ?? null,
    titulo: input.titulo ?? null,
  });
  return {
    propuesta,
    lectura,
    crudo,
    modelo,
    documentoHash,
    usage: {
      promptTokens: body.usageMetadata?.promptTokenCount,
      candidatesTokens: body.usageMetadata?.candidatesTokenCount,
      totalTokens: body.usageMetadata?.totalTokenCount,
    },
  };
}
