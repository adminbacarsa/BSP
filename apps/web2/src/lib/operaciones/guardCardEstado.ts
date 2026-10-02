/**
 * Estado visible de la tarjeta del guardia en el CC.
 * Un turno con presencia nunca se muestra como DESCUBIERTO aunque conserve la marca
 * de la escalada (p. ej. un eventual AA que después revirtió el operador).
 */
export const ALTA_ARCA_ALERTA_MS = 2 * 60 * 60 * 1000;

export type GuardCardEstadoShift = {
    isPresent?: boolean;
    isDescubierto?: boolean;
    isSinCobertura?: boolean;
    operacionallyCovered?: boolean;
    esEventual?: boolean;
    eventualAltaArcaConfirmada?: boolean;
    shiftDateObj?: Date;
};

export function mostrarDescubierto(shift: GuardCardEstadoShift | null | undefined): boolean {
    if (!shift) return false;
    if (shift.isPresent === true) return false;
    return shift.isDescubierto === true || shift.isSinCobertura === true;
}

export function altaArcaPendienteVisible(shift: GuardCardEstadoShift | null | undefined, now: Date): boolean {
    if (shift?.esEventual !== true || shift?.eventualAltaArcaConfirmada === true) return false;
    const start = shift.shiftDateObj instanceof Date ? shift.shiftDateObj.getTime() : NaN;
    if (!Number.isFinite(start)) return false;
    return now.getTime() >= start - ALTA_ARCA_ALERTA_MS;
}

/** Aviso secundario, no un chip de estado. */
export const ALTA_ARCA_AVISO_TEXTO = 'Alta ARCA pendiente · urgente';
export const ALTA_ARCA_AVISO_TITLE = 'Sin número de transacción: el alta sale en el próximo envío urgente. Sin el número no puede fichar por la app.';
