import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Bell, Home, Menu } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { MovilMenu } from '@/components/movil/MovilMenu';
import { movilNavForPermissions, type MovilNavId } from '@/lib/movil/navItems';

const ICONS: Record<MovilNavId, typeof Home> = {
  inicio: Home,
  alertas: Bell,
  mas: Menu,
};

const ITEM_CLS = 'relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[9px] font-black';

export function MovilBottomNav({ alertCount = 0 }: { alertCount?: number }) {
  const router = useRouter();
  const { canReadModule, isSuperAdmin } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const query = router.query as Record<string, string | string[] | undefined>;
  const items = movilNavForPermissions((key) => isSuperAdmin || canReadModule(key), router.pathname, query);
  const panel = String(query.panel || '');

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-slate-200 bg-white md:hidden"
        aria-label="Navegación celular"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {items.map((item) => {
          const Icon = ICONS[item.id];
          if (item.id === 'mas') {
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setMenuOpen(true)}
                className={`${ITEM_CLS} ${menuOpen ? 'text-indigo-600' : 'text-slate-400'}`}
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
              >
                <Icon size={18} strokeWidth={2.2} />
                {item.label}
              </button>
            );
          }
          const active = item.id === 'alertas'
            ? panel === 'alertas'
            : panel !== 'alertas';
          return (
            <Link key={item.id} href={item.href} className={`${ITEM_CLS} ${active && !menuOpen ? 'text-indigo-600' : 'text-slate-400'}`}>
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
      <MovilMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
