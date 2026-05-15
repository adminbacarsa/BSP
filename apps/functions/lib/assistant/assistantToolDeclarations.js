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
];
exports.ASSISTANT_TOOL_ROUNDS_MAX = 6;
//# sourceMappingURL=assistantToolDeclarations.js.map