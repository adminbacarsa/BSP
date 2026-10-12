/**
 * Llamada a Gemini para interpretar la grilla. No escribe Firestore ni loguea la clave.
 */
import { textoParaModelo, validarLecturaIa, type GrillaPlanillaIa, type LecturaPlanillaIa } from './planillaIaCore';

export const GEMINI_MODEL_PLANILLA_DEFAULT = 'gemini-2.5-flash';

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    puestos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          nombre: { type: 'STRING' },
          filas: { type: 'ARRAY', items: { type: 'INTEGER' } },
          tipo: { type: 'STRING' },
          confianza: { type: 'NUMBER' },
        },
        required: ['nombre', 'filas', 'tipo', 'confianza'],
      },
    },
    leyenda: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          codigo: { type: 'STRING' },
          color: { type: 'STRING' },
          puesto: { type: 'STRING' },
          banda: { type: 'STRING' },
          inicio: { type: 'STRING' },
          fin: { type: 'STRING' },
          tipo: { type: 'STRING' },
          confianza: { type: 'NUMBER' },
        },
        required: ['codigo', 'inicio', 'fin', 'tipo', 'confianza'],
      },
    },
    funciones: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          nombre: { type: 'STRING' },
          cubre: { type: 'ARRAY', items: { type: 'STRING' } },
          confianza: { type: 'NUMBER' },
        },
        required: ['nombre', 'cubre', 'confianza'],
      },
    },
    excepcionesPorDia: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          dia: { type: 'INTEGER' },
          filas: { type: 'ARRAY', items: { type: 'INTEGER' } },
          codigo: { type: 'STRING' },
          inicio: { type: 'STRING' },
          fin: { type: 'STRING' },
          fuente: { type: 'STRING' },
          confianza: { type: 'NUMBER' },
        },
        required: ['dia', 'codigo', 'inicio', 'fin', 'fuente', 'confianza'],
      },
    },
    dudas: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['puestos', 'leyenda', 'funciones', 'excepcionesPorDia', 'dudas'],
};

export type ImagenPlanilla = { mime: 'image/png' | 'image/jpeg'; base64: string };

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

function sinClave(mensaje: string, apiKey: string): string {
  return apiKey ? mensaje.split(apiKey).join('***') : mensaje;
}

export async function leerPlanillaConGemini(input: {
  grilla: GrillaPlanillaIa;
  apiKey: string;
  imagen?: ImagenPlanilla | null;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ lectura: LecturaPlanillaIa; modelo: string }> {
  const apiKey = String(input.apiKey || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY no configurada');
  const modelo = (input.model || process.env.GEMINI_MODEL || GEMINI_MODEL_PLANILLA_DEFAULT).trim();
  const doFetch = input.fetchImpl || fetch;
  const parts: Array<Record<string, unknown>> = [];
  if (input.imagen) {
    parts.push({ inline_data: { mime_type: input.imagen.mime, data: input.imagen.base64 } });
  }
  parts.push({ text: textoParaModelo(input.grilla) });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 150_000);
  let res: Response;
  try {
    res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0, response_mime_type: 'application/json', response_schema: SCHEMA },
      }),
    });
  } catch (e) {
    throw new Error(sinClave((e as Error)?.message || 'No se pudo llamar a Gemini', apiKey));
  } finally {
    clearTimeout(timer);
  }
  const bodyText = await res.text();
  if (!res.ok) throw new Error(sinClave(`Gemini ${res.status}: ${bodyText.slice(0, 300)}`, apiKey));
  const body = JSON.parse(bodyText) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] };
  const texto = (body.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!texto.trim()) throw new Error(`Gemini sin contenido (finishReason ${body.candidates?.[0]?.finishReason ?? '?'})`);
  const lectura = validarLecturaIa(extraerJson(texto));
  return { lectura, modelo };
}
