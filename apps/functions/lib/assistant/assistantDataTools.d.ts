import type { AssistantPersona } from './resolveAssistantUser';
export declare const ASSISTANT_TURNOS_DIA_QUERY_LIMIT = 900;
export type AssistantToolContext = {
    persona: AssistantPersona;
    empresaId: string;
    scopeEmpresa: boolean;
    readableModuleKeys: string[];
    selfEmployeeFirestoreId: string | null;
    referenceDateYsMmDd: string;
};
export declare function canQueryClientsCrm(ctx: AssistantToolContext): boolean;
export declare function formatListadoFrancoRetParaChat(data: Record<string, unknown>): string;
export declare function ejecutarListadoFrancoRetDia(ctx: AssistantToolContext, args: {
    fecha?: string;
    tipo?: string;
    id_objetivo_cercania?: string;
    limite?: number;
}): Promise<Record<string, unknown>>;
export declare function formatListadoAusentesLicenciasParaChat(data: Record<string, unknown>): string;
export declare function ejecutarListadoAusentesLicenciasDia(ctx: AssistantToolContext, args: {
    fecha?: string;
    id_objetivo?: string;
    tipo?: string;
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
export declare function ejecutarContarClientesEmpresa(ctx: AssistantToolContext, _args: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function ejecutarListadoClientesEmpresa(ctx: AssistantToolContext, args: {
    solo_activos?: boolean;
    limite?: number;
}): Promise<Record<string, unknown>>;
export declare function ejecutarAuditarCompletitudDatosClientesEmpresa(ctx: AssistantToolContext, args: {
    solo_activos?: boolean;
    limite?: number;
    texto_cliente?: string;
}): Promise<Record<string, unknown>>;
export declare function ejecutarListarObjetivosCliente(ctx: AssistantToolContext, args: {
    texto_cliente?: string;
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
    hora_inicio_cor?: string;
    codigo_turno?: string;
    solo_estado_presencia?: 'presente' | 'ausente' | 'sin_marcacion';
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
export declare function ejecutarResumenHorasSlaVariosObjetivos(ctx: AssistantToolContext, args: {
    textos_objetivo?: string[];
    fecha_referencia?: string;
    todos_servicios_activos_mes?: boolean;
    texto_cliente?: string;
    limite?: number;
}): Promise<Record<string, unknown>>;
export declare function ejecutarResumenHorasLiquidacionEmpresaPeriodo(ctx: AssistantToolContext, args: {
    fecha_desde?: string;
    fecha_hasta?: string;
    fecha_referencia?: string;
}): Promise<Record<string, unknown>>;
export declare function ejecutarListadoEmpleadosHorasPlanificadasUmbral(ctx: AssistantToolContext, args: {
    umbral_horas?: number;
    fecha_desde?: string;
    fecha_hasta?: string;
    fecha_referencia?: string;
    limite?: number;
}): Promise<Record<string, unknown>>;
export declare function ejecutarListadoEmpleadosSinTurnosPlanificados(ctx: AssistantToolContext, args: {
    fecha_desde?: string;
    fecha_hasta?: string;
    fecha_referencia?: string;
    limite?: number;
    solo_activos_nomina_panel?: boolean;
}): Promise<Record<string, unknown>>;
export declare function ejecutarContarEmpleadosPlantillaEmpresa(ctx: AssistantToolContext, args: {
    fecha_referencia?: string;
}): Promise<Record<string, unknown>>;
export type EmpresaMetricsSnapshotOptions = {
    includeOperationsDay?: boolean;
};
export declare function buildEmpresaMetricsSnapshotForPrompt(ctx: AssistantToolContext, options?: EmpresaMetricsSnapshotOptions): Promise<string>;
export declare function dispatchAssistantToolCall(ctx: AssistantToolContext, name: string, rawArgs: unknown): Promise<Record<string, unknown>>;
