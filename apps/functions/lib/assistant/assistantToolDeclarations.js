"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSISTANT_TOOL_ROUNDS_MAX = exports.ASSISTANT_FUNCTION_DECLARATIONS = void 0;
exports.getFilteredDeclarations = getFilteredDeclarations;
const generative_ai_1 = require("@google/generative-ai");
exports.ASSISTANT_FUNCTION_DECLARATIONS = [
    {
        name: 'buscar_empleados_por_nombre',
        description: 'Busca colaboradores por fragmento de nombre o apellido (orden libre: «Romina Romero» encuentra legajo con lastName/firstName o name «APELLIDO, NOMBRE»), o por número de legajo. Devuelve idFirestore para consultar_turnos_empleado y resumen_horas_empleado_periodo. Si hay varias coincidencias, pedí aclaración antes de afirmar presencia.',
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
        name: 'listado_empleados_empresa',
        description: 'Lista nombres de colaboradores de la empresa (legajo apellido/nombre, id Firestore, número de legajo si existe). Usalo cuando pidan «quiénes hay», «nómina de nombres», «empleados de la empresa» sin saber el apellido exacto. Opcional filtro_texto (misma lógica flexible que buscar_empleados_por_nombre). Opcional solo_activos_nomina_panel=true para alinear a la tarjeta de nómina del panel. Si la lista trunca, pedí filtro o ver RRHH.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                filtro_texto: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Opcional. Fragmento apellido/nombre/legajo; si omitís, lista ordenada hasta limite.',
                },
                limite: { type: generative_ai_1.SchemaType.NUMBER, description: '8 a 120 filas, default 48.' },
                solo_activos_nomina_panel: {
                    type: generative_ai_1.SchemaType.BOOLEAN,
                    description: 'Si true, solo status activo/active/activa como tarjeta EMPLEADOS EN NÓMINA del panel.',
                },
            },
            required: [],
        },
    },
    {
        name: 'contar_clientes_empresa',
        description: 'Cuenta clientes de la empresa en CRM (colección clients): activos, inactivos y total de objetivos/sedes embebidos. Usar para «cuántos clientes tenemos», «clientes activos». Para **listar nombres** (lista completa, todos los clientes) usá **listado_clientes_empresa**.',
        parameters: { type: generative_ai_1.SchemaType.OBJECT, properties: {}, required: [] },
    },
    {
        name: 'listado_clientes_empresa',
        description: 'Lista **todos** los nombres de clientes CRM de la empresa (activos por defecto). Usar para «qué clientes hay», «lista completa de clientes», «los demás clientes», «listado de todos los clientes». No confundir con contar_clientes_empresa (solo cuenta + muestra de 10).',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                solo_activos: {
                    type: generative_ai_1.SchemaType.BOOLEAN,
                    description: 'Si true (default), solo clientes activos.',
                },
                limite: { type: generative_ai_1.SchemaType.NUMBER, description: 'Máximo de filas (default 120).' },
            },
            required: [],
        },
    },
    {
        name: 'auditar_completitud_datos_clientes_empresa',
        description: 'Revisa si los clientes CRM tienen datos recomendados completos: CUIT, razón social, contacto, dirección/ciudad y al menos un objetivo/sede. Usar para «¿tienen todos los datos completados?», «clientes con datos incompletos», «falta CUIT/contacto», «auditar CRM». Opcional filtrar un cliente por nombre.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                solo_activos: {
                    type: generative_ai_1.SchemaType.BOOLEAN,
                    description: 'Si true (default), solo clientes activos.',
                },
                limite: { type: generative_ai_1.SchemaType.NUMBER, description: 'Máximo de incompletos en la muestra (default 45).' },
                texto_cliente: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Opcional: auditar solo clientes cuyo nombre contenga este texto.',
                },
            },
            required: [],
        },
    },
    {
        name: 'listar_objetivos_cliente',
        description: 'Lista objetivos/sedes embebidos de un cliente por nombre comercial (ej. CASISA, Lotería). Usar para «objetivos de CASISA», «cuántas sedes tiene el cliente X».',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                texto_cliente: { type: generative_ai_1.SchemaType.STRING, description: 'Fragmento del nombre del cliente en CRM.' },
                limite: { type: generative_ai_1.SchemaType.NUMBER, description: 'Máximo de objetivos a listar (default 40, máx 60).' },
            },
            required: ['texto_cliente'],
        },
    },
    {
        name: 'contar_empleados_plantilla_empresa',
        description: 'Cuenta legajos de la empresa: cuenta_para_tarjeta_panel_empleados_nomina (misma regla que tarjeta EMPLEADOS EN NÓMINA del panel) y criterio amplio RRHH. Usar para «cuántos empleados en nómina/plantilla».',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                fecha_referencia: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD opcional para rotular el mes.' },
            },
            required: [],
        },
    },
    {
        name: 'buscar_objetivos_por_nombre',
        description: 'Resuelve nombre de sede/objetivo (o fragmento) a id_objetivo Firestore dentro de los clientes de la empresa (CRM). Usalo antes de listado_franco_ret_dia con id_objetivo_cercania cuando el usuario no pasó el id. Devuelve nombre_cliente y tiene_coordenadas. Si ambigua, pedí aclaración.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                texto: { type: generative_ai_1.SchemaType.STRING, description: 'Ej. "Casino", "Ministerio", "Planta Norte"' },
                limite: { type: generative_ai_1.SchemaType.NUMBER, description: '1 a 20, default 12.' },
            },
            required: ['texto'],
        },
    },
    {
        name: 'consultar_turnos_empleado',
        description: 'Lista turnos reales desde Firestore de un legajo por idFirestore en un rango de fechas (zona AR). Usá para «detalle de los turnos», «mostrame los turnos de X en mayo», seguimiento tras resumen_horas_empleado_periodo. Si el hilo ya nombró a la persona (ej. Romina Romero), buscar_empleados primero si no tenés id. Devuelve día, código, objetivo, borrador y presencia.',
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
        description: 'Lista nombres/horarios/objetivos de los turnos visibles para la empresa un día (misma vista que Operaciones). Usalo para «quién está de turno hoy/mañana», «a las 7 quién trabaja», «quién está presente en [objetivo]». Fecha opcional (= hoy cliente). Filtrá con hora_inicio_cor (ej. 07:00), codigo_turno (M/T/N) o solo_estado_presencia=presente si el usuario acota hora, banda o presentes. **No** usar para «mis turnos» del usuario logueado — consultar_turnos_empleado con su legajo.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                fecha: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD; omitir = hoy del cliente.' },
                id_objetivo: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Filtrar un objetivo por id sólo si lo tenés; si no omití.',
                },
                hora_inicio_cor: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Hora inicio Cordoba HH:MM (ej. 07:00) si preguntan «a las 7», «07 hs».',
                },
                codigo_turno: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Código CCT M/T/N si preguntan banda mañana/tarde/noche sin hora exacta.',
                },
                solo_estado_presencia: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'presente | ausente | sin_marcacion — ej. «quién está presente en CASISA» → presente.',
                },
                limite: { type: generative_ai_1.SchemaType.NUMBER, description: 'Filas máximas en muestra_turnos (8–120, default implícito 96).' },
            },
            required: [],
        },
    },
    {
        name: 'listado_franco_ret_dia',
        description: 'Para «quién está de franco», «quién en RET», listado por día: turnos F/FF/FP/FT o código RET en objetivos de la empresa (incluye planificación/borrador). Devuelve resumen_por_objetivo con nombres de legajos (desde RRHH) y filas[].empleado. Con id_objetivo_cercania ordena por distancia Haversine km al objetivo. **No** usar para «faltaron», «ausentes» ni «licencia» — usá listado_ausentes_licencias_dia.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                fecha: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD; omitir = hoy del cliente.' },
                tipo: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'franco | ret | ambos (default ambos). Franco = códigos F, FF, FP, FT. RET = código RET.',
                },
                id_objetivo_cercania: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Id Firestore del objetivo (CRM). Si el usuario dio sólo el nombre del sitio, llamá antes buscar_objetivos_por_nombre y usá id_objetivo de la coincidencia. Con coordenadas en CRM y legajos, la respuesta ordena por distancia km.',
                },
                limite: { type: generative_ai_1.SchemaType.NUMBER, description: 'Máximo de filas (8–160, default 80).' },
            },
            required: [],
        },
    },
    {
        name: 'listado_ausentes_licencias_dia',
        description: 'Para «quién faltó hoy», «ausentes», «licencias», «enfermedad/vacaciones» de un día: ausentes operativos (isAbsent en turnos visibles como Operaciones) y licencias (códigos V/L/E/A/PG/AA en turnos + colección ausencias RRHH). Devuelve resumen_por_objetivo con nombres. **No** confundir con franco (F) ni RET — eso es listado_franco_ret_dia.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                fecha: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD; omitir = hoy del cliente.' },
                tipo: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'ausentes | licencias | ambos (default ambos). «Faltaron» → ausentes; «de licencia» → licencias.',
                },
                id_objetivo: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Opcional. Filtrar un objetivo por id Firestore (CRM).',
                },
                limite: { type: generative_ai_1.SchemaType.NUMBER, description: 'Máximo de filas (8–160, default 120).' },
            },
            required: [],
        },
    },
    {
        name: 'contar_servicios_sla_vigentes_empresa',
        description: 'Para «cuántos servicios activos», SLA del mes, tarjeta del panel: devuelve cuenta_para_tarjeta_servicios_activos_del_mes (misma lógica que el KPI del módulo Servicios / panel) y cuenta_objetivos_distintos_con_sla_en_ese_mes. Para «vigentes hoy» contractual estricto mirá cuenta_contratos_vigentes_en_el_dia_referencia. Usar SIEMPRE que pidan número; no inventar cifras.',
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
    {
        name: 'resumen_horas_objetivo_sla_periodo',
        description: 'Para **un** objetivo: «cuántas horas a planificar», horas vendidas SLA vs planificadas en un mes. Si son **varios** contratos listados en el chat, usá **resumen_horas_sla_varios_objetivos** en su lugar. fecha_referencia = cualquier día del mes (ej. junio → 2026-06-15). texto_objetivo = nombre del sitio.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                id_objetivo: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Id Firestore del objetivo (CRM). Preferible si ya lo tenés de buscar_objetivos_por_nombre.',
                },
                texto_objetivo: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Fragmento del nombre del objetivo/sede si no tenés id (ej. "Obrador Malagueño", "CASISA").',
                },
                fecha_referencia: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'YYYY-MM-DD dentro del mes a analizar; omitir = hoy del cliente.',
                },
                id_servicio_sla: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Opcional. Id o prefijo del doc servicios_sla si hay varios contratos para el mismo objetivo.',
                },
            },
            required: [],
        },
    },
    {
        name: 'resumen_horas_liquidacion_empresa_periodo',
        description: 'Totales de liquidación operativa de la empresa en un mes o rango (misma lógica que Reportes): hs_reales fichadas, diurnas, nocturnas, al_100_ft (FT), al_50 (bolsa >200h), plus_feriado, bolsa_200, hs_simples. Usar para «horas extras en mayo», «horas al 100%», «diurnas y nocturnas», «cantidad para liquidar», «FT trabajados». fecha_referencia = cualquier día del mes; o fecha_desde/fecha_hasta.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                fecha_desde: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD inicio inclusive.' },
                fecha_hasta: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD fin inclusive.' },
                fecha_referencia: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Si solo dan mes (ej. mayo 2026), pasá 2026-05-15.',
                },
            },
            required: [],
        },
    },
    {
        name: 'resumen_horas_sla_varios_objetivos',
        description: 'Cuando el usuario pide SLA/horas de **varios** contratos a la vez (ej. tras listar «CASISA - Obrador», «Lotería - …» y pregunta «qué SLA tiene cada uno», «horas de cada servicio»): devuelve por cada objetivo horas_vendidas_sla_mes, horas_ya_planificadas_turnos_mes y horas_pendientes_a_planificar. Pasá textos_objetivo con el nombre del **objetivo** de cada línea (o cliente+objetivo). Si piden **solo [cliente]** (ej. solo CASISA), usá texto_cliente y no todos_servicios_activos_mes. Si no tenés lista ni cliente, todos_servicios_activos_mes=true. fecha_referencia = día del mes a analizar.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                textos_objetivo: {
                    type: generative_ai_1.SchemaType.ARRAY,
                    items: { type: generative_ai_1.SchemaType.STRING },
                    description: 'Nombres de objetivo/sede, uno por contrato listado en el chat.',
                },
                fecha_referencia: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'YYYY-MM-DD dentro del mes; omitir = hoy del cliente.',
                },
                todos_servicios_activos_mes: {
                    type: generative_ai_1.SchemaType.BOOLEAN,
                    description: 'Si true, consulta todos los contratos SLA del mes (hasta limite). No combinar con texto_cliente.',
                },
                texto_cliente: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'Filtrar SLA del mes a un cliente comercial (ej. CASISA). Usar con «solo CASISA» o «servicios activos de X».',
                },
                limite: {
                    type: generative_ai_1.SchemaType.NUMBER,
                    description: 'Máximo de objetivos a consultar (default 12, máx 20).',
                },
            },
            required: [],
        },
    },
    {
        name: 'listado_empleados_sin_turnos_planificados',
        description: 'Para «a qué colaboradores no les planifiqué turno», «empleados sin turnos en el mes», «quién no tiene nada en la grilla»: legajos activos sin ningún turno asignado en el rango (mes por defecto; F/V/L cuentan como planificación). No confundir con horas > umbral ni con ausentes del día.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                fecha_referencia: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'YYYY-MM-DD dentro del mes a evaluar (default mes de clientToday).',
                },
                fecha_desde: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD inicio inclusive.' },
                fecha_hasta: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD fin inclusive.' },
                limite: { type: generative_ai_1.SchemaType.NUMBER, description: 'Máximo de filas (default 60, máx 90).' },
                solo_activos_nomina_panel: {
                    type: generative_ai_1.SchemaType.BOOLEAN,
                    description: 'Si true, solo status activo/active/activa como tarjeta nómina del panel.',
                },
            },
            required: [],
        },
    },
    {
        name: 'listado_empleados_horas_planificadas_umbral',
        description: 'Para «vigiladores/empleados con más de 200 h planificadas en mayo», «quién supera X horas planificadas por empleado»: lista legajos cuya suma horas_planificadas_cobertura en el mes/rango supera umbral_horas (default 200). No usar para SLA de un objetivo ni bolsa 200 de liquidación/fichadas. fecha_referencia = día del mes; o fecha_desde/fecha_hasta.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                umbral_horas: {
                    type: generative_ai_1.SchemaType.NUMBER,
                    description: 'Mínimo a superar (default 200). Ej. 200 para «más de 200 hs planificadas».',
                },
                fecha_referencia: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'YYYY-MM-DD dentro del mes (ej. mayo 2026 → 2026-05-15).',
                },
                fecha_desde: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD inicio inclusive.' },
                fecha_hasta: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD fin inclusive.' },
                limite: { type: generative_ai_1.SchemaType.NUMBER, description: 'Máximo de filas en la muestra (default 40, máx 80).' },
            },
            required: [],
        },
    },
    {
        name: 'resumen_horas_empleado_periodo',
        description: 'Para «cuántas horas trabajó / tiene planificadas» un colaborador en un rango (semana, quincena, mes): agrega turnos Firestore del legajo con totales horas_planificadas_cobertura (excluye francos/licencias/RET según códigos estándar) y horas_reales_fichadas_sumadas cuando hay fichada y turno completado. Usar después de buscar_empleados_por_nombre si no hay id. Rango máximo ~98 días. No es liquidación legal: remitir a Reportes si piden noche/feriado/CCT fino.',
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                id_firestore_empleado: {
                    type: generative_ai_1.SchemaType.STRING,
                    description: 'ID documento empleados. Portal empleado: se ignora y se usa el propio legajo.',
                },
                fecha_desde: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD inicio inclusive (zona AR).' },
                fecha_hasta: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD fin inclusive.' },
            },
            required: ['fecha_desde', 'fecha_hasta'],
        },
    },
];
exports.ASSISTANT_FUNCTION_DECLARATIONS.push({
    name: 'consultar_vacantes_dia',
    description: 'Lista los turnos del día que están vacantes (isAbsent=true o sin empleado asignado) en un objetivo o en todos los objetivos de la empresa. Usá para «qué turnos quedan vacantes hoy», «hay vacantes en el Casino esta tarde», «cuántas vacantes tenemos». Devuelve objetivo, banda/código y si ya fue cubierto.',
    parameters: {
        type: generative_ai_1.SchemaType.OBJECT,
        properties: {
            fecha: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD. Default: hoy cliente.' },
            texto_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'Nombre o fragmento del objetivo para filtrar. Omití para ver todos.' },
            id_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'ID Firestore del objetivo (si ya lo tenés).' },
        },
        required: [],
    },
}, {
    name: 'resumen_ausencias_pendientes',
    description: 'Lista ausencias recientes de la empresa que aún no tienen cobertura asignada (vacantes sin resolver). Usá para «ausencias sin resolver», «quiénes faltaron y no se cubrió», «pendientes de cobertura hoy». Filtra por fecha o rango.',
    parameters: {
        type: generative_ai_1.SchemaType.OBJECT,
        properties: {
            fecha_desde: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD inicio. Default: hoy cliente.' },
            fecha_hasta: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD fin. Default: igual a fecha_desde (solo hoy).' },
            limite: { type: generative_ai_1.SchemaType.NUMBER, description: 'Máximo de filas (default 30).' },
        },
        required: [],
    },
});
exports.ASSISTANT_FUNCTION_DECLARATIONS.push({
    name: 'proponer_extender_jornada',
    description: 'Propone extender la jornada de un empleado de 8h a 12h (M→D12, T→D12, N→N12) en un objetivo y fecha. Usá cuando pidan «extendé a García», «pasá a García a 12 horas», «necesito extender el turno de X». Buscá primero al empleado con buscar_empleados_por_nombre si no tenés su id. Requiere permiso OPERATIONS.',
    parameters: {
        type: generative_ai_1.SchemaType.OBJECT,
        properties: {
            id_firestore_empleado: { type: generative_ai_1.SchemaType.STRING, description: 'ID Firestore del empleado (de buscar_empleados_por_nombre).' },
            texto_empleado: { type: generative_ai_1.SchemaType.STRING, description: 'Nombre/apellido si no tenés el id.' },
            fecha: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD del turno a extender. Default: hoy cliente.' },
            texto_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'Nombre del objetivo/sede (opcional, para desambiguar si tiene varios turnos ese día).' },
        },
        required: [],
    },
}, {
    name: 'proponer_cubrir_ausencia',
    description: 'Busca candidatos disponibles para cubrir un puesto vacante o una ausencia en un objetivo y día, siguiendo la prioridad CCT (sin turno → RET → ESC → FT). Usá cuando pidan «alguien para cubrir», «hay alguien disponible para el turno M en X», «cubrí la vacante». Si no especifican banda, usá la del turno ausente.',
    parameters: {
        type: generative_ai_1.SchemaType.OBJECT,
        properties: {
            fecha: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD. Default: hoy cliente.' },
            texto_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'Nombre del objetivo donde hay vacante.' },
            id_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'ID Firestore del objetivo (si ya lo tenés).' },
            banda: { type: generative_ai_1.SchemaType.STRING, description: 'M | T | N — turno a cubrir.' },
            id_empleado_ausente: { type: generative_ai_1.SchemaType.STRING, description: 'Opcional: ID del empleado ausente para tomar su turno exacto.' },
        },
        required: [],
    },
}, {
    name: 'proponer_crear_turno_refuerzo',
    description: 'Propone crear un turno de refuerzo (origen OPERATIONS_COVERAGE) para un empleado específico en un objetivo y fecha. Usá para «agregá un refuerzo», «mandá a García al objetivo X mañana», «necesito un refuerzo en Banco XYZ». Requiere nombre de empleado, objetivo, fecha y banda.',
    parameters: {
        type: generative_ai_1.SchemaType.OBJECT,
        properties: {
            id_firestore_empleado: { type: generative_ai_1.SchemaType.STRING, description: 'ID Firestore del empleado.' },
            texto_empleado: { type: generative_ai_1.SchemaType.STRING, description: 'Nombre si no tenés el id.' },
            fecha: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD del turno a crear.' },
            texto_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'Nombre del objetivo donde irá el refuerzo.' },
            id_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'ID Firestore del objetivo (si ya lo tenés).' },
            banda: { type: generative_ai_1.SchemaType.STRING, description: 'M | T | N | D12 | N12 — código CCT del turno.' },
        },
        required: [],
    },
}, {
    name: 'proponer_confirmar_presencia',
    description: 'Propone marcar presente a un empleado en su turno del día indicado. Usá cuando digan «marcá presente a García», «confirmar presencia de X», «llegó García». Buscá al empleado con buscar_empleados_por_nombre si no tenés id. Requiere permiso OPERATIONS:update.',
    parameters: {
        type: generative_ai_1.SchemaType.OBJECT,
        properties: {
            id_firestore_empleado: { type: generative_ai_1.SchemaType.STRING, description: 'ID Firestore del empleado.' },
            texto_empleado: { type: generative_ai_1.SchemaType.STRING, description: 'Nombre/apellido si no tenés el id.' },
            fecha: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD del turno. Default: hoy cliente.' },
            texto_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'Nombre del objetivo para desambiguar si hay más de un turno ese día.' },
            id_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'ID Firestore del objetivo (si ya lo tenés).' },
        },
        required: [],
    },
}, {
    name: 'proponer_registrar_ausencia',
    description: 'Propone registrar que un empleado estuvo ausente en su turno: marca isAbsent=true y crea doc en ausencias. Usá para «García no vino», «registrá la ausencia de X», «faltó Romero hoy». Siempre buscá primero el turno del empleado. Requiere permiso OPERATIONS:update.',
    parameters: {
        type: generative_ai_1.SchemaType.OBJECT,
        properties: {
            id_firestore_empleado: { type: generative_ai_1.SchemaType.STRING, description: 'ID Firestore del empleado.' },
            texto_empleado: { type: generative_ai_1.SchemaType.STRING, description: 'Nombre/apellido si no tenés el id.' },
            fecha: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD. Default: hoy cliente.' },
            texto_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'Nombre del objetivo para desambiguar.' },
            id_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'ID Firestore del objetivo (si ya lo tenés).' },
            motivo: { type: generative_ai_1.SchemaType.STRING, description: 'Motivo opcional: AA (injustificada), E (enfermedad), A (autorizada). Default: AA.' },
        },
        required: [],
    },
}, {
    name: 'proponer_cerrar_turno',
    description: 'Propone cerrar (checkout / completar) el turno de un empleado: isCompleted=true. Usá para «cerré el turno de García», «García ya se fue», «checkout de X». Requiere permiso OPERATIONS:update.',
    parameters: {
        type: generative_ai_1.SchemaType.OBJECT,
        properties: {
            id_firestore_empleado: { type: generative_ai_1.SchemaType.STRING, description: 'ID Firestore del empleado.' },
            texto_empleado: { type: generative_ai_1.SchemaType.STRING, description: 'Nombre/apellido si no tenés el id.' },
            fecha: { type: generative_ai_1.SchemaType.STRING, description: 'YYYY-MM-DD. Default: hoy cliente.' },
            texto_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'Nombre del objetivo para desambiguar.' },
            id_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'ID Firestore del objetivo (si ya lo tenés).' },
        },
        required: [],
    },
}, {
    name: 'proponer_planificar_objetivo_mes',
    description: 'Genera automáticamente el cronograma mensual de un objetivo aplicando CCT 422/05 (ciclo 6+2). Usá para «planificá Obrador para octubre», «generá la planificación de Casino en septiembre», «automatizá el crono de X». Los turnos se crean como borrador (draft:true) para revisión antes de publicar. Requiere permiso PLANNING:create.',
    parameters: {
        type: generative_ai_1.SchemaType.OBJECT,
        properties: {
            texto_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'Nombre del objetivo/sede a planificar (ej. «Obrador Malagueño», «Casino»).' },
            id_objetivo: { type: generative_ai_1.SchemaType.STRING, description: 'ID Firestore del objetivo (si ya lo tenés de buscar_objetivos_por_nombre).' },
            mes: { type: generative_ai_1.SchemaType.NUMBER, description: 'Número de mes 1-12 (ej. octubre = 10). Default: mes en curso.' },
            anio: { type: generative_ai_1.SchemaType.NUMBER, description: 'Año (ej. 2026). Default: año en curso.' },
        },
        required: [],
    },
}, {
    name: 'ejecutar_auto_presencia_cierre',
    description: 'Marca automáticamente presencia en los turnos que ya iniciaron sin fichar, y cierra los turnos que ya terminaron y siguen activos. Si hay un relevo pendiente (guardia que viene a reemplazar pero aún no llegó), el turno saliente queda en retención en vez de cerrarse. Ideal para «activá el modo demo», «dar presentes automáticos», «cerrar turnos que terminaron», «activá auto presencia». Con simulacion=true solo muestra qué haría sin modificar nada.',
    parameters: {
        type: generative_ai_1.SchemaType.OBJECT,
        properties: {
            simulacion: {
                type: generative_ai_1.SchemaType.BOOLEAN,
                description: 'Si true (default), solo muestra qué haría sin modificar datos (dry run). Si false, ejecuta los cambios reales.',
            },
        },
        required: [],
    },
});
exports.ASSISTANT_TOOL_ROUNDS_MAX = 4;
const WRITE_TOOL_MODULE_REQUIREMENTS = {
    proponer_extender_jornada: 'OPERATIONS',
    proponer_cubrir_ausencia: 'OPERATIONS',
    proponer_crear_turno_refuerzo: 'OPERATIONS',
    proponer_confirmar_presencia: 'OPERATIONS',
    proponer_registrar_ausencia: 'OPERATIONS',
    proponer_cerrar_turno: 'OPERATIONS',
    proponer_planificar_objetivo_mes: 'PLANNING',
    ejecutar_auto_presencia_cierre: 'OPERATIONS',
};
function getFilteredDeclarations(readableModuleKeys) {
    const moduleSet = new Set(readableModuleKeys);
    return exports.ASSISTANT_FUNCTION_DECLARATIONS.filter((decl) => {
        const req = WRITE_TOOL_MODULE_REQUIREMENTS[decl.name];
        if (!req)
            return true;
        return moduleSet.has(req);
    });
}
//# sourceMappingURL=assistantToolDeclarations.js.map