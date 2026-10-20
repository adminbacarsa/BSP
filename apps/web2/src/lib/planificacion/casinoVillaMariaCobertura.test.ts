import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluarCoberturaDia, type TurnoRelojCobertura } from './positionCoverageUnits';
import { leerDia, type PuestoServicio, type TurnoDia } from './lecturaBandas';
import { textoCierreContraVendidas, textoFueraDelCierre } from './desgloseCierreTexto';

const guardia = {
  positionName: 'Guardia',
  qty: 1,
  coverageType: 'custom',
  shifts: [
    { code: 'M', hours: 8, startTime: '06:00', endTime: '14:00', quantity: 1 },
    { code: 'T', hours: 8, startTime: '14:00', endTime: '22:00', quantity: 2 },
    { code: 'N', hours: 8, startTime: '22:00', endTime: '06:00', quantity: 2 },
  ],
};
const mm = { positionName: 'MM', qty: 1, coverageType: 'custom', shifts: [{ code: 'MM', hours: 8, startTime: '11:00', endTime: '19:00', quantity: 1 }] };
const rn1 = { positionName: 'RN1', qty: 1, coverageType: 'custom', shifts: [{ code: 'N1', hours: 8, startTime: '20:00', endTime: '04:00', quantity: 1 }] };
const rn2 = { positionName: 'RN2', qty: 1, coverageType: 'custom', shifts: [{ code: 'N2', hours: 8, startTime: '21:00', endTime: '05:00', quantity: 1 }] };
const puestos = [guardia, mm, rn1, rn2];

function t(code: string, positionName: string, start: string, end: string, extra: Partial<TurnoRelojCobertura> = {}): TurnoRelojCobertura & { positionName: string } {
  return { code, positionName, startTime: start, endTime: end, ...extra };
}

const resto = [
  t('MM', 'MM', '11:00', '19:00'),
  t('N1', 'RN1', '20:00', '04:00'),
  t('N2', 'RN2', '21:00', '05:00'),
];

function dia(turnosGuardia: Array<TurnoRelojCobertura & { positionName: string }>) {
  return evaluarCoberturaDia(puestos, [...turnosGuardia, ...resto], 'J', '2026-10-01');
}

function guardiaDe(r: ReturnType<typeof dia>) {
  const g = r.positions.find((p) => p.positionName === 'Guardia');
  assert.ok(g);
  return g!;
}

