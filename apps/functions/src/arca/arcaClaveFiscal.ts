/**
 * Clave fiscal del robot ARCA. La clave no se loguea: Firestore guarda metadatos
 * y Secret Manager guarda el secreto.
 */
import { isSuperAdminRole } from '../common/role.util';
import { rateLimitHit } from './arcaEnviosCore';

export const AUTH_RECIENTE_MS = 15 * 60 * 1000;
export const CREDENCIAL_MAX = 6;

const CAMPOS_META = ['cuitLogin', 'cuitRepresentado', 'configuradoAt', 'configuradoPor', 'secretVersion'] as const;

export type MetaClave = {
  cuitLogin: string;
  cuitRepresentado: string;
  configuradoAt: string;
  configuradoPor: string;
  secretVersion: string;
};

export class ClaveFiscalError extends Error {
  codigo: 'unauthenticated' | 'permission-denied' | 'failed-precondition' | 'invalid-argument';

  constructor(
    codigo: 'unauthenticated' | 'permission-denied' | 'failed-precondition' | 'invalid-argument',
    message: string,
  ) {
    super(message);
    this.codigo = codigo;
  }
}

export type ClaveStore = {
  escribir(secretId: string, clave: string): Promise<{ version: string }>;
  destruir(secretId: string): Promise<void>;
};

export type MetaStore = {
  leer(empresaId: string): Promise<MetaClave | null>;
  guardar(empresaId: string, meta: MetaClave): Promise<void>;
  borrar(empresaId: string): Promise<void>;
};

export type AuditEntry = {
  action: string;
  actorUid: string;
  actorName: string;
  empresaId: string;
  details: string;
};

export type PortsClave = {
  lookupRole: (uid: string) => Promise<string>;
  store: ClaveStore;
  meta: MetaStore;
  audit: { add(entry: AuditEntry): Promise<void> };
};

export function soloDigitosCuit(valor: unknown): string {
  return String(valor || '').replace(/\D/g, '');
}

export function secretIdDe(empresaId: string): string {
  const limpio = String(empresaId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 200);
  if (!limpio) throw new ClaveFiscalError('invalid-argument', 'Falta la empresa.');
  return `arca-clave-fiscal-${limpio}`;
}

export function validarCuits(cuitLogin: string, cuitRepresentado: string): void {
  if (!/^\d{11}$/.test(cuitLogin)) {
    throw new ClaveFiscalError('invalid-argument', 'El CUIT con el que se entra a ARCA tiene que tener 11 dígitos.');
  }
  if (!/^\d{11}$/.test(cuitRepresentado)) {
    throw new ClaveFiscalError('invalid-argument', 'El CUIT representado tiene que tener 11 dígitos.');
  }
}

export function validarClave(clave: string): void {
  if (!clave || clave.trim() !== clave || clave.length < 4 || clave.length > 80 || /[\r\n\0]/.test(clave)) {
    throw new ClaveFiscalError('invalid-argument', 'La clave fiscal no puede estar vacía, tener espacios en los extremos ni saltos de línea.');
  }
}

export function metaPublica(meta: Partial<MetaClave> | null | undefined): Record<string, unknown> {
  if (!meta?.cuitLogin || !meta.secretVersion) return { configurada: false };
  const salida: Record<string, unknown> = { configurada: true };
  for (const campo of CAMPOS_META) salida[campo] = meta[campo] || '';
  return salida;
}

export function esPermisoSecretManager(error: unknown): boolean {
  const e = error as { code?: number | string; message?: string };
  const code = e?.code;
  const msg = String(e?.message || error || '');
  return code === 7 || code === 'PERMISSION_DENIED' || /PERMISSION_DENIED|permission denied/i.test(msg);
}

export function errorPermisoSecretManager(): ClaveFiscalError {
  return new ClaveFiscalError(
    'failed-precondition',
    'Falta permiso en Secret Manager. La cuenta de Cloud Functions necesita roles/secretmanager.admin sobre los secretos arca-clave-fiscal-* (o secretmanager.secretAccessor, secretVersionAdder y secretVersionManager, más secretCreator la primera vez). Ese permiso se otorga en GCP; desde acá no se cambia.',
  );
}

function mapStore(error: unknown): ClaveFiscalError {
  if (error instanceof ClaveFiscalError) return error;
  if (esPermisoSecretManager(error)) return errorPermisoSecretManager();
  return new ClaveFiscalError('failed-precondition', 'No se pudo usar Secret Manager.');
}

function ingresoReciente(authTimeSec: number, ahoraMs: number, emulator: boolean): boolean {
  if (!authTimeSec) return emulator;
  return ahoraMs - authTimeSec * 1000 <= AUTH_RECIENTE_MS;
}

