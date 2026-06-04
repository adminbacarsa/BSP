export type NormalizedCuit = {
    digits: string;
    formatted: string;
    numeric: number;
};
export declare function normalizeCuitInput(raw: unknown): NormalizedCuit | null;
