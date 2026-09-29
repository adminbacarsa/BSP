import { isConvocadoEta, type ConvocadoEtaMinutes } from '@cosp/portal-core';
import { getPortalCallables } from './portal';
import { mapPortalCallableError } from './mapPortalCallableError';

export async function responderRecordatorioConvocado(params: {
  convocatoriaId: string;
  action: 'ON_WAY' | 'PROBLEM';
  etaMinutes?: ConvocadoEtaMinutes;
  note?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const convocatoriaId = String(params.convocatoriaId || '').trim();
  if (!convocatoriaId) {
    return { ok: false, message: 'Falta la convocatoria del recordatorio.' };
  }
  if (params.action === 'ON_WAY' && (params.etaMinutes == null || !isConvocadoEta(params.etaMinutes))) {
    return { ok: false, message: 'Elegí 10, 15 o 30 minutos.' };
  }
  const note = String(params.note || '').trim().slice(0, 200);
  try {
    const { responderRecordatorioConvocado: call } = getPortalCallables();
    await call({
      convocatoriaId,
      action: params.action,
      ...(params.action === 'ON_WAY' && params.etaMinutes ? { etaMinutes: params.etaMinutes } : {}),
      ...(params.action === 'PROBLEM' && note ? { note } : {}),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: mapPortalCallableError(e) };
  }
}
