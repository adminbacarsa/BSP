/**
 * Clave fiscal del robot ARCA. La clave no se loguea: Firestore guarda metadatos
 * y Secret Manager guarda el secreto. El secreto es por CUIT de ingreso
 * (`arca-clave-fiscal-{cuitLogin}`): varias empresas pueden apuntar al mismo.
 */
import { isSuperAdminRole } from '../common/role.util';
import { rateLimitHit } from './arcaEnviosCore';

export const AUTH_RECIENTE_MS = 60 * 60 * 1000;
export const CREDENCIAL_MAX = 6;

const CAMPOS_META = ['cuitLogin', 'cuitRepresentado', 'secretRef', 'secretVersion', 'configuradoAt', 'configuradoPor'] as const;

export type MetaClave = {
  cuitLogin: string;
  cuitRepresentado: string;
  secretRef: string;
  secretVersion: string;
  configuradoAt: string;
  configuradoPor: string;
};

export type EmpresaClave = {
  empresaId: string;
  nombre: string;
  cuit: string;
  meta: MetaClave | null;
};

export type CodigoClaveFiscal = 'unauthenticated' | 'permission-denied' | 'failed-precondition' | 'invalid-argument' | 'not-found';

export class ClaveFiscalError extends Error {
  codigo: CodigoClaveFiscal;

  constructor(codigo: CodigoClaveFiscal, message: string) {
    super(message);
    this.codigo = codigo;
  }
}

export type ClaveStore = {
  escribir(secretId: string, clave: string): Promise<{ version: string }>;
  leer(secretId: string): Promise<string>;
  destruir(secretId: string): Promise<void>;
};

