/**
 * Anulación de alta por el robot, de a una, dentro del plazo RG 2988.
 * Si falla dos veces o faltan menos de 2 h, queda MANUAL para RRHH.
 * Vencido el plazo no se toca: lo convierte a baja código 30 el job que ya existe.
 */

export const ANULACION_FALLOS_MAX = 2;
export const ANULACION_MARGEN_MANUAL_MS = 2 * 60 * 60 * 1000;

export type EnvioAnulacion = {
  tipo?: string;
  estado?: string;
  quitadoDelLote?: boolean;
  acuseAnulacion?: string | null;
  venceAnulacionMs?: number;
  fallosRobot?: number;
  manualMotivo?: string;
  bolsaCuil?: string;
  cuil?: string;
  fechaInicio?: string;
  fechaAlta?: string;
  nroTransaccionAlta?: string;
  empresaId?: string;
  intentos?: Array<{ estado?: string }>;
};

export function fallosDe(envio: EnvioAnulacion | null | undefined): number {
  const guardados = Number(envio?.fallosRobot || 0);
  const intentos = (envio?.intentos || []).filter((i) => i?.estado === 'ERROR').length;
  return Math.max(Number.isFinite(guardados) ? guardados : 0, intentos);
}

export function motivoLegible(codigo: string): string {
  if (codigo === 'ROBOT_FALLO_2') return 'el robot falló 2 veces';
  if (codigo === 'MENOS_DE_2H') return 'faltan menos de 2 horas';
  if (codigo === 'FALTAN_DATOS') return 'faltan CUIL, fecha o la empresa representada';
  if (!codigo) return 'revisar en ARCA';
  return codigo;
}

/** Aviso al webhook urgente solo al entrar en PENDIENTE, no en cada corrección. */
export function debeAvisarAnulacion(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): boolean {
  if (!after || String(after.tipo || '') !== 'ANULACION') return false;
  if (String(after.estado || '') !== 'PENDIENTE') return false;
  if (after.quitadoDelLote === true || after.acuseAnulacion) return false;
  if (!before) return true;
  return !(String(before.tipo || '') === 'ANULACION'
    && String(before.estado || '') === 'PENDIENTE'
    && before.quitadoDelLote !== true);
}

export function decidirAnulacion(
  envio: EnvioAnulacion | null | undefined,
  nowMs: number,
): { accion: 'ROBOT' | 'MANUAL' | 'NADA'; motivo: string } {
  if (!envio || envio.tipo !== 'ANULACION') return { accion: 'NADA', motivo: 'NO_ES_ANULACION' };
  if (envio.quitadoDelLote === true) return { accion: 'NADA', motivo: 'QUITADO' };
  if (envio.estado === 'ANULADO' || envio.acuseAnulacion) return { accion: 'NADA', motivo: 'YA_ANULADO' };
  const estado = String(envio.estado || 'PENDIENTE');
  if (!['PENDIENTE', 'ERROR', 'SUBIENDO', 'MANUAL'].includes(estado)) {
    return { accion: 'NADA', motivo: 'ESTADO' };
  }
  const vence = Number(envio.venceAnulacionMs || 0);
  if (vence && nowMs > vence) return { accion: 'NADA', motivo: 'PLAZO_VENCIDO' };
  if (estado === 'MANUAL') return { accion: 'MANUAL', motivo: String(envio.manualMotivo || 'MANUAL') };
  if (vence && vence - nowMs < ANULACION_MARGEN_MANUAL_MS) return { accion: 'MANUAL', motivo: 'MENOS_DE_2H' };
  if (fallosDe(envio) >= ANULACION_FALLOS_MAX) return { accion: 'MANUAL', motivo: 'ROBOT_FALLO_2' };
  return { accion: 'ROBOT', motivo: '' };
}

function soloDigitos(raw: unknown): string {
  return String(raw || '').replace(/\D/g, '');
}

function aaaammdd(raw: unknown): string {
  return /^\d{8}$/.test(String(raw || ''))
    ? String(raw)
    : (/^\d{4}-\d{2}-\d{2}/.test(String(raw || '')) ? String(raw).slice(0, 10).replace(/-/g, '') : '');
}

