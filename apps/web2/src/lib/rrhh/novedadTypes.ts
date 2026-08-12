import type { AbsenceCode } from './novedadTypeCodes';

/** Catálogo de tipos de novedad RRHH (colección `tipos_novedad`). */
export type NovedadTypeStatus = 'ACTIVE' | 'INACTIVE';

export type NovedadType = {
  id?: string;
  empresaId?: string;
  label: string;
  code: AbsenceCode;
  /** Días corridos por defecto al cargar la novedad; null = no autocompleta fin. */
  defaultDays: number | null;
  requiresAuth: boolean;
  medicalVerification: boolean;
  status: NovedadTypeStatus;
  sortOrder: number;
  isSystem: boolean;
};

export type NovedadTypeSeed = Omit<NovedadType, 'id' | 'empresaId' | 'status'> & {
  status?: NovedadTypeStatus;
};

/**
 * Tipos actuales en uso + MAVIC (mutual capacitación SUVICO).
 * Seed por empresa la primera vez; no reescribe ausencias históricas.
 */
export const NOVEDAD_TYPE_SEEDS: NovedadTypeSeed[] = [
  { label: 'Vacaciones', code: 'V', defaultDays: null, requiresAuth: true, medicalVerification: false, sortOrder: 10, isSystem: true },
  { label: 'Matrimonio', code: 'L', defaultDays: 10, requiresAuth: true, medicalVerification: false, sortOrder: 20, isSystem: true },
  { label: 'Maternidad', code: 'L', defaultDays: null, requiresAuth: true, medicalVerification: false, sortOrder: 30, isSystem: true },
  { label: 'Nacimiento / Paternidad', code: 'L', defaultDays: 2, requiresAuth: true, medicalVerification: false, sortOrder: 40, isSystem: true },
  { label: 'Fallecimiento Familiar', code: 'L', defaultDays: 3, requiresAuth: true, medicalVerification: false, sortOrder: 50, isSystem: true },
  { label: 'Examen / Estudio', code: 'L', defaultDays: 1, requiresAuth: true, medicalVerification: false, sortOrder: 60, isSystem: true },
  { label: 'Mudanza', code: 'L', defaultDays: 2, requiresAuth: true, medicalVerification: false, sortOrder: 70, isSystem: true },
  { label: 'Donación de Sangre', code: 'L', defaultDays: 1, requiresAuth: true, medicalVerification: false, sortOrder: 80, isSystem: true },
  { label: 'MAVIC', code: 'L', defaultDays: 1, requiresAuth: true, medicalVerification: false, sortOrder: 85, isSystem: true },
  { label: 'Licencia Esp.', code: 'L', defaultDays: null, requiresAuth: true, medicalVerification: false, sortOrder: 90, isSystem: true },
  { label: 'Enfermedad', code: 'E', defaultDays: null, requiresAuth: false, medicalVerification: true, sortOrder: 100, isSystem: true },
  { label: 'ART', code: 'A', defaultDays: null, requiresAuth: false, medicalVerification: true, sortOrder: 110, isSystem: true },
  { label: 'PG Permiso Gremial', code: 'PG', defaultDays: null, requiresAuth: true, medicalVerification: false, sortOrder: 120, isSystem: true },
  { label: 'Sin Goce de Sueldo', code: 'SGS', defaultDays: null, requiresAuth: true, medicalVerification: false, sortOrder: 130, isSystem: true },
  { label: 'Suspensión', code: 'SUS', defaultDays: null, requiresAuth: false, medicalVerification: false, sortOrder: 140, isSystem: true },
  { label: 'Injustificada', code: 'AA', defaultDays: 1, requiresAuth: false, medicalVerification: false, sortOrder: 150, isSystem: true },
];

/** Labels legacy hardcodeados (fallback si aún no hay seed en Firestore). */
export const NOVEDAD_TYPE_LABELS_FALLBACK = NOVEDAD_TYPE_SEEDS.map((s) => s.label);

export function addCalendarDaysYmd(startYmd: string, days: number): string {
  const [y, m, d] = startYmd.split('-').map(Number);
  if (!y || !m || !d) return startYmd;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** endDate inclusivo: 1 día → misma fecha; 10 días → start + 9. */
export function endDateFromDefaultDays(startYmd: string, defaultDays: number | null | undefined): string | null {
  if (defaultDays == null || defaultDays < 1 || !startYmd) return null;
  return addCalendarDaysYmd(startYmd, defaultDays - 1);
}

export function findNovedadTypeByLabel(
  types: NovedadType[],
  label: string,
): NovedadType | undefined {
  const t = String(label || '').trim();
  return types.find((x) => x.label === t);
}
