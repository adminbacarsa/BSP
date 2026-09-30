const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function cuilDigits(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

/** Dígito verificador de CUIT/CUIL (módulo 11). */
export function cuilCheckDigit(first10) {
  let sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(first10[i]) * WEIGHTS[i];
  const mod = sum % 11;
  if (mod === 0) return '0';
  if (mod === 1) return '9';
  return String(11 - mod);
}

/** 11 dígitos y verificador válido. Null si no es un CUIL. */
export function normalizeCuil(raw) {
  const digits = cuilDigits(raw);
  if (digits.length !== 11) return null;
  if (cuilCheckDigit(digits.slice(0, 10)) !== digits[10]) return null;
  return digits;
}
