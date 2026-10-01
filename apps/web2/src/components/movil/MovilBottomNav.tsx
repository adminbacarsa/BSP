import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Bell, CalendarDays, ClipboardList, FileText, FolderOpen, Grid2x2, LayoutGrid, ListChecks, Radio, Send, Sun, UserPlus, Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { barraDelModulo, moduloMovilDe, modulosMovil, seccionActiva, type MovilIcono } from '@/lib/movil/movilModulos';

const ICONS: Record<MovilIcono, typeof Radio> = {
  objetivos: Radio,
  alertas: Bell,
  sala: Users,
  dias: CalendarDays,
  huecos: Grid2x2,
  hoy: Sun,
  cargar: ClipboardList,
  novedades: FileText,
  bolsa: FolderOpen,
  arca: Send,
  alta: UserPlus,
  lista: ListChecks,
  menu: LayoutGrid,
};

/** Barra del módulo actual. Nunca mezcla secciones de otros módulos. */
export function MovilBottomNav({ alertCount = 0 }: { alertCount?: number }) {
  const router = useRouter();
  const { canReadModule, isSuperAdmin } = useAuth();
  const query = router.query as Record<string, string | string[] | undefined>;
  const actual = moduloMovilDe(router.pathname, query);
  const permitidos = modulosMovil(canReadModule, isSuperAdmin);
  const modulo = actual && permitidos.some((m) => m.id === actual.id) ? actual : null;
  const items = barraDelModulo(modulo);
  const activa = seccionActiva(modulo, query);
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-slate-200 bg-white md:hidden"
      aria-label={modulo ? `Navegación ${modulo.label}` : 'Navegación celular'}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map((item) => {
        const Icon = ICONS[item.icono] || LayoutGrid;
        const active = item.id !== 'menu' && item.id === activa;
        const esInicio = modulo?.secciones[0]?.id === item.id;
        return (
          <Link
            key={item.id}
            href={item.href}
            // La primera sección vuelve a la pantalla principal del módulo aunque la URL no cambie.
            onClick={esInicio ? () => window.dispatchEvent(new Event('cosp-modulo-inicio')) : undefined}
            className={`relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[9px] font-black ${active ? 'text-indigo-600' : 'text-slate-400'}`}
          >
            <Icon size={18} strokeWidth={2.2} />
            {item.id === 'alertas' && alertCount > 0 && (
              <span className="absolute right-[calc(50%-18px)] top-1 min-w-[14px] rounded-full bg-rose-600 px-1 text-[8px] text-white">
                {alertCount > 9 ? '9+' : alertCount}
              </span>
            )}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
