import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { acreditarExtEntrePuestos, deltaCierreExtEntre, textoFacturableCliente, turnoExtDelObjetivo, type PuestoExt, type TurnoExt } from './extEntrePuestos';

function turno(p: TurnoExt): TurnoExt {
  return p;
}

const dia24: PuestoExt[] = [
  { positionName: 'M', franjas: [{ code: 'M', startTime: '06:00', endTime: '14:00', qty: 1 }] },
  { positionName: 'T', franjas: [{ code: 'T', startTime: '14:00', endTime: '22:00', qty: 1 }] },
  { positionName: 'N', franjas: [{ code: 'N', startTime: '22:00', endTime: '06:00', qty: 1 }] },
];

describe('extensión entre puestos del mismo objetivo', () => {
  it('la T de 24 h se cierra con ext 14–18 y adel 18–22, y el facturable queda en lo vendido', () => {
    const r = acreditarExtEntrePuestos(dia24, [
      turno({ positionName: 'M', nombre: 'X', code: 'M', startTime: '06:00', endTime: '14:00', isExtended: true, segmentFromTime: '14:00', segmentToTime: '18:00' }),
      turno({ positionName: 'N', nombre: 'Y', code: 'N', startTime: '22:00', endTime: '06:00', isEarlyStart: true, segmentFromTime: '18:00', segmentToTime: '22:00' }),
    ]);
    const tarde = r.porPuesto.find((p) => p.positionName === 'T');
    assert.equal(tarde?.cerrado, true);
    assert.equal(tarde?.faltanHoras, 0);
    assert.equal(r.cerrado, true);
    assert.equal(r.facturable, r.vendidas);
    assert.equal(r.vendidas, 24);
    assert.match(r.textos.join(' '), /T 14–22: cubierto por ext\. de X 14–18 y adel\. de Y 18–22/);
    assert.equal(r.porPuesto.find((p) => p.positionName === 'M')?.facturable, 8);
  });

  it('Casa Central: P2 +4 y P3 +4 no tapan el hueco de P1', () => {
    const puestos: PuestoExt[] = [
      { positionName: 'P1', franjas: [{ code: 'P1', startTime: '06:00', endTime: '14:00', qty: 1 }] },
      { positionName: 'P2', franjas: [{ code: 'P2', startTime: '07:00', endTime: '16:00', qty: 1 }] },
      { positionName: 'P3', franjas: [{ code: 'P3', startTime: '14:00', endTime: '20:00', qty: 1 }] },
    ];
    const r = acreditarExtEntrePuestos(puestos, [
      turno({ positionName: 'P2', nombre: 'B', code: 'P2', startTime: '07:00', endTime: '16:00', isExtended: true, segmentFromTime: '16:00', segmentToTime: '20:00' }),
      turno({ positionName: 'P3', nombre: 'C', code: 'P3', startTime: '14:00', endTime: '20:00', isExtended: true, segmentFromTime: '20:00', segmentToTime: '00:00' }),
    ]);
    const p1 = r.porPuesto.find((p) => p.positionName === 'P1');
    assert.equal(p1?.cerrado, false);
    assert.equal(p1?.faltanHoras, 8);
    assert.match(p1?.textos.join(' ') || '', /falta 06–14/);
    assert.equal(r.facturable, r.vendidas - 8);
    assert.equal(r.turaHoras, 0);
  });

  it('un TURA de 4 h suma al facturable por encima de lo vendido', () => {
    const r = acreditarExtEntrePuestos(dia24, [
      turno({ positionName: 'M', nombre: 'A', code: 'M', startTime: '06:00', endTime: '14:00' }),
      turno({ positionName: 'T', nombre: 'B', code: 'T', startTime: '14:00', endTime: '22:00' }),
      turno({ positionName: 'N', nombre: 'C', code: 'N', startTime: '22:00', endTime: '06:00' }),
      turno({ positionName: 'T', nombre: 'Cliente', code: 'TURA', isTura: true, startTime: '14:00', endTime: '18:00' }),
    ]);
    assert.equal(r.cerrado, true);
    assert.equal(r.vendidas, 24);
    assert.equal(r.turaHoras, 4);
    assert.equal(r.facturable, r.vendidas + 4);
    assert.match(textoFacturableCliente(r), /vendidas 24h \+ TURA 4h/);
  });

  it('el mismo tramo no cubre dos huecos ni suma al puesto de origen', () => {
    const puestos: PuestoExt[] = [
      { positionName: 'D', franjas: [{ code: 'M', startTime: '06:00', endTime: '14:00', qty: 1 }] },
      { positionName: 'HA', franjas: [{ code: 'T', startTime: '14:00', endTime: '18:00', qty: 1 }] },
      { positionName: 'HB', franjas: [{ code: 'T', startTime: '14:00', endTime: '18:00', qty: 1 }] },
    ];
    const r = acreditarExtEntrePuestos(puestos, [
      turno({ positionName: 'D', nombre: 'X', code: 'M', startTime: '06:00', endTime: '14:00', isExtended: true, segmentFromTime: '14:00', segmentToTime: '18:00' }),
    ]);
    const ha = r.porPuesto.find((p) => p.positionName === 'HA');
    const hb = r.porPuesto.find((p) => p.positionName === 'HB');
    const origen = r.porPuesto.find((p) => p.positionName === 'D');
    const cerrados = [ha, hb].filter((p) => p?.cerrado).length;
    assert.equal(cerrados, 1);
    assert.equal((ha?.faltanHoras || 0) + (hb?.faltanHoras || 0), 4);
    assert.equal(origen?.facturable, 8);
    assert.equal(origen?.cedidasHoras, 4);
    assert.equal(r.facturable, r.vendidas - 4);
  });

  it('MM 08–20 y ME 10–14 cuentan cada minuto una vez: el solape no se vende dos veces', () => {
    const puestos: PuestoExt[] = [{
      positionName: 'Vigilador',
      franjas: [
        { code: 'MM', startTime: '08:00', endTime: '20:00', qty: 1 },
        { code: 'ME', startTime: '10:00', endTime: '14:00', qty: 1 },
      ],
    }];
    const r = acreditarExtEntrePuestos(puestos, [
      turno({ positionName: 'Vigilador', nombre: 'A', code: 'MM', startTime: '08:00', endTime: '20:00' }),
      turno({ positionName: 'Vigilador', nombre: 'B', code: 'ME', startTime: '10:00', endTime: '14:00' }),
    ]);
    assert.equal(r.vendidas, 16);
    assert.equal(r.facturable, 16);
    assert.equal(r.cerrado, true);
    const solo = acreditarExtEntrePuestos(puestos, [
      turno({ positionName: 'Vigilador', nombre: 'A', code: 'MM', startTime: '08:00', endTime: '20:00' }),
    ]);
    assert.equal(solo.vendidas, 16);
    assert.equal(solo.facturable, 12);
    assert.equal(solo.cerrado, false);
    assert.equal(solo.porPuesto[0]?.faltanHoras, 4);
  });
});

