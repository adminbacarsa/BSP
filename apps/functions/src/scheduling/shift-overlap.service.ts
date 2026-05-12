import { Injectable } from '@nestjs/common';

/**
 * @class ShiftOverlapService
 * @description Servicio que encapsula la lógica pura (matemática) para determinar
 * si dos rangos de tiempo se cruzan. Cumple con SRP (SOLID).
 */
@Injectable()
export class ShiftOverlapService {

  /**
   * @function isOverlap
   * @description Verifica si un nuevo rango de tiempo se superpone con un rango existente.
   * La fórmula evita solapamiento si los turnos son adyacentes (ej: uno termina a las 14:00 y el otro empieza a las 14:00).
   * @param {Date} existingStart - Inicio del turno ya registrado.
   * @param {Date} existingEnd - Fin del turno ya registrado.
   * @param {Date} newStart - Inicio del nuevo turno.
   * @param {Date} newEnd - Fin del nuevo turno.
   * @returns {boolean} True si hay solapamiento.
   */
  public isOverlap(existingStart: Date, existingEnd: Date, newStart: Date, newEnd: Date): boolean {
    // Si el nuevo empieza antes de que el existente termine Y el nuevo termina despues de que el existente empiece, SÍ hay solapamiento.
    return (
      newStart.getTime() < existingEnd.getTime() && 
      newEnd.getTime() > existingStart.getTime()
    );
  }
}



