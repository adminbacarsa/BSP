import { isEmulatorMode, getEmulatorHostLabel } from './portal';

export function mapPortalCallableError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const code = (e?.code ?? '').replace('functions/', '');
  const msg = (e?.message ?? '').trim();

  if (code === 'unauthenticated' || msg === 'Sin permisos.') {
    if (isEmulatorMode()) {
      return `Sin permisos en el servidor (sesión no llegó a Functions). Cerrá sesión, entrá de nuevo y verificá que EXPO_PUBLIC_USE_EMULATOR=true y Functions en ${getEmulatorHostLabel()}:5001.`;
    }
    return 'Sesión expirada o inválida. Cerrá sesión y volvé a entrar.';
  }
  if (code === 'permission-denied') {
    return msg || 'No tenés permiso para fichar este turno.';
  }
  if (code === 'not-found') {
    return msg || 'No se encontró el turno o el legajo.';
  }
  if (code === 'failed-precondition') {
    return msg || 'No se puede fichar en este momento.';
  }
  return msg || 'No se pudo completar la operación.';
}
