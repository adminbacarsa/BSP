import {
  Bot, Briefcase, CalendarDays, ChevronRight, Eye, LayoutGrid, LogOut, Monitor, Radio, UserPlus, Users,
  type LucideIcon,
} from 'lucide-react';
import type { MovilModulo } from '@/lib/movil/modulos';
import { MENU_FILA_PX, MENU_TILE_PX, altoMenuPx } from '@/lib/movil/empresaSelector';
import { movilFechaCorta } from '@/lib/movil/fechaCorta';
import { MOVIL_BORDER, MOVIL_CARD, MOVIL_FONT, MOVIL_PRIMARY_TEXT, MovilTopBar } from './ui';

/** Ícono de cada módulo (trazo fino, gris oscuro, sin cuadro). */
const MODULO_ICON: Record<string, LucideIcon> = {
  operacion: Radio,
  supervision: Eye,
  planificacion: CalendarDays,
  eventuales: UserPlus,
  rrhh: Users,
  servicios: Briefcase,
};

function moduloIcon(id: string): LucideIcon {
  return MODULO_ICON[id] || LayoutGrid;
}

/** Fila de acción del menú (44 px): ícono, texto y chevron. */
function MenuRow({ icon: Icon, label, onClick, attrs }: { icon: LucideIcon; label: string; onClick: () => void; attrs?: Record<string, string | undefined> }) {
  return (
    <button type="button" onClick={onClick} {...attrs} className="flex h-11 w-full items-center gap-3 px-3 text-left active:bg-slate-50" data-movil-fila={MENU_FILA_PX}>
      <Icon size={18} strokeWidth={1.75} className="shrink-0 text-slate-700" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-900">{label}</span>
      <ChevronRight size={16} strokeWidth={1.75} className="shrink-0 text-slate-400" aria-hidden="true" />
    </button>
  );
}

/** Tile compacto (64 px): ícono, nombre, subtítulo en una línea y alertas a la derecha. */
function ModuloTile({ modulo, alertas, onClick }: { modulo: MovilModulo; alertas: number; onClick: () => void }) {
  const Icon = moduloIcon(modulo.id);
  return (
    <button
      type="button"
      onClick={onClick}
      data-movil-module={modulo.id}
      data-movil-tile={MENU_TILE_PX}
      className={`flex h-16 items-center gap-2.5 ${MOVIL_CARD} px-3 text-left active:bg-slate-50`}
    >
      <Icon size={20} strokeWidth={1.75} className="shrink-0 text-slate-700" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight text-slate-900">{modulo.label}</span>
        <span className="block truncate text-[11px] leading-tight text-slate-500">{modulo.mobile === false ? 'En la computadora' : modulo.desc}</span>
      </span>
      {alertas > 0 && (
        <span data-movil-alertas={alertas} className={`shrink-0 text-[13px] font-semibold tabular-nums ${MOVIL_PRIMARY_TEXT}`}>{alertas}</span>
      )}
    </button>
  );
}

/**
 * Selector de módulos (`/admin/movil/`), estilo minimalista: barra oscura con la píldora de
 * empresa (abre la hoja de cambio), fecha en una línea gris, tiles compactos en 2 columnas y
 * las filas asistente / escritorio / salir. Seis módulos + asistente entran en 390x844 sin scroll.
 * Con un solo módulo permitido no hay grilla: «Volver a X», asistente y salir.
 */
export function MovilMenuScreens(props: {
  empresaName: string;
  modulos: MovilModulo[];
  unico: MovilModulo | null;
  /** Alertas pendientes por módulo (`modulo.id` → cantidad). */
  alertas?: Partial<Record<string, number>>;
  /** Instante de referencia (tests). Default `Date.now()`. */
  now?: number;
  onEmpresa?: () => void;
  onModulo: (modulo: MovilModulo) => void;
  onAsistente: () => void;
  onEscritorio: () => void;
  onLogout: () => void;
}) {
  const nowMs = props.now ?? Date.now();
  const alertasDe = (id: string): number => props.alertas?.[id] ?? 0;
  return (
    <div data-movil-screen="menu" data-viewport="390x844" data-movil-alto={altoMenuPx(props.modulos.length)} className={`mx-auto flex min-h-[844px] w-full max-w-[480px] flex-col touch-manipulation overflow-x-hidden bg-[#f7f8fa] pb-8 ${MOVIL_FONT}`}>
      <MovilTopBar modulo="Menú" empresa={props.empresaName} onEmpresa={props.onEmpresa} />
      <div className="flex flex-col gap-3 px-3 pt-1">
        <p className="h-5 text-[11px] font-medium leading-5 text-slate-400" data-movil-fecha="1">{movilFechaCorta(nowMs)}</p>

        {props.unico ? (
          <ModuloTile modulo={{ ...props.unico, label: `Volver a ${props.unico.label}` }} alertas={alertasDe(props.unico.id)} onClick={() => props.onModulo(props.unico as MovilModulo)} />
        ) : (
          <section className="grid grid-cols-2 gap-2" data-movil-tiles={props.modulos.length}>
            {props.modulos.map((modulo) => (
              <ModuloTile key={modulo.id} modulo={modulo} alertas={alertasDe(modulo.id)} onClick={() => props.onModulo(modulo)} />
            ))}
            {props.modulos.length === 0 && (
              <p className={`col-span-2 ${MOVIL_CARD} p-4 text-sm font-medium text-slate-500`}>Tu rol no tiene módulos para el celular.</p>
            )}
          </section>
        )}

        <div className={`divide-y divide-slate-100 overflow-hidden rounded-lg border ${MOVIL_BORDER} bg-white`}>
          <MenuRow icon={Bot} label="Asistente" onClick={props.onAsistente} />
          <MenuRow icon={Monitor} label="Ver como escritorio" onClick={props.onEscritorio} />
          <MenuRow icon={LogOut} label="Cerrar sesión" onClick={props.onLogout} />
        </div>
      </div>
    </div>
  );
}
