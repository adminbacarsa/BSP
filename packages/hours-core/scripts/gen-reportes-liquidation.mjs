import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const src = fs.readFileSync(path.join(repoRoot, 'apps/web2/src/hooks/useReportes.ts'), 'utf8');
const lines = src.split(/\r?\n/);
const chunk = lines.slice(36, 951).join('\n');
const header = `import {
  deploymentShiftHours,
  isDeploymentOrPoolShift,
  isRegularLiquidationWorkShift,
} from '../planning/deploymentRoles';
import { RET_STANDBY_REFERENCE_HOURS } from '../planning/constants';
import { calcPlanningBillableShiftHours } from '../planning/planningScheduledHours';
import {
  coalescePlannedCellBillableHours,
  coalescePlannedTurnosForCell,
} from '../planning/planningTurnoCoalesce';
import { isEmployeeOnLeave, RRHH_ABSENCE_TYPES } from '../planning/leaveCoverage';

`;
const out = path.join(__dirname, '../src/motors/liquidation/reportesLiquidation.ts');
fs.writeFileSync(out, header + chunk);
console.log('wrote', out, fs.statSync(out).size);