describe('tramo que cruza medianoche', () => {
  it('el adelanto 02–06 tapa el hueco 22–06 y entra al facturable', () => {
    const r = acreditarExtEntrePuestos(dia24, [
      turno({ positionName: 'M', nombre: 'X', code: 'M', startTime: '06:00', endTime: '14:00', isEarlyStart: true, segmentFromTime: '02:00', segmentToTime: '06:00' }),
    ]);
    const noche = r.porPuesto.find((p) => p.positionName === 'N');
    const manana = r.porPuesto.find((p) => p.positionName === 'M');
    assert.equal(noche?.facturable, 4);
    assert.equal(noche?.faltanHoras, 4);
    assert.equal(noche?.cerrado, false);
    assert.equal(manana?.facturable, 8);
    assert.equal(manana?.cedidasHoras, 4);
    assert.equal(r.extEnHuecoHoras, 4);
    assert.equal(r.facturable, 12);
    assert.equal(r.vendidas, 24);
    assert.match(noche?.textos.join(' ') || '', /cubierto por adel\. de X 02–06/);
    assert.match(noche?.textos.join(' ') || '', /falta 22–02/);
  });

  it('la extensión 18–22 tapa el tramo inicial del hueco 18–06', () => {
    const puestos: PuestoExt[] = [
      { positionName: 'D', franjas: [{ code: 'D12', startTime: '06:00', endTime: '18:00', qty: 1 }] },
      { positionName: 'N', franjas: [{ code: 'N12', startTime: '18:00', endTime: '06:00', qty: 1 }] },
    ];
    const r = acreditarExtEntrePuestos(puestos, [
      turno({ positionName: 'D', nombre: 'X', code: 'D12', startTime: '06:00', endTime: '18:00', isExtended: true, segmentFromTime: '18:00', segmentToTime: '22:00' }),
    ]);
    const noche = r.porPuesto.find((p) => p.positionName === 'N');
    const dia = r.porPuesto.find((p) => p.positionName === 'D');
    assert.equal(noche?.facturable, 4);
    assert.equal(noche?.faltanHoras, 8);
    assert.equal(dia?.facturable, 12);
    assert.equal(dia?.cedidasHoras, 4);
    assert.equal(r.facturable, 16);
    assert.equal(r.vendidas, 24);
    assert.match(noche?.textos.join(' ') || '', /cubierto por ext\. de X 18–22/);
    assert.match(noche?.textos.join(' ') || '', /falta 22–06/);
  });

  it('un tramo que no cruza medianoche no se corre al otro día', () => {
    const r = acreditarExtEntrePuestos(dia24, [
      turno({ positionName: 'M', nombre: 'X', code: 'M', startTime: '06:00', endTime: '14:00', isExtended: true, segmentFromTime: '14:00', segmentToTime: '18:00' }),
    ]);
    const tarde = r.porPuesto.find((p) => p.positionName === 'T');
    const noche = r.porPuesto.find((p) => p.positionName === 'N');
    assert.equal(tarde?.facturable, 4);
    assert.equal(tarde?.faltanHoras, 4);
    assert.equal(noche?.facturable, 0);
    assert.equal(noche?.faltanHoras, 8);
    assert.equal(r.porPuesto.find((p) => p.positionName === 'M')?.cedidasHoras, 4);
    assert.equal(r.facturable, 12);
    assert.equal(r.vendidas, 24);
  });
});

