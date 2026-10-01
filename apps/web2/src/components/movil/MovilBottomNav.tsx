import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '@/context/AuthContext';
import { movilNavForPermissions } from '@/lib/movil/navItems';

const ICONS: Record<string, string> = {
  operaciones: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  alertas: 'M12 3a6 6 0 0 0-6 6c0 7-3 7-3 7h18s-3 0-3-7a6 6 0 0 0-6-6zm-2 16a2 2 0 0 0 4 0',
  eventuales: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.87',
  novedades: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  plan: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  mas: 'M5 12h.01M12 12h.01M19 12h.01',
};

export function MovilBottomNav({ alertCount = 0 }: { alertCount?: number }) {
  const router = useRouter();
  const { canReadModule, isSuperAdmin } = useAuth();
  const items = movilNavForPermissions((key) => isSuperAdmin || canReadModule(key));
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-slate-200 bg-white md:hidden"
      aria-label="Navegación celular"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map((item) => {
        const active = item.id === 'alertas'
          ? router.query.panel === 'alertas'
          : item.id === 'mas'
            ? router.query.panel === 'mas'
            : item.id === 'operaciones'
              ? router.pathname.startsWith('/admin/operaciones') && !router.query.panel
              : item.id === 'plan'
                ? router.pathname.startsWith('/admin/movil/planificacion') || (router.pathname.startsWith('/admin/planificacion') && !router.query.panel)
                : router.pathname.startsWith(item.href.replace(/\?.*$/, '').replace(/\/$/, ''));
        return (
          <Link
            key={item.id}
            href={item.href}
            className={`relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[9px] font-black ${active ? 'text-indigo-600' : 'text-slate-400'}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d={ICONS[item.id] || ICONS.mas} />
            </svg>
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
