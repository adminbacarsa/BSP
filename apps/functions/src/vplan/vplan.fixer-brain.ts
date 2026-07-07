/**
 * @deprecated Usar vplan.brain.ts
 */
export {
  applyLightPositionTagFixes,
  evaluateVplanBrainMandates,
  runBrainMandateRepair,
  type VplanBrainAction,
  type VplanBrainReport,
  type VplanMandateKey,
  type VplanMandateStatus,
} from './vplan.brain';

export type VplanFixerPolicy = 'skip' | 'preserve' | 'mandate_repair' | 'solver_full';
