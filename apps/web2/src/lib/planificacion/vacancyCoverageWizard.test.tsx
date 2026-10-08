import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCoverageToDay,
  coveragesDiffer,
  daysOverwritten,
  draftCoverage,
  draftIsPartial,
  evaluateCoverageDayGuards,
  fillEmptyDays,
  nextMarkedDay,
  propuestaGuardCobertura,
  savedCoverage,
  templateDayForRemaining,
  unresolvedGuardMessages,
} from '@/lib/planificacion/vacancyCoverageWizard';
import type { VacancyDayCoverage } from '@/lib/planificacion/vacancyCoverage';
import { buildCoverageCandidates } from '@cosp/ops-core';

const DAYS = ['2026-10-04', '2026-10-05', '2026-10-06'];
const lizRod: VacancyDayCoverage = {
  mode: 'split', extEmpId: 'liz', adelEmpId: 'rod', gapBand: 'T', gapPosition: 'RECEPCION',
};
const otro: VacancyDayCoverage = {
  mode: 'split', extEmpId: 'gomez', adelEmpId: 'perez', gapBand: 'T', gapPosition: 'RECEPCION',
};
const suplente: VacancyDayCoverage = { mode: 'substitute', employeeId: 'suarez' };

test('cada día guarda su cobertura y el siguiente no hereda la anterior', () => {
  let map: Record<string, VacancyDayCoverage> = {};
  map = applyCoverageToDay(map, '2026-10-04', lizRod);
  const next = nextMarkedDay(DAYS, '2026-10-04');
  assert.equal(next, '2026-10-05');
  assert.equal(savedCoverage(map, next!).mode, 'none');
  map = applyCoverageToDay(map, '2026-10-05', suplente);
  assert.equal(coveragesDiffer(map['2026-10-04'], map['2026-10-05']), true);
  assert.equal(savedCoverage(map, '2026-10-06').mode, 'none');
});

test('pisar un día ya configurado distinto se detecta; un día vacío no', () => {
  const map = applyCoverageToDay({}, '2026-10-04', lizRod);
  const incoming = { '2026-10-04': otro, '2026-10-05': otro, '2026-10-06': otro };
  assert.deepEqual(daysOverwritten(map, incoming), ['2026-10-04']);
  assert.deepEqual(daysOverwritten(map, { '2026-10-04': lizRod, '2026-10-05': lizRod }), []);
});

test('completar restantes solo llena vacíos con la del último día configurado', () => {
  const map = applyCoverageToDay({}, '2026-10-04', lizRod);
  assert.equal(templateDayForRemaining(DAYS, map, '2026-10-04'), '2026-10-04');
  const { next, filled } = fillEmptyDays(map, DAYS, lizRod);
  assert.deepEqual(filled, ['2026-10-05', '2026-10-06']);
  assert.deepEqual(next['2026-10-04'], lizRod);
  assert.deepEqual(next['2026-10-05'], lizRod);
  const conCinco = applyCoverageToDay(next, '2026-10-05', suplente);
  const otra = fillEmptyDays(conCinco, DAYS, suplente);
  assert.deepEqual(otra.filled, []);
  assert.equal(templateDayForRemaining(DAYS, { '2026-10-06': suplente }, null), '2026-10-06');
});

test('el borrador a medias o con la misma persona en los dos tramos no se puede aplicar', () => {
  assert.equal(draftIsPartial({ tab: 'split', substituteId: '', extId: 'liz', adelId: '' }), true);
  assert.equal(draftCoverage({ tab: 'split', substituteId: '', extId: 'liz', adelId: '' }, { band: 'T', position: 'RECEPCION' }), null);
  assert.equal(draftCoverage(
    { tab: 'split', substituteId: '', extId: 'liz', adelId: 'liz' },
    { band: 'T', position: 'RECEPCION' },
  ), null);
  const listo = draftCoverage(
    { tab: 'split', substituteId: '', extId: 'liz', adelId: 'rod' },
    { band: 'T', position: 'RECEPCION' },
  );
  assert.equal(listo?.mode, 'split');
});

test('licencia, descanso y tope se evalúan con el guardia de ese día; el franco no bloquea', () => {
  const base = {
    dateStr: '2026-10-05',
    proposedByEmp: { liz: { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8, addHours: 8 } },
    monthHoursOf: () => 40,
    nameOf: () => 'LIZARRAGA',
    monthlyCap: 200,
  };
  const art = evaluateCoverageDayGuards({
    ...base,
    shiftOf: (_id, ds) => (ds === '2026-10-05' ? { code: 'ART' } : null),
  });
  assert.match(art.blocked.join(' '), /licencia ART/);

  const franco = evaluateCoverageDayGuards({
    ...base,
    shiftOf: (_id, ds) => (ds === '2026-10-05' ? { code: 'F', isFranco: true } : null),
  });
  assert.deepEqual(franco.blocked, []);

  const descanso8 = evaluateCoverageDayGuards({
    ...base,
    shiftOf: (id, ds) => (id === 'liz' && ds === '2026-10-04' ? { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 } : null),
  });
  assert.deepEqual(descanso8.blocked, []);
  assert.equal(descanso8.authorizations.some((a) => a.kind === 'DESCANSO'), true);
  assert.match(unresolvedGuardMessages(descanso8, { descanso: false, tope: true }).join(' '), /8\.0h|8h/);
  assert.deepEqual(unresolvedGuardMessages(descanso8, { descanso: true, tope: true }), []);
});

