import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CambioPuntual, CandidatosHueco } from '@/components/movil/PlanificacionMovilView';
import { CeldaSheetBody, SemanaGrilla } from '@/components/movil/PlanificacionSemanaView';
import { MOVIL_BTN_PRIMARY } from '@/components/movil/ui/tones';
import { buildMovilTheme } from '@/lib/companyTheme';
import {
  aplicarCambios,
  candidatosParaHueco,
  companerosCompatibles,
  type EmpleadoMovil,
  type TurnoMovil,
} from '@/lib/movil/planificacionBasica';
import {
  OPCIONES_GENERICAS,
  celdasSemana,
  estructuraSlaDelMes,
  filasSemana,
  huecoDeCelda,
  opcionesTurnoDelDia,
  puestoDe,
  semanaDe,
} from '@/lib/movil/planificacionSemana';

const LV = ['L', 'M', 'X', 'J', 'V'];
const t = (code: string, startTime: string, endTime: string, extra: Record<string, unknown> = {}) => ({ code, name: code, startTime, endTime, ...extra });

/** SLA u7pMU1WQaGq1rxXxWstO (pruebas_sa · Peaje 9 Norte): turnos propios por puesto, días de semana. */
const SLA_PEAJE = {
  id: 'u7pMU1WQaGq1rxXxWstO',
  empresaId: 'pruebas_sa',
  clientId: 'cli-peaje',
  objectiveId: 'obj-peaje',
  objectiveName: 'Peaje 9 Norte',
  status: 'active',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  positions: [
    {
      name: 'Puesto 1',
      quantity: 1,
      coverageType: 'custom',
      activeDays: LV,
      allowedShiftTypes: [
        t('M', '10:45', '12:00', { days: LV }),
        t('T', '12:00', '14:30', { days: LV }),
        t('M2', '11:00', '15:00', { days: LV }),
        t('T2', '15:00', '17:00', { days: LV }),
        t('M3', '12:30', '16:00', { days: LV }),
        t('T3', '16:00', '17:00', { days: LV }),
      ],
    },
    {
      name: 'Puesto 2',
      quantity: 2,
      coverageType: 'custom',
      activeDays: LV,
      allowedShiftTypes: [
        t('M', '11:30', '15:15', { days: LV, quantity: 2 }),
        t('T', '15:15', '16:15', { days: LV, quantity: 2 }),
        t('M2', '11:45', '15:30', { days: LV, quantity: 2 }),
        t('T2', '15:30', '16:30', { days: LV, quantity: 2 }),
      ],
    },
  ],
};

const CLIENTES = [{ id: 'cli-peaje', name: 'Peaje', objetivos: [{ id: 'obj-peaje', name: 'Peaje 9 Norte' }] }];
const PEAJE = { id: 'obj-peaje', name: 'Peaje 9 Norte', clientId: 'cli-peaje', clientName: 'Peaje' };
const LUNES = '2026-10-05';
const SABADO = '2026-10-10';

function estructura(slas: unknown[] = [SLA_PEAJE]) {
  return estructuraSlaDelMes({
    slas: slas as never, empresaId: 'pruebas_sa', scopeEmpresa: false, clientes: CLIENTES, clientId: 'cli-peaje', objectiveId: 'obj-peaje', ym: '2026-10',
  }).estructura;
}

function turno(p: Partial<TurnoMovil> & Pick<TurnoMovil, 'id' | 'employeeId' | 'code' | 'start' | 'end'>): TurnoMovil {
  return {
    employeeName: p.employeeId,
    objectiveId: 'obj-peaje',
    objectiveName: 'Peaje 9 Norte',
    positionName: 'Puesto 1',
    clientId: 'cli-peaje',
    clientName: 'Peaje',
    date: LUNES,
    hours: 2,
    vacante: p.employeeId === 'VACANTE',
    licencia: ['V', 'L', 'E'].includes(p.code),
    coveredBy: '',
    franco: p.code === 'F',
    ...p,
  };
}

