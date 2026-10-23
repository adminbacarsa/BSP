import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decisionGuardadoTurnoAjeno } from '@/lib/planificacion/turnoOtroObjetivo';
import {
  armarEscriturasRfze,
  camposRelojTurnoRfze,
  prepararRfzeSobreCeldas,
  resolverBorradoRetParaRfze,
} from './rfzeSobreRet';

const OBRADOR = 'obrador';
const BANCO = 'banco';

describe('RFZE sobre RET', () => {
  it('RET del mismo objetivo se borra y el RFZE se crea', () => {
    const docs = [{ id: 'ret-obrador', objectiveId: OBRADOR, code: 'RET' }];
    const prep = prepararRfzeSobreCeldas({
      celdas: [{ empId: 'e1', empName: 'PEREZ, ANA', ds: '2026-10-23', r: 0, c: 1, celda: { code: 'RET' }, docs }],
      permitidos: [OBRADOR],
      objetivoCrono: OBRADOR,
    });
    assert.equal(prep.crear.length, 1);
    assert.deepEqual(prep.borrarRet.map((b) => [b.id, b.objectiveId]), [['ret-obrador', OBRADOR]]);
    assert.equal(prep.avisos.length, 0);
    const escrituras = armarEscriturasRfze({ fechas: ['2026-10-23'], inicio: '08:00', fin: '20:00', borrarTurnoIds: prep.borrarRet.map((b) => b.id) });
    assert.deepEqual(escrituras.filter((e) => e.tipo === 'delete').map((e) => e.id), ['ret-obrador']);
    assert.equal(escrituras.filter((e) => e.tipo === 'turno').length, 1);
  });

  it('RET de otro objetivo borra ese documento; el isDeleted del guardado lo descartaría', () => {
    const docs = [{ id: 'ret-banco', objectiveId: BANCO, code: 'RET' }];
    const descartado = decisionGuardadoTurnoAjeno({ cambio: { isDeleted: true }, docs, permitidos: [OBRADOR] });
    assert.equal(descartado.escribir, false);
    assert.deepEqual(descartado.borrarIds, []);
    const prep = prepararRfzeSobreCeldas({
      celdas: [{ empId: 'e1', empName: 'PEREZ, ANA', ds: '2026-10-23', r: 0, c: 1, celda: { code: 'RET' }, docs }],
      permitidos: [OBRADOR],
      objetivoCrono: OBRADOR,
    });
    assert.equal(prep.crear.length, 1);
    assert.deepEqual(prep.borrarRet.map((b) => [b.id, b.objectiveId]), [['ret-banco', BANCO]]);
    assert.equal(prep.avisos.length, 0);
  });

  it('RET ajeno sin documento no crea el RFZE y avisa', () => {
    const prep = prepararRfzeSobreCeldas({
      celdas: [{
        empId: 'e1', empName: 'PEREZ, ANA', ds: '2026-10-23', r: 0, c: 1,
        celda: { code: 'RET' },
        docs: [{ objectiveId: BANCO, code: 'RET' }],
      }],
      permitidos: [OBRADOR],
      objetivoCrono: OBRADOR,
    });
    assert.equal(prep.crear.length, 0);
    assert.equal(prep.borrarRet.length, 0);
    assert.match(prep.avisos[0], /No se creó el RFZE/);
    const suelto = resolverBorradoRetParaRfze({ docs: [{ objectiveId: BANCO, code: 'RET' }], permitidos: [OBRADOR], objetivoCrono: OBRADOR });
    assert.equal(suelto.ok, false);
  });

  it('franco y celda vacía crean el RFZE sin borrar', () => {
    const prep = prepararRfzeSobreCeldas({
      celdas: [
        { empId: 'e1', empName: 'PEREZ', ds: '2026-10-24', r: 0, c: 2, celda: { code: 'F', isFranco: true }, docs: [{ id: 'f1', objectiveId: BANCO, code: 'F' }] },
        { empId: 'e1', empName: 'PEREZ', ds: '2026-10-25', r: 0, c: 3, celda: null, docs: [] },
      ],
      permitidos: [OBRADOR],
      objetivoCrono: OBRADOR,
    });
    assert.equal(prep.crear.length, 2);
    assert.equal(prep.borrarRet.length, 0);
    assert.equal(prep.rfzf.length, 0);
    assert.equal(prep.avisos.length, 0);
  });

  it('startTime y endTime del turno son Timestamp, no string', () => {
    const { startTime, endTime } = camposRelojTurnoRfze('2026-10-23', '22:00', '06:00');
    assert.equal(startTime instanceof Date, true);
    assert.equal(typeof startTime, 'object');
    assert.equal(startTime.getHours(), 22);
    assert.equal(endTime.getDate(), 24);
    assert.equal(endTime.getHours(), 6);
    const plan = armarEscriturasRfze({ fechas: ['2026-10-23'], inicio: '22:00', fin: '06:00', borrarTurnoIds: ['ret-banco'] });
    const turno = plan.find((e) => e.tipo === 'turno');
    assert.ok(turno && turno.tipo === 'turno');
    assert.equal(turno.startTime instanceof Date, true);
    assert.equal(typeof turno.startTime, 'object');
    const writer = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'crearRfzePlanificacion.ts'), 'utf8');
    assert.match(writer, /startTime:\s*Timestamp\.fromDate\(reloj\.startTime\)/);
    assert.match(writer, /endTime:\s*Timestamp\.fromDate\(reloj\.endTime\)/);
    assert.doesNotMatch(writer, /startTime:\s*`\$\{fecha\}T/);
    assert.equal(armarEscriturasRfze({ fechas: [], inicio: '08:00', fin: '20:00', borrarTurnoIds: ['ret-banco'] }).length, 0);
  });
});
