import React from 'react';
import { LayoutGrid, Inbox, MapPin } from 'lucide-react';
import type { SupervisionMainTab } from '@/lib/supervision/supervisionUtils';
import { SUPERVISION_MAIN_TABS } from '@/lib/supervision/supervisionNav';

const TAB_ICONS: Record<SupervisionMainTab, React.ElementType> = {
  TABLERO: LayoutGrid,
  BANDEJA: Inbox,
  CAMPO: MapPin,
};

export default function SupervisionBottomNav({
  active,
  onChange,
  badges,
}: {
  active: SupervisionMainTab;
  onChange: (tab: SupervisionMainTab) => void;
  badges?: Partial<Record<SupervisionMainTab, number>>;
}) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[70] lg:hidden border-t border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md safe-area-bottom shadow-lg"
      aria-label="Supervisión"
    >
      <div className="flex items-stretch max-w-lg mx-auto">
        {SUPERVISION_MAIN_TABS.map(({ id, label }) => {
          const Icon = TAB_ICONS[id];
          const isActive = active === id;
          const badge = badges?.[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[56px] transition-colors active:scale-95 ${
                isActive ? 'text-teal-600' : 'text-slate-400'
              }`}
            >
              <span className="relative">
                <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
                {badge != null && badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              <span className="text-[9px] font-black uppercase tracking-wide">{label}</span>
              {isActive && (
                <span className="absolute bottom-0 w-10 h-0.5 rounded-full bg-teal-500" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
