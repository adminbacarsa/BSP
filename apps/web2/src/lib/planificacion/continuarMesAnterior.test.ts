import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alertasDescansoCambioMes,
  alertasTope,
  cambioPendienteDe,
  codigoDeCiclo,
  avisosCoberturaPuesto,
  detectarCiclo,
  diaDelCiclo,
  diaIndex,
  observacionesDelGuardia,
  proponerContinuacion,
  sobrantesPorDia,
  textoDias,
  ymdDeIndex,
  type ContinuarInput,
  type PuestoSla,
  type TurnoPrevio,
} from '@/lib/planificacion/continuarMesAnterior';

const OBJ = 'obj1';
const P1 = 'Puesto 1';

const estructura: PuestoSla[] = [{
  positionName: P1,
  qty: 1,
  shifts: [
    { code: 'M', hours: 8, startTime: '06:00', endTime: '14:00' },
    { code: 'T', hours: 8, startTime: '14:00', endTime: '22:00' },
    { code: 'N', hours: 8, startTime: '22:00', endTime: '06:00' },
  ],
}, {
  positionName: 'Encargada',
  qty: 1,
  shifts: [{ code: 'EN', hours: 9, startTime: '08:00', endTime: '17:00', days: ['L', 'M', 'X', 'J', 'V'] }],
}];

function diasDelMes(y: number, m: number): string[] {
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
}

/** Turnos de `desde` a `hasta` siguiendo `patron`, arrancando en `fase0` el día `desde`. */
function armar(patron: string[], desde: string, hasta: string, fase0 = 0, pos = P1): TurnoPrevio[] {
  const out: TurnoPrevio[] = [];
  for (let i = diaIndex(desde), k = fase0; i <= diaIndex(hasta); i += 1, k += 1) {
    const code = patron[k % patron.length];
    out.push({ dateStr: ymdDeIndex(i), code, positionName: code === 'F' ? 'General' : pos, objectiveId: OBJ });
  }
  return out;
}

function input(guardias: ContinuarInput['guardias'], dias: string[], extra?: Partial<ContinuarInput>): ContinuarInput {
  return { objectiveId: OBJ, dias, guardias, estructura, estadoCelda: () => null, ...extra };
}

function codigos(res: ReturnType<typeof proponerContinuacion>[number]): Record<string, string> {
  return Object.fromEntries(res.propuestas.map((c) => [c.dateStr, c.code]));
}

const ROTA_6_2 = [...Array(6).fill('M'), 'F', 'F', ...Array(6).fill('N'), 'F', 'F', ...Array(6).fill('T'), 'F', 'F'];

test('ciclo de 24 días: 6+2 con la banda rotando de bloque en bloque', () => {
  // Septiembre (30 días) termina en el 2.º día de N: octubre sigue con N ×4.
  const previos = armar(ROTA_6_2, '2026-08-01', '2026-09-30', 0);
  const ultimo = previos[previos.length - 1];
  const obs = observacionesDelGuardia(previos, OBJ);
  const ciclo = detectarCiclo(obs)!;
  assert.equal(ciclo.periodo, 24);
  assert.equal(ciclo.etiqueta, 'M×6 · F×2 · N×6 · F×2 · T×6 · F×2');
  const [res] = proponerContinuacion(input([{ id: 'g1', nombre: 'Uno', previos }], diasDelMes(2026, 10)));
  const k0 = (diaIndex('2026-10-01') - diaIndex('2026-08-01')) % 24;
  const esperado = diasDelMes(2026, 10).map((d, i) => ROTA_6_2[(k0 + i) % 24]);
  assert.deepEqual(Object.values(codigos(res)), esperado);
  assert.equal(ultimo.code, ROTA_6_2[(diaIndex('2026-09-30') - diaIndex('2026-08-01')) % 24]);
  assert.match(res.continuaEn, /^[MNTF]/);
});

