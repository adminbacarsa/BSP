import type { AssistantPersona } from './resolveAssistantUser';
export type AssistantToolContext = {
    persona: AssistantPersona;
    empresaId: string;
    readableModuleKeys: string[];
    selfEmployeeFirestoreId: string | null;
    referenceDateYsMmDd: string;
};
export declare function ejecutarListadoFrancoRetDia(ctx: AssistantToolContext, args: {
    fecha?: string;
    tipo?: string;
    id_objetivo_cercania?: string;
    limite?: number;
}): Promise<Record<string, unknown>>;
export declare function assistantToolsEnabledForContext(ctx: AssistantToolContext): boolean;
export declare function resolveSelfEmployeeFirestoreId(uid: string): Promise<string | null>;
export declare function ejecutarBuscarEmpleadosPorNombre(ctx: AssistantToolContext, args: {
    texto?: string;
    limite?: number;
}): Promise<Record<string, unknown>>;
export declare function ejecutarListadoEmpleadosEmpresa(ctx: AssistantToolContext, args: {
    filtro_texto?: string;
    limite?: number;
    solo_activos_nomina_panel?: boolean;
}): Promise<Record<string, unknown>>;
export declare function ejecutarBuscarObjetivosPorNombre(ctx: AssistantToolContext, args: {
    texto?: string;
    limite?: number;
}): Promise<Record<string, unknown>>;
export declare function ejecutarConsultarTurnosEmpleado(ctx: AssistantToolContext, args: {
    id_firestore_empleado?: string;
    fecha_desde: string;
    fecha_hasta: string;
}): Promise<Record<string, unknown>>;
export declare function ejecutarResumenHorasEmpleadoPeriodo(ctx: AssistantToolContext, args: {
    id_firestore_empleado?: string;
    fecha_desde: string;
    fecha_hasta: string;
}): Promise<Record<string, unknown>>;
export declare function ejecutarResumenPresenciasObjetivosDia(ctx: AssistantToolContext, args: {
    fecha?: string;
    id_objetivo?: string;
}): Promise<Record<string, unknown>>;
export declare function ejecutarListadoTurnosOperativosDia(ctx: AssistantToolContext, args: {
    fecha?: string;
    id_objetivo?: string;
    limite?: number;
}): Promise<Record<string, unknown>>;
export declare function ejecutarContarServiciosSlaVigentesEmpresa(ctx: AssistantToolContext, args: {
    fecha?: string;
}): Promise<Record<string, unknown>>;
export declare function ejecutarResumenHorasObjetivoSlaPeriodo(ctx: AssistantToolContext, args: {
    id_objetivo?: string;
    texto_objetivo?: string;
    fecha_referencia?: string;
    id_servicio_sla?: string;
}): Promise<Record<string, unknown>>;
export declare function ejecutarContarEmpleadosPlantillaEmpresa(ctx: AssistantToolContext, args: {
    fecha_referencia?: string;
}): Promise<Record<string, unknown>>;
export declare function buildEmpresaMetricsSnapshotForPrompt(ctx: AssistantToolContext): Promise<string>;
export declare function dispatchAssistantToolCall(ctx: AssistantToolContext, name: string, rawArgs: unknown): Promise<Record<string, unknown>>;
