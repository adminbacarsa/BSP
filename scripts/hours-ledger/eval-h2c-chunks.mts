import { simulateJob } from '../../apps/functions/src/hoursLedger/jobPlan.ts';

const sim = simulateJob(150, 10, 3);
if (sim.processed !== 150 || sim.pct !== 100) throw new Error(`progreso ${sim.processed} ${sim.pct}`);
if (sim.pending !== 0) throw new Error('quedaron tandas');
if (sim.maxChunk > 10) throw new Error('tanda grande');
if (sim.chunkCount !== 15 || sim.waves !== 5) throw new Error(`ondas ${sim.waves} tandas ${sim.chunkCount}`);
const again = simulateJob(150);
if (again.processed !== 150) throw new Error('reintento duplicó');
console.log('chunks-150', JSON.stringify(sim));
