import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePositionDayGap } from '@/lib/planificacion/coverageGapAnalysis';
import { resumenAusenciaDia } from '@/lib/planificacion/coberturaExistente';
import { resolveTitularVacancyWorkShift } from '@/lib/planificacion/vacancyCoverage';
import {
  camposBandaConservada,
  elegirVistaCelda,
  resolverBandaACubrir,
} from '@/lib/planificacion/bandaLicencia';

const EMP = 'martinez';
const PUESTO = 'Puesto 2';
const estructura = [{
  positionName: PUESTO,
  shifts: [
    { code: 'M', hours: 8, startTime: '07:00', endTime: '15:00' },
    { code: 'T', hours: 8, startTime: '15:00', endTime: '23:00' },
    { code: 'N', hours: 8, startTime: '23:00', endTime: '07:00' },
  ],
}];

const puestoSla = {
  positionName: PUESTO,
  qty: 1,
  coverageType: '24hs',
  shifts: estructura[0].shifts,
};

function faltantes(counts: Record<string, number>): string[] {
  const gap = analyzePositionDayGap(puestoSla, 'D', counts, undefined, true, '2026-10-11');
  return (gap?.missingBandsPrimary || []).map((b) => b.code);
}

test('una sola banda sin cerrar manda, aunque el original diga otra', () => {
  const previo = { code: 'N', positionName: PUESTO, startTime: '23:00', endTime: '07:00', hours: 8 };
  const campos = camposBandaConservada(previo);
  assert.deepEqual(campos, {
    originalCode: 'N',
    originalPositionName: PUESTO,
    originalStartTime: '23:00',
    originalEndTime: '07:00',
  });
  const pending = { [`${EMP}_2026-10-11`]: { code: 'V', name: 'Vacaciones', startTime: '00:00', endTime: '23:59', ...campos } };
  const sola = resolverBandaACubrir({
    titularId: EMP,
    dateStr: '2026-10-11',
    pendingChanges: pending,
    positionName: PUESTO,
    positionStructure: estructura,
    bandasFaltantes: ['N'],
  });
  assert.equal(sola?.code, 'N');
  assert.equal(sola?.scheduleLabel, '23:00–07:00');
  const distinta = resolverBandaACubrir({
    titularId: EMP,
    dateStr: '2026-10-11',
    pendingChanges: { [`${EMP}_2026-10-11`]: { code: 'V', originalCode: 'M', originalStartTime: '07:00', originalEndTime: '15:00', positionName: PUESTO } },
    positionName: PUESTO,
    positionStructure: estructura,
    bandasFaltantes: ['N'],
  });
  assert.equal(distinta?.code, 'N');
  assert.equal(distinta?.source, 'sla_faltante');
  assert.notEqual(distinta?.code, 'M');
});

test('si faltan varias, gana originalCode y no la primera de la lista', () => {
  const pending = { [`${EMP}_2026-10-11`]: { code: 'V', originalCode: 'N', originalPositionName: PUESTO, originalStartTime: '23:00', originalEndTime: '07:00' } };
  const banda = resolverBandaACubrir({
    titularId: EMP,
    dateStr: '2026-10-11',
    pendingChanges: pending,
    positionName: PUESTO,
    positionStructure: estructura,
    bandasFaltantes: ['M', 'T', 'N'],
  });
  assert.equal(banda?.code, 'N');
  assert.equal(banda?.source, 'dia');
  assert.equal(banda?.scheduleLabel, '23:00–07:00');
});

test('licencia sin originalCode usa la banda que el SLA dejó sin cubrir, nunca M', () => {
  const codes = faltantes({ M: 1, T: 1 });
  assert.deepEqual(codes, ['N']);
  const shifts: Record<string, { code: string; positionName?: string }> = {
    [`${EMP}_2026-10-07`]: { code: 'M', positionName: PUESTO },
    [`${EMP}_2026-10-08`]: { code: 'M', positionName: PUESTO },
    [`${EMP}_2026-10-09`]: { code: 'F' },
    [`${EMP}_2026-10-10`]: { code: 'F' },
    [`${EMP}_2026-10-11`]: { code: 'V', positionName: PUESTO },
  };
  const banda = resolveTitularVacancyWorkShift(EMP, '2026-10-11', shifts, {}, undefined, undefined, {
    positionName: PUESTO,
    positionStructure: estructura,
    bandasFaltantes: codes,
    absenceBlockStart: '2026-10-11',
  });
  assert.equal(banda?.code, 'N');
  assert.equal(banda?.source, 'sla_faltante');
  assert.equal(banda?.scheduleLabel, '23:00–07:00');
  assert.notEqual(banda?.code, 'M');
  const resumen = resumenAusenciaDia({
    titularEmployeeId: EMP,
    date: '2026-10-11',
    titular: { employeeId: EMP, code: 'V', startTime: '00:00', endTime: '23:59' },
    banda,
  });
  assert.equal(resumen.textoTurno, 'N · Puesto 2 · 23:00–07:00');
});

