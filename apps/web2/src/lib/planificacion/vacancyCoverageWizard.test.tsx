import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { VacancyCoberturaAcciones, VacancyCoberturaLista } from '@/components/planificacion/VacancyCoberturaDia';
import {
  applyCoverageToDay,
  coveragesDiffer,
  daysOverwritten,
  draftCoverage,
  draftIsPartial,
  evaluateCoverageDayGuards,
  fillEmptyDays,
  nextMarkedDay,
  savedCoverage,
  templateDayForRemaining,
} from '@/lib/planificacion/vacancyCoverageWizard';
import type { VacancyDayCoverage } from '@/lib/planificacion/vacancyCoverage';

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

  const descanso = evaluateCoverageDayGuards({
    ...base,
    shiftOf: (id, ds) => (id === 'liz' && ds === '2026-10-04' ? { code: 'T', startTime: '15:00', endTime: '23:00', hours: 8 } : null),
  });
  assert.match(descanso.blocked.join(' '), /mín\. 12h/);

  const tope = evaluateCoverageDayGuards({
    ...base,
    monthHoursOf: () => 196,
    shiftOf: () => null,
  });
  assert.match(tope.blocked.join(' '), /Tope 200/);
});

test('la lista muestra coberturas distintas y Quitar solo en los días cubiertos', () => {
  const html = renderToStaticMarkup(
    <VacancyCoberturaLista
      days={[
        { date: '2026-10-04', label: '04/10', coverageLabel: 'LIZARRAGA ext + RODRIGUEZ adel', mode: 'split', editing: true, titular: 'T · RECEPCION · 15:00–23:00' },
        { date: '2026-10-05', label: '05/10', coverageLabel: 'Sin cobertura', mode: 'none', editing: false, titular: 'T · RECEPCION · 15:00–23:00' },
        { date: '2026-10-06', label: '06/10', coverageLabel: 'SUAREZ suplente', mode: 'substitute', editing: false, titular: 'T · RECEPCION · 15:00–23:00' },
      ]}
      emptyCount={1}
      templateLabel="04/10"
      onEdit={() => {}}
      onClear={() => {}}
      onCompleteRemaining={() => {}}
    />,
  );
  assert.match(html, /Paso 2/);
  assert.match(html, /LIZARRAGA ext \+ RODRIGUEZ adel/);
  assert.match(html, /SUAREZ suplente/);
  assert.match(html, /Completar 1 día\(s\) sin cobertura con la de 04\/10/);
  assert.match(html, /data-cobertura-quitar="2026-10-04"/);
  assert.match(html, /data-cobertura-quitar="2026-10-06"/);
  assert.equal(html.includes('data-cobertura-quitar="2026-10-05"'), false);
  assert.match(html, /data-cobertura-dia="2026-10-05"/);
});

test('el botón principal aplica a este día y el secundario nombra los días marcados', () => {
  const medio = renderToStaticMarkup(
    <VacancyCoberturaAcciones
      dayLabel="05/10"
      markedCount={3}
      canApply
      isLast={false}
      hasPreviousCoverage
      onApplyThisDay={() => {}}
      onApplyToMarked={() => {}}
      onNext={() => {}}
      onCopyPrevious={() => {}}
      onClose={() => {}}
    />,
  );
  assert.match(medio, /Aplicar a este día/);
  assert.match(medio, /Aplicar esta misma cobertura a los 3 días marcados/);
  assert.match(medio, /Siguiente día/);
  assert.match(medio, /Copiar del día anterior/);
  assert.equal(medio.includes('Aplicar a los 3 días seleccionados'), false);

  const primero = renderToStaticMarkup(
    <VacancyCoberturaAcciones
      dayLabel="04/10"
      markedCount={3}
      canApply={false}
      isLast={false}
      hasPreviousCoverage={false}
      onApplyThisDay={() => {}}
      onApplyToMarked={() => {}}
      onNext={() => {}}
      onCopyPrevious={() => {}}
      onClose={() => {}}
    />,
  );
  assert.equal(primero.includes('Copiar del día anterior'), false);
  assert.match(primero, /disabled=""/);

  const ultimo = renderToStaticMarkup(
    <VacancyCoberturaAcciones
      dayLabel="06/10"
      markedCount={1}
      canApply
      isLast
      hasPreviousCoverage={false}
      onApplyThisDay={() => {}}
      onApplyToMarked={() => {}}
      onNext={() => {}}
      onCopyPrevious={() => {}}
      onClose={() => {}}
    />,
  );
  assert.match(ultimo, />Listo</);
  assert.equal(ultimo.includes('días marcados'), false);
});