test('2+2+2+2 (N,N,T,T,M,M,F,F): sigue la racha a través de un fin de mes de 31', () => {
  const patron = ['N', 'N', 'T', 'T', 'M', 'M', 'F', 'F'];
  // 31/08 cae en el 2.º día de T (fase 3).
  const desde = ymdDeIndex(diaIndex('2026-08-31') - 3 - 8 * 5);
  const previos = armar(patron, desde, '2026-08-31', 0);
  assert.equal(previos[previos.length - 1].code, 'T');
  const [res] = proponerContinuacion(input([{ id: 'g', nombre: 'G', previos }], diasDelMes(2026, 9)));
  assert.equal(res.ciclo?.periodo, 8);
  assert.equal(res.ciclo?.etiqueta, 'N,N,T,T,M,M,F,F');
  const c = codigos(res);
  assert.deepEqual(['01', '02', '03', '04', '05', '06', '07'].map((d) => c[`2026-09-${d}`]), ['M', 'M', 'F', 'F', 'N', 'N', 'T']);
  assert.equal(res.continuaEn, 'M (1.º de 2)');
});

test('fin de mes de 30: el 1.º sigue con el día que corresponde, no con el 1 del mes anterior', () => {
  const patron = ['N', 'N', 'T', 'T', 'M', 'M', 'F', 'F'];
  const previos = armar(patron, '2026-08-20', '2026-09-30', 0);
  const fase30 = (diaIndex('2026-09-30') - diaIndex('2026-08-20')) % 8;
  const [res] = proponerContinuacion(input([{ id: 'g', nombre: 'G', previos }], diasDelMes(2026, 10)));
  assert.equal(codigos(res)['2026-10-01'], patron[(fase30 + 1) % 8]);
  // Copiar día por número repetiría el 01/09; el ciclo de 8 no cae igual en meses de 30.
  const copiaPorNumero = previos.filter((t) => t.dateStr.startsWith('2026-09')).map((t) => t.code);
  const continuado = diasDelMes(2026, 10).slice(0, 30).map((d) => codigos(res)[d]);
  assert.notDeepEqual(continuado, copiaPorNumero);
});

test('fijo lunes a viernes con F sábado y domingo: período 7 alineado a la semana', () => {
  const previos: TurnoPrevio[] = [];
  for (let i = diaIndex('2026-08-03'); i <= diaIndex('2026-09-30'); i += 1) {
    const d = ymdDeIndex(i);
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    previos.push({ dateStr: d, code: dow === 0 || dow === 6 ? 'F' : 'EN', positionName: 'Encargada', objectiveId: OBJ });
  }
  const [res] = proponerContinuacion(input([{ id: 'en', nombre: 'Encargada', previos }], diasDelMes(2026, 10)));
  assert.equal(res.ciclo?.periodo, 7);
  const c = codigos(res);
  assert.equal(c['2026-10-03'], 'F'); // sábado
  assert.equal(c['2026-10-04'], 'F'); // domingo
  assert.equal(c['2026-10-05'], 'EN'); // lunes
  const lunes = res.propuestas.find((p) => p.dateStr === '2026-10-05')!;
  assert.equal(lunes.startTime, '08:00');
  assert.equal(lunes.endTime, '17:00');
  assert.equal(lunes.hours, 9);
});

test('vacaciones en el mes anterior: usa la banda conservada (originalCode) y si no hay, no inventa', () => {
  const patron = ['M', 'M', 'M', 'M', 'M', 'M', 'F', 'F'];
  const previos = armar(patron, '2026-08-01', '2026-09-30', 0).map((t) => {
    if (t.dateStr >= '2026-09-10' && t.dateStr <= '2026-09-20') {
      return t.dateStr <= '2026-09-15'
        ? { ...t, code: 'V', originalCode: t.code }
        : { ...t, code: 'V', positionName: 'General' };
    }
    return t;
  });
  const obs = observacionesDelGuardia(previos, OBJ);
  assert.equal(obs.find((o) => o.idx === diaIndex('2026-09-12'))?.code, patron[(diaIndex('2026-09-12') - diaIndex('2026-08-01')) % 8]);
  assert.equal(obs.some((o) => o.idx === diaIndex('2026-09-18')), false);
  const [res] = proponerContinuacion(input([{ id: 'v', nombre: 'V', previos }], diasDelMes(2026, 10)));
  assert.equal(res.ciclo?.periodo, 8);
  const fase = (diaIndex('2026-10-01') - diaIndex('2026-08-01')) % 8;
  assert.equal(codigos(res)['2026-10-01'], patron[fase]);
});

