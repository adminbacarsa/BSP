/**
 * Panel "Trabajaron" (TOT): selección del día contra datos reales de pruebas_sa del 26/09/2026.
 * Fixture = misma consulta del panel (startTime desde el mediodía del 25 hasta el fin del 26), leída de prod.
 * Nombres anonimizados ("Guardia NN", mismo alias por legajo); ids y estructura intactos.
 *
 *   npx tsx --tsconfig apps/web2/tsconfig.json scripts/eval-worked-day-shifts.mts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  selectWorkedDayShifts,
  workedDayKey,
  WORKED_EXCLUDED_CODES,
  type WorkedDayDoc,
} from '../apps/web2/src/lib/operaciones/workedDayShifts.ts';

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'trabajaron-pruebas-sa-2026-09-26.json'), 'utf8'),
) as { day: string; docs: Array<Record<string, any>>; linkedNames: Record<string, string> };

const day = fixture.day;
const docs: WorkedDayDoc[] = fixture.docs.map(({ id, ...data }) => ({ id: String(id), data }));
const linked = new Map(Object.entries(fixture.linkedNames || {}));

let failed = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = got === want;
  console.log(ok ? 'OK' : 'FALLA', `\t${label}\tesperado ${want}\tobtenido ${got}`);
  if (!ok) failed++;
};

/** Filtro anterior del panel (origin/main), para medir qué cambia. */
function legacySelect(): Array<{ id: string; data: Record<string, any> }> {
  const dayStart = new Date(`${day}T00:00:00-03:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600e3);
  const d = (v: unknown) => (v ? new Date(String(v)) : null);
  return docs.filter(({ data: s }) => {
    if (s.isDeleted === true || s.isFranco === true) return false;
    if (!s.employeeId || s.employeeId === 'VACANTE' || s.isUnassigned === true) return false;
    if (s.coverageHoursOnSource === true) return false;
    const rs = d(s.realStartTime) || d(s.checkInTime);
    if (!rs) return false;
    const re = d(s.realEndTime) || d(s.checkOutTime);
    const inProgress = !s.isCompleted && !re;
    const we = re || (inProgress ? new Date() : d(s.endTime));
    return !(rs >= dayEnd || (we && we < dayStart));
  });
}

/** Alias de los casos revisados contra el CSV del panel. */
const G = {
  licenciaV: 'Guardia 41',
  nocheDel25YN12Del26: 'Guardia 38',
  tardeDel25YMananaDel26: 'Guardia 08',
  tardeObradorDel25YDel26: 'Guardia 19',
  noche0000Del26: 'Guardia 50',
  ftCubreAusente: 'Guardia 36',
  ausenteConExtendPropia: 'Guardia 05',
  ftCubreA: 'Guardia 54',
  cubiertoPorFt: 'Guardia 48',
  ftCubreCobertura: 'Guardia 32',
  coberturaCubierta: 'Guardia 56',
  advanceSinTurnoPropio: 'Guardia 43',
  cubiertoPorAdvance: 'Guardia 37',
};

const rows = selectWorkedDayShifts(docs, day, linked);
const legacy = legacySelect();
const name = (s: Record<string, any>) => String(s.employeeName || '');
const byEmp = (alias: string) => rows.filter((r) => name(r.data) === alias);

console.log(`\nTrabajaron ${day}: antes ${legacy.length} filas, ahora ${rows.length}`);
const newIds = new Set(rows.map((r) => r.id));
const legacyIds = new Set(legacy.map((r) => r.id));
for (const r of legacy.filter((x) => !newIds.has(x.id))) {
  console.log(`  - sale  ${String(r.data.code).padEnd(4)} ${name(r.data).padEnd(12)} día ${workedDayKey(r.data)}`);
}
for (const r of rows.filter((x) => !legacyIds.has(x.id))) {
  console.log(`  + entra ${String(r.data.code).padEnd(4)} ${name(r.data).padEnd(12)} ${r.data.coverageType || ''} cubre a ${r.coversName}`);
}
for (const r of rows.filter((x) => x.coversName)) {
  console.log(`  cubre a: ${name(r.data)} (${r.data.code}) → ${r.coversName}`);
}

console.log('\nReglas');
check('todas las filas son del día elegido', rows.every((r) => workedDayKey(r.data) === day), true);
check('sin licencias ni francos', rows.some((r) => WORKED_EXCLUDED_CODES.has(String(r.data.code || '').toUpperCase())), false);
check('V del 26 fuera', byEmp(G.licenciaV).length, 0);
check('N de las 23:00 del 25 fuera (queda solo el N12 del 26)', byEmp(G.nocheDel25YN12Del26).map((r) => r.data.code).join(','), 'N12');
check('T 15–23 del 25 fuera (queda solo el M del 26)', byEmp(G.tardeDel25YMananaDel26).map((r) => r.data.code).join(','), 'M');
check('Obrador: T del 25 fuera, T del 26 una sola vez', byEmp(G.tardeObradorDel25YDel26).length, 1);
check('N de las 00:00 del 26 adentro', byEmp(G.noche0000Del26).length, 1);
check('FT cubre al ausente (titular por titularShiftId, no la VACANTE)', byEmp(G.ftCubreAusente).find((r) => r.data.code === 'FT')?.coversName, G.ausenteConExtendPropia);
check('FT cubre al ausente por coversEmployeeName', byEmp(G.ftCubreA).find((r) => r.data.code === 'FT')?.coversName, G.cubiertoPorFt);
check('FT que cubre a una cobertura', byEmp(G.ftCubreCobertura).find((r) => r.data.code === 'FT')?.coversName, G.coberturaCubierta);
check('ADVANCE sin turno propio en la lista aparece y cubre', byEmp(G.advanceSinTurnoPropio)[0]?.coversName, G.cubiertoPorAdvance);
check('ausente con EXTEND sobre sí mismo no figura', byEmp(G.ausenteConExtendPropia).length, 0);

console.log(`\nfallas: ${failed}`);
process.exit(failed ? 1 : 0);
