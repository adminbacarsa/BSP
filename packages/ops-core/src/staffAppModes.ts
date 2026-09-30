/**
 * Tipos y helpers multi-rol (app COSP / panel).
 * Alineado con callables Plataforma: resolveStaffProfile, sesionOperador.
 * Archivo aparte para no tocar el núcleo ops-core de cobertura/monitor.
 */

/** Empresa visible para staff multi-tenant. */
export type StaffEmpresa = {
  id: string;
  name: string;
};

/**
 * Respuesta de la callable `resolveStaffProfile`.
 * `employeeId` puede venir omitido o string (Plataforma); normalizar a null en clientes.
 */
export type StaffProfile = {
  isGuard: boolean;
  employeeId: string | null;
  isStaff: boolean;
  isSuperAdmin: boolean;
  empresas: StaffEmpresa[];
  /** permissions por módulo: MODULE_KEY → acciones ('read', 'create', …) */
  modules: Record<string, string[]>;
};

/** Acciones reales de la callable `sesionOperador`. */
export type SesionOperadorAction =
  | 'start'
  | 'end'
  | 'requestPilot'
  | 'cancelPilotRequest'
  | 'acceptPilot'
  | 'rejectPilot'
  | 'passToAuto';

export type WriteOrigin = 'WEB' | 'MOBILE';

export type SesionOperadorRequest = {
  action: SesionOperadorAction;
  empresaId: string;
  writeOrigin?: WriteOrigin;
};

export type SesionOperadorResponse = {
  success: true;
  action: SesionOperadorAction;
};

/** Modos de la app multi-rol (Fase 0). */
export type AppModeId =
  | 'guardia'
  | 'operacion'
  | 'supervision'
  | 'rrhh'
  | 'planificacion';

export type AppModeDef = {
  id: AppModeId;
  label: string;
  /** null = modo Guardia (no usa modules de staff) */
  moduleKey: string | null;
  /** Ruta expo-router */
  href: string;
};

export const APP_MODE_DEFS: AppModeDef[] = [
  { id: 'guardia', label: 'Guardia', moduleKey: null, href: '/(tabs)' },
  { id: 'operacion', label: 'Operación', moduleKey: 'OPERATIONS', href: '/(staff)/operacion' },
  { id: 'supervision', label: 'Supervisión', moduleKey: 'SUPERVISION', href: '/(staff)/supervision' },
  { id: 'rrhh', label: 'RRHH', moduleKey: 'RRHH', href: '/(staff)/rrhh' },
  {
    id: 'planificacion',
    label: 'Planificación',
    moduleKey: 'PLANNING',
    href: '/(staff)/planificacion',
  },
];

/** Módulos staff de la app (mismo set que Plataforma STAFF_APP_MODULE_KEYS). */
export const STAFF_APP_MODULE_KEYS = ['OPERATIONS', 'SUPERVISION', 'RRHH', 'PLANNING'] as const;

const BASE_ACTIONS = ['read', 'create', 'update', 'delete'] as const;
const MODULE_ONLY_ACTIONS: Record<string, readonly string[]> = {
  PLANNING: ['publish', 'correct', 'auto_lab', 'assign_ft'],
  RRHH: ['adjust'],
};

/** Permisos SA para stub de emulador (solo módulos de la app staff). */
export function fullSuperAdminModules(): Record<string, string[]> {
  const perms: Record<string, string[]> = {};
  for (const m of STAFF_APP_MODULE_KEYS) {
    const extra = MODULE_ONLY_ACTIONS[m] ?? [];
    perms[m] = [...BASE_ACTIONS, ...extra];
  }
  return perms;
}

function hasRead(modules: Record<string, string[]>, moduleKey: string): boolean {
  const actions = modules[moduleKey];
  if (!Array.isArray(actions)) return false;
  return actions.map((a) => String(a).toLowerCase()).includes('read');
}

/**
 * Modos visibles según perfil.
 * - Guardia si isGuard (o SuperAdmin)
 * - Staff: módulos con `read` (SuperAdmin → todos los modos staff de Fase 0)
 */
export function resolveVisibleModes(
  profile: Pick<StaffProfile, 'isGuard' | 'isSuperAdmin' | 'modules'>,
): AppModeDef[] {
  const out: AppModeDef[] = [];
  for (const mode of APP_MODE_DEFS) {
    if (mode.id === 'guardia') {
      if (profile.isGuard || profile.isSuperAdmin) out.push(mode);
      continue;
    }
    if (profile.isSuperAdmin) {
      out.push(mode);
      continue;
    }
    if (mode.moduleKey && hasRead(profile.modules, mode.moduleKey)) {
      out.push(mode);
    }
  }
  return out;
}

export function canAccessMode(
  profile: Pick<StaffProfile, 'isGuard' | 'isSuperAdmin' | 'modules'>,
  modeId: AppModeId,
): boolean {
  return resolveVisibleModes(profile).some((m) => m.id === modeId);
}

export function pickDefaultMode(
  profile: Pick<StaffProfile, 'isGuard' | 'isStaff' | 'isSuperAdmin' | 'modules'>,
  preferred?: AppModeId | null,
): AppModeId | null {
  const visible = resolveVisibleModes(profile);
  if (!visible.length) return null;
  if (preferred && visible.some((m) => m.id === preferred)) return preferred;
  if (profile.isGuard && visible.some((m) => m.id === 'guardia')) return 'guardia';
  const staffFirst = visible.find((m) => m.id !== 'guardia');
  if (staffFirst) return staffFirst.id;
  return visible[0].id;
}

/** Normaliza respuesta cruda de la callable a StaffProfile. */
export function normalizeStaffProfile(raw: unknown): StaffProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (!('isGuard' in data) && !('isStaff' in data)) return null;
  const employeeIdRaw = data.employeeId;
  return {
    isGuard: !!data.isGuard,
    employeeId:
      typeof employeeIdRaw === 'string' && employeeIdRaw.trim()
        ? employeeIdRaw.trim()
        : null,
    isStaff: !!data.isStaff,
    isSuperAdmin: !!data.isSuperAdmin,
    empresas: Array.isArray(data.empresas)
      ? (data.empresas as StaffEmpresa[]).map((e) => ({
          id: String((e as StaffEmpresa).id || ''),
          name: String((e as StaffEmpresa).name || (e as StaffEmpresa).id || ''),
        }))
      : [],
    modules:
      data.modules && typeof data.modules === 'object'
        ? (data.modules as Record<string, string[]>)
        : {},
  };
}
