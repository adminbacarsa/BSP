/**
 * Avisa al n8n local cuando un AT/BT pasa a canal URGENTE.
 * La URL es ARCA_N8N_URGENTE_URL (el alias publico: Cloud Functions no llega a la LAN).
 * Sin esa variable no hace nada: el lote de las 18:00 y el respaldo de n8n Cloud siguen.
 * La clave fiscal no sale de aca.
 */
import * as functions from 'firebase-functions/v1';

export function debeAvisarUrgente(before: Record<string, unknown> | null, after: Record<string, unknown> | null): boolean {
  if (!after) return false;
  const tipo = String(after.tipo || '');
  if (tipo !== 'AT' && tipo !== 'BT') return false;
  if (after.canal !== 'URGENTE') return false;
  if (after.quitadoDelLote === true || after.estado === 'CONFIRMADO') return false;
  if (!before) return true;
  const mismo = before.canal === 'URGENTE'
    && String(before.tipo || '') === tipo
    && before.estado !== 'CONFIRMADO'
    && before.quitadoDelLote !== true;
  return !mismo;
}

export async function notificarUrgenteN8n(input: {
  empresaId: string;
  tipo: string;
  envioIds: string[];
  fetchImpl?: typeof fetch;
}): Promise<'omitido' | 'ok' | 'error'> {
  const url = String(process.env.ARCA_N8N_URGENTE_URL || '').trim();
  const ids = (input.envioIds || []).map((id) => String(id || '').trim()).filter(Boolean);
  if (!url || !ids.length) return 'omitido';
  if (input.tipo !== 'AT' && input.tipo !== 'BT') return 'omitido';
  const fetchImpl = input.fetchImpl || fetch;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-arca-key': String(process.env.ARCA_ROBOT_KEY || ''),
      },
      body: JSON.stringify({
        canal: 'URGENTE',
        empresaId: input.empresaId,
        tipo: input.tipo,
        envioIds: ids,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error('[arca urgente] n8n respondio', res.status);
      return 'error';
    }
    return 'ok';
  } catch (e) {
    console.error('[arca urgente] no se pudo avisar a n8n', (e as Error)?.message || e);
    return 'error';
  }
}

/** Se dispara al crear o al pasar a URGENTE un AT/BT. No reavisa en cada correccion del mismo envio. */
export const onArcaEnvioUrgente = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .firestore.document('arca_envios/{envioId}')
  .onWrite(async (change, context) => {
    const before = change.before.exists ? (change.before.data() as Record<string, unknown>) : null;
    const after = change.after.exists ? (change.after.data() as Record<string, unknown>) : null;
    if (!debeAvisarUrgente(before, after) || !after) return;
    await notificarUrgenteN8n({
      empresaId: String(after.empresaId || ''),
      tipo: String(after.tipo || ''),
      envioIds: [String(context.params.envioId || '')],
    });
  });
