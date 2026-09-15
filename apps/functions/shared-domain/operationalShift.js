'use strict';

const OPERATIONAL_SHIFT_ORIGINS = new Set([
  'RETEN',
  'OPERATIONS_COVERAGE',
  'SLA_VIRTUAL',
]);

function isOperationalOriginShift(shift) {
  if (!shift) return false;
  const origin = String(shift.origin || '').trim().toUpperCase();
  return OPERATIONAL_SHIFT_ORIGINS.has(origin)
    || shift.isReten === true
    || String(shift.resolvedBy || '').trim().toUpperCase() === 'OPERACIONES';
}

module.exports = {
  OPERATIONAL_SHIFT_ORIGINS,
  isOperationalOriginShift,
};
