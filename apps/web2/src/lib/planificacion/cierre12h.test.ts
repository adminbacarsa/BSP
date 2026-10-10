import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzePositionDayGap } from './coverageGapAnalysis';
import { countPositionClosedUnitsFromShifts } from './positionCoverageUnits';
import { proponerCierre12h, volverA8 } from './cierre12h';

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

    it('si falta la M, el T del día y la N del día anterior cubren 12 + 12', () => {
        const falta = faltantes({ T: 1, N: 1 });
        assert.ok(falta.includes('M'));
        const p = proponerCierre12h({
            dateStr: '2026-10-02',
            positionName: 'Puesto 1',
            faltantes: ['M'],
            turnos: [
                { empId: 'diaz', nombre: 'DIAZ', dateStr: '2026-10-01', code: 'N', positionName: 'Puesto 1' },
                { empId: 'herr', nombre: 'HERRANTE', dateStr: '2026-10-02', code: 'T', positionName: 'Puesto 1' },
            ],
        });
        assert.equal(p?.modo, 'par');
        assert.equal(p?.cambios.find((c) => c.empId === 'herr')?.code, 'D12');
        assert.equal(p?.cambios.find((c) => c.empId === 'diaz')?.code, 'N12');
        assert.equal(p?.cambios.find((c) => c.empId === 'diaz')?.dateStr, '2026-10-01');
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
