/**
 * Ciclo rotativo 24 días: 6M+2F+6T+2F+6N+2F (≈1 semana por banda).
 * Garantiza equidad M/T/N y francos entre saltos de banda (sin M→N directo).
 */
export const CYCLE_24_MTN_LEN = 24;

export const CYCLE_24_MTN: readonly string[] = [
    ...Array(6).fill('M'),
    ...Array(2).fill('F'),
    ...Array(6).fill('T'),
    ...Array(2).fill('F'),
    ...Array(6).fill('N'),
    ...Array(2).fill('F'),
];

export const MTN_WORK_BANDS = new Set(['M', 'T', 'N']);

export function isRotativeMtnWorkCode(code: string): boolean {
    return MTN_WORK_BANDS.has(String(code || '').toUpperCase());
}

/** Anillo M/T/N de 3 bandas (sin D12/N12 como bandas principales). */
export function positionUsesRotativeMtnCycle(shiftCodes: string[]): boolean {
    const bands = shiftCodes.map((c) => String(c || '').toUpperCase());
    return bands.includes('M') && bands.includes('T') && bands.includes('N');
}

/** Mapea offset del ciclo CCT (6+2 → 8d) al slot de apertura 0..23 del ciclo MTN. */
export function mtnOpeningSlotFromGroupOffset(groupOffset: number, cctCycleLen: number): number {
    const len = CYCLE_24_MTN.length;
    const o = ((groupOffset % cctCycleLen) + cctCycleLen) % cctCycleLen;
    return Math.floor((o * len) / Math.max(1, cctCycleLen)) % len;
}

/** Código del día en el ciclo MTN (M/T/N) o null si es franco del ciclo. */
export function resolveRotativeMtnCode(openingSlot24: number, absDay: number): string | null {
    const idx = ((openingSlot24 % CYCLE_24_MTN_LEN) + absDay) % CYCLE_24_MTN_LEN;
    const code = String(CYCLE_24_MTN[idx] || '').toUpperCase();
    return isRotativeMtnWorkCode(code) ? code : null;
}

/** Día laborable según ciclo MTN (no F del patrón 24d). */
export function rotativeMtnIsWorkDay(openingSlot24: number, absDay: number): boolean {
    return resolveRotativeMtnCode(openingSlot24, absDay) !== null;
}