test('varios días con bandas distintas: cada día la suya', () => {
  const dias: Record<string, string[]> = {
    '2026-10-11': ['N'],
    '2026-10-12': ['N'],
    '2026-10-13': ['T'],
    '2026-10-14': ['T'],
  };
  const resueltas = Object.entries(dias).map(([dateStr, bandasFaltantes]) => resolverBandaACubrir({
    titularId: EMP,
    dateStr,
    shiftsMap: { [`${EMP}_${dateStr}`]: { code: 'V' } },
    positionName: PUESTO,
    positionStructure: estructura,
    bandasFaltantes,
  })?.code);
  assert.deepEqual(resueltas, ['N', 'N', 'T', 'T']);
});

test('si faltan varias bandas, el ciclo elige y no cae en M', () => {
  const patron = ['N', 'N', 'T', 'T', 'M', 'M', 'F', 'F'];
  const shifts: Record<string, { code: string; positionName: string }> = {};
  patron.forEach((code, i) => {
    const dia = String(3 + i).padStart(2, '0');
    shifts[`${EMP}_2026-10-${dia}`] = { code, positionName: PUESTO };
  });
  const faltan = ['M', 'T', 'N'];
  const resueltas = ['11', '12', '13', '14'].map((dia) => resolverBandaACubrir({
    titularId: EMP,
    dateStr: `2026-10-${dia}`,
    shiftsMap: { ...shifts, [`${EMP}_2026-10-${dia}`]: { code: 'V', positionName: PUESTO } },
    positionName: PUESTO,
    positionStructure: estructura,
    bandasFaltantes: faltan,
  })?.code);
  assert.deepEqual(resueltas, ['N', 'N', 'T', 'T']);
  const fuera = resolverBandaACubrir({
    titularId: EMP,
    dateStr: '2026-10-11',
    shiftsMap: shifts,
    positionName: PUESTO,
    positionStructure: estructura,
    bandasFaltantes: ['M', 'T'],
  });
  assert.equal(fuera, null);
});

test('la grilla muestra la licencia y se queda con el turno de trabajo de al lado', () => {
  const docs: Array<{
    code: string;
    positionName?: string;
    startTime: string;
    endTime: string;
    employeeId: string;
    isAbsent?: boolean;
    originalCode?: string;
    originalPositionName?: string;
    originalStartTime?: string;
    originalEndTime?: string;
  }> = [
    { code: 'N', positionName: PUESTO, startTime: '23:00', endTime: '07:00', employeeId: EMP, isAbsent: true },
    { code: 'V', startTime: '00:00', endTime: '23:59', employeeId: EMP },
  ];
  const vista = elegirVistaCelda(docs);
  assert.equal(vista?.code, 'V');
  assert.equal(vista?.originalCode, 'N');
  assert.equal(vista?.originalStartTime, '23:00');
  assert.equal(vista?.originalEndTime, '07:00');
  const resumen = resumenAusenciaDia({
    titularEmployeeId: EMP,
    date: '2026-10-11',
    titular: { id: 'v', employeeId: EMP, code: 'V', startTime: '00:00', endTime: '23:59' },
    turnosDelDia: [
      { id: 'v', employeeId: EMP, code: 'V', startTime: '00:00', endTime: '23:59' },
      { id: 'n', employeeId: EMP, code: 'N', positionName: PUESTO, startTime: '23:00', endTime: '07:00', isAbsent: true },
    ],
  });
  assert.equal(resumen.textoTurno, 'N · Puesto 2 · 23:00–07:00');
});
