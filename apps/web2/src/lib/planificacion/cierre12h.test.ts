import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzePositionDayGap } from './coverageGapAnalysis';
import { countPositionClosedUnitsFromShifts } from './positionCoverageUnits';
import { horarioDoce, proponerCierre12h, resumirDias12, slaExigeCobertura, textoRango12h, volverA8 } from './cierre12h';

const puesto = {
    positionName: 'Puesto 1',
    qty: 1,
    coverageType: '24hs',
    shifts: [
        { code: 'M', hours: 8, startTime: '07:00', endTime: '15:00' },
        { code: 'T', hours: 8, startTime: '15:00', endTime: '23:00' },
        { code: 'N', hours: 8, startTime: '23:00', endTime: '07:00' },
        { code: 'D12', hours: 12, startTime: '07:00', endTime: '19:00' },
        { code: 'N12', hours: 12, startTime: '19:00', endTime: '07:00' },
    ],
};

function faltantes(counts: Record<string, number>) {
    const gap = analyzePositionDayGap(puesto, 'J', counts, undefined, true, '2026-10-01');
    return (gap?.missingBandsPrimary || []).map((b) => b.code);
}

describe('cierre a 12 h', () => {
    it('si falta la T, el M pasa a D12 y el N a N12', () => {
        const falta = faltantes({ M: 1, N: 1 });
        assert.deepEqual(falta, ['T']);
        const p = proponerCierre12h({
            dateStr: '2026-10-01',
            positionName: 'Puesto 1',
            faltantes: falta,
            turnos: [
                { empId: 'herr', nombre: 'HERRANTE, Luis', dateStr: '2026-10-01', code: 'M', positionName: 'Puesto 1' },
                { empId: 'diaz', nombre: 'DIAZ, Ana', dateStr: '2026-10-01', code: 'N', positionName: 'Puesto 1' },
            ],
        });
        assert.equal(p?.modo, 'par');
        assert.equal(p?.banda, 'T');
        assert.deepEqual(p?.cambios.map((c) => [c.empId, c.code, c.startTime, c.endTime]), [
            ['herr', 'D12', '07:00', '19:00'],
            ['diaz', 'N12', '19:00', '07:00'],
        ]);
        assert.match(p!.texto, /Cubre la T de Puesto 1: HERRANTE D12 07:00–19:00 \+ DIAZ N12 19:00–07:00/);
        const cerrado = countPositionClosedUnitsFromShifts(puesto, 'J', { D12: 1, N12: 1 });
        assert.equal(cerrado.closed, cerrado.required);
    });

    it('si falta la M, el T y la N de ese mismo día pasan a D12 y N12', () => {
        const falta = faltantes({ T: 1, N: 1 });
        assert.ok(falta.includes('M'));
        const p = proponerCierre12h({
            dateStr: '2026-10-02',
            positionName: 'Puesto 1',
            faltantes: ['M'],
            turnos: [
                { empId: 'diaz', nombre: 'DIAZ', dateStr: '2026-10-01', code: 'N', positionName: 'Puesto 1' },
                { empId: 'herr', nombre: 'HERRANTE', dateStr: '2026-10-02', code: 'T', positionName: 'Puesto 1' },
                { empId: 'diaz', nombre: 'DIAZ', dateStr: '2026-10-02', code: 'N', positionName: 'Puesto 1' },
            ],
        });
        assert.equal(p?.modo, 'par');
        assert.equal(p?.cambios.find((c) => c.empId === 'herr')?.code, 'D12');
        const n12 = p?.cambios.find((c) => c.code === 'N12');
        assert.equal(n12?.dateStr, '2026-10-02');
        assert.equal(n12?.startTime, '19:00');
        assert.equal(n12?.endTime, '07:00');
    });

    it('si falta la N, el M pasa a D12 y el T a N12 y la noche se acredita ese día', () => {
        const falta = faltantes({ M: 1, T: 1 });
        assert.deepEqual(falta, ['N']);
        const p = proponerCierre12h({
            dateStr: '2026-10-03',
            positionName: 'Puesto 1',
            faltantes: falta,
            turnos: [
                { empId: 'herr', nombre: 'HERRERA', dateStr: '2026-10-03', code: 'M', positionName: 'Puesto 1' },
                { empId: 'bord', nombre: 'BORDINO', dateStr: '2026-10-03', code: 'T', positionName: 'Puesto 1' },
            ],
        });
        assert.equal(p?.modo, 'par');
        assert.equal(p?.banda, 'N');
        assert.deepEqual(p?.cambios.map((c) => [c.empId, c.code, c.dateStr, c.startTime, c.endTime]), [
            ['herr', 'D12', '2026-10-03', '07:00', '19:00'],
            ['bord', 'N12', '2026-10-03', '19:00', '07:00'],
        ]);
        assert.ok(p?.cambios.every((c) => c.dateStr !== '2026-10-04'));
        const cerrado = countPositionClosedUnitsFromShifts(puesto, 'S', { D12: 1, N12: 1 });
        assert.equal(cerrado.closed, cerrado.required);
    });

    it('no reescribe a quien ya cumple 12 h', () => {
        const p = proponerCierre12h({
            dateStr: '2026-10-01',
            positionName: 'Puesto 1',
            faltantes: ['T'],
            turnos: [
                { empId: 'herr', nombre: 'HERRANTE', dateStr: '2026-10-01', code: 'M', positionName: 'Puesto 1', hours: 12 },
                { empId: 'diaz', nombre: 'DIAZ', dateStr: '2026-10-01', code: 'N', positionName: 'Puesto 1' },
            ],
        });
        assert.equal(p?.cambios.some((c) => c.empId === 'herr'), false);
    });

    it('en un rango de licencia lista el día sin par y no lo aplica', () => {
        const base = {
            positionName: 'Puesto 1',
            faltantes: ['N'] as const,
        };
        const turno = (dateStr: string, empId: string, nombre: string, code: string, bloqueado?: boolean, motivo?: string) => ({
            empId, nombre, dateStr, code, positionName: 'Puesto 1', bloqueado, motivo,
        });
        const dias = resumirDias12([
            {
                ...base,
                dateStr: '2026-10-11',
                turnos: [turno('2026-10-11', 'herr', 'HERRERA', 'M'), turno('2026-10-11', 'bord', 'BORDINO', 'T')],
            },
            {
                ...base,
                dateStr: '2026-10-12',
                turnos: [
                    turno('2026-10-12', 'herr', 'HERRERA', 'M'),
                    turno('2026-10-12', 'bord', 'BORDINO', 'T', true, 'licencia'),
                ],
            },
        ]);
        assert.equal(dias[0].aplicable, true);
        assert.equal(dias[0].propuesta?.cambios.length, 2);
        assert.equal(dias[1].aplicable, false);
        assert.match(dias[1].motivo, /licencia/);
        const texto = textoRango12h({
            nombre: 'MARTINEZ, Juan',
            code: 'V',
            desde: '2026-10-11',
            hasta: '2026-10-12',
            dias,
        });
        assert.match(texto, /V de MARTINEZ 11\/10→12\/10: cubrir con 12 h en los 1 días/);
        assert.match(texto, /HERRERA D12/);
        assert.match(texto, /12\/10 sin cubrir/);
    });

    it('exigeCobertura ausente sigue exigiendo; en false no hay fila de cobertura y las horas quedan', () => {
        assert.equal(slaExigeCobertura(undefined), true);
        assert.equal(slaExigeCobertura({}), true);
        assert.equal(slaExigeCobertura({ exigeCobertura: true }), true);
        assert.equal(slaExigeCobertura({ exigeCobertura: false }), false);
        const horas = horarioDoce('D12').hours + horarioDoce('N12').hours;
        assert.equal(horas, 24);
        assert.equal(slaExigeCobertura({ exigeCobertura: false }) ? 0 : horas, 24);
    });

    it('el 29/09 no propone a BARRIOS si ese día está ausente (AA)', () => {
        const p = proponerCierre12h({
            dateStr: '2026-09-29',
            positionName: 'Puesto 1',
            faltantes: ['M'],
            sla: [
                { code: 'D12', startTime: '08:00', endTime: '20:00', hours: 12 },
                { code: 'N12', startTime: '20:00', endTime: '08:00', hours: 12 },
            ],
            turnos: [
                { empId: 'araya', nombre: 'ARAYA, Santiago', dateStr: '2026-09-29', code: 'T', positionName: 'Puesto 1' },
                { empId: 'barrios', nombre: 'BARRIOS, Erick', dateStr: '2026-09-29', code: 'N', positionName: 'Puesto 1', bloqueado: true },
            ],
        });
        assert.equal(p?.cambios.some((c) => c.empId === 'barrios'), false);
        assert.match(p!.texto, /No hay quién cubra la M de Puesto 1 con 12 h: falta el turno de la noche/);
        assert.equal(p?.modo, 'uno');
        assert.deepEqual(p?.cambios.map((c) => [c.empId, c.code, c.startTime, c.endTime]), [
            ['araya', 'D12', '08:00', '20:00'],
        ]);
        assert.equal(horarioDoce('D12', [{ code: 'D12', startTime: '08:00', endTime: '20:00' }]).startTime, '08:00');
        assert.equal(horarioDoce('N12', [{ code: 'N12', startTime: '20:00', endTime: '08:00' }]).startTime, '20:00');
    });

    it('con un solo lado propone ese guardia', () => {
        const p = proponerCierre12h({
            dateStr: '2026-10-01',
            positionName: 'Puesto 1',
            faltantes: ['T'],
            turnos: [
                { empId: 'herr', nombre: 'HERRANTE', dateStr: '2026-10-01', code: 'M', positionName: 'Puesto 1' },
            ],
        });
        assert.equal(p?.modo, 'uno');
        assert.equal(p?.cambios.length, 1);
        assert.equal(p?.cambios[0].code, 'D12');
    });

    it('− vuelve D12 a M y N12 a N', () => {
        assert.equal(volverA8('D12')?.code, 'M');
        assert.equal(volverA8('N12')?.code, 'N');
        assert.equal(volverA8('M'), null);
    });
});
