import {
  Bot, Briefcase, CalendarDays, ChevronRight, Eye, LayoutGrid, LogOut, Monitor, Radio, UserPlus, Users,
  type LucideIcon,
} from 'lucide-react';
import type { MovilModulo } from '@/lib/movil/modulos';
import { MENU_FILA_PX, MENU_TILE_MAX_PX, MENU_TILE_MIN_PX, altoMenuPx, estadoModulo, tileAltoCss, type MenuDatos, type MenuTono } from '@/lib/movil/menuLayout';
import { movilFechaCorta } from '@/lib/movil/fechaCorta';
import { MOVIL_BORDER, MOVIL_CARD, MOVIL_FONT, MovilTopBar } from './ui';

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

const TONO_CLASS: Record<MenuTono, string> = {
  gris: 'text-slate-500',
  ambar: 'text-amber-700',
  rojo: 'text-rose-700',
};

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

/**
 * Tile que ocupa su parte de la pantalla: ícono fino arriba (24), nombre grande, subtítulo
 * completo en 1–2 líneas y, abajo, la línea de estado con dato real (gris; rojo/ámbar si urge).
 */
function ModuloTile({ modulo, datos, altoCss, onClick }: { modulo: MovilModulo; datos?: MenuDatos | null; altoCss: string; onClick: () => void }) {
  const Icon = moduloIcon(modulo.id);
  const estado = modulo.mobile === false ? null : estadoModulo(modulo.id, datos);
  return (
    <button
      type="button"
      onClick={onClick}
      data-movil-module={modulo.id}
      data-movil-tile="flex"
      data-movil-tile-min={MENU_TILE_MIN_PX}
      data-movil-tile-max={MENU_TILE_MAX_PX}
      style={{ height: altoCss }}
      className={`flex flex-col ${MOVIL_CARD} overflow-hidden px-3 py-3 text-left active:bg-slate-50`}
    >
      <Icon size={24} strokeWidth={1.5} className="shrink-0 text-slate-700" aria-hidden="true" />
      <span className="mt-1.5 block text-[17px] font-semibold leading-tight text-slate-900">{modulo.label}</span>
      <span className="mt-0.5 block text-[12px] leading-snug text-slate-500" data-movil-desc="1">{modulo.mobile === false ? 'Disponible en la computadora' : modulo.desc}</span>
      {estado && (
        <span data-movil-estado={estado.tono} className={`mt-auto block truncate pt-1 text-[11px] font-medium tabular-nums ${TONO_CLASS[estado.tono]}`}>{estado.texto}</span>
      )}
    </button>
  );
}

/**
 * Selector de módulos (`/admin/movil/`), estilo minimalista: barra oscura con la píldora de
 * empresa (abre la hoja de cambio), fecha en una línea gris, grilla 2 columnas que reparte el
 * alto disponible (tile 96–150 px) y las filas asistente / escritorio / salir. Seis módulos entran
 * en 390x844 sin scroll; en pantallas más bajas la página scrollea sin cortar nada.
 * Con un solo módulo permitido no hay grilla: «Volver a X», asistente y salir.
 */
export function MovilMenuScreens(props: {
  empresaName: string;
  modulos: MovilModulo[];
  unico: MovilModulo | null;
  /** Alertas pendientes por módulo (`modulo.id` → cantidad). Entra en la línea de estado. */
  alertas?: Partial<Record<string, number>>;
  /** Datos reales por módulo para la línea de estado (activos, huecos, ausencias, ARCA…). */
  datos?: Partial<Record<string, MenuDatos>>;
  /** Instante de referencia (tests). Default `Date.now()`. */
  now?: number;
  onEmpresa?: () => void;
  onModulo: (modulo: MovilModulo) => void;
  onAsistente: () => void;
  onEscritorio: () => void;
  onLogout: () => void;
}) {
  const nowMs = props.now ?? Date.now();
  const datosDe = (id: string): MenuDatos | null => {
    const base = props.datos?.[id];
    const alertas = props.alertas?.[id];
    if (!base && alertas === undefined) return null;
    return { ...(base || {}), ...(alertas !== undefined ? { alertas } : {}) };
  };
  const total = props.unico ? 1 : props.modulos.length;
  const altoCss = tileAltoCss(total);
  return (
    <div
      data-movil-screen="menu"
      data-viewport="390x844"
      data-movil-alto={altoMenuPx(total)}
      data-movil-alto-740={altoMenuPx(total, 740)}
      className={`mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col touch-manipulation overflow-x-hidden bg-[#f7f8fa] pb-8 ${MOVIL_FONT}`}
    >
      <MovilTopBar modulo="Menú" empresa={props.empresaName} onEmpresa={props.onEmpresa} />
      <div className="flex flex-1 flex-col gap-3 px-3 pt-1">
        <p className="h-5 text-[11px] font-medium leading-5 text-slate-400" data-movil-fecha="1">{movilFechaCorta(nowMs)}</p>

        {props.unico ? (
          <ModuloTile modulo={{ ...props.unico, label: `Volver a ${props.unico.label}` }} datos={datosDe(props.unico.id)} altoCss={altoCss} onClick={() => props.onModulo(props.unico as MovilModulo)} />
        ) : (
          <section className="grid grid-cols-2 gap-2" data-movil-tiles={props.modulos.length}>
            {props.modulos.map((modulo) => (
              <ModuloTile key={modulo.id} modulo={modulo} datos={datosDe(modulo.id)} altoCss={altoCss} onClick={() => props.onModulo(modulo)} />
            ))}
            {props.modulos.length === 0 && (
              <p className={`col-span-2 ${MOVIL_CARD} p-4 text-sm font-medium text-slate-500`}>Tu rol no tiene módulos para el celular.</p>
            )}
          </section>
        )}

        <div className={`mt-auto divide-y divide-slate-100 overflow-hidden rounded-lg border ${MOVIL_BORDER} bg-white`}>
          <MenuRow icon={Bot} label="Asistente" onClick={props.onAsistente} />
          <MenuRow icon={Monitor} label="Ver como escritorio" onClick={props.onEscritorio} />
          <MenuRow icon={LogOut} label="Cerrar sesión" onClick={props.onLogout} />
        </div>
      </div>
    </div>
  );
}
