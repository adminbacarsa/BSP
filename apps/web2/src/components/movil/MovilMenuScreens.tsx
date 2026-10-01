import {
  ArrowLeftRight, Bot, Briefcase, Building2, CalendarDays, ChevronRight, Eye, LayoutGrid, LogOut, Monitor, Radio, UserPlus, Users,
  type LucideIcon,
} from 'lucide-react';
import type { MovilModulo } from '@/lib/movil/modulos';
import { MOVIL_CARD, MOVIL_FONT, MOVIL_PRIMARY_BORDER, MOVIL_PRIMARY_TEXT, MovilBadge, MovilCard, MovilHeader, MovilIconBox, MovilTopBar, type MovilTone } from './ui';

export interface MovilMenuEmpresa {
  id: string;
  name: string;
}

/** Ícono y tono de cada módulo en el selector (mismos íconos que el menú del escritorio). */
const MODULO_UI: Record<string, { icon: LucideIcon; tone: MovilTone }> = {
  operacion: { icon: Radio, tone: 'emerald' },
  supervision: { icon: Eye, tone: 'blue' },
  planificacion: { icon: CalendarDays, tone: 'indigo' },
  eventuales: { icon: UserPlus, tone: 'violet' },
  rrhh: { icon: Users, tone: 'amber' },
  servicios: { icon: Briefcase, tone: 'slate' },
};

function moduloUi(id: string): { icon: LucideIcon; tone: MovilTone } {
  return MODULO_UI[id] || { icon: LayoutGrid, tone: 'slate' };
}

/** Fila de acción del menú: ícono pastel, texto y chevron. */
function MenuRow({ icon, tone, label, hint, onClick, attrs }: { icon: LucideIcon; tone: MovilTone; label: string; hint?: string; onClick: () => void; attrs?: Record<string, string | undefined> }) {
  return (
    <button type="button" onClick={onClick} {...attrs} className="flex min-h-14 w-full items-center gap-3 px-3 text-left active:bg-slate-50">
      <MovilIconBox icon={icon} tone={tone} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        {hint && <span className="block truncate text-[11px] font-medium text-slate-500">{hint}</span>}
      </span>
      <ChevronRight size={16} strokeWidth={1.75} className="shrink-0 text-slate-400" aria-hidden="true" />
    </button>
  );
}

/** Selector de módulos. Con un solo módulo permitido no hay grilla: empresa, asistente y salir. */
export function MovilMenuScreens(props: {
  empresaId: string;
  empresaName: string;
  empresas: MovilMenuEmpresa[];
  canSwitchEmpresa: boolean;
  modulos: MovilModulo[];
  unico: MovilModulo | null;
  onModulo: (modulo: MovilModulo) => void;
  onSwitchEmpresa: (id: string) => void;
  onAsistente: () => void;
  onEscritorio: () => void;
  onLogout: () => void;
}) {
  const otras = props.canSwitchEmpresa ? props.empresas.filter((e) => e.id !== props.empresaId) : [];
  return (
    <div data-movil-screen="menu" data-viewport="390x844" className={`mx-auto flex min-h-[844px] w-full max-w-[480px] flex-col bg-[#f7f8fa] pb-8 ${MOVIL_FONT}`}>
      <MovilTopBar modulo="Menú" empresa={props.empresaName} />
      <div className="flex flex-col gap-3 px-3 pt-3">
        <MovilHeader icon={LayoutGrid} title="Módulos" />

        <MovilCard
          icon={Building2}
          tone="indigo"
          title={props.empresaName}
          subtitle="Empresa activa"
          badge={otras.length > 0 ? <MovilBadge tone="indigo">{otras.length + 1} empresas</MovilBadge> : undefined}
        >
          {otras.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {otras.map((e) => (
                <button key={e.id} type="button" onClick={() => props.onSwitchEmpresa(e.id)} data-movil-empresa-switch={e.id} className={`flex min-h-10 items-center gap-1.5 rounded-lg border bg-white px-3 text-[11px] font-semibold active:bg-slate-50 ${MOVIL_PRIMARY_BORDER} ${MOVIL_PRIMARY_TEXT}`}>
                  <ArrowLeftRight size={13} strokeWidth={1.75} aria-hidden="true" />
                  Cambiar a {e.name}
                </button>
              ))}
            </div>
          )}
        </MovilCard>

        {props.unico ? (
          <MovilCard
            icon={moduloUi(props.unico.id).icon}
            tone={moduloUi(props.unico.id).tone}
            title={`Volver a ${props.unico.label}`}
            subtitle={props.unico.desc}
            badge={<ChevronRight size={18} className="text-slate-300" aria-hidden="true" />}
            onClick={() => props.onModulo(props.unico as MovilModulo)}
            attrs={{ 'data-movil-module': props.unico.id }}
          />
        ) : (
          <section className="grid grid-cols-2 gap-2">
            {props.modulos.map((modulo) => {
              const ui = moduloUi(modulo.id);
              return (
                <MovilCard
                  key={modulo.id}
                  className="min-h-[108px]"
                  onClick={() => props.onModulo(modulo)}
                  attrs={{ 'data-movil-module': modulo.id }}
                >
                  <div className="flex items-start justify-between">
                    <MovilIconBox icon={ui.icon} tone={ui.tone} size="md" />
                    {modulo.mobile === false && <MovilBadge tone="slate">PC</MovilBadge>}
                  </div>
                  <b className="mt-3 block text-[15px] font-semibold leading-tight text-slate-900">{modulo.label}</b>
                  <small className="mt-0.5 block text-[11px] font-medium text-slate-500">{modulo.desc}</small>
                </MovilCard>
              );
            })}
            {props.modulos.length === 0 && (
              <p className={`col-span-2 ${MOVIL_CARD} p-4 text-sm font-medium text-slate-500`}>Tu rol no tiene módulos para el celular.</p>
            )}
          </section>
        )}

        <MovilCard className="!p-0 divide-y divide-slate-100 overflow-hidden">
          <MenuRow icon={Bot} tone="indigo" label="Asistente" hint="Preguntale a COSP" onClick={props.onAsistente} />
          <MenuRow icon={Monitor} tone="slate" label="Ver como escritorio" hint="Panel completo en esta pestaña" onClick={props.onEscritorio} />
          <MenuRow icon={LogOut} tone="rose" label="Cerrar sesión" onClick={props.onLogout} />
        </MovilCard>
      </div>
    </div>
  );
}
