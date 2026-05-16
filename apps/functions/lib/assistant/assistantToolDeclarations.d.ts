import { SchemaType } from '@google/generative-ai';
export declare const ASSISTANT_FUNCTION_DECLARATIONS: ({
    name: string;
    description: string;
    parameters: {
        type: SchemaType;
        properties: {
            texto: {
                type: SchemaType;
                description: string;
            };
            limite: {
                type: SchemaType;
                description: string;
            };
            filtro_texto?: undefined;
            solo_activos_nomina_panel?: undefined;
            id_firestore_empleado?: undefined;
            fecha_desde?: undefined;
            fecha_hasta?: undefined;
            fecha?: undefined;
            id_objetivo?: undefined;
            tipo?: undefined;
            id_objetivo_cercania?: undefined;
            texto_objetivo?: undefined;
            fecha_referencia?: undefined;
            id_servicio_sla?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    parameters: {
        type: SchemaType;
        properties: {
            filtro_texto: {
                type: SchemaType;
                description: string;
            };
            limite: {
                type: SchemaType;
                description: string;
            };
            solo_activos_nomina_panel: {
                type: SchemaType;
                description: string;
            };
            texto?: undefined;
            id_firestore_empleado?: undefined;
            fecha_desde?: undefined;
            fecha_hasta?: undefined;
            fecha?: undefined;
            id_objetivo?: undefined;
            tipo?: undefined;
            id_objetivo_cercania?: undefined;
            texto_objetivo?: undefined;
            fecha_referencia?: undefined;
            id_servicio_sla?: undefined;
        };
        required: any[];
    };
} | {
    name: string;
    description: string;
    parameters: {
        type: SchemaType;
        properties: {
            id_firestore_empleado: {
                type: SchemaType;
                description: string;
            };
            fecha_desde: {
                type: SchemaType;
                description: string;
            };
            fecha_hasta: {
                type: SchemaType;
                description: string;
            };
            texto?: undefined;
            limite?: undefined;
            filtro_texto?: undefined;
            solo_activos_nomina_panel?: undefined;
            fecha?: undefined;
            id_objetivo?: undefined;
            tipo?: undefined;
            id_objetivo_cercania?: undefined;
            texto_objetivo?: undefined;
            fecha_referencia?: undefined;
            id_servicio_sla?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    parameters: {
        type: SchemaType;
        properties: {
            fecha: {
                type: SchemaType;
                description: string;
            };
            id_objetivo: {
                type: SchemaType;
                description: string;
            };
            texto?: undefined;
            limite?: undefined;
            filtro_texto?: undefined;
            solo_activos_nomina_panel?: undefined;
            id_firestore_empleado?: undefined;
            fecha_desde?: undefined;
            fecha_hasta?: undefined;
            tipo?: undefined;
            id_objetivo_cercania?: undefined;
            texto_objetivo?: undefined;
            fecha_referencia?: undefined;
            id_servicio_sla?: undefined;
        };
        required: any[];
    };
} | {
    name: string;
    description: string;
    parameters: {
        type: SchemaType;
        properties: {
            fecha: {
                type: SchemaType;
                description: string;
            };
            id_objetivo: {
                type: SchemaType;
                description: string;
            };
            limite: {
                type: SchemaType;
                description: string;
            };
            texto?: undefined;
            filtro_texto?: undefined;
            solo_activos_nomina_panel?: undefined;
            id_firestore_empleado?: undefined;
            fecha_desde?: undefined;
            fecha_hasta?: undefined;
            tipo?: undefined;
            id_objetivo_cercania?: undefined;
            texto_objetivo?: undefined;
            fecha_referencia?: undefined;
            id_servicio_sla?: undefined;
        };
        required: any[];
    };
} | {
    name: string;
    description: string;
    parameters: {
        type: SchemaType;
        properties: {
            fecha: {
                type: SchemaType;
                description: string;
            };
            tipo: {
                type: SchemaType;
                description: string;
            };
            id_objetivo_cercania: {
                type: SchemaType;
                description: string;
            };
            limite: {
                type: SchemaType;
                description: string;
            };
            texto?: undefined;
            filtro_texto?: undefined;
            solo_activos_nomina_panel?: undefined;
            id_firestore_empleado?: undefined;
            fecha_desde?: undefined;
            fecha_hasta?: undefined;
            id_objetivo?: undefined;
            texto_objetivo?: undefined;
            fecha_referencia?: undefined;
            id_servicio_sla?: undefined;
        };
        required: any[];
    };
} | {
    name: string;
    description: string;
    parameters: {
        type: SchemaType;
        properties: {
            fecha: {
                type: SchemaType;
                description: string;
            };
            texto?: undefined;
            limite?: undefined;
            filtro_texto?: undefined;
            solo_activos_nomina_panel?: undefined;
            id_firestore_empleado?: undefined;
            fecha_desde?: undefined;
            fecha_hasta?: undefined;
            id_objetivo?: undefined;
            tipo?: undefined;
            id_objetivo_cercania?: undefined;
            texto_objetivo?: undefined;
            fecha_referencia?: undefined;
            id_servicio_sla?: undefined;
        };
        required: any[];
    };
} | {
    name: string;
    description: string;
    parameters: {
        type: SchemaType;
        properties: {
            id_objetivo: {
                type: SchemaType;
                description: string;
            };
            texto_objetivo: {
                type: SchemaType;
                description: string;
            };
            fecha_referencia: {
                type: SchemaType;
                description: string;
            };
            id_servicio_sla: {
                type: SchemaType;
                description: string;
            };
            texto?: undefined;
            limite?: undefined;
            filtro_texto?: undefined;
            solo_activos_nomina_panel?: undefined;
            id_firestore_empleado?: undefined;
            fecha_desde?: undefined;
            fecha_hasta?: undefined;
            fecha?: undefined;
            tipo?: undefined;
            id_objetivo_cercania?: undefined;
        };
        required: any[];
    };
} | {
    name: string;
    description: string;
    parameters: {
        type: SchemaType;
        properties: {
            fecha_referencia: {
                type: SchemaType;
                description: string;
            };
            texto?: undefined;
            limite?: undefined;
            filtro_texto?: undefined;
            solo_activos_nomina_panel?: undefined;
            id_firestore_empleado?: undefined;
            fecha_desde?: undefined;
            fecha_hasta?: undefined;
            fecha?: undefined;
            id_objetivo?: undefined;
            tipo?: undefined;
            id_objetivo_cercania?: undefined;
            texto_objetivo?: undefined;
            id_servicio_sla?: undefined;
        };
        required: any[];
    };
})[];
export declare const ASSISTANT_TOOL_ROUNDS_MAX = 6;