describe('Casino Villa María: cantidad por banda', () => {
  const base = [
    t('D12', 'Guardia', '06:00', '18:00'),
    t('N12', 'Guardia', '18:00', '06:00'),
    t('T', 'Guardia', '14:00', '22:00'),
    t('N', 'Guardia', '22:00', '06:00'),
  ];

  it('D12+N12+T+N cierra 4/4 sin sobrante', () => {
    const r = dia(base);
    assert.equal(r.etiqueta, '4/4');
    assert.equal(r.sobra, 0);
    assert.equal(guardiaDe(r).bandas?.map((b) => `${b.code} ${b.tiene}/${b.pide}`).join(' · '), 'M 1/1 · T 2/2 · N 2/2');
    assert.equal(guardiaDe(r).facturable, 40);
    assert.equal(guardiaDe(r).sobraHoras, 0);
  });

  it('una T de más marca 4/4 +1 en la tarde', () => {
    const r = dia([...base, t('T', 'Guardia', '14:00', '22:00')]);
    assert.equal(r.etiqueta, '4/4 +1');
    assert.match(r.sobraDetalle.join(' '), /Sobra 1 en Guardia 14–22 \(T\)/);
  });

  it('sin la T la tarde queda en una persona: 3/4 y no hay sobrante', () => {
    const r = dia(base.filter((x) => x.code !== 'T'));
    assert.equal(r.etiqueta, '3/4');
    assert.equal(r.sobra, 0);
    assert.equal(guardiaDe(r).bandas?.find((b) => b.code === 'T')?.tiene, 1);
  });

  it('sin la segunda N el día queda 3/4', () => {
    const r = dia(base.filter((x) => x.code !== 'N'));
    assert.equal(r.etiqueta, '3/4');
    assert.equal(guardiaDe(r).closed, 0);
  });

  it('una T más la extensión 14–18 y el adelanto 18–22 cierran Guardia en 40 h', () => {
    const r = dia([
      t('M', 'Guardia', '06:00', '14:00', { isExtended: true, segmentFromTime: '14:00', segmentToTime: '18:00' }),
      t('T', 'Guardia', '14:00', '22:00'),
      t('N', 'Guardia', '22:00', '06:00', { isEarlyStart: true, segmentFromTime: '18:00', segmentToTime: '22:00' }),
      t('N', 'Guardia', '22:00', '06:00'),
    ]);
    assert.equal(r.etiqueta, '4/4');
    assert.equal(guardiaDe(r).facturable, 40);
    assert.equal(guardiaDe(r).sobraHoras, 0);
  });

  it('la misma extensión con las dos T sobra 4 h', () => {
    const r = dia([
      t('M', 'Guardia', '06:00', '14:00', { isExtended: true, segmentFromTime: '14:00', segmentToTime: '18:00' }),
      t('T', 'Guardia', '14:00', '22:00'),
      t('T', 'Guardia', '14:00', '22:00'),
      t('N', 'Guardia', '22:00', '06:00'),
      t('N', 'Guardia', '22:00', '06:00'),
    ]);
    assert.equal(r.etiqueta, '4/4');
    assert.equal(guardiaDe(r).sobraHoras, 4);
    assert.equal(guardiaDe(r).facturable, 40);
  });

  it('D12 07–19 y N12 19–07 cierran 4/4 y avisan la hora de 06:00 a 07:00', () => {
    const r = dia([
      t('D12', 'Guardia', '07:00', '19:00'),
      t('N12', 'Guardia', '19:00', '07:00'),
      t('T', 'Guardia', '14:00', '22:00'),
      t('N', 'Guardia', '22:00', '06:00'),
    ]);
    assert.equal(r.etiqueta, '4/4 ⚠1h');
    assert.equal(guardiaDe(r).bandas?.map((b) => `${b.code} ${b.tiene}/${b.pide}`).join(' · '), 'M 1/1 · T 2/2 · N 2/2');
    assert.match(guardiaDe(r).avisoHoras || '', /Falta 1 h en Guardia \(06:00–07:00\)/);
  });

  it('Casino Miramar 2/10: el hueco de 14 a 15 cierra el día y marca la hora', () => {
    const miramar = {
      positionName: 'Guardia',
      qty: 2,
      coverageType: '24hs',
      shifts: [
        { code: 'M', hours: 8, startTime: '06:00', endTime: '14:00', quantity: 2 },
        { code: 'T', hours: 8, startTime: '14:00', endTime: '22:00', quantity: 2 },
        { code: 'N', hours: 8, startTime: '22:00', endTime: '06:00', quantity: 2 },
      ],
    };
    const r = evaluarCoberturaDia([miramar], [
      t('M', 'Guardia', '06:00', '18:00', { nombre: 'CHAVEZ' }),
      t('M', 'Guardia', '06:00', '14:00', { nombre: 'CARNERO' }),
      t('T', 'Guardia', '15:00', '23:00', { nombre: 'CORDOBA' }),
      t('N', 'Guardia', '18:00', '06:00', { nombre: 'BAZAN' }),
      t('N', 'Guardia', '22:00', '06:00', { nombre: 'AGUILERA' }),
    ], 'V', '2026-10-02');
    assert.equal(r.closed, 1);
    assert.equal(r.required, 1);
    assert.match(r.avisoHoras, /Falta 1 h en Guardia \(14:00–15:00\)/);
    assert.equal(r.etiqueta, '1/1 ⚠1h');
  });

  it('el puesto con quantity 2 y PAX por banda es una sola cobertura', () => {
    const conQtyPuesto = { ...guardia, qty: 2, coverageType: '24hs' };
    const r = evaluarCoberturaDia([conQtyPuesto, mm, rn1, rn2], [...base, ...resto]);
    assert.equal(r.required, 4);
    assert.equal(r.etiqueta, '4/4');
  });
});

describe('lectura del día con cantidad por banda', () => {
  it('no dice puestos × 2 pax: muestra M 1/1 · T 2/2 · N 2/2', () => {
    const puestosLectura: PuestoServicio[] = [{ ...guardia, qty: 2, coverageType: 'custom' }];
    const turnos: TurnoDia[] = [
      { empId: 'a', nombre: 'A', code: 'D12', positionName: 'Guardia', hours: 12 },
      { empId: 'b', nombre: 'B', code: 'N12', positionName: 'Guardia', hours: 12 },
      { empId: 'c', nombre: 'C', code: 'T', positionName: 'Guardia', hours: 8 },
      { empId: 'd', nombre: 'D', code: 'N', positionName: 'Guardia', hours: 8 },
    ];
    const lectura = leerDia({ turnos, puestos: puestosLectura });
    assert.match(lectura.texto, /M 1\/1 · T 2\/2 · N 2\/2/);
    assert.doesNotMatch(lectura.texto, /puestos ×/);
    assert.equal(lectura.falta.M + lectura.falta.T + lectura.falta.N, 0);
  });
});

describe('desglose sin publicar', () => {
  it('compara el cierre del borrador contra vendidas', () => {
    assert.equal(
      textoCierreContraVendidas({ mesPublicado: false, horasCierre: 1968, vendidas: 1984 }),
      'Faltan 16h (borrador, sin publicar)',
    );
    assert.equal(
      textoCierreContraVendidas({ mesPublicado: false, horasCierre: 2000, vendidas: 1984 }),
      'Sobran 16h (borrador, sin publicar)',
    );
    const fuera = textoFueraDelCierre({
      mesPublicado: false,
      horasPublicadas: 0,
      baseSla: 1968,
      ftHours: 0,
      uncodedHours: 0,
    });
    assert.match(fuera, /Cierre con borrador 1968h/);
    assert.doesNotMatch(fuera, /-1968h/);
    assert.doesNotMatch(fuera, /1968 \+ eso = 0h/);
  });
});