export type MetaStore = {
  listar(): Promise<EmpresaClave[]>;
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

export function enmascararCuit(cuit: unknown): string {
  const d = soloDigitosCuit(cuit);
  return d ? `***${d.slice(-3)}` : '—';
}

/** Id legacy por empresa (primera versión). Solo lo usa el robot como respaldo si el meta no trae `secretRef`. */
export function secretIdDe(empresaId: string): string {
  const limpio = String(empresaId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 200);
  if (!limpio) throw new ClaveFiscalError('invalid-argument', 'Falta la empresa.');
  return `arca-clave-fiscal-${limpio}`;
}

export function secretRefDeCuit(cuitLogin: string): string {
  const d = soloDigitosCuit(cuitLogin);
  if (!/^\d{11}$/.test(d)) {
    throw new ClaveFiscalError('invalid-argument', 'El CUIT con el que se entra a ARCA tiene que tener 11 dígitos.');
  }
  return `arca-clave-fiscal-${d}`;
}

export function secretRefDeMeta(meta: Pick<MetaClave, 'secretRef'> | null | undefined, empresaId: string): string {
  return String(meta?.secretRef || '') || secretIdDe(empresaId);
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
  salida.cuitLoginEnmascarado = enmascararCuit(meta.cuitLogin);
  salida.cuitRepresentadoEnmascarado = enmascararCuit(meta.cuitRepresentado);
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

/** Empresas configuradas que apuntan a ese secreto. */
export function empresasConSecreto(lista: EmpresaClave[], secretRef: string): string[] {
  return lista
    .filter((e) => e.meta?.secretVersion && secretRefDeMeta(e.meta, e.empresaId) === secretRef)
    .map((e) => e.empresaId);
}

export type ExtenderA = { empresaId: string; cuitRepresentado: string };

export function normalizarExtender(valor: unknown, empresaId: string, lista: EmpresaClave[]): ExtenderA[] {
  if (!Array.isArray(valor)) return [];
  const ids = new Set<string>();
  const salida: ExtenderA[] = [];
  for (const item of valor) {
    const id = String((item as { empresaId?: unknown })?.empresaId || '').trim();
    if (!id || id === empresaId || ids.has(id)) continue;
    const empresa = lista.find((e) => e.empresaId === id);
    if (!empresa) throw new ClaveFiscalError('invalid-argument', `La empresa ${id} no está en la plataforma.`);
    const cuitRepresentado = soloDigitosCuit((item as { cuitRepresentado?: unknown })?.cuitRepresentado) || empresa.cuit;
    if (!/^\d{11}$/.test(cuitRepresentado)) {
      throw new ClaveFiscalError('invalid-argument', `El CUIT representado de ${empresa.nombre} tiene que tener 11 dígitos.`);
    }
    ids.add(id);
    salida.push({ empresaId: id, cuitRepresentado });
  }
  return salida;
}

function vistaEmpresas(lista: EmpresaClave[], empresaId: string): Record<string, unknown>[] {
  return lista
    .filter((e) => e.empresaId !== empresaId)
    .map((e) => ({
      empresaId: e.empresaId,
      nombre: e.nombre,
      cuit: e.cuit,
      configurada: !!(e.meta?.cuitLogin && e.meta.secretVersion),
      cuitLogin: e.meta?.cuitLogin || '',
      cuitRepresentado: e.meta?.cuitRepresentado || '',
    }));
}

const ESCRITURAS = ['guardar', 'editarCuits', 'reemplazarClave', 'quitar'];

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
  const actor = input.actorName || auth.uid;
  const ahoraIso = new Date(input.ahoraMs).toISOString();

  if (ESCRITURAS.includes(accion)) {
    const authTime = Number(auth.token?.auth_time || 0);
    if (!ingresoReciente(authTime, input.ahoraMs, !!input.emulator)) {
      throw new ClaveFiscalError(
        'failed-precondition',
        'Volvé a iniciar sesión: cambiar la clave fiscal pide un ingreso de la última hora.',
      );
    }
  }

  const lista = await ports.meta.listar();
  const propia = lista.find((e) => e.empresaId === empresaId);
  if (!propia) throw new ClaveFiscalError('not-found', 'La empresa no está en la plataforma.');
  const meta = propia.meta;
  const nombreDe = (id: string) => lista.find((e) => e.empresaId === id)?.nombre || id;

  if (accion === 'leer') {
    return {
      ...metaPublica(meta),
      empresa: { empresaId, nombre: propia.nombre, cuit: propia.cuit },
      empresas: vistaEmpresas(lista, empresaId),
    };
  }

  const auditar = (action: string, id: string, details: string) =>
    ports.audit.add({ action, actorUid: auth.uid, actorName: actor, empresaId: id, details });

  /** Destruye el secreto solo cuando ninguna empresa lo referencia. */
  const limpiarSiHuerfano = async (secretRef: string): Promise<boolean> => {
    const quedan = empresasConSecreto(await ports.meta.listar(), secretRef);
    if (quedan.length) return false;
    try {
      await ports.store.destruir(secretRef);
    } catch (e) {
      throw mapStore(e);
    }
    return true;
  };

  if (accion === 'quitar') {
    if (input.data?.confirmar !== true) {
      throw new ClaveFiscalError('invalid-argument', 'Confirmá que querés quitar la clave fiscal.');
    }
    if (!meta) return { configurada: false, empresas: vistaEmpresas(lista, empresaId) };
    const ref = secretRefDeMeta(meta, empresaId);
    await ports.meta.borrar(empresaId);
    const destruido = await limpiarSiHuerfano(ref);
    await auditar(
      'ARCA_CLAVE_QUITADA',
      empresaId,
      destruido
        ? `Se quitó la clave fiscal de ${propia.nombre} y se destruyó el secreto.`
        : `Se quitó la clave fiscal de ${propia.nombre}; el secreto sigue en uso por otra empresa.`,
    );
    return { configurada: false, empresas: vistaEmpresas(await ports.meta.listar(), empresaId) };
  }

  if (accion === 'reemplazarClave') {
    if (!meta) throw new ClaveFiscalError('failed-precondition', 'Primero cargá las credenciales completas.');
    const clave = String(input.data?.clave ?? '');
    validarClave(clave);
    const ref = secretRefDeMeta(meta, empresaId);
    let version = '';
    try {
      version = (await ports.store.escribir(ref, clave)).version;
    } catch (e) {
      throw mapStore(e);
    }
    const afectadas = empresasConSecreto(lista, ref);
    let salida: MetaClave | null = null;
    for (const id of afectadas) {
      const previa = lista.find((e) => e.empresaId === id)?.meta;
      if (!previa) continue;
      const nueva: MetaClave = { ...previa, secretRef: ref, secretVersion: version, configuradoAt: ahoraIso, configuradoPor: actor };
      await ports.meta.guardar(id, nueva);
      if (id === empresaId) salida = nueva;
      await auditar('ARCA_CLAVE_REEMPLAZADA', id, `Clave nueva para ${nombreDe(id)}: CUIT de ingreso ${enmascararCuit(previa.cuitLogin)}, versión ${version}.`);
    }
    return { ...metaPublica(salida), afectadas };
  }

  if (accion === 'editarCuits') {
    if (!meta) throw new ClaveFiscalError('failed-precondition', 'Primero cargá las credenciales completas.');
    const cuitLogin = soloDigitosCuit(input.data?.cuitLogin ?? meta.cuitLogin);
    const cuitRepresentado = soloDigitosCuit(input.data?.cuitRepresentado ?? meta.cuitRepresentado);
    validarCuits(cuitLogin, cuitRepresentado);
    const refVieja = secretRefDeMeta(meta, empresaId);
    let ref = refVieja;
    let version = meta.secretVersion;
    if (cuitLogin !== meta.cuitLogin) {
      ref = secretRefDeCuit(cuitLogin);
      const existente = lista.find((e) => e.empresaId !== empresaId && e.meta?.secretVersion && secretRefDeMeta(e.meta, e.empresaId) === ref);
      if (existente?.meta) {
        version = existente.meta.secretVersion;
      } else {
        try {
          const clave = await ports.store.leer(refVieja);
          if (!clave) throw new ClaveFiscalError('failed-precondition', 'El secreto actual está vacío: reemplazá la clave.');
          version = (await ports.store.escribir(ref, clave)).version;
        } catch (e) {
          throw mapStore(e);
        }
      }
    }
    const nueva: MetaClave = { ...meta, cuitLogin, cuitRepresentado, secretRef: ref, secretVersion: version, configuradoAt: ahoraIso, configuradoPor: actor };
    await ports.meta.guardar(empresaId, nueva);
    if (ref !== refVieja) await limpiarSiHuerfano(refVieja);
    await auditar('ARCA_CLAVE_CUIT_EDITADO', empresaId, `${propia.nombre}: CUIT de ingreso ${enmascararCuit(cuitLogin)}, representado ${enmascararCuit(cuitRepresentado)}.`);
    return metaPublica(nueva);
  }

  if (accion !== 'guardar') throw new ClaveFiscalError('invalid-argument', 'Acción desconocida.');

  const cuitLogin = soloDigitosCuit(input.data?.cuitLogin);
  const cuitRepresentado = soloDigitosCuit(input.data?.cuitRepresentado) || propia.cuit;
  const clave = String(input.data?.clave ?? '');
  validarCuits(cuitLogin, cuitRepresentado);
  validarClave(clave);
  const extender = normalizarExtender(input.data?.extender, empresaId, lista);
  const ref = secretRefDeCuit(cuitLogin);
  let version = '';
  try {
    version = (await ports.store.escribir(ref, clave)).version;
  } catch (e) {
    throw mapStore(e);
  }
  const destinos: ExtenderA[] = [{ empresaId, cuitRepresentado }, ...extender];
  const refsViejas = new Set<string>();
  let salida: MetaClave | null = null;
  for (const destino of destinos) {
    const previa = lista.find((e) => e.empresaId === destino.empresaId)?.meta;
    if (previa?.secretVersion) {
      const vieja = secretRefDeMeta(previa, destino.empresaId);
      if (vieja !== ref) refsViejas.add(vieja);
    }
    const nueva: MetaClave = {
      cuitLogin,
      cuitRepresentado: destino.cuitRepresentado,
      secretRef: ref,
      secretVersion: version,
      configuradoAt: ahoraIso,
      configuradoPor: actor,
    };
    await ports.meta.guardar(destino.empresaId, nueva);
    if (destino.empresaId === empresaId) salida = nueva;
    await auditar(
      'ARCA_CLAVE_GUARDADA',
      destino.empresaId,
      `Credenciales para ${nombreDe(destino.empresaId)}: CUIT de ingreso ${enmascararCuit(cuitLogin)}, representado ${enmascararCuit(destino.cuitRepresentado)}, versión ${version}.`,
    );
  }
  // Otras empresas con el mismo CUIT de ingreso comparten el secreto: su versión también cambió.
  for (const e of lista) {
    if (destinos.some((d) => d.empresaId === e.empresaId) || !e.meta?.secretVersion) continue;
    if (secretRefDeMeta(e.meta, e.empresaId) !== ref) continue;
    await ports.meta.guardar(e.empresaId, { ...e.meta, secretRef: ref, secretVersion: version, configuradoAt: ahoraIso, configuradoPor: actor });
  }
  for (const vieja of refsViejas) await limpiarSiHuerfano(vieja);
  return {
    ...metaPublica(salida),
    extendidas: extender.map((x) => x.empresaId),
    empresas: vistaEmpresas(await ports.meta.listar(), empresaId),
  };
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
      details: `El robot leyó la clave de ${empresaId} (${secretRefDeMeta(input.meta, empresaId)}, versión ${input.meta.secretVersion}).`,
    },
  };
}