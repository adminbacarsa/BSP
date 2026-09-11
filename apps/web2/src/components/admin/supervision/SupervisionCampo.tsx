import React from 'react';
import { FileText, MapPin, ClipboardList } from 'lucide-react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useSupervisionCampoPulse } from '@/hooks/useSupervisionCampoPulse';
import type { SupervisorObjective } from '@/hooks/useSupervisorScope';
import type { SupervisionCampoSection } from '@/lib/supervision/supervisionUtils';
import {
  SUPERVISION_CAMPO_SECTIONS,
  SUPERVISION_CAMPO_SECTION_STORAGE_KEY,
} from '@/lib/supervision/supervisionNav';
import SupervisionCampoPulse from '@/components/admin/supervision/SupervisionCampoPulse';
import SupervisionNovedades from '@/components/admin/supervision/SupervisionNovedades';
import SupervisionMas from '@/components/admin/supervision/SupervisionMas';

const SECTION_ICONS: Record<SupervisionCampoSection, React.ElementType> = {
  NOVEDADES: FileText,
  VISITAS: MapPin,
  CONSIGNAS: ClipboardList,
};

export default function SupervisionCampo({
  empresaId,
  objectiveIds,
  objectives,
  userUid,
  userName,
  isSuperAdmin,
  canViewAllObjectives,
}: {
  empresaId: string;
  objectiveIds: string[];
  objectives: SupervisorObjective[];
  userUid: string;
  userName: string;
  isSuperAdmin: boolean;
  canViewAllObjectives: boolean;
}) {
  const [section, setSection] = usePersistedState<SupervisionCampoSection>(
    SUPERVISION_CAMPO_SECTION_STORAGE_KEY,
    'NOVEDADES',
  );
  const pulse = useSupervisionCampoPulse(empresaId, objectiveIds, canViewAllObjectives);

  return (
    <div className="space-y-4">
      <SupervisionCampoPulse metrics={pulse} objectivesTotal={objectives.length} />

      <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-1 px-1">
        {SUPERVISION_CAMPO_SECTIONS.map(({ id, label }) => {
          const Icon = SECTION_ICONS[id];
          const active = section === id;
          const sectionBadge =
            id === 'NOVEDADES' ? pulse.incidentesAbiertos
            : id === 'VISITAS' ? pulse.visitasCriticasMes
            : 0;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={`relative shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-black uppercase transition-colors ${
                active
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                  : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50'
              }`}
            >
              <Icon size={14} strokeWidth={active ? 2.5 : 2} />
              {label}
              {sectionBadge > 0 && (
                <span className={`min-w-[16px] h-4 px-1 rounded-full text-[9px] font-black flex items-center justify-center ${
                  active ? 'bg-rose-500 text-white' : 'bg-rose-100 text-rose-700'
                }`}>
                  {sectionBadge > 99 ? '99+' : sectionBadge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {section === 'NOVEDADES' && (
        <SupervisionNovedades
          embedded
          objectiveIds={objectiveIds}
          objectives={objectives}
          userUid={userUid}
          userName={userName}
        />
      )}

      {section === 'VISITAS' && (
        <SupervisionMas
          empresaId={empresaId}
          objectiveIds={objectiveIds}
          objectives={objectives}
          userUid={userUid}
          userName={userName}
          isSuperAdmin={isSuperAdmin}
          canViewAllObjectives={canViewAllObjectives}
          forcedSection="VISITAS"
          hideSectionToggle
          hideKpi
        />
      )}

      {section === 'CONSIGNAS' && (
        <SupervisionMas
          empresaId={empresaId}
          objectiveIds={objectiveIds}
          objectives={objectives}
          userUid={userUid}
          userName={userName}
          isSuperAdmin={isSuperAdmin}
          canViewAllObjectives={canViewAllObjectives}
          forcedSection="CONSIGNAS"
          hideSectionToggle
          hideKpi
        />
      )}
    </div>
  );
}
