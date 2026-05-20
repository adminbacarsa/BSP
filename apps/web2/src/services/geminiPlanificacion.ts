import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

export interface GeminiCorreccion {
  empId: string;
  fecha: string;
  codigoNuevo: string;
  puesto: string;
  razon: string;
}

export interface GeminiMetricas {
  totalHsFacturables: number;
  diasConDeficit: string[];
  empleadosFueraDeEquidad: string[];
}

export interface GeminiRespuesta {
  bloqueoEstructural: boolean;
  razonBloqueo: string | null;
  correcciones: GeminiCorreccion[];
  metricas: GeminiMetricas | null;
  resumen: string;
}

export interface PlannerContext {
  mes: string;
  objetivo: string;
  slaVendidas: number;
  puestos: unknown[];
  empleados: unknown[];
  dias: string[];
  diasBloqueados: string[];
  planificacionCompleta: unknown;
  ausencias: unknown;
  coberturaPorDia: unknown;
  cicloCCT?: {
    cortePrev: string;
    corteActual: string;
    descripcion: string;
  };
  autoCycles?: unknown[];
}

const optimizePlanningGeminiCallable = httpsCallable<{ context: PlannerContext; empresaId?: string }, GeminiRespuesta>(
  functions,
  'optimizePlanningGemini',
);

export async function optimizarConGemini(context: PlannerContext, empresaId?: string): Promise<GeminiRespuesta> {
  try {
    const res = await optimizePlanningGeminiCallable({ context, empresaId });
    return res.data as GeminiRespuesta;
  } catch (e: unknown) {
    if (e instanceof FirebaseError) {
      throw new Error(e.message);
    }
    throw e;
  }
}
