import { createContext, useContext } from 'react';

export type PuntajeDetalle = {
  tipo: string;
  componente: string;
  delta: number;
  etiqueta: string;
  fechaMs?: number;
};

export type PuntajeFila = {
  total: number;
  cumplimiento: number;
  disposicion: number;
  detalle: PuntajeDetalle[];
};

export type GuardiaPuntajeCtx = {
  totalDe: (id?: string | null) => number | null;
  filaDe: (id?: string | null) => PuntajeFila | null;
};

export const puntajeVacio: GuardiaPuntajeCtx = { totalDe: () => null, filaDe: () => null };

export const GuardiaPuntajeReactContext = createContext<GuardiaPuntajeCtx>(puntajeVacio);

export function useGuardiaPuntaje(): GuardiaPuntajeCtx {
  return useContext(GuardiaPuntajeReactContext);
}

export function usePuntaje(sujetoId?: string | null): PuntajeFila | null {
  return useGuardiaPuntaje().filaDe(sujetoId);
}