test('no pisa licencias ni celdas con algo en el mes nuevo', () => {
  const patron = ['N', 'N', 'T', 'T', 'M', 'M', 'F', 'F'];
  const previos = armar(patron, '2026-08-01', '2026-09-30', 0);
  const [res] = proponerContinuacion(input([{ id: 'g', nombre: 'G', previos }], diasDelMes(2026, 10), {
    estadoCelda: (_e, d) => (d >= '2026-10-05' && d <= '2026-10-09' ? 'licencia' : d === '2026-10-20' ? 'ocupada' : null),
    diaBloqueado: (d) => d === '2026-10-31',
  }));
  const c = codigos(res);
  for (const d of ['05', '06', '07', '08', '09', '20', '31']) assert.equal(c[`2026-10-${d}`], undefined, d);
  assert.equal(res.omitidas.licencia, 5);
  assert.equal(res.omitidas.ocupada, 1);
  assert.equal(res.omitidas.bloqueada, 1);
  assert.equal(res.propuestas.length, 31 - 7);
});

test('ignora coberturas, REF/ESC/RET, extensiones y turnos de otro objetivo', () => {
  assert.equal(codigoDeCiclo({ dateStr: '2026-09-01', code: 'M', origin: 'OPERATIONS_COVERAGE' }, OBJ), null);
  assert.equal(codigoDeCiclo({ dateStr: '2026-09-01', code: 'REF' }, OBJ), null);
  assert.equal(codigoDeCiclo({ dateStr: '2026-09-01', code: 'RET' }, OBJ), null);
  assert.equal(codigoDeCiclo({ dateStr: '2026-09-01', code: 'M', isExtended: true }, OBJ), null);
  assert.equal(codigoDeCiclo({ dateStr: '2026-09-01', code: 'M', objectiveId: 'otro' }, OBJ), null);
  assert.equal(codigoDeCiclo({ dateStr: '2026-09-01', code: 'FF' }, OBJ), 'F');
  assert.equal(codigoDeCiclo({ dateStr: '2026-09-01', code: 'M2' }, OBJ), 'M2');
  assert.equal(codigoDeCiclo({ dateStr: '2026-09-01', code: 'E', originalCode: 'N' }, OBJ), 'N');
  // Un REF puntual en un día de franco no rompe el ciclo.
  const patron = ['M', 'M', 'M', 'M', 'M', 'M', 'F', 'F'];
  const previos = [...armar(patron, '2026-08-01', '2026-09-30', 0), { dateStr: '2026-09-07', code: 'REF', positionName: P1, objectiveId: OBJ }];
  assert.equal(detectarCiclo(observacionesDelGuardia(previos, OBJ))?.periodo, 8);
});

test('ciclo que no se repite: queda sin proponer, para hacer a mano', () => {
  const codes = ['M', 'T', 'N', 'F', 'M', 'M', 'N', 'F', 'T', 'F', 'F', 'N', 'M', 'T', 'F', 'N', 'N', 'M', 'F', 'T', 'M', 'F', 'N', 'T', 'T', 'F', 'M', 'N'];
  const previos = codes.map((code, i) => ({ dateStr: ymdDeIndex(diaIndex('2026-09-03') + i), code, positionName: P1, objectiveId: OBJ }));
  const [res] = proponerContinuacion(input([{ id: 'x', nombre: 'X', previos }], diasDelMes(2026, 10)));
  assert.equal(res.ciclo, null);
  assert.equal(res.propuestas.length, 0);
  assert.match(res.motivoSinCiclo || '', /no se repite/);
});

