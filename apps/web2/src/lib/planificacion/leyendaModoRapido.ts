/**
 * Leyenda compacta debajo de la grilla, solo en modo rápido.
 */
export type ChipLeyenda = { code: string; horario: string; horas: number; detalle?: string };

export type GrupoLeyenda = { titulo: string; chips: ChipLeyenda[] };

export type TurnoLeyenda = {
  code: string;
  startTime?: string;
  endTime?: string;
  hours?: number;
  name?: string;
  blocks?: Array<{ startTime?: string; endTime?: string }>;
};

const OTROS = [
  { code: 'F', horario: 'Franco', horas: 0 },
  { code: 'RET', horario: 'Retén', horas: 0 },
  { code: 'ESC', horario: 'Escuela', horas: 8 },
  { code: 'FT', horario: 'Franco trabajado', horas: 8 },
];

const LICENCIAS = new Set(['V', 'E', 'A', 'L', 'AA', 'PG', 'ART', 'SGS', 'SUS', 'LT']);

function hm(a?: string, b?: string): string {
  const corto = (v?: string) => String(v || '').slice(0, 5);
  if (!a || !b) return '';
  return `${corto(a)}–${corto(b)}`;
}

function horarioLeyenda(s: TurnoLeyenda): string {
  const blocks = s.blocks;
  if (Array.isArray(blocks) && blocks.length >= 2) {
    const partes = blocks.map((b) => hm(b.startTime, b.endTime)).filter(Boolean);
    if (partes.length >= 2) return partes.join(' + ');
  }
  return hm(s.startTime, s.endTime);
}

/**
 * El turno es de alguno de los objetivos que se están viendo. El mapa de turnos del mes trae
 * a toda la empresa: sin este filtro la leyenda mostraba extensiones de otros cronogramas.
 * Un turno sin `objectiveId` (recién cargado en la grilla) cuenta como de la vista actual.
 */
export function turnoDeObjetivos(
  sh: { objectiveId?: string | null } | null | undefined,
  objetivos: ReadonlySet<string>,
): boolean {
  const obj = String(sh?.objectiveId || '').trim();
  return !obj || objetivos.has(obj);
}

/** Pares de extensión del mismo objetivo (ej. EM+EM2). No incluye +EM2 de otro objetivo. */
export function textoSumasExt(sumas: readonly string[]): string {
  return [...new Set(sumas.map((s) => s.toUpperCase()).filter(Boolean))].sort().join(' · ');
}

export function armarLeyenda(
  puestos: readonly { name: string; shifts: readonly TurnoLeyenda[] }[],
  usados: ReadonlySet<string>,
  sumas: readonly string[] = [],
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
          horario: horarioLeyenda(s),
          horas: Number(s.hours) || 0,
          detalle: s.name && s.name.toUpperCase() !== s.code.toUpperCase() ? s.name : undefined,
        };
      });
    if (chips.length) grupos.push({ titulo: p.name, chips });
  }
  const otros: ChipLeyenda[] = OTROS.filter((o) => !propios.has(o.code)).map((o) => ({ code: o.code, horario: o.horario, horas: o.horas }));
  const suma = textoSumasExt(sumas);
  if (suma) otros.push({ code: 'EXT', horario: suma, horas: 0, detalle: 'Extensión del mismo objetivo' });
  grupos.push({ titulo: 'Otros', chips: otros });
  const lic = [...usados].map((c) => c.toUpperCase()).filter((c) => LICENCIAS.has(c) && !propios.has(c));
  if (lic.length) grupos.push({ titulo: 'Licencias de este mes', chips: lic.map((code) => ({ code, horario: '', horas: 0 })) });
  return grupos.filter((g) => g.chips.length);
}

export function lineaLeyenda(g: GrupoLeyenda): string {
  const chips = g.chips.map((c) => [c.code, c.detalle, c.horario].filter(Boolean).join(' ')).join(' · ');
  return `${g.titulo} · ${chips}`;
}