test('filas de la semana = turnos propios del SLA con su horario (sin M/T/N/D12/N12 genéricos)', () => {
  const filas = filasSemana(estructura());
  assert.deepEqual(filas.map((f) => `${f.positionName}|${f.code} ${f.start}–${f.end}×${f.qty}`), [
    'Puesto 1|M 10:45–12:00×1', 'Puesto 1|T 12:00–14:30×1', 'Puesto 1|M2 11:00–15:00×1', 'Puesto 1|T2 15:00–17:00×1', 'Puesto 1|M3 12:30–16:00×1', 'Puesto 1|T3 16:00–17:00×1',
    'Puesto 2|M 11:30–15:15×2', 'Puesto 2|T 15:15–16:15×2', 'Puesto 2|M2 11:45–15:30×2', 'Puesto 2|T2 15:30–16:30×2',
  ]);
  const celdas = celdasSemana(filas, semanaDe(LUNES), [], 'obj-peaje');
  assert.equal(celdas[6][0].cupo, 2, 'Puesto 2 M lunes ×2');
  assert.equal(celdas[0][5].kind, 'sin-servicio', 'sábado fuera de los días del turno');
});

test('opciones de la hoja: turnos habilitados del puesto ese día; genéricos solo sin SLA', () => {
  const est = estructura();
  const p1 = opcionesTurnoDelDia(puestoDe(est, 'Puesto 1'), LUNES).map((o) => o.label);
  assert.deepEqual(p1, ['M 10:45–12:00', 'M2 11:00–15:00', 'T 12:00–14:30', 'M3 12:30–16:00', 'T2 15:00–17:00', 'T3 16:00–17:00']);
  const p2 = opcionesTurnoDelDia(puestoDe(est, 'Puesto 2'), LUNES).map((o) => o.label);
  assert.deepEqual(p2, ['M 11:30–15:15', 'M2 11:45–15:30', 'T 15:15–16:15', 'T2 15:30–16:30']);
  assert.equal(p1.some((l) => /^(N|D12|N12) /.test(l)), false);
  assert.deepEqual(opcionesTurnoDelDia(puestoDe(est, 'Puesto 2'), SABADO), []);
  // Un turno con fecha específica solo aparece ese día.
  const conEvento = estructura([{ ...SLA_PEAJE, positions: [{ ...SLA_PEAJE.positions[0], allowedShiftTypes: [...SLA_PEAJE.positions[0].allowedShiftTypes, t('EV', '18:00', '22:00', { specificDates: ['2026-10-07'] })] }] }]);
  assert.equal(opcionesTurnoDelDia(conEvento[0], LUNES).some((o) => o.code === 'EV'), false);
  assert.equal(opcionesTurnoDelDia(conEvento[0], '2026-10-07').some((o) => o.label === 'EV 18:00–22:00'), true);
  assert.deepEqual(opcionesTurnoDelDia(null, LUNES).map((o) => o.code), ['M', 'T', 'N', 'D12', 'N12']);
  assert.equal(OPCIONES_GENERICAS.length, 5);
});

