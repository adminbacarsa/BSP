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
    puestos: any[];
    empleados: any[];
    dias: string[];
    diasBloqueados: string[];
    planificacionCompleta: any;
    ausencias: any;
    coberturaPorDia: any;
    cicloCCT?: {
        cortePrev: string;
        corteActual: string;
        descripcion: string;
    };
    autoCycles?: any[];
}
export declare function runPlanningGeminiOptimize(context: PlannerContext): Promise<GeminiRespuesta>;
