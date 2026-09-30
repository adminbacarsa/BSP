/** Lógica pura del acuse de recibo (sin Firebase) para poder testearla en Node. */

export const ACUSE_NO_DISPONIBLE_MESSAGE =
  'El acuse desde la app todavía no está habilitado en el servidor. Avisale a RRHH que recibiste el contrato.';

/** El servidor no desplegó la callable: Functions responde not-found / unimplemented. */
export function isCallableMissingError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const code = String(e?.code ?? '').replace('functions/', '');
  const msg = String(e?.message ?? '').toLowerCase();
  if (code === 'not-found' || code === 'unimplemented') return true;
  return /not found|no existe|unimplemented|404/.test(msg) && !/contrato/.test(msg);
}