test('cubrir el hueco M2 del Puesto 1: candidatos reales con la franja del SLA y el turno nace M2 11:00–15:00', () => {
  const filas = filasSemana(estructura());
  const turnos = [
    turno({ id: 'p1m', employeeId: 'baez', employeeName: 'Baez', code: 'M', start: '10:45', end: '12:00' }),
    turno({ id: 'lic', employeeId: 'fontana', employeeName: 'Fontana', code: 'V', start: '00:00', end: '23:59', hours: 0 }),
    turno({ id: 'p2t2', employeeId: 'farias', employeeName: 'Farias', code: 'T2', start: '15:30', end: '16:30', positionName: 'Puesto 2', hours: 1 }),
  ];
  const fila = filas.findIndex((f) => f.id === 'Puesto 1|M2');
  const celda = celdasSemana(filas, semanaDe(LUNES), turnos, 'obj-peaje')[fila][0];
  assert.equal(celda.kind, 'hueco');
  const hueco = huecoDeCelda(celda, PEAJE);
  assert.deepEqual([hueco.code, hueco.start, hueco.end, hueco.hours], ['M2', '11:00', '15:00', 4]);
  const empleados: EmpleadoMovil[] = [
    { id: 'guerrero', name: 'Guerrero', preferredObjectiveId: 'obj-peaje', lat: -31.4, lng: -64.18, monthHours: 40 },
    { id: 'baez', name: 'Baez', preferredObjectiveId: 'obj-peaje', lat: -31.4, lng: -64.18, monthHours: 40 },
    { id: 'fontana', name: 'Fontana', preferredObjectiveId: 'obj-peaje', monthHours: 0 },
    { id: 'tope', name: 'Tope', preferredObjectiveId: 'otro', monthHours: 198 },
  ];
  const banda = { code: 'M2', start: '11:00', end: '15:00', hours: 4 };
  const cands = candidatosParaHueco({ hueco, empleados, turnos, objLat: -31.4, objLng: -64.18, banda });
  assert.equal(cands.some((c) => c.employeeId === 'baez'), false, 'Baez trabaja 10:45–12:00: se pisa');
  assert.equal(cands.find((c) => c.employeeId === 'guerrero')?.blocked, false);
  assert.match(cands.find((c) => c.employeeId === 'fontana')?.reason || '', /licencia V/);
  assert.match(cands.find((c) => c.employeeId === 'tope')?.reason || '', /Tope 200/);
  assert.equal(cands.find((c) => c.employeeId === 'tope')?.tab, 'otros');

  const nuevos = aplicarCambios(turnos, [{ kind: 'nuevo', franja: { ...hueco, ...banda }, employeeId: 'guerrero', employeeName: 'Guerrero', ft: false }]);
  const creado = nuevos.find((x) => x.employeeId === 'guerrero');
  assert.deepEqual([creado?.code, creado?.start, creado?.end, creado?.positionName], ['M2', '11:00', '15:00', 'Puesto 1']);
  assert.equal(celdasSemana(filas, semanaDe(LUNES), nuevos, 'obj-peaje')[fila][0].kind, 'ok');

  // Vacante con doc: el cambio guarda el turno del SLA elegido, no la banda CCT.
  const vacante = turno({ id: 'vac', employeeId: 'VACANTE', code: 'T3', start: '16:00', end: '17:00', hours: 1 });
  const asignado = aplicarCambios([vacante], [{ kind: 'asignar', franjaId: 'vac', employeeId: 'guerrero', employeeName: 'Guerrero', ft: false, banda: { code: 'T2', start: '15:00', end: '17:00', hours: 2 } }]);
  assert.deepEqual([asignado[0].code, asignado[0].start, asignado[0].end, asignado[0].hours], ['T2', '15:00', '17:00', 2]);
});

test('permuta y cambiar guardia filtran por compatibilidad', () => {
  const baez = turno({ id: 'a', employeeId: 'baez', code: 'M', start: '10:45', end: '12:00', hours: 1.25 });
  const turnos = [
    baez,
    turno({ id: 'b', employeeId: 'guerrero', code: 'T', start: '12:00', end: '14:30', hours: 2.5 }),
    // Lopez tiene además un turno que se pisa con el M de Baez: no puede permutar.
    turno({ id: 'c', employeeId: 'lopez', code: 'T3', start: '16:00', end: '17:00', hours: 1 }),
    turno({ id: 'c2', employeeId: 'lopez', code: 'M', start: '11:30', end: '15:15', positionName: 'Puesto 2', hours: 3.75 }),
    turno({ id: 'd', employeeId: 'otro', code: 'M', start: '10:45', end: '12:00', date: '2026-10-06' }),
    turno({ id: 'e', employeeId: 'baez', code: 'M', start: '10:45', end: '12:00', objectiveId: 'otro-obj', date: '2026-10-06' }),
  ];
  const ids = companerosCompatibles(baez, turnos).map((x) => x.id);
  assert.equal(ids.includes('b'), true);
  assert.equal(ids.includes('c'), false, 'solape con el otro turno de Lopez');
  assert.equal(ids.includes('d'), false, 'otro día');
  assert.equal(ids.includes('a'), false, 'el mismo turno');
});

