export {
  computeOpsLateArrivalMonitorState,
  hasLateArrivalNotice,
  readLateEtaMinutes,
  resolveLateArrivalEtaAtMs,
  resolveLateAbsenceDeadlineMs,
  formatLateEtaLabelAR,
  opsLateArrivalBadgeLabel,
} from '@cosp/ops-core';

export type {
  OpsLateArrivalMonitorInput,
  OpsLateArrivalMonitorState,
} from '@cosp/ops-core';
