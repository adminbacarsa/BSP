import assert from 'node:assert/strict';
import test from 'node:test';
import {
    bandaOcupadaEnDatos,
    legajosQuePasanARet,
    turnoVigente,
} from './lecturaTurnoGrilla';

const m = (empId: string, positionName = 'Vigilador') => ({
    empId,
    guardado: { code: 'M', positionName, objectiveId: 'obj-1', startTime: '06:00', endTime: '14:00' },
});

test('el pendiente pisa al guardado y el borrado deja ver el turno de abajo', () => {
    assert.equal(turnoVigente({ code: 'T', isDeleted: false }, { code: 'M' })?.code, 'T');
    assert.equal(turnoVigente({ code: 'T', isDeleted: true }, { code: 'M' })?.code, 'M');
    assert.equal(turnoVigente({ isDeleted: true }, { isDeleted: true }), null);
    assert.equal(turnoVigente(null, null), null);
});

test('la banda ocupada se lee de los datos, también fuera de las filas montadas', () => {
    const legajos = [
        ...Array.from({ length: 48 }, (_, i) => ({ empId: `vacio-${i}`, guardado: { code: 'F', positionName: 'Vigilador', objectiveId: 'obj-1' } })),
        { empId: 'lejos', guardado: { code: 'T', positionName: 'Vigilador', objectiveId: 'obj-1' } },
    ];
    assert.equal(bandaOcupadaEnDatos(legajos, 'T', 'Vigilador'), true);
    assert.equal(bandaOcupadaEnDatos(legajos, 'N', 'Vigilador'), false);
    assert.equal(bandaOcupadaEnDatos([{ pending: { code: 'T', isDeleted: true }, guardado: { code: 'M', positionName: 'Vigilador' } }], 'T', 'Vigilador'), false);
    assert.equal(bandaOcupadaEnDatos([{ guardado: { code: 'T' } }], 'T', 'Vigilador'), true);
});

test('«No se trabaja» pasa a RET a toda la dotación, no solo a la ventana', () => {
    const legajos = [
        m('en-ventana'),
        m('fuera'),
        { empId: 'ya-ret', guardado: { code: 'RET', positionName: 'Retén', objectiveId: 'obj-1' } },
        { empId: 'franco', guardado: { code: 'F', isFranco: true, positionName: 'Vigilador', objectiveId: 'obj-1' } },
        { empId: 'licencia', guardado: { code: 'V', positionName: 'Vigilador', objectiveId: 'obj-1' } },
        { empId: 'ausente', guardado: { code: 'M', positionName: 'Vigilador', objectiveId: 'obj-1' }, tieneAusencia: true },
        { empId: 'otro', guardado: { code: 'M', positionName: 'Vigilador', objectiveId: 'obj-2' } },
        { empId: 'fichado', guardado: { code: 'M', positionName: 'Vigilador', objectiveId: 'obj-1', status: 'PRESENT' } },
        { empId: 'ops', guardado: { code: 'M', positionName: 'Vigilador', objectiveId: 'obj-1', origin: 'OPERATIONS_COVERAGE' } },
        { empId: 'otro-puesto', guardado: { code: 'M', positionName: 'Portería', objectiveId: 'obj-1' } },
        { empId: 'pendiente', pending: { code: 'N', positionName: 'Vigilador', objectiveId: 'obj-1' }, guardado: { code: 'F', objectiveId: 'obj-1' } },
    ];
    assert.deepEqual(
        legajosQuePasanARet(legajos, 'obj-1', { tipo: 'todo' }),
        ['en-ventana', 'fuera', 'otro-puesto', 'pendiente'],
    );
    assert.deepEqual(
        legajosQuePasanARet(legajos, 'obj-1', { tipo: 'puesto', puesto: 'Vigilador' }),
        ['en-ventana', 'fuera', 'pendiente'],
    );
    assert.deepEqual(
        legajosQuePasanARet(legajos, 'obj-1', { tipo: 'franja', puesto: 'Vigilador', code: 'N' }),
        ['pendiente'],
    );
});