export function nroAnulacionSimulado(envioId: string): string {
  const limpio = String(envioId || 'ENVIO').replace(/[^a-zA-Z0-9]/g, '').slice(-12) || 'ENVIO';
  return `SIM-ANUL-${limpio}`;
}

/**
 * Después de un ERROR: si ya van 2 fallos o queda poco plazo, MANUAL.
 * Si todavía se puede reintentar, vuelve a PENDIENTE para que el webhook llame de nuevo.
 */
export function planTrasError(
  envio: EnvioAnulacion,
  nowMs: number,
  fallosInformados = 0,
): { estado: 'MANUAL' | 'PENDIENTE'; motivo: string; fallosRobot: number } {
  const fallosRobot = Math.max(fallosDe(envio) + 1, Number(fallosInformados) || 0);
  const decision = decidirAnulacion({ ...envio, estado: 'ERROR', fallosRobot, manualMotivo: '' }, nowMs);
  if (decision.accion === 'MANUAL') {
    return { estado: 'MANUAL', motivo: decision.motivo, fallosRobot };
  }
  return { estado: 'PENDIENTE', motivo: '', fallosRobot };
}

export function planRespuestaAnulacion(
  envio: EnvioAnulacion | null,
  opts: { nowMs: number; envioId: string; cuitRepresentado: string },
): { status: number; body: Record<string, unknown>; patch: Record<string, unknown> | null; avisar: boolean } {
  if (!envio) return { status: 404, body: { error: 'NO_EXISTE' }, patch: null, avisar: false };
  if (envio.tipo !== 'ANULACION') {
    return { status: 409, body: { error: 'NO_ES_ANULACION' }, patch: null, avisar: false };
  }
  const decision = decidirAnulacion(envio, opts.nowMs);
  if (decision.motivo === 'PLAZO_VENCIDO' || decision.motivo === 'YA_ANULADO') {
    return { status: 409, body: { error: decision.motivo }, patch: null, avisar: false };
  }
  if (decision.accion === 'NADA') {
    return { status: 409, body: { error: decision.motivo || 'NO_DISPONIBLE' }, patch: null, avisar: false };
  }
  const cuil = soloDigitos(envio.bolsaCuil || envio.cuil);
  const fechaInicio = aaaammdd(envio.fechaInicio || envio.fechaAlta);
  const nroTransaccionAlta = String(envio.nroTransaccionAlta || '').trim();
  const cuitRepresentado = soloDigitos(opts.cuitRepresentado);
  const faltan = cuil.length !== 11 || !fechaInicio || cuitRepresentado.length !== 11;
  if (decision.accion === 'ROBOT' && faltan) {
    return {
      status: 409,
      body: { error: 'MANUAL', motivo: 'FALTAN_DATOS', mensaje: motivoLegible('FALTAN_DATOS') },
      patch: envio.estado === 'MANUAL' ? null : { estado: 'MANUAL', manualMotivo: 'FALTAN_DATOS', carga: 'MANUAL_WEB', origen: 'MANUAL' },
      avisar: envio.estado !== 'MANUAL',
    };
  }
  if (decision.accion === 'MANUAL') {
    const ya = envio.estado === 'MANUAL';
    return {
      status: 409,
      body: { error: 'MANUAL', motivo: decision.motivo, mensaje: motivoLegible(decision.motivo) },
      patch: ya ? null : { estado: 'MANUAL', manualMotivo: decision.motivo, carga: 'MANUAL_WEB', origen: 'MANUAL' },
      avisar: !ya,
    };
  }
  return {
    status: 200,
    body: {
      envioId: opts.envioId,
      empresaId: envio.empresaId || '',
      cuil,
      fechaInicio,
      nroTransaccionAlta,
      cuitRepresentado,
      venceAnulacionMs: Number(envio.venceAnulacionMs) || 0,
    },
    patch: envio.estado === 'SUBIENDO' ? null : { estado: 'SUBIENDO', anulacionReclamadaAtMs: opts.nowMs },
    avisar: false,
  };
}
