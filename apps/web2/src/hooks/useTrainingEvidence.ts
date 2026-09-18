import { useEffect, useRef } from 'react';
import { collection, query, where, limit, onSnapshot, Timestamp } from 'firebase/firestore';
import { useRouter } from 'next/router';
import { db } from '@/lib/firebase';
import { useEmpresa } from '@/context/EmpresaContext';
import { useTrainingSession } from '@/hooks/useTrainingSession';
import { getActiveCoachStep, COACH_STEPS } from '@/lib/training/coachContent';
import { completeStep } from '@/lib/training/trainingSession';

/**
 * Observa Firestore en tiempo real para detectar evidencia de cada paso
 * del coach y marcarlo automáticamente al completarse.
 * Solo activo cuando isTrainingEmpresa=true.
 */
export function useTrainingEvidence() {
  const { empresa } = useEmpresa();
  const { session } = useTrainingSession();
  const router = useRouter();
  const completingRef = useRef<Set<string>>(new Set());

  const isTraining = !!empresa?.isTrainingEmpresa;
  const empresaId  = session?.empresaId ?? '';

  // ── Convertir startedAt a Timestamp de Firestore ─────────────────────────
  const sessionStart: Timestamp | null = (() => {
    if (!session?.startedAt) return null;
    try {
      const sa = session.startedAt as unknown;
      if (sa instanceof Timestamp) return sa;
      const d = new Date(sa as string);
      if (isNaN(d.getTime())) return null;
      return Timestamp.fromDate(d);
    } catch {
      return null;
    }
  })();

  // ── Helper: marcar paso y evitar duplicados ───────────────────────────────
  const markDone = (moduleKey: string, stepId: string) => {
    const key = `${moduleKey}:${stepId}`;
    if (completingRef.current.has(key)) return;
    if (session?.progress[moduleKey]?.stepsCompleted?.includes(stepId)) return;
    completingRef.current.add(key);
    const allStepsForModule = COACH_STEPS
      .filter(s => s.moduleKey === moduleKey)
      .map(s => s.stepId);
    completeStep({ sessionId: session!.id, moduleKey, stepId, allStepsForModule })
      .catch(() => {})
      .finally(() => completingRef.current.delete(key));
  };

  // Helper: comparar timestamp de un doc contra sessionStart (client-side)
  // Evita queries compuestas que requieren índices Firestore en producción.
  const isAfterStart = (tsField: unknown): boolean => {
    if (!sessionStart || !tsField) return false;
    try {
      const ts = tsField instanceof Timestamp
        ? tsField
        : Timestamp.fromDate(new Date(String(tsField)));
      return ts.seconds >= sessionStart.seconds;
    } catch {
      return false;
    }
  };

  // ── Detectar evidencia según el paso activo ───────────────────────────────
  useEffect(() => {
    if (!isTraining || !session || !empresaId || !sessionStart) return;

    const coachStep = getActiveCoachStep(session.currentModuleKey, session.progress);
    if (!coachStep) return;

    const { moduleKey, stepId } = coachStep;
    let unsub: (() => void) | null = null;

    switch (stepId) {
      // ── CLIENTS ────────────────────────────────────────────────────────────
      case 'crear_cliente': {
        // Query solo por empresaId (índice automático); filtro de fecha client-side
        const q = query(
          collection(db, 'clients'),
          where('empresaId', '==', empresaId),
          limit(30),
        );
        unsub = onSnapshot(q, snap => {
          const hasNew = snap.docs.some(d => isAfterStart(d.data().createdAt));
          if (hasNew) markDone(moduleKey, stepId);
        });
        break;
      }

      case 'crear_objetivo': {
        const q = query(
          collection(db, 'clients'),
          where('empresaId', '==', empresaId),
          limit(30),
        );
        unsub = onSnapshot(q, snap => {
          const hasObj = snap.docs.some(d => {
            const data = d.data();
            if (!isAfterStart(data.createdAt)) return false;
            const obj = data.objetivos;
            return Array.isArray(obj) && obj.length > 0;
          });
          if (hasObj) markDone(moduleKey, stepId);
        });
        break;
      }

      // ── SERVICES ───────────────────────────────────────────────────────────
      case 'crear_sla': {
        const q = query(
          collection(db, 'servicios_sla'),
          where('empresaId', '==', empresaId),
          limit(30),
        );
        unsub = onSnapshot(q, snap => {
          const hasNew = snap.docs.some(d => isAfterStart(d.data().createdAt));
          if (hasNew) markDone(moduleKey, stepId);
        });
        break;
      }

      case 'conf_puesto_24hs': {
        const q = query(
          collection(db, 'servicios_sla'),
          where('empresaId', '==', empresaId),
          limit(30),
        );
        unsub = onSnapshot(q, snap => {
          const configured = snap.docs.some(d => {
            const data = d.data();
            if (!isAfterStart(data.createdAt)) return false;
            const positions = data.positions ?? [];
            return positions.some((p: { coverageType?: string; shifts?: unknown[] }) =>
              (p.coverageType === '24hs' || p.coverageType === '24H' || p.coverageType === 'FULL_DAY') &&
              Array.isArray(p.shifts) && p.shifts.length > 0
            );
          });
          if (configured) markDone(moduleKey, stepId);
        });
        break;
      }

      case 'conf_puesto_custom': {
        const q = query(
          collection(db, 'servicios_sla'),
          where('empresaId', '==', empresaId),
          limit(30),
        );
        unsub = onSnapshot(q, snap => {
          const hasTwoOrMore = snap.docs.some(d => {
            const data = d.data();
            if (!isAfterStart(data.createdAt)) return false;
            const positions = data.positions ?? [];
            return positions.filter((p: { shifts?: unknown[] }) =>
              Array.isArray(p.shifts) && p.shifts.length > 0
            ).length >= 2;
          });
          if (hasTwoOrMore) markDone(moduleKey, stepId);
        });
        break;
      }

      // ── PLANNING ───────────────────────────────────────────────────────────
      case 'crear_turnos': {
        const q = query(
          collection(db, 'turnos'),
          where('empresaId', '==', empresaId),
          limit(30),
        );
        unsub = onSnapshot(q, snap => {
          const hasNew = snap.docs.some(d => isAfterStart(d.data().createdAt));
          if (hasNew) markDone(moduleKey, stepId);
        });
        break;
      }

      case 'publicar_grilla': {
        const q = query(
          collection(db, 'planificacion_estados'),
          where('empresaId', '==', empresaId),
          limit(5),
        );
        unsub = onSnapshot(q, snap => {
          const published = snap.docs.some(d => {
            const pa = d.data().publishedAt;
            if (!pa) return false;
            const publishedTs = pa instanceof Timestamp ? pa : Timestamp.fromDate(new Date(pa));
            return publishedTs.seconds >= sessionStart!.seconds;
          });
          if (published) markDone(moduleKey, stepId);
        });
        break;
      }

      // ── OPERATIONS ─────────────────────────────────────────────────────────
      case 'reg_presencia': {
        const q = query(
          collection(db, 'turnos'),
          where('empresaId', '==', empresaId),
          where('isPresent', '==', true),
          limit(1),
        );
        unsub = onSnapshot(q, snap => {
          if (!snap.empty) markDone(moduleKey, stepId);
        });
        break;
      }

      case 'gestionar_aus': {
        const q = query(
          collection(db, 'turnos'),
          where('empresaId', '==', empresaId),
          where('isAbsent', '==', true),
          limit(1),
        );
        unsub = onSnapshot(q, snap => {
          if (!snap.empty) markDone(moduleKey, stepId);
        });
        break;
      }

      // ── RRHH ───────────────────────────────────────────────────────────────
      case 'cargar_novedad': {
        const qAus = query(
          collection(db, 'ausencias'),
          where('empresaId', '==', empresaId),
          limit(30),
        );
        const qNov = query(
          collection(db, 'novedades'),
          where('empresaId', '==', empresaId),
          limit(30),
        );
        const u1 = onSnapshot(qAus, snap => {
          if (snap.docs.some(d => isAfterStart(d.data().createdAt))) markDone(moduleKey, stepId);
        });
        const u2 = onSnapshot(qNov, snap => {
          if (snap.docs.some(d => isAfterStart(d.data().createdAt))) markDone(moduleKey, stepId);
        });
        unsub = () => { u1(); u2(); };
        break;
      }

      default:
        break;
    }

    return () => unsub?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTraining, session?.currentModuleKey, session?.progress, empresaId]);

  // ── ver_reporte: detectar por navegación ─────────────────────────────────
  useEffect(() => {
    if (!isTraining || !session) return;
    const coachStep = getActiveCoachStep(session.currentModuleKey, session.progress);
    if (!coachStep || coachStep.stepId !== 'ver_reporte') return;
    if (router.pathname.startsWith('/admin/reportes')) {
      markDone(coachStep.moduleKey, coachStep.stepId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTraining, router.pathname, session?.currentModuleKey]);
}
