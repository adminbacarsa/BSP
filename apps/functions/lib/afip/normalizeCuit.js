"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCuitInput = normalizeCuitInput;
function normalizeCuitInput(raw) {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (digits.length !== 11)
        return null;
    return {
        digits,
        formatted: `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`,
        numeric: Number(digits),
    };
}
//# sourceMappingURL=normalizeCuit.js.map