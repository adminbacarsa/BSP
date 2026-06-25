"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fichajeDocIdFromKey = fichajeDocIdFromKey;
function fichajeDocIdFromKey(key) {
    const cleaned = String(key).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!cleaned)
        return `fichaje_${Date.now()}`;
    return cleaned.length > 200 ? cleaned.slice(0, 200) : cleaned;
}
//# sourceMappingURL=sanitizeId.js.map