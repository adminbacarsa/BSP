import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    confirmarFtPideBanda,
    esCeldaFranco,
    etiquetaFt,
    opcionesBandaFt,
    payloadConsultaFt,
    resolverEscrituraFt,
} from './francoTrabajadoRapido';

const sla = [
    { code: 'M', startTime: '06:00', endTime: '14:00', hours: 8, name: 'Mañana' },
    { code: 'T', startTime: '14:00', endTime: '22:00', hours: 8, name: 'Tarde' },
    { code: 'N', startTime: '22:00', endTime: '06:00', hours: 8, name: 'Noche' },
    { code: 'D12', startTime: '06:00', endTime: '18:00', hours: 12, name: 'Diurno 12h' },
];
const franco = { code: 'F', isFranco: true };

describe('franco trabajado en modo rápido', () => {
    it('F + banda escribe FT con las horas de esa banda', () => {
        const r = resolverEscrituraFt({ texto: 'M', celda: franco, bandas: sla, puede: true });
        assert.equal(r.accion, 'ft');
        if (r.accion !== 'ft') return;
        assert.equal(r.code, 'M');
        assert.equal(r.hours, 8);
        assert.equal(r.startTime, '06:00');
        assert.equal(r.endTime, '14:00');
        assert.equal(etiquetaFt(r.code), 'FT·M');
    });

    it('«FT» pide la banda y no confirma solo', () => {
        assert.equal(confirmarFtPideBanda('FT', -1), true);
        assert.equal(confirmarFtPideBanda('FT', 0), false);
        const r = resolverEscrituraFt({ texto: 'FT', celda: franco, bandas: sla, puede: true });
        assert.equal(r.accion, 'pedir_banda');
        const ops = opcionesBandaFt(sla);
        assert.ok(ops.some((o) => o.code === 'FT·M' && o.horario === '06:00–14:00'));
        assert.ok(ops.some((o) => o.code === 'FT·T'));
        assert.ok(ops.some((o) => o.code === 'FT·N'));
    });

    it('elegir FT·T escribe la tarde con horas', () => {
        const r = resolverEscrituraFt({ texto: 'FT·T', celda: franco, bandas: sla, puede: true });
        assert.equal(r.accion, 'ft');
        if (r.accion !== 'ft') return;
        assert.equal(r.code, 'T');
        assert.equal(r.hours, 8);
        assert.equal(r.startTime, '14:00');
    });

    it('D12 sobre el franco lleva 12 h', () => {
        const r = resolverEscrituraFt({ texto: 'D12', celda: { code: 'FF' }, bandas: sla, puede: true });
        assert.equal(r.accion, 'ft');
        if (r.accion !== 'ft') return;
        assert.equal(r.hours, 12);
    });

    it('sin permiso no escribe', () => {
        const r = resolverEscrituraFt({ texto: 'M', celda: franco, bandas: sla, puede: false });
        assert.equal(r.accion, 'sin_permiso');
    });

    it('FT sobre una celda que no es franco no escribe', () => {
        assert.equal(esCeldaFranco({ code: 'M' }), false);
        assert.equal(esCeldaFranco({ code: 'F', isFrancoTrabajado: true }), false);
        const r = resolverEscrituraFt({ texto: 'FT·M', celda: { code: 'M' }, bandas: sla, puede: true });
        assert.equal(r.accion, 'no_franco');
    });

    it('el clic derecho arma la consulta de FT y no un turno', () => {
        const payload = payloadConsultaFt({
            empresaId: 'bacarsa',
            objectiveId: 'obj',
            clientId: 'cli',
            objectiveName: 'Obrador',
            positionName: 'Puesto 1',
            jornada: { fecha: '2026-10-02', horaInicio: '06:00', horaFin: '14:00', horas: 8, code: 'M', name: 'Mañana' },
            franco: { employeeId: 'g1', nombre: 'PERALTA, Jeremías' },
            cubreEmployeeId: 'g2',
            cubreNombre: 'REGALO, Juan',
        });
        assert.equal(payload.lugares, 1);
        assert.deepEqual(payload.guardias, [{ employeeId: 'g1', tipo: 'FT', nombre: 'PERALTA, Jeremías' }]);
        assert.equal(payload.titularEmployeeId, 'g2');
        assert.equal('turnos' in payload, false);
        assert.equal('code' in payload, false);
    });
});
