"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guardFirstName = guardFirstName;
exports.guardLead = guardLead;
const EMPTY = new Set(['', 'undefined', 'null']);
function token(raw) {
    const s = String(raw ?? '').trim();
    if (!s || EMPTY.has(s.toLowerCase()))
        return '';
    return s.split(/\s+/).filter(Boolean)[0] || '';
}
function capitalizeName(raw) {
    const lower = raw.toLocaleLowerCase('es-AR');
    return lower.charAt(0).toLocaleUpperCase('es-AR') + lower.slice(1);
}
function guardFirstName(input) {
    if (!input)
        return '';
    const direct = token(input.firstName);
    if (direct)
        return capitalizeName(direct);
    const full = String(input.employeeName ?? '').trim();
    if (!full || EMPTY.has(full.toLowerCase()))
        return '';
    const comma = full.indexOf(',');
    const given = comma >= 0 ? full.slice(comma + 1) : full;
    const first = token(given);
    return first ? capitalizeName(first) : '';
}
function guardLead(name, sentence) {
    const text = sentence.trim();
    if (!name)
        return text;
    return `${name}, ${text}`;
}
//# sourceMappingURL=pushGreeting.js.map