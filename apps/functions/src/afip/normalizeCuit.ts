export type NormalizedCuit = {
  digits: string;
  formatted: string;
  numeric: number;
};

export function normalizeCuitInput(raw: unknown): NormalizedCuit | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return null;
  return {
    digits,
    formatted: `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`,
    numeric: Number(digits),
  };
}
