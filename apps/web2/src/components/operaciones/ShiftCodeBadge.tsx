import { opsShiftCodeBadge, type ShiftCodeBadgeTone } from '@cosp/ops-core';

const TONE_CLASS: Record<ShiftCodeBadgeTone, string> = {
  base: 'bg-indigo-600 text-white',
  extra: 'bg-amber-500 text-white',
  coverage: 'bg-violet-600 text-white',
  rest: 'bg-blue-600 text-white',
  license: 'bg-slate-500 text-white',
  other: 'bg-slate-700 text-white',
};

/** Código de turno (M/T/N/ESC/REF/…) junto al nombre o al puesto. */
export function ShiftCodeBadge({ shift, className = '' }: { shift: Record<string, unknown> | null | undefined; className?: string }) {
  const badge = opsShiftCodeBadge(shift);
  if (!badge) return null;
  return (
    <span
      title={badge.title}
      className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${TONE_CLASS[badge.tone]} ${className}`}
    >
      {badge.code}
    </span>
  );
}