test('render 390x844 de la hoja: turnos del SLA, botón de cubrir primario y sin genéricos', () => {
  const est = estructura();
  const op = opcionesTurnoDelDia(puestoDe(est, 'Puesto 1'), LUNES);
  const m2 = op.find((o) => o.code === 'M2');
  const hoja = renderToStaticMarkup(
    <div data-viewport="390x844" className="max-w-[390px]">
      <CandidatosHueco tab="plantel" onTab={() => {}} candidatos={[{ employeeId: 'g', name: 'Guerrero', tab: 'plantel', monthHours: 40, cap: 200, km: 1.2, blocked: false, reason: null }]} eventuales={[]} elegidoId={null} puedeFt puedeEventuales onElegir={() => {}} onConfirmar={() => {}} opciones={op} opcionId={m2?.id} onOpcion={() => {}} />
    </div>,
  );
  assert.match(hoja, /data-plan-turno-cubrir="M2 11:00–15:00"/);
  assert.match(hoja, /data-plan-opcion="M3 12:30–16:00"/);
  assert.equal(/data-plan-opcion="(N|D12|N12) /.test(hoja), false);
  assert.match(hoja, /Guerrero/);
  assert.equal(hoja.includes(MOVIL_BTN_PRIMARY), true);

  const cambio = renderToStaticMarkup(
    <CambioPuntual opciones={op} actualId={op[0].id} codigo={null} onCodigo={() => {}} companeros={[]} companeroId={null} onCompanero={() => {}} aviso={null} bloqueado={false} onHorario={() => {}} onPermuta={() => {}} onFranco={() => {}} />,
  );
  assert.match(cambio, /data-plan-opcion="T2 15:00–17:00"/);
  assert.match(cambio, /Actual/);
  assert.equal(cambio.includes('data-plan-codigo='), false);

  const filas = filasSemana(est);
  const celdas = celdasSemana(filas, semanaDe(LUNES), [turno({ id: 'p1m', employeeId: 'baez', employeeName: 'Baez', code: 'M', start: '10:45', end: '12:00' })], 'obj-peaje');
  const hojaCelda = renderToStaticMarkup(<CeldaSheetBody celda={{ ...celdas[0][0], faltan: 1, cupo: 2 }} onGuardia={() => {}} onCubrir={() => {}} />);
  const boton = hojaCelda.match(/<button[^>]*data-plan-cubrir="1"[^>]*>/)?.[0] || '';
  assert.equal(boton.includes(MOVIL_BTN_PRIMARY), true);
  assert.equal(boton.includes('disabled'), false);

  const grilla = renderToStaticMarkup(<SemanaGrilla lunes={LUNES} dias={semanaDe(LUNES)} hoy={LUNES} filas={filas} celdas={celdas} licencias={[]} onAnterior={() => {}} onSiguiente={() => {}} onCelda={() => {}} onLicencia={() => {}} />);
  assert.match(grilla, /data-plan-fila="Puesto 1\|M2"/);
  assert.match(grilla, /11:00–15:00/);
  assert.match(grilla, /data-plan-fila="Puesto 2\|T2"/);
  assert.equal((grilla.match(/data-plan-fila="/g) || []).length, 10);
});

test('color de empresa gris: el primario no parece deshabilitado', () => {
  assert.equal(buildMovilTheme('#64748b')['--movil-primary'], '#111827');
  assert.equal(buildMovilTheme('#1d4ed8')['--movil-primary'], '#1d4ed8');
});
