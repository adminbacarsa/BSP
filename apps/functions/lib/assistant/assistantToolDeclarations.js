"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSISTANT_TOOL_ROUNDS_MAX = exports.ASSISTANT_FUNCTION_DECLARATIONS = void 0;
const generative_ai_1 = require("@google/generative-ai");
exports.ASSISTANT_FUNCTION_DECLARATIONS = [
    {
        name: 'buscar_empleados_por_nombre',
        description: 'Busca colaboradores por fragmento de nombre o apellido dentro de la empresa del usuario admin. Devuelve idFirestore necesario para consultar_turnos_empleado. Si hay varias coincidencias, pedí aclaración antes de afirmar presencia.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                texto: { type: generative_ai_1.SchemaType.STRING, description: 'Texto libre ejemplo "Gomez" o "Maria L"' },
                limite: { type: generative_ai_1.SchemaType.NUMBER, description: '1 a 15, default implícito 8 si omitís.' },
            },
            required: ['texto'],
        },
    },
    {
        name: 'consultar_turnos_empleado',
        description: 'Lista turnos reales desde Firestore de un legajo por idFirestore (colección empleados) en un rango de fechas inclusivo zona AR. Usá esto para saber si estaba planificado, borrador u operativo, y señales de presencia cuando existan.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                id_firestore_empleado: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'ID del doc empleados. Omití solo portal empleado (se fuerza automático el propio). Backoffice debe obtener id vía buscar_empleados_por_nombre salvo ya lo sepas.',
                },
                fecha_desde: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'YYYY-MM-DD desde (inclusive). Para "hoy" usá fechaReferenciaCliente (misma en desde y hasta si un solo día).',
                },
                fecha_hasta: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD hasta (inclusive).' },
            },
            required: ['fecha_desde', 'fecha_hasta'],
        },
    },
    {
        name: 'resumen_presencias_objetivos_dia',
        description: 'Para preguntas agregadas del tipo «cuántos presentes hay hoy», «resumen por objetivo», «cuántos ausentes», etc.: consulta turnos del día (zona AR) limitados a la empresa del usuario y alineados a la lógica del monitor de Operaciones. Usá fecha YYYY-MM-DD = fechaReferenciaCliente si el usuario dice "hoy". Opcional id_objetivo para un solo objetivo.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                fecha: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Día a analizar YYYY-MM-DD. Si omitís, se usa el hoy del cliente.',
                },
                id_objetivo: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Si el usuario nombra un objetivo puntual y ya conocés su id Firestore, filtrá; si no, omití y resumí toda la empresa.',
                },
            },
            required: [],
        },
    },
    {
        name: 'listado_turnos_operativos_dia',
        description: 'Lista nombres/horarios/objetivos de los turnos visibles para la empresa un día (misma vista que Operaciones). Usalo para «quién está de turno hoy», «qué obligaciones tiene el equipo hoy». Fecha opcional (= hoy cliente). Opcional limite 8–120 filas si el usuario sólo necesita muestra.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                fecha: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD; omitir = hoy del cliente.' },
                id_objetivo: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Filtrar un objetivo por id sólo si lo tenés; si no omití.',
                },
                limite: { type: generative_ai_1.SchemaType.NUMBER, description: 'Filas máximas en muestra_turnos (8–120, default implícito 96).' },
            },
            required: [],
        },
    },
    {
        name: 'contar_servicios_sla_vigentes_empresa',
        description: 'Para «cuántos servicios / SLA activos hay hoy», «contratos vigentes»: cuenta documentos activos en `servicios_sla` limitados a clientes de la empresa actual y donde la fecha de referencia está entre startDate y endDate. Usarlo SIEMPRE que pidan número/cantidad, no bastar con explicar la pantalla /admin/servicios.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                fecha: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'YYYY-MM-DD del «hoy». Si omitís usar la fechaReferenciaCliente del contexto.',
                },
            },
            required: [],
        },
    },
];
exports.ASSISTANT_TOOL_ROUNDS_MAX = 6;
//# sourceMappingURL=assistantToolDeclarations.js.map