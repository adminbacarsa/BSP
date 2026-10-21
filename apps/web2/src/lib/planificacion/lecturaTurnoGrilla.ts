import { esCeldaFranco } from './francoTrabajadoRapido';
import { esCeldaLicencia } from './seleccionLicencia';

function esTurnoOperativo(data: { origin?: string; resolvedBy?: string } | null | undefined): boolean {
    const o = String(data?.origin || '').toUpperCase();
    if (o === 'RETEN' || o === 'OPERATIONS_COVERAGE' || o === 'SLA_VIRTUAL') return true;
    return data?.resolvedBy === 'OPERACIONES';
}

/** Alcance de «No se trabaja»: todo el servicio, un puesto o una franja. */
export type AlcanceNoTrabaja =
    | { tipo: 'todo' }
    | { tipo: 'puesto'; puesto: string }
    | { tipo: 'franja'; puesto: string; code: string };

export type TurnoPlano = {
    code?: string;
    positionName?: string;
    objectiveId?: string;
    isDeleted?: boolean;
    isFranco?: boolean;
    isFrancoTrabajado?: boolean;
    status?: string;
    origin?: string;
    resolvedBy?: string;
    startTime?: unknown;
    endTime?: unknown;
    hours?: number;
};

/** Turno que vale en la celda: el pendiente si no está borrado; si no, el guardado. */
export function turnoVigente(
    pending: TurnoPlano | null | undefined,
    guardado: TurnoPlano | null | undefined,
): TurnoPlano | null {
    if (pending && !pending.isDeleted) return pending;
    if (guardado && !guardado.isDeleted) return guardado;
    return null;
}

function turnoFichado(turno: TurnoPlano): boolean {
    return turno.status === 'PRESENT' || turno.status === 'CHECK_IN' || turno.status === 'COMPLETED';
}

/** La franja del puesto ya tiene a alguien, aunque su fila no esté montada. */
export function ocupaBanda(turno: TurnoPlano | null | undefined, code: string, positionName: string): boolean {
    if (!turno) return false;
    const cod = String(turno.code || '').trim().toUpperCase().replace(/\s+/g, '');
    const esperado = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!cod || cod !== esperado) return false;
    return String(turno.positionName || positionName) === positionName;
}

export function bandaOcupadaEnDatos(
    legajos: ReadonlyArray<{ pending?: TurnoPlano | null; guardado?: TurnoPlano | null }>,
    code: string,
    positionName: string,
): boolean {
    return legajos.some((l) => ocupaBanda(turnoVigente(l.pending, l.guardado), code, positionName));
}

/** El turno de ese legajo pasa a RET con «No se trabaja». Franco, licencia, fichado y otro objetivo no. */
export function debePasarARet(input: {
    turno: TurnoPlano | null | undefined;
    tieneAusencia: boolean;
    objectiveId: string;
    alcance: AlcanceNoTrabaja;
}): boolean {
    const actual = input.turno;
    if (!actual || input.tieneAusencia) return false;
    if (turnoFichado(actual) || esTurnoOperativo(actual)) return false;
    const cod = String(actual.code || '').trim().toUpperCase();
    if (!cod || cod === 'RET') return false;
    if (esCeldaFranco(actual) || esCeldaLicencia({ code: cod, tieneAusencia: false })) return false;
    if (actual.objectiveId && String(actual.objectiveId) !== String(input.objectiveId)) return false;
    if (input.alcance.tipo !== 'todo' && String(actual.positionName || '') !== input.alcance.puesto) return false;
    if (input.alcance.tipo === 'franja' && cod !== String(input.alcance.code).toUpperCase()) return false;
    return true;
}

export function legajosQuePasanARet(
    legajos: ReadonlyArray<{
        empId: string;
        pending?: TurnoPlano | null;
        guardado?: TurnoPlano | null;
        tieneAusencia?: boolean;
    }>,
    objectiveId: string,
    alcance: AlcanceNoTrabaja,
): string[] {
    const out: string[] = [];
    for (const l of legajos) {
        if (debePasarARet({
            turno: turnoVigente(l.pending, l.guardado),
            tieneAusencia: !!l.tieneAusencia,
            objectiveId,
            alcance,
        })) out.push(l.empId);
    }
    return out;
}
