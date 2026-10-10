/**
 * Leyenda compacta debajo de la grilla, solo en modo rápido.
 */
export type ChipLeyenda = { code: string; horario: string; horas: number; detalle?: string };

export type GrupoLeyenda = { titulo: string; chips: ChipLeyenda[] };

export type TurnoLeyenda = { code: string; startTime?: string; endTime?: string; hours?: number; name?: string };

const OTROS = [
  { code: 'F', horario: 'Franco', horas: 0 },
  { code: 'RET', horario: 'Retén', horas: 0 },
  { code: 'REF', horario: 'Refuerzo', horas: 8 },
  { code: 'ESC', horario: 'Escuela', horas: 8 },
  { code: 'FT', horario: 'Franco trabajado', horas: 8 },
];

const LICENCIAS = new Set(['V', 'E', 'A', 'L', 'AA', 'PG', 'ART', 'SGS', 'SUS', 'LT']);

function hm(a?: string, b?: string): string {
  const corto = (v?: string) => String(v || '').slice(0, 5);
  if (!a || !b) return '';
  return `${corto(a)}–${corto(b)}`;
}

export function armarLeyenda(
  puestos: readonly { name: string; shifts: readonly TurnoLeyenda[] }[],
  usados: ReadonlySet<string>,
): GrupoLeyenda[] {
  const grupos: GrupoLeyenda[] = [];
  const propios = new Set<string>();
  for (const p of puestos) {
    const chips: ChipLeyenda[] = p.shifts
      .filter((s) => s.code)
      .map((s) => {
        propios.add(s.code.toUpperCase());
        return {
          code: s.code.toUpperCase(),
          horario: hm(s.startTime, s.endTime),
          horas: Number(s.hours) || 0,
          detalle: s.name && s.name.toUpperCase() !== s.code.toUpperCase() ? s.name : undefined,
        };
      });
    if (chips.length) grupos.push({ titulo: p.name, chips });
  }
  grupos.push({
    titulo: 'Otros',
    chips: OTROS.filter((o) => !propios.has(o.code)).map((o) => ({ code: o.code, horario: o.horario, horas: o.horas })),
  });
  const lic = [...usados].map((c) => c.toUpperCase()).filter((c) => LICENCIAS.has(c) && !propios.has(c));
  if (lic.length) grupos.push({ titulo: 'Licencias de este mes', chips: lic.map((code) => ({ code, horario: '', horas: 0 })) });
  return grupos.filter((g) => g.chips.length);
}

export function lineaLeyenda(g: GrupoLeyenda): string {
  const chips = g.chips.map((c) => [c.code, c.detalle, c.horario].filter(Boolean).join(' ')).join(' · ');
  return `${g.titulo} · ${chips}`;
}
