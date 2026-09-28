/** Tandas del recálculo. Puro: lo usa el worker y el test de 150 objetivos. */

export const LEDGER_CHUNK_SIZE = 10;
export const LEDGER_PARALLEL = 3;

export type ChunkMark = 'PENDING' | 'RUNNING' | 'DONE' | 'ERROR';

export type LedgerChunk = {
  start: number;
  end: number;
  status: ChunkMark;
  error?: string;
};

export function buildChunks(total: number, size = LEDGER_CHUNK_SIZE): LedgerChunk[] {
  const n = Math.max(0, Math.floor(total));
  const out: LedgerChunk[] = [];
  for (let i = 0; i < n; i += size) {
    out.push({ start: i, end: Math.min(i + size, n), status: 'PENDING' });
  }
  return out;
}

export function claimChunks(chunks: LedgerChunk[], parallel = LEDGER_PARALLEL): number[] {
  const idx: number[] = [];
  chunks.forEach((c, i) => {
    if (idx.length >= parallel) return;
    if (c.status === 'PENDING') idx.push(i);
  });
  return idx;
}

export function markChunk(chunks: LedgerChunk[], index: number, status: 'DONE' | 'ERROR', error?: string): LedgerChunk[] {
  const cur = chunks[index];
  if (!cur || cur.status === 'DONE') return chunks;
  const next = chunks.slice();
  next[index] = { ...cur, status, error: error || '' };
  return next;
}

export function processedOf(chunks: LedgerChunk[]): number {
  return chunks.reduce((s, c) => (c.status === 'DONE' || c.status === 'ERROR' ? s + (c.end - c.start) : s), 0);
}

export function progressPct(processed: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((100 * processed) / total)));
}

export function simulateJob(total: number, size = LEDGER_CHUNK_SIZE, parallel = LEDGER_PARALLEL) {
  let chunks = buildChunks(total, size);
  const waves: number[] = [];
  let guard = 0;
  while (chunks.some((c) => c.status === 'PENDING') && guard < 1000) {
    const idx = claimChunks(chunks, parallel);
    if (!idx.length) break;
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
