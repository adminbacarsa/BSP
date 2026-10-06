/**
 * Qué documentos de `consultas_disponibilidad_invitaciones` escucha la app.
 * En vista previa no se usa el uid del SuperAdmin: la invitación del eventual
 * sin app no tiene uid.
 */

export type ConsultaListenField = 'uid' | 'bolsaCuil' | 'employeeId';

export type ConsultaListenKey = { field: ConsultaListenField; value: string };

export type ConsultaPreviewArgs = { asBolsaCuil?: string; asEmployeeId?: string };

function pushUnique(out: ConsultaListenKey[], field: ConsultaListenField, value: string | null | undefined) {
  const v = String(value || '').trim();
  if (!v) return;
  if (out.some((k) => k.field === field && k.value === v)) return;
  out.push({ field, value: v });
}

export function consultasListenKeys(input: {
  isPreviewMode: boolean;
  authUid?: string | null;
  /** Claim del EVENTUAL, o el CUIL de la persona previsualizada. */
  bolsaCuil?: string | null;
  employeeIds?: Array<string | null | undefined> | null;
}): ConsultaListenKey[] {
  const out: ConsultaListenKey[] = [];
  if (!input.isPreviewMode) pushUnique(out, 'uid', input.authUid);
  pushUnique(out, 'bolsaCuil', input.bolsaCuil);
  for (const id of input.employeeIds || []) pushUnique(out, 'employeeId', id);
  return out;
}

/** PENDIENTE (app) o AVISO_MAIL (le llegó por correo y todavía puede responder). */
export function consultaSigueAbierta(estado: string, venceAtMs: number | null, ahoraMs: number): boolean {
  if (estado !== 'PENDIENTE' && estado !== 'AVISO_MAIL') return false;
  if (venceAtMs && venceAtMs <= ahoraMs) return false;
  return true;
}

/** Args de la callable cuando el SuperAdmin responde en nombre del previsualizado. */
export function argsPreviewConsulta(input: {
  isPreviewMode: boolean;
  bolsaCuil?: string | null;
  employeeId?: string | null;
}): ConsultaPreviewArgs | undefined {
  if (!input.isPreviewMode) return undefined;
  const asBolsaCuil = String(input.bolsaCuil || '').replace(/\D/g, '');
  const asEmployeeId = String(input.employeeId || '').trim();
  const args: ConsultaPreviewArgs = {};
  if (asBolsaCuil) args.asBolsaCuil = asBolsaCuil;
  if (asEmployeeId) args.asEmployeeId = asEmployeeId;
  return args.asBolsaCuil || args.asEmployeeId ? args : undefined;
}