test('el puesto del mes anterior ya no existe: si un solo puesto tiene el turno se propone ahí y se marca para revisar', () => {
  const patron = ['N', 'N', 'T', 'T', 'M', 'M', 'F', 'F'];
  const previos = armar(patron, '2026-08-01', '2026-09-30', 0, 'Puesto 3');
  const [res] = proponerContinuacion(input([{ id: 'g', nombre: 'G', previos }], diasDelMes(2026, 10)));
  assert.ok(res.propuestas.filter((c) => !c.isFranco).every((c) => c.positionName === P1 && c.puestoReasignadoDe === 'Puesto 3'));
  assert.equal(res.revisar.length, 3);
  assert.ok(res.revisar.every((r) => r.propuestoEn === P1));
  // Dos puestos con el mismo turno: no se elige solo.
  const doble: PuestoSla[] = [...estructura, { positionName: 'Puesto 2', qty: 1, shifts: [{ code: 'M', startTime: '07:00', endTime: '15:00' }] }];
  const [res2] = proponerContinuacion(input([{ id: 'g', nombre: 'G', previos }], diasDelMes(2026, 10), { estructura: doble }));
  assert.ok(!res2.propuestas.some((c) => c.code === 'M'));
  assert.ok(res2.revisar.some((r) => r.code === 'M' && !r.propuestoEn));
});

test('horario del SLA del mes nuevo, no el del mes anterior; borrador con la forma de la grilla', () => {
  const patron = ['M', 'M', 'F', 'F'];
  const previos = armar(patron, '2026-08-20', '2026-09-30', 0).map((t) => ({ ...t, startTime: '07:00' }));
  const [res] = proponerContinuacion(input([{ id: 'g', nombre: 'G', previos }], diasDelMes(2026, 10)));
  const m = res.propuestas.find((c) => c.code === 'M')!;
  assert.equal(m.startTime, '06:00');
  assert.equal(m.endTime, '14:00');
  const pend = cambioPendienteDe(m, OBJ);
  assert.equal(pend.isTemp, true);
  assert.equal(pend.objectiveId, OBJ);
  assert.equal(pend.positionName, P1);
  const f = cambioPendienteDe(res.propuestas.find((c) => c.isFranco)!, OBJ);
  assert.equal(f.code, 'F');
  assert.equal(f.isFranco, true);
});

