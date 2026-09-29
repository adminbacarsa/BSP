"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.simulateJob = exports.progressPct = exports.processedOf = exports.markChunk = exports.claimChunks = exports.buildChunks = exports.LEDGER_PARALLEL = exports.LEDGER_CHUNK_SIZE = void 0;
exports.LEDGER_CHUNK_SIZE = 10;
exports.LEDGER_PARALLEL = 3;
function buildChunks(total, size = exports.LEDGER_CHUNK_SIZE) {
    const n = Math.max(0, Math.floor(total));
    const out = [];
    for (let i = 0; i < n; i += size) {
        out.push({ start: i, end: Math.min(i + size, n), status: 'PENDING' });
    }
    return out;
}
exports.buildChunks = buildChunks;
function claimChunks(chunks, parallel = exports.LEDGER_PARALLEL) {
    const idx = [];
    chunks.forEach((c, i) => {
        if (idx.length >= parallel)
            return;
        if (c.status === 'PENDING')
            idx.push(i);
    });
    return idx;
}
exports.claimChunks = claimChunks;
function markChunk(chunks, index, status, error) {
    const cur = chunks[index];
    if (!cur || cur.status === 'DONE')
        return chunks;
    const next = chunks.slice();
    next[index] = { ...cur, status, error: error || '' };
    return next;
}
exports.markChunk = markChunk;
function processedOf(chunks) {
    return chunks.reduce((s, c) => (c.status === 'DONE' || c.status === 'ERROR' ? s + (c.end - c.start) : s), 0);
}
exports.processedOf = processedOf;
function progressPct(processed, total) {
    if (!(total > 0))
        return 0;
    return Math.max(0, Math.min(100, Math.round((100 * processed) / total)));
}
exports.progressPct = progressPct;
function simulateJob(total, size = exports.LEDGER_CHUNK_SIZE, parallel = exports.LEDGER_PARALLEL) {
    let chunks = buildChunks(total, size);
    const waves = [];
    let guard = 0;
    while (chunks.some((c) => c.status === 'PENDING') && guard < 1000) {
        const idx = claimChunks(chunks, parallel);
        if (!idx.length)
            break;
        for (const i of idx) {
            chunks = markChunk(chunks, i, 'DONE');
            chunks = markChunk(chunks, i, 'DONE');
        }
        waves.push(processedOf(chunks));
        guard += 1;
    }
    const processed = processedOf(chunks);
    return {
        processed,
        total,
        pct: progressPct(processed, total),
        waves: waves.length,
        chunkCount: chunks.length,
        maxChunk: chunks.reduce((m, c) => Math.max(m, c.end - c.start), 0),
        pending: chunks.filter((c) => c.status === 'PENDING').length,
    };
}
exports.simulateJob = simulateJob;
//# sourceMappingURL=jobPlan.js.map