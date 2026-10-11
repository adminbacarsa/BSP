import assert from 'node:assert/strict';
import test from 'node:test';
import {
    decidirAsignacionOtroObjetivo,
    modoEscrituraOtroObjetivo,
    partirCodigoAjeno,
    resolverEquivalenciaOtro,
    urlCronograma,
    validarContraTodos,
    type EquivalenciaOtro,
} from './asignarOtroObjetivo';

test('sin turno ese día se puede asignar en otro objetivo', () => {
    const d = decidirAsignacionOtroObjetivo({
        nombre: 'HERRERA',
        empId: 'h1',
        dateStr: '2026-10-12',
        turnos: [],
    });
    assert.equal(d.ok, true);
});

test('si ya tiene turno, no escribe y ofrece abrir ese cronograma', () => {
    const d = decidirAsignacionOtroObjetivo({
        nombre: 'HERRERA',
        empId: 'h1',
        dateStr: '2026-10-12',
        turnos: [{ objectiveId: 'vifood', objectiveName: 'Vifood', clientId: 'cli', code: 'T' }],
    });
    assert.equal(d.ok, false);
    if (d.ok) return;
    assert.equal(d.mensaje, 'HERRERA ya tiene T en Vifood el 12/10');
    assert.equal(d.abrir?.objectiveId, 'vifood');
    assert.equal(urlCronograma({ ...d.abrir!, year: d.abrir!.year, month: d.abrir!.month }), '/admin/planificacion/?objectiveId=vifood&year=2026&month=10&clientId=cli&dia=2026-10-12&empId=h1');
});

test('una licencia también bloquea', () => {
    const d = decidirAsignacionOtroObjetivo({
        nombre: 'HERRERA',
        empId: 'h1',
        dateStr: '2026-10-12',
        turnos: [{ objectiveId: 'obj', objectiveName: 'Planta', code: 'V', esLicencia: true }],
    });
    assert.equal(d.ok, false);
});

test('VF/T parte marca y banda, y la equivalencia no vuelve a preguntar', () => {
    assert.deepEqual(partirCodigoAjeno('VF/T'), { marca: 'VF', banda: 'T' });
    assert.deepEqual(partirCodigoAjeno('MISE 2/T'), { marca: 'MISE 2', banda: 'T' });
    assert.deepEqual(partirCodigoAjeno('PM / T'), { marca: 'PM', banda: 'T' });
    assert.deepEqual(partirCodigoAjeno('BANCO'), { marca: 'BANCO', banda: null });
    assert.equal(partirCodigoAjeno('M'), null);
    assert.equal(partirCodigoAjeno('F'), null);
    const eq: EquivalenciaOtro = {
        codigo: 'VF',
        objectiveId: 'vifood',
        clientId: 'cli',
        objectiveName: 'Vifood',
        banda: 'T',
        positionName: 'Puesto 1',
        startTime: '14:00',
        endTime: '22:00',
        hours: 8,
    };
    const hit = resolverEquivalenciaOtro('VF/T', [eq]);
    assert.equal(hit?.objectiveId, 'vifood');
    assert.equal(hit?.banda, 'T');
    assert.equal(resolverEquivalenciaOtro('STOCK', [eq]), null);
});

test('publicado pide corrección; sin publicar queda borrador', () => {
    assert.deepEqual(modoEscrituraOtroObjetivo(false, false), { ok: true, draft: true });
    assert.equal(modoEscrituraOtroObjetivo(true, false).ok, false);
    assert.deepEqual(modoEscrituraOtroObjetivo(true, true), { ok: true, draft: false });
});

test('el solape y el tope se miran contra los turnos de todos los objetivos', () => {
    const solapa = validarContraTodos({
        startMin: 14 * 60,
        endMin: 22 * 60,
        horasMes: 40,
        horasTurno: 8,
        otros: [{ startMin: 15 * 60, endMin: 23 * 60, dateOffset: 0 }],
    });
    assert.equal(solapa.ok, false);
    const tope = validarContraTodos({
        startMin: 7 * 60,
        endMin: 15 * 60,
        horasMes: 196,
        horasTurno: 8,
        otros: [],
    });
    assert.equal(tope.ok, false);
    const ok = validarContraTodos({
        startMin: 15 * 60,
        endMin: 23 * 60,
        horasMes: 40,
        horasTurno: 8,
        otros: [{ startMin: 23 * 60, endMin: 7 * 60, dateOffset: -1 }],
    });
    assert.equal(ok.ok, true);
});
