import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { acreditarExtEntrePuestos, textoFacturableCliente, type PuestoExt, type TurnoExt } from './extEntrePuestos';

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
});
