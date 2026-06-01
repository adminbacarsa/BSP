/** Género del personal y preferencia por objetivo (ej. sedes que exigen guardia femenina/masculina). */

export type GeneroEmpleado = 'M' | 'F' | '';
export type PreferenciaGeneroPuesto = 'M' | 'F' | 'INDISTINTO';
/** @deprecated usar PreferenciaGeneroPuesto */
export type PreferenciaGeneroObjetivo = PreferenciaGeneroPuesto;

export const GENERO_EMPLEADO_OPTIONS: { value: GeneroEmpleado; label: string }[] = [
    { value: '', label: 'Sin especificar' },
    { value: 'M', label: 'Masculino' },
    { value: 'F', label: 'Femenino' },
];

export const PREFERENCIA_GENERO_OPTIONS: { value: PreferenciaGeneroObjetivo; label: string }[] = [
    { value: 'INDISTINTO', label: 'Indistinto' },
    { value: 'M', label: 'Solo masculino' },
    { value: 'F', label: 'Solo femenino' },
];

export function generoLabel(g: GeneroEmpleado | string | undefined | null): string {
    if (g === 'M') return 'Masculino';
    if (g === 'F') return 'Femenino';
    return 'Sin especificar';
}

export function preferenciaGeneroLabel(p: PreferenciaGeneroObjetivo | string | undefined | null): string {
    if (p === 'M') return 'Solo masculino';
    if (p === 'F') return 'Solo femenino';
    return 'Indistinto';
}

export function normalizePreferenciaGenero(raw: unknown): PreferenciaGeneroObjetivo {
    const v = String(raw || 'INDISTINTO').toUpperCase();
    if (v === 'M' || v === 'F') return v;
    return 'INDISTINTO';
}

export function normalizeGeneroImport(raw: unknown): GeneroEmpleado {
    const s = String(raw || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '');
    if (!s) return '';
    if (['m', 'masculino', 'male', 'hombre', 'varon', 'h', 'masc'].includes(s) || s.startsWith('masc')) return 'M';
    if (['f', 'femenino', 'female', 'mujer', 'fem'].includes(s) || s.startsWith('fem')) return 'F';
    return '';
}

export function checkGeneroPuesto(
    empleadoGenero: GeneroEmpleado | string | undefined | null,
    puestoPreferencia: PreferenciaGeneroPuesto | string | undefined | null,
): { blocked: boolean; message?: string } {
    const pref = normalizePreferenciaGenero(puestoPreferencia);
    if (pref === 'INDISTINTO') return { blocked: false };
    const eg = String(empleadoGenero || '').toUpperCase() as GeneroEmpleado;
    if (!eg) {
        return {
            blocked: true,
            message: `Este puesto requiere personal ${pref === 'F' ? 'femenino' : 'masculino'}; el legajo no tiene género cargado`,
        };
    }
    if (eg !== pref) {
        return {
            blocked: true,
            message: `Este puesto requiere personal ${pref === 'F' ? 'femenino' : 'masculino'}`,
        };
    }
    return { blocked: false };
}

/** @deprecated usar checkGeneroPuesto */
export const checkGeneroObjetivo = checkGeneroPuesto;

export function getPreferenciaGeneroFromPositionStructure(
    positionStructure: Array<{ positionName?: string; preferenciaGenero?: string }>,
    positionName: string | null | undefined,
): PreferenciaGeneroPuesto {
    if (!positionName || positionName === 'General' || positionName === 'Retén') return 'INDISTINTO';
    const pos = positionStructure.find((p) => p.positionName === positionName);
    return normalizePreferenciaGenero(pos?.preferenciaGenero);
}
