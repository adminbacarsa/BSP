import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countPositionClosedUnitsFromShifts } from './positionCoverageUnits';

/** Guardia 24 h, 2 PAX: M/T/N 8 h y D12/N12 12 h. Meta 48 h (dos unidades). */
const guardia = {
    positionName: 'Guardia',
    qty: 2,
    coverageType: '24hs',
    shifts: [
        { code: 'M', hours: 8, startTime: '07:00', endTime: '15:00' },
        { code: 'T', hours: 8, startTime: '15:00', endTime: '23:00' },
        { code: 'N', hours: 8, startTime: '23:00', endTime: '07:00' },
        { code: 'D12', hours: 12, startTime: '07:00', endTime: '19:00' },
        { code: 'N12', hours: 12, startTime: '19:00', endTime: '07:00' },
    ],
};

describe('unidades de 24 h sin reutilizar el par', () => {
    it('Casino Mina Clavero 1/10: D12+N12 más M y N sueltos es 1/2, no 2/2', () => {
        // LOPEZ D12 07–19, REARTE N12 19–07, MOYANO N 23–07, PEDERNERA M 07–15.
        // 40 h de 48. La tarde 15–23 queda en una sola persona (15–19 solo el D12).
        const u = countPositionClosedUnitsFromShifts(
            guardia,
            'J',
            { D12: 1, N12: 1, N: 1, M: 1 },
            undefined,
            true,
            '2026-10-01',
        );
        assert.equal(u.required, 2);
        assert.equal(u.closed, 1);
        assert.match(u.schemeLabel, /M\+T\+N/);
        assert.match(u.schemeLabel, /D12\+N12/);
    });

    it('un solo par D12+N12 con PAX 2 no cierra la segunda unidad', () => {
        const u = countPositionClosedUnitsFromShifts(guardia, 'J', { D12: 1, N12: 1 });
        assert.equal(u.closed, 1);
        assert.equal(u.required, 2);
    });

    it('M+T+N y D12+N12 juntos cierran las dos unidades', () => {
        const u = countPositionClosedUnitsFromShifts(
            guardia,
            'J',
            { M: 1, T: 1, N: 1, D12: 1, N12: 1 },
        );
        assert.equal(u.closed, 2);
        assert.equal(u.required, 2);
    });

    it('dos juegos M+T+N cierran 2/2', () => {
        const u = countPositionClosedUnitsFromShifts(guardia, 'J', { M: 2, T: 2, N: 2 });
        assert.equal(u.closed, 2);
        assert.equal(u.required, 2);
    });
});
