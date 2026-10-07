import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultAbsenceType, filterAbsenceTypesForFeatures } from '../../../../packages/portal-core/src/absences/employeeAbsence.ts';

test('avisar que no va no arranca en Vacaciones', () => {
  const todas = filterAbsenceTypesForFeatures({ reportAbsence: true, requestLicense: true });
  assert.equal(todas[0], 'Vacaciones');
  assert.equal(defaultAbsenceType(todas), 'Ausencia con aviso');
  const soloLicencia = filterAbsenceTypesForFeatures({ reportAbsence: false, requestLicense: true });
  assert.equal(defaultAbsenceType(soloLicencia), 'Vacaciones');
});
