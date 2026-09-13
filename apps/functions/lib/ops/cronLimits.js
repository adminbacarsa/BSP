"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRON_MAX_WALL_MS = exports.CRON_BATCH_WRITE_LIMIT = exports.CRON_QUERY_MAX_DOCS = exports.CRON_V1_RUNTIME = void 0;
exports.cronShouldStop = cronShouldStop;
exports.commitBatchIfNeeded = commitBatchIfNeeded;
exports.CRON_V1_RUNTIME = { timeoutSeconds: 540, memory: '512MB' };
exports.CRON_QUERY_MAX_DOCS = 250;
exports.CRON_BATCH_WRITE_LIMIT = 400;
exports.CRON_MAX_WALL_MS = 8 * 60 * 1000;
function cronShouldStop(startedAtMs, maxWallMs = exports.CRON_MAX_WALL_MS) {
    return Date.now() - startedAtMs >= maxWallMs;
}
async function commitBatchIfNeeded(db, batch, opCount) {
    if (opCount < exports.CRON_BATCH_WRITE_LIMIT) {
        return { batch, opCount };
    }
    await batch.commit();
    return { batch: db.batch(), opCount: 0 };
}
//# sourceMappingURL=cronLimits.js.map