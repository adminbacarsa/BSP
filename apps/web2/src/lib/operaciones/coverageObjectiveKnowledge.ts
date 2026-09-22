import {
  computeExperienciaNivel,
  experienciaNivelLabel,
  type ExperienciaNivel,
} from '@/lib/planificacion/experienciaObjetivos';

export type ObjectiveKnowledgeRow = {
  nivel: ExperienciaNivel;
  label: string;
  knowsObjective: boolean;
};

export function objectiveKnowledgeForEmployee(
  employee: Record<string, unknown> | null | undefined,
  objectiveId: string,
): ObjectiveKnowledgeRow {
  const objId = String(objectiveId || '').trim();
  if (!employee || !objId) {
    return { nivel: 'NINGUNO', label: experienciaNivelLabel('NINGUNO'), knowsObjective: false };
  }
  const isTitular = String(employee.preferredObjectiveId || '') === objId;
  const expMap = (employee.experienciaObjetivos || {}) as Record<string, Record<string, unknown>>;
  const entry = expMap[objId];
  const nivel = computeExperienciaNivel(entry, isTitular);
  const knowsObjective = nivel !== 'NINGUNO' || isTitular;
  return {
    nivel,
    label: experienciaNivelLabel(nivel),
    knowsObjective,
  };
}
