import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyTurnoFindings,
  integrityNovedadDescription,
  integrityReportId,
  scanLoadedEmpresa,
  slaClientIsMissing,
} from './integrityClassify';

const clients = new Map([
  ['cli-ok', { empresaId: 'bacarsa', exists: true }],
  ['cli-otra', { empresaId: 'pruebas_sa', exists: true }],
]);
const objectives = new Set(['obj-1']);

describe('cron de integridad (solo reporte)', () => {
  it('clasifica cliente inexistente, objetivo inexistente y empresa distinta', () => {
    assert.deepEqual(
      classifyTurnoFindings(
        { empresaId: 'bacarsa', clientId: 'cli-borrado', objectiveId: 'obj-1' },
        clients,
        objectives,
      ),
      ['turnoClienteInexistente'],
    );
    assert.deepEqual(
      classifyTurnoFindings(
        { empresaId: 'bacarsa', clientId: 'cli-ok', objectiveId: 'obj-fantasma' },
        clients,
        objectives,
      ),
      ['turnoObjetivoInexistente'],
    );
    assert.deepEqual(
      classifyTurnoFindings(
        { empresaId: 'bacarsa', clientId: 'cli-otra', objectiveId: 'obj-1' },
        clients,
        objectives,
      ),
      ['turnoEmpresaDistinta'],
    );
  });

  it('arma el reporte y no corrige los documentos de entrada', () => {
    const turnos = [
      { id: 't1', empresaId: 'bacarsa', clientId: 'cli-borrado', objectiveId: 'obj-1' },
      { id: 't2', empresaId: 'bacarsa', clientId: 'cli-ok', objectiveId: 'obj-1' },
    ];
    const before = JSON.stringify(turnos);
    const report = scanLoadedEmpresa({
      empresaId: 'bacarsa',
      date: '2026-09-28',
      windowStart: '2026-07-01T00:00:00.000Z',
      windowEnd: '2026-09-30T23:59:59.999Z',
      generatedAt: '2026-09-28T06:30:00.000Z',
      turnos,
      slas: [{ id: 'sla-1', clientId: 'cli-muerto' }],
      clientsById: clients,
      objectiveIds: objectives,
    });
    assert.equal(JSON.stringify(turnos), before);
    assert.equal(report.mode, 'report_only');
    assert.equal(integrityReportId('bacarsa', '2026-09-28'), 'bacarsa_2026-09-28');
    assert.equal(report.counts.turnoClienteInexistente, 1);
    assert.equal(report.counts.turnoObjetivoInexistente, 0);
    assert.equal(report.counts.slaClienteInexistente, 1);
    assert.equal(report.totalFindings, 2);
    assert.equal(slaClientIsMissing('cli-ok', clients), false);
    assert.match(integrityNovedadDescription('bacarsa_2026-09-28', report.counts), /Solo informe/);
  });

  it('sin hallazgos el total es 0 (no corresponde novedad)', () => {
    const report = scanLoadedEmpresa({
      empresaId: 'bacarsa',
      date: '2026-09-28',
      windowStart: '2026-07-01T00:00:00.000Z',
      windowEnd: '2026-09-30T23:59:59.999Z',
      generatedAt: '2026-09-28T06:30:00.000Z',
      turnos: [{ id: 't2', empresaId: 'bacarsa', clientId: 'cli-ok', objectiveId: 'obj-1' }],
      slas: [{ id: 'sla-ok', clientId: 'cli-ok' }],
      clientsById: clients,
      objectiveIds: objectives,
    });
    assert.equal(report.totalFindings, 0);
  });
});
