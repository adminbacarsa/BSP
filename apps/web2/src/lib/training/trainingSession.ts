import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ── Módulos entrenables (en orden de recorrido) ──────────────────────────────

export interface TrainingStep {
  id: string;
  label: string;
}

export interface TrainableModule {
  key: string;
  label: string;
  icon: string;
  steps: TrainingStep[];
}

export const TRAINABLE_MODULES: TrainableModule[] = [
  {
    key: 'CLIENTS',
    label: 'CRM — Clientes',
    icon: '🏢',
    steps: [
      { id: 'crear_cliente',   label: 'Crear un cliente' },
      { id: 'crear_objetivo',  label: 'Agregar sede al cliente' },
    ],
  },
  {
    key: 'RRHH',
    label: 'RRHH — Empleados',
    icon: '👥',
    steps: [
      { id: 'ver_empleado',    label: 'Explorar legajo de empleado' },
      { id: 'cargar_novedad',  label: 'Cargar novedad' },
    ],
  },
  {
    key: 'SERVICES',
    label: 'Servicios y SLA',
    icon: '📋',
    steps: [
      { id: 'crear_sla',          label: 'Crear contrato/SLA' },
      { id: 'conf_puesto_24hs',   label: 'Puesto 24 horas' },
      { id: 'conf_puesto_custom', label: 'Puesto personalizado' },
    ],
  },
  {
    key: 'PLANNING',
    label: 'Planificación',
    icon: '📅',
    steps: [
      { id: 'crear_turnos',    label: 'Asignar turnos' },
      { id: 'publicar_grilla', label: 'Publicar grilla' },
    ],
  },
  {
    key: 'OPERATIONS',
    label: 'Operaciones',
    icon: '📡',
    steps: [
      { id: 'reg_presencia',   label: 'Registrar presencia' },
      { id: 'gestionar_aus',   label: 'Gestionar ausencia' },
    ],
  },
];

// ── Tipos de sesión ──────────────────────────────────────────────────────────

export type TrainingStatus = 'active' | 'completed' | 'reset';

export interface ModuleProgress {
  status: 'pending' | 'in_progress' | 'completed';
  startedAt?: string;
  completedAt?: string;
  score?: number;
  stepsCompleted: string[];
  attempts: number;
}

export interface TrainingSession {
  id: string;
  userId: string;
  userEmail: string;
  empresaId: string;
  roleId: string;
  modulePlan: string[];             // keys de TRAINABLE_MODULES en orden
  status: TrainingStatus;
  currentModuleKey: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  progress: Record<string, ModuleProgress>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Construye el plan de módulos filtrando por permisos del rol */
export function buildModulePlan(rolePermissions: Record<string, string[]>): string[] {
  return TRAINABLE_MODULES
    .filter(m => {
      const perms = rolePermissions[m.key] ?? [];
      return perms.includes('read');
    })
    .map(m => m.key);
}

/** Inicializa el objeto de progreso para un plan de módulos dado */
export function initProgress(modulePlan: string[]): Record<string, ModuleProgress> {
  const progress: Record<string, ModuleProgress> = {};
  for (const key of modulePlan) {
    progress[key] = { status: 'pending', stepsCompleted: [], attempts: 0 };
  }
  return progress;
}

/** ID de documento de sesión: uno por usuario por empresa de capacitación */
export function sessionDocId(empresaId: string, userId: string): string {
  return `${empresaId}_${userId}`;
}

/** Carga o crea la sesión de capacitación para el usuario */
export async function loadOrCreateSession(params: {
  userId: string;
  userEmail: string;
  empresaId: string;
  roleId: string;
  rolePermissions: Record<string, string[]>;
}): Promise<TrainingSession> {
  const { userId, userEmail, empresaId, roleId, rolePermissions } = params;
  const docId = sessionDocId(empresaId, userId);
  const ref = doc(db, 'training_sessions', docId);

  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data() as Omit<TrainingSession, 'id'>;
    return { id: docId, ...data };
  }