describe('el turno de ext pertenece al objetivo', () => {
  it('sin objectiveId no entra; el legajo o el objetivo del hueco sí', () => {
    assert.equal(turnoExtDelObjetivo({ objectiveId: '' }, 'A'), false);
    assert.equal(turnoExtDelObjetivo({}, 'A', { objetivoLegajo: 'B' }), false);
    assert.equal(turnoExtDelObjetivo({}, 'A', { objetivoLegajo: 'A' }), true);
    assert.equal(turnoExtDelObjetivo({ objectiveId: 'B' }, 'A', { objetivoLegajo: 'A' }), false);
    assert.equal(turnoExtDelObjetivo({ objectiveId: 'A', coversObjectiveId: 'B' }, 'A'), false);
    assert.equal(turnoExtDelObjetivo({ objectiveId: 'A', coversObjectiveId: 'B' }, 'B'), true);
  });
});

describe('cierre de ext en el pie', () => {
  it('suma el puesto que el cruce cerró y no el que ya estaba cerrado', () => {
    assert.equal(deltaCierreExtEntre({ required: 1, closed: 0 }, { cerrado: true }), 1);
    assert.equal(deltaCierreExtEntre({ required: 1, closed: 1 }, { cerrado: true }), 0);
    assert.equal(deltaCierreExtEntre({ required: 1, closed: 0 }, { cerrado: false }), 0);
    assert.equal(deltaCierreExtEntre({ required: 0, closed: 0 }, { cerrado: true }), 0);
  });
});
