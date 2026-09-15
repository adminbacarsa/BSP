export const getDateKey = (dateInput: any) => {
    const d = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
    const options: any = { timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit' };
    const parts = new Intl.DateTimeFormat('es-AR', options).formatToParts(d);
    const day = parts.find((p: any) => p.type === 'day')?.value;
    const month = parts.find((p: any) => p.type === 'month')?.value;
    const year = parts.find((p: any) => p.type === 'year')?.value;
    return year + '-' + month + '-' + day;
};
/** Fecha pasada (calendario AR): bloquea edición en grilla. */
export const isDateLocked = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const cellDate = new Date(y, m - 1, d);
    cellDate.setHours(23, 59, 59, 999);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return cellDate < startOfToday;
};
export const isShiftConsolidated = (shift: any) => shift && ['PRESENT', 'CHECK_IN', 'COMPLETED'].includes(shift.status);
export const getDayLetter = (dateStr: string) => {
    const parts = dateStr.split('-').map(Number);
    return ['D', 'L', 'M', 'X', 'J', 'V', 'S'][new Date(parts[0], parts[1] - 1, parts[2]).getDay()];
};