  const modulePlan = buildModulePlan(rolePermissions);
  const now = new Date().toISOString();
  const session: Omit<TrainingSession, 'id'> = {
    userId,
    userEmail,
    empresaId,
    roleId,
    modulePlan,
    status: 'active',
    currentModuleKey: modulePlan[0] ?? null,
    startedAt: now,
    updatedAt: now,
    progress: initProgress(modulePlan),
  };

  await setDoc(ref, { ...session, startedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return { id: docId, ...session };
}

/** Marca un paso de un módulo como completado */
export async function completeStep(params: {
  sessionId: string;
  moduleKey: string;
  stepId: string;
  allStepsForModule: string[];
}): Promise<void> {
  const { sessionId, moduleKey, stepId, allStepsForModule } = params;
  const ref = doc(db, 'training_sessions', sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const data = snap.data() as Omit<TrainingSession, 'id'>;
  const mod: ModuleProgress = data.progress?.[moduleKey] ?? { status: 'pending', stepsCompleted: [], attempts: 0 };

  const stepsCompleted = Array.from(new Set([...mod.stepsCompleted, stepId]));
  const allDone = allStepsForModule.every(s => stepsCompleted.includes(s));

  const updatedMod: ModuleProgress = {
    ...mod,
    status: allDone ? 'completed' : 'in_progress',
    stepsCompleted,
    ...(mod.status === 'pending' ? { startedAt: new Date().toISOString() } : {}),
    ...(allDone ? { completedAt: new Date().toISOString() } : {}),
  };

  // Si el módulo se completó, avanzar al siguiente
  let currentModuleKey = data.currentModuleKey;
  if (allDone && currentModuleKey === moduleKey) {
    const idx = data.modulePlan.indexOf(moduleKey);
    currentModuleKey = data.modulePlan[idx + 1] ?? null;
  }

  const allModulesDone = data.modulePlan.every(k =>
    k === moduleKey ? allDone : (data.progress[k]?.status === 'completed')
  );

  await updateDoc(ref, {
    [`progress.${moduleKey}`]: updatedMod,
    currentModuleKey,
    status: allModulesDone ? 'completed' : 'active',
    updatedAt: serverTimestamp(),
  });
}

/** Deshace un paso completado (permite retroceder en el recorrido) */
export async function uncompleteStep(params: {
  sessionId: string;
  targetModuleKey: string;
  targetStepId: string;
  newCurrentModuleKey: string;
}): Promise<void> {
  const { sessionId, targetModuleKey, targetStepId, newCurrentModuleKey } = params;
  const ref = doc(db, 'training_sessions', sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const data = snap.data() as Omit<TrainingSession, 'id'>;
  const mod: ModuleProgress = data.progress?.[targetModuleKey] ?? { status: 'pending', stepsCompleted: [], attempts: 0 };
  const stepsCompleted = mod.stepsCompleted.filter(s => s !== targetStepId);

  const updates: Record<string, unknown> = {
    [`progress.${targetModuleKey}`]: {
      ...mod,
      status: stepsCompleted.length === 0 ? 'pending' : 'in_progress',
      stepsCompleted,
      completedAt: null,
    },
    currentModuleKey: newCurrentModuleKey,
    status: 'active',
    updatedAt: serverTimestamp(),
  };

  // Si volvemos a un módulo diferente que estaba 'completed', revertirlo
  if (newCurrentModuleKey !== targetModuleKey) {
    const prevMod = data.progress?.[newCurrentModuleKey];
    if (prevMod?.status === 'completed') {
      updates[`progress.${newCurrentModuleKey}`] = { ...prevMod, status: 'in_progress', completedAt: null };
    }
  }

  await updateDoc(ref, updates);
}

/** Reinicia la sesión de un alumno (instructor) */
export async function resetSession(sessionId: string, modulePlan: string[]): Promise<void> {
  const ref = doc(db, 'training_sessions', sessionId);
  await updateDoc(ref, {
    status: 'active',
    currentModuleKey: modulePlan[0] ?? null,
    progress: initProgress(modulePlan),
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
  });
}