test('alertas: descanso < 12 h en el cambio de mes, más de 200 h y cupo sobrado', () => {
  // Termina septiembre en T (14–22) y el ciclo pone M (06–14) el 1.º → 8 h de descanso.
  const patron = ['T', 'T', 'M', 'M', 'F', 'F'];
  const previos = armar(patron, '2026-09-05', '2026-09-30', 0);
  const ultimo = previos[previos.length - 1];
  assert.equal(ultimo.code, 'T');
  const resultados = proponerContinuacion(input([{ id: 'g', nombre: 'Gómez', previos }], diasDelMes(2026, 10)));
  assert.equal(resultados[0].propuestas[0].code, 'M');
  const desc = alertasDescansoCambioMes(
    [{ employeeId: 'g', code: 'T', startTime: new Date('2026-09-30T14:00:00-03:00'), endTime: new Date('2026-09-30T22:00:00-03:00') }],
    resultados,
    '2026-10-01',
  );
  assert.equal(desc.length, 1);
  assert.match(desc[0].texto, /T del 30\/09 → M del 01\/10: 8 h/);

  const tope = alertasTope(resultados, () => 150);
  assert.equal(tope.length, 1);
  assert.ok(tope[0].horas > 200);

  const sob = sobrantesPorDia(estructura, [
    { dateStr: '2026-10-01', positionName: P1, code: 'M' },
    { dateStr: '2026-10-01', positionName: P1, code: 'M' },
    { dateStr: '2026-10-01', positionName: P1, code: 'T' },
  ]);
  assert.deepEqual(sob, [{ dateStr: '2026-10-01', positionName: P1, code: 'M', asignados: 2, cupo: 1 }]);
  assert.equal(textoDias(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-07', '2026-10-09', '2026-10-10']), '1–3, 7, 9, 10');
});

test('QUEVEDO: la M suelta al inicio del bloque de T entra en el T×6', () => {
  // M×6 · F×2 · T×6 · F×2 · N×6 · F×2, alineado para que el 10/10 sea el primer M.
  const patron = [...Array(6).fill('M'), 'F', 'F', ...Array(6).fill('T'), 'F', 'F', ...Array(6).fill('N'), 'F', 'F'];
  const oct10 = diaIndex('2026-10-10');
  const mEnElBorde = new Set(['2026-08-31', '2026-09-24', '2026-10-18']);
  const previos = armar(patron, ymdDeIndex(oct10 - 24 * 3), '2026-10-31', 0).map((t) => {
    if (t.dateStr === '2026-10-15') return { ...t, code: 'RET', isReten: true };
    if (mEnElBorde.has(t.dateStr)) return { ...t, code: 'M' };
    if (t.dateStr === '2026-10-22') return { ...t, code: 'D12' };
    if (t.dateStr === '2026-10-29') return { ...t, code: 'N12' };
    return t;
  });
  const ciclo = detectarCiclo(observacionesDelGuardia(previos, OBJ))!;
  assert.equal(ciclo.etiqueta, 'M×6 · F×2 · T×6 · F×2 · N×6 · F×2');
  assert.equal(diaDelCiclo(ciclo, '2026-10-15')?.code, 'M');
  assert.equal(diaDelCiclo(ciclo, '2026-10-18')?.code, 'T');
  assert.equal(diaDelCiclo(ciclo, '2026-11-11')?.code, 'T');
  const [res] = proponerContinuacion(input([{ id: '1V9qOhsyY8EZVPzavxnb', nombre: 'QUEVEDO, GASTON', previos }], diasDelMes(2026, 11)));
  assert.equal(codigos(res)['2026-11-11'], 'T');
});

test('aviso de cobertura: el mismo día y puesto junta la banda que sobra con la que falta', () => {
  const est: PuestoSla[] = [{
    positionName: P1,
    qty: 1,
    shifts: [
      { code: 'M', quantity: 1 },
      { code: 'T', quantity: 1 },
      { code: 'N', quantity: 1 },
    ],
  }];
  const celdas = [
    { dateStr: '2026-11-11', positionName: P1, code: 'M', nombre: 'QUEVEDO, GASTON' },
    { dateStr: '2026-11-11', positionName: P1, code: 'M', nombre: 'TORRES, JUAN' },
    { dateStr: '2026-11-11', positionName: P1, code: 'N', nombre: 'OTRO, ANA' },
    { dateStr: '2026-11-12', positionName: P1, code: 'M', nombre: 'SOLO, UNO' },
    { dateStr: '2026-11-12', positionName: P1, code: 'N', nombre: 'DOS, UNO' },
    { dateStr: '2026-11-13', positionName: P1, code: 'M', nombre: 'A, A' },
    { dateStr: '2026-11-13', positionName: P1, code: 'M', nombre: 'B, B' },
    { dateStr: '2026-11-13', positionName: P1, code: 'T', nombre: 'C, C' },
    { dateStr: '2026-11-13', positionName: P1, code: 'N', nombre: 'D, D' },
  ];
  const avisos = avisosCoberturaPuesto(est, celdas, [
    { dateStr: '2026-11-11', positionName: P1 },
    { dateStr: '2026-11-12', positionName: P1 },
  ]);
  assert.equal(avisos.lineas[0], '11/11 · Puesto 1: dos en M (QUEVEDO y TORRES) y nadie en T');
  assert.equal(avisos.lineas[1], '12/11 · Puesto 1: falta T');
  assert.equal(avisos.lineas[2], '13/11 · Puesto 1: dos en M (A y B)');
  assert.equal(avisos.accion, 'Cambiá a mano una de las dos M por T después de aplicar');
  const muchos = Array.from({ length: 7 }, (_, i) => ({ dateStr: `2026-11-${String(i + 1).padStart(2, '0')}`, positionName: P1 }));
  const lista = avisosCoberturaPuesto(est, [], muchos);
  assert.equal(lista.lineas.length, 5);
  assert.equal(lista.resto, 2);
  assert.match(lista.lineas[0], /^01\/11 · Puesto 1: falta/);
});

test('días de 12 h dentro de un bloque de M no rompen el ciclo (D12 ≈ M)', () => {
  const previos = armar(ROTA_6_2, '2026-08-01', '2026-09-30', 0).map((t, i) =>
    (t.code === 'M' && i % 5 === 0 ? { ...t, code: 'D12' } : t.code === 'N' && i % 7 === 0 ? { ...t, code: 'N12' } : t));
  const ciclo = detectarCiclo(observacionesDelGuardia(previos, OBJ))!;
  assert.equal(ciclo.periodo, 24);
  assert.ok(ciclo.fases.every((f) => f && ['M', 'N', 'T', 'F'].includes(f.code)));
});
