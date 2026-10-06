/**
 * Contenido de una tarjeta de Agenda: misma jerarquía que Hoy
 * (fecha y horario, evento o puesto, lugar una vez, nota) y el estado en el chip.
 * Sin «Cómo llegar»: eso queda solo en la tarjeta principal de Hoy.
 */
import type { ShiftPlacement } from './shiftPlacement';
import { buildHeroShiftCardModel, type HeroEvDisplay } from './heroShiftCard';

export type AgendaEstadoChip = 'Trabajado' | 'Ausente' | 'Próximo' | 'Retenido' | 'Franco';

export type AgendaShiftView = {
  cuando: string | null;
  whereTitle: string | null;
  wherePlace: string | null;
  note: string | null;
  estado: AgendaEstadoChip;
  /** Los ya trabajados y las ausencias no ofrecen botones. */
  permiteAcciones: boolean;
};

function clean(v: unknown): string {
  return String(v ?? '').trim();
}

function included(hay: string | null, needle: string): boolean {
  const n = needle.toLocaleLowerCase('es-AR');
  return !!hay && hay.toLocaleLowerCase('es-AR').includes(n);
}

export function buildAgendaShiftView(input: {
  cuando: string | null;
  placement: ShiftPlacement;
  ev?: HeroEvDisplay | null;
  isFranco?: boolean;
  isAbsent?: boolean;
  isRetention?: boolean;
  isWorked?: boolean;
  isFt?: boolean;
}): AgendaShiftView {
  const isFranco = !!input.isFranco && !input.isFt && !input.isAbsent;
  const model = buildHeroShiftCardModel({
    sectionBase: 'Turno',
    isToday: false,
    timeRange: input.cuando,
    placement: input.placement,
    ev: input.ev,
    isFranco,
    isAbsent: !!input.isAbsent,
    isRetention: !!input.isRetention && !input.isAbsent,
  });

  let note = model.note;
  if (!note && input.ev) {
    const pos = clean(input.placement.position);
    if (pos && pos !== 'Puesto no indicado' && !included(model.whereTitle, pos) && !included(model.wherePlace, pos)) {
      note = pos;
    }
  }

  const estado: AgendaEstadoChip = input.isAbsent
    ? 'Ausente'
    : input.isRetention
      ? 'Retenido'
      : isFranco
        ? 'Franco'
        : input.isWorked
          ? 'Trabajado'
          : 'Próximo';

  return {
    cuando: input.cuando,
    whereTitle: model.whereTitle,
    wherePlace: model.wherePlace,
    note,
    estado,
    permiteAcciones: !input.isWorked && !input.isAbsent,
  };
}
