// D5: Unit Test que verifica la REGRA DE NEGOCIO más importante.
import { ShiftOverlapService } from '../../src/scheduling/shift-overlap.service';

describe('ShiftOverlapService (Core Logic D5)', () => {
  let service: ShiftOverlapService;

  beforeEach(() => {
    service = new ShiftOverlapService();
  });

  // Turno base (existente): De 10:00 a 14:00 (4 horas)
  const T_START = new Date('2025-11-20T10:00:00.000Z');
  const T_END = new Date('2025-11-20T14:00:00.000Z');

  // =========================================================
  // ESCENARIO 2.2: PRUEBA DE SOLAPAMIENTO (DEBE FALLAR)
  // =========================================================
  it('should return TRUE if the new shift overlaps with the existing shift (Escenario 2.2)', () => {
    // Turno B: 11:00 AM a 01:00 PM (Completamente dentro)
    const newStart = new Date('2025-11-20T11:00:00.000Z');
    const newEnd = new Date('2025-11-20T13:00:00.000Z');
    
    // Si esta prueba pasa (TRUE), la Transacción Atómica ABORTARÁ.
    expect(service.isOverlap(T_START, T_END, newStart, newEnd)).toBe(true);
  });

  // Turno que se superpone parcialmente (Escenario 2.2a)
  it('should return TRUE if the new shift starts inside and ends outside', () => {
    // Nuevo turno: 12:00 a 16:00
    const newStart = new Date('2025-11-20T12:00:00.000Z');
    const newEnd = new Date('2025-11-20T16:00:00.000Z');
    expect(service.isOverlap(T_START, T_END, newStart, newEnd)).toBe(true);
  });


  // =========================================================
  // ESCENARIO 2.3: PRUEBA DE ADYACENCIA (DEBE PASAR)
  // =========================================================
  it('should return FALSE if the new shift is adjacent (starts exactly when the other ends - Escenario 2.3)', () => {
    // Turno C: 14:00 PM a 18:00 PM (Empieza justo donde termina A)
    const newStart = new Date('2025-11-20T14:00:00.000Z');
    const newEnd = new Date('2025-11-20T18:00:00.000Z');
    
    // Si esta prueba pasa (FALSE), la Transacción Atómica CONTINUARÁ.
    expect(service.isOverlap(T_START, T_END, newStart, newEnd)).toBe(false);
  });

  it('should return FALSE if the new shift ends exactly when the other starts (Adyacente inverso)', () => {
    // Nuevo turno: 06:00 a 10:00
    const newStart = new Date('2025-11-20T06:00:00.000Z');
    const newEnd = new Date('2025-11-20T10:00:00.000Z');
    expect(service.isOverlap(T_START, T_END, newStart, newEnd)).toBe(false);
  });

  it('should return FALSE if the new shift is completely outside the range', () => {
    // Nuevo turno: 07:00 a 09:00
    const newStart = new Date('2025-11-20T07:00:00.000Z');
    const newEnd = new Date('2025-11-20T09:00:00.000Z');
    expect(service.isOverlap(T_START, T_END, newStart, newEnd)).toBe(false);
  });
});



