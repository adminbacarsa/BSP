export function isShiftConsolidated(shift: any): boolean {
    if (!shift) return false;
    if (shift.status === 'PRESENT' || shift.status === 'CHECK_IN' || shift.status === 'COMPLETED') return true;
    return false;
}

/** Normaliza documento RFZ para vista de celda / modal de turno. */
export function rfzDocToShiftView(rfz: any) {
    return {
        id: rfz.id,
        ...rfz,
        code: 'RFZ',
        type: rfz.type || 'Refuerzo Cliente',
        name: 'Refuerzo Cliente',
        objectiveId: rfz.objectiveId,
        startTime: rfz.startTime,
        endTime: rfz.endTime,
        positionName: rfz.positionName,
        draft: rfz.draft,
        hours: rfz.hours,
        isRfz: true,
        origin: rfz.origin || 'CLIENT_REQUEST',
        employeeId: rfz.employeeId,
        employeeName: rfz.employeeName,
    };
}
