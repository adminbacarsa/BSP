import { Bell, Bot, Building2, Calendar, Eye, LogOut, Monitor, Radio, ShieldCheck, UserPlus, Users } from 'lucide-react';
import type { MovilModule, MovilModuleId } from '@/lib/movil/navItems';

const MODULE_ICON: Record<MovilModuleId, typeof Radio> = {
  operacion: Radio,
  supervision: Eye,
  planificacion: Calendar,
  eventuales: UserPlus,
  rrhh: Users,
  servicios: ShieldCheck,
};

export interface MovilMenuEmpresa {
  id: string;
  name: string;
}

export function MovilMenuGrid({
  empresaId,
  empresaName,
  empresas,
  canSwitchEmpresa,
  modules,
  sinGrilla = false,
  currentModuleId,
  onModule,
  onSwitchEmpresa,
  onAsistente,
  onEscritorio,
  onAvisos,
  onLogout,
}: {
  empresaId: string;
  empresaName: string;
  empresas: MovilMenuEmpresa[];
  canSwitchEmpresa: boolean;
  modules: MovilModule[];
  /** Un solo módulo: la hoja no ofrece otros. */
  sinGrilla?: boolean;
  currentModuleId: MovilModuleId | null;
  onModule: (module: MovilModule) => void;
  onSwitchEmpresa: (id: string) => void;
  onAsistente: () => void;
  onEscritorio: () => void;
  onAvisos: () => void;
  onLogout: () => void;
}) {
  const otrasEmpresas = canSwitchEmpresa ? empresas.filter((item) => item.id !== empresaId) : [];
  return (
    <div data-movil-menu>
      <div className="mb-3 flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <Building2 size={18} className="shrink-0 text-indigo-600" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase text-slate-500">Empresa activa</p>
          <p className="truncate text-sm font-black text-slate-900">{empresaName}</p>
        </div>
      </div>
      {otrasEmpresas.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {otrasEmpresas.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSwitchEmpresa(item.id)}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-black text-slate-700 active:scale-95"
            >
              Cambiar a {item.name}
            </button>
          ))}
        </div>
      )}
      {!sinGrilla && <div className="mb-3 grid grid-cols-2 gap-2">
        {modules.map((module) => {
          const Icon = MODULE_ICON[module.id];
          const active = module.id === currentModuleId;
          return (
            <button
              key={module.id}
              type="button"
              data-movil-module={module.id}
              onClick={() => onModule(module)}
              className={`flex min-h-[88px] flex-col items-start justify-between rounded-2xl border p-3 text-left shadow-sm active:scale-95 ${
                active ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'
              }`}
            >
              <Icon size={26} strokeWidth={2.2} className={active ? 'text-indigo-700' : 'text-indigo-600'} />
              <span>
                <b className="block text-sm font-black text-slate-900">{module.label}</b>
                <small className="block text-[10px] font-semibold text-slate-500">
                  {module.mobile ? module.desc : 'En la computadora'}
                </small>
              </span>
            </button>
          );
        })}
      </div>}
      {!sinGrilla && modules.length === 0 && (
        <p className="mb-3 rounded-2xl bg-white p-4 text-sm font-semibold text-slate-500">Tu rol no tiene módulos para el celular.</p>
      )}
      <button type="button" onClick={onAsistente} className="mb-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-50 text-sm font-black text-indigo-800 active:scale-95">
        <Bot size={16} /> Asistente
      </button>
      <button type="button" onClick={onAvisos} className="mb-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-700 active:scale-95">
        <Bell size={16} /> Activar avisos de este celular
      </button>
      <button type="button" onClick={onEscritorio} className="mb-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-bold text-slate-700 active:scale-95">
        <Monitor size={16} /> Ver como escritorio
      </button>
      <button type="button" onClick={onLogout} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-rose-50 text-sm font-black text-rose-700 active:scale-95">
        <LogOut size={16} /> Cerrar sesión
      </button>
    </div>
  );
}
