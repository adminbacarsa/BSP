import { describe, expect, it } from 'vitest';
import {
  getOpsCapabilities,
  pickCanonicalPilotSession,
  resolveOpsMode,
} from './opsMode';

describe('resolveOpsMode (sala empresa)', () => {
  it('Demo gana sobre Manual', () => {
    expect(resolveOpsMode({ modoDemoEnabled: true, hasRoomManual: true })).toBe('DEMO');
  });

  it('Manual si hay alguien en sala, aunque yo no', () => {
    expect(resolveOpsMode({ modoDemoEnabled: false, hasRoomManual: true })).toBe('MANUAL');
  });

  it('Auto si la sala está vacía', () => {
    expect(resolveOpsMode({ modoDemoEnabled: false, hasRoomManual: false })).toBe('AUTO');
  });
});

describe('getOpsCapabilities', () => {
  it('fullAuto solo en Demo/Auto; copiloto no corre pipeline', () => {
    expect(getOpsCapabilities('AUTO', true).fullAuto).toBe(true);
    expect(getOpsCapabilities('MANUAL', true, { isPilot: true, inRoom: true }).fullAuto).toBe(false);
    expect(getOpsCapabilities('MANUAL', true, { isPilot: true, inRoom: true }).pipelineRoutine).toBe(true);
    expect(getOpsCapabilities('MANUAL', true, { isPilot: false, inRoom: true }).pipelineRoutine).toBe(false);
  });
});

describe('pickCanonicalPilotSession', () => {
  it('elige la sesión más antigua', () => {
    const a = { id: 'b', startTime: new Date('2026-09-16T12:00:00') };
    const b = { id: 'a', startTime: new Date('2026-09-16T11:00:00') };
    expect(pickCanonicalPilotSession([a, b])?.id).toBe('a');
  });
});