test('Ext + Adel: la extensión sigue a su noche sin pedir descanso; el adelanto arranca en el corte', () => {
  const day = '2026-10-15';
  const turnos: Record<string, { code: string; startTime: string; endTime: string; hours: number }> = {
    'galeano|2026-10-14': { code: 'N', startTime: '23:00', endTime: '07:00', hours: 8 },
    'galeano|2026-10-15': { code: 'N', startTime: '23:00', endTime: '07:00', hours: 8 },
    'barros|2026-10-14': { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 },
    'barros|2026-10-15': { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 },
  };
  const propuesta = propuestaGuardCobertura({
    coverage: { mode: 'split', gapBand: 'M', gapPosition: 'Puesto 1', extEmpId: 'galeano', adelEmpId: 'barros' } as VacancyDayCoverage,
    titular: { code: 'M', scheduleLabel: '07:00–15:00', hours: 8 },
    shiftOf: (id) => turnos[`${id}|${day}`] || null,
    positionStructure: undefined,
  });
  assert.equal(propuesta.galeano.extiendeTurno, true);
  assert.equal(propuesta.barros.startTime, '11:00');
  assert.equal(propuesta.barros.endTime, '23:00');
  const r = evaluateCoverageDayGuards({
    dateStr: day,
    proposedByEmp: propuesta,
    shiftOf: (id, ds) => turnos[`${id}|${ds}`] || null,
    monthHoursOf: () => 100,
    nameOf: (id) => id,
  });
  assert.deepEqual(r.blocked, []);
  assert.deepEqual(r.authorizations, []);
});

test('12 h pasa, 10 h pide PIN, 7 h bloquea y 204 h pide PIN', () => {
  const day = '2026-10-05';
  const proposed = { liz: { code: 'M', startTime: '07:00', endTime: '15:00', hours: 8, addHours: 8 } };
  const run = (prevEnd: string, prevStart: string, month: number, start = '07:00') => evaluateCoverageDayGuards({
    dateStr: day,
    proposedByEmp: { liz: { ...proposed.liz, startTime: start } },
    monthHoursOf: () => month,
    nameOf: () => 'DEMICHELIS',
    monthlyCap: 200,
    shiftOf: (id, ds) => (id === 'liz' && ds === '2026-10-04'
      ? { code: 'T', startTime: prevStart, endTime: prevEnd, hours: 8 }
      : null),
  });

  const ok12 = run('23:00', '15:00', 40, '11:00');
  assert.deepEqual(ok12.blocked, []);
  assert.equal(ok12.authorizations.some((a) => a.kind === 'DESCANSO'), false);

  const pin10 = run('23:00', '15:00', 40, '09:00');
  assert.deepEqual(pin10.blocked, []);
  assert.equal(pin10.authorizations.some((a) => a.kind === 'DESCANSO'), true);
  assert.equal(unresolvedGuardMessages(pin10, { descanso: true, tope: false }).length, 0);
  assert.ok(unresolvedGuardMessages(pin10, { descanso: false, tope: true }).length > 0);

  const block7 = run('23:00', '15:00', 40, '06:00');
  assert.ok(block7.blocked.length > 0);
  assert.equal(block7.authorizations.some((a) => a.kind === 'DESCANSO'), false);

  const pin204 = evaluateCoverageDayGuards({
    dateStr: day,
    proposedByEmp: proposed,
    monthHoursOf: () => 196,
    nameOf: () => 'DEMICHELIS',
    monthlyCap: 200,
    shiftOf: () => null,
  });
  assert.deepEqual(pin204.blocked, []);
  assert.equal(pin204.authorizations.some((a) => a.kind === 'TOPE' && a.monthHours === 204), true);
  assert.match(unresolvedGuardMessages(pin204, { descanso: true, tope: false }).join(' '), /204 h/);
  assert.deepEqual(unresolvedGuardMessages(pin204, { descanso: true, tope: true }), []);
});

test('el CC muestra requiere autorización entre 8 y 12 h y excluye menos de 8 h', () => {
  const hm = (iso: string) => new Date(iso).getTime();
  const gap = {
    titularShiftId: 'tit',
    absentEmployeeId: 'aus',
    objectiveId: 'obj',
    positionName: 'Puesto 1',
    startMs: hm('2026-10-05T15:00:00-03:00'),
    endMs: hm('2026-10-05T23:00:00-03:00'),
    band: 'T',
  };
  const franco = {
    id: 'f',
    employeeId: 'dem',
    employeeName: 'DEMICHELIS',
    code: 'F',
    isFranco: true,
    objectiveId: 'obj',
    positionName: 'Puesto 1',
    startMs: hm('2026-10-05T00:00:00-03:00'),
    endMs: hm('2026-10-05T23:59:59-03:00'),
  };
  const previo = (id: string, end: string) => ({
    id,
    employeeId: 'dem',
    employeeName: 'DEMICHELIS',
    code: 'M',
    origin: 'OPERATIONS_COVERAGE',
    objectiveId: 'obj',
    positionName: 'Puesto 1',
    startMs: hm('2026-10-05T01:00:00-03:00'),
    endMs: hm(end),
    absenceShiftId: 'otro',
    isPresent: true,
  });
  const diez = buildCoverageCandidates({
    nowMs: gap.startMs,
    gap,
    shifts: [franco, previo('p10', '2026-10-05T05:00:00-03:00')],
  });
  const row10 = diez.byType.FT.find((r) => r.employeeId === 'dem');
  assert.equal(row10?.eligible, true);
  assert.equal(row10?.requiereAutorizacion, 'DESCANSO');

  const siete = buildCoverageCandidates({
    nowMs: gap.startMs,
    gap,
    shifts: [franco, previo('p7', '2026-10-05T08:00:00-03:00')],
  });
  const row7 = siete.byType.FT.find((r) => r.employeeId === 'dem');
  assert.equal(row7?.eligible, false);
  assert.equal(row7?.rejectReason, 'DESCANSO');
});