export async function ejecutarClaveFiscal(
  input: {
    auth: { uid: string; token?: Record<string, unknown> } | null;
    data: Record<string, unknown>;
    ahoraMs: number;
    actorName: string;
    emulator?: boolean;
  },
  ports: PortsClave,
): Promise<Record<string, unknown>> {
  const auth = input.auth;
  if (!auth?.uid) throw new ClaveFiscalError('unauthenticated', 'Tenés que iniciar sesión.');
  let superOk = isSuperAdminRole(auth.token?.role);
  if (!superOk) superOk = isSuperAdminRole(await ports.lookupRole(auth.uid));
  if (!superOk) {
    throw new ClaveFiscalError('permission-denied', 'Solo un SuperAdmin puede ver o cambiar la clave fiscal.');
  }

  const accion = String(input.data?.accion || 'leer');
  const empresaId = String(input.data?.empresaId || '').trim();
  secretIdDe(empresaId);

  if (accion === 'guardar' || accion === 'quitar') {
    const authTime = Number(auth.token?.auth_time || 0);
    if (!ingresoReciente(authTime, input.ahoraMs, !!input.emulator)) {
      throw new ClaveFiscalError(
        'failed-precondition',
        'Volvé a iniciar sesión: guardar o quitar la clave fiscal pide un ingreso de los últimos 15 minutos.',
      );
    }
  }

  if (accion === 'leer') return metaPublica(await ports.meta.leer(empresaId));

  if (accion === 'quitar') {
    if (input.data?.confirmar !== true) {
      throw new ClaveFiscalError('invalid-argument', 'Confirmá que querés quitar la clave fiscal.');
    }
    try {
      await ports.store.destruir(secretIdDe(empresaId));
    } catch (e) {
      throw mapStore(e);
    }
    await ports.meta.borrar(empresaId);
    await ports.audit.add({
      action: 'ARCA_CLAVE_QUITADA',
      actorUid: auth.uid,
      actorName: input.actorName || auth.uid,
      empresaId,
      details: `Se quitó la clave fiscal de ${empresaId}.`,
    });
    return { configurada: false };
  }

  if (accion !== 'guardar') throw new ClaveFiscalError('invalid-argument', 'Acción desconocida.');

  const cuitLogin = soloDigitosCuit(input.data?.cuitLogin);
  const cuitRepresentado = soloDigitosCuit(input.data?.cuitRepresentado);
  const clave = String(input.data?.clave ?? '');
  validarCuits(cuitLogin, cuitRepresentado);
  validarClave(clave);
  let version = '';
  try {
    version = (await ports.store.escribir(secretIdDe(empresaId), clave)).version;
  } catch (e) {
    throw mapStore(e);
  }
  const meta: MetaClave = {
    cuitLogin,
    cuitRepresentado,
    configuradoAt: new Date(input.ahoraMs).toISOString(),
    configuradoPor: input.actorName || auth.uid,
    secretVersion: version,
  };
  await ports.meta.guardar(empresaId, meta);
  const details = `CUIT de ingreso ${cuitLogin}, representado ${cuitRepresentado}, version ${version}.`;
  await ports.audit.add({
    action: 'ARCA_CLAVE_GUARDADA',
    actorUid: auth.uid,
    actorName: input.actorName || auth.uid,
    empresaId,
    details,
  });
  return metaPublica(meta);
}

export async function manejarCredencial(input: {
  key: string;
  expectedKey: string;
  empresaId: string;
  nowMs: number;
  meta: MetaClave | null;
  leerClave: () => Promise<string>;
}): Promise<{ status: number; body: Record<string, unknown>; audit?: { action: string; details: string } }> {
  if (!input.key || input.key !== input.expectedKey) {
    return { status: 401, body: { error: 'NO_AUTORIZADO', mensaje: 'Falta o no coincide x-arca-key.' } };
  }
  const empresaId = String(input.empresaId || '').trim();
  if (!empresaId) return { status: 400, body: { error: 'PARAMETROS', mensaje: 'Falta empresaId.' } };
  if (!rateLimitHit(`credencial:${empresaId}`, input.nowMs, CREDENCIAL_MAX, 60_000)) {
    return { status: 429, body: { error: 'RATE_LIMIT', mensaje: 'Demasiadas lecturas de la clave fiscal. Esperá un minuto.' } };
  }
  if (!input.meta?.secretVersion || !input.meta.cuitLogin) {
    return { status: 403, body: { error: 'SIN_CLAVE_FISCAL', mensaje: 'Esta empresa no tiene clave fiscal configurada.' } };
  }
  let clave = '';
  try {
    clave = await input.leerClave();
  } catch (e) {
    if (esPermisoSecretManager(e)) {
      return {
        status: 403,
        body: {
          error: 'SIN_PERMISO_SECRET_MANAGER',
          mensaje: 'Falta permiso en Secret Manager para leer la clave fiscal. Hace falta roles/secretmanager.admin (o secretAccessor) sobre arca-clave-fiscal-*.',
        },
      };
    }
    return { status: 403, body: { error: 'CLAVE_NO_DISPONIBLE', mensaje: 'No se pudo leer la clave fiscal.' } };
  }
  if (!clave) {
    return { status: 403, body: { error: 'SIN_CLAVE_FISCAL', mensaje: 'La clave fiscal está vacía.' } };
  }
  return {
    status: 200,
    body: {
      cuitLogin: input.meta.cuitLogin,
      cuitRepresentado: input.meta.cuitRepresentado,
      clave,
    },
    audit: {
      action: 'ARCA_CLAVE_LEIDA',
      details: `El robot leyó la clave de ${empresaId} (version ${input.meta.secretVersion}).`,
    },
  };
}