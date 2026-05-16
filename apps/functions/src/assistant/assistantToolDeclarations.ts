import { SchemaType } from '@google/generative-ai';

/** Declaraciones para Gemini — nombres en snake_case estable. */
export const ASSISTANT_FUNCTION_DECLARATIONS = [
  {
    name: 'buscar_empleados_por_nombre',
    description:
      'Busca colaboradores por fragmento de nombre o apellido (orden libre: «Romina Romero» encuentra legajo con lastName/firstName o name «APELLIDO, NOMBRE»), o por número de legajo. Devuelve idFirestore para consultar_turnos_empleado y resumen_horas_empleado_periodo. Si hay varias coincidencias, pedí aclaración antes de afirmar presencia.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        texto: { type: SchemaType.STRING, description: 'Texto libre ejemplo "Gomez" o "Maria L"' },
        limite: { type: SchemaType.NUMBER, description: '1 a 15, default implícito 8 si omitís.' },
      },
      required: ['texto'],
    },
  },
  {
    name: 'listado_empleados_empresa',
    description:
      'Lista nombres de colaboradores de la empresa (legajo apellido/nombre, id Firestore, número de legajo si existe). Usalo cuando pidan «quiénes hay», «nómina de nombres», «empleados de la empresa» sin saber el apellido exacto. Opcional filtro_texto (misma lógica flexible que buscar_empleados_por_nombre). Opcional solo_activos_nomina_panel=true para alinear a la tarjeta de nómina del panel. Si la lista trunca, pedí filtro o ver RRHH.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        filtro_texto: {
          type: SchemaType.STRING,
          description: 'Opcional. Fragmento apellido/nombre/legajo; si omitís, lista ordenada hasta limite.',
        },
        limite: { type: SchemaType.NUMBER, description: '8 a 120 filas, default 48.' },
        solo_activos_nomina_panel: {
          type: SchemaType.BOOLEAN,
          description: 'Si true, solo status activo/active/activa como tarjeta EMPLEADOS EN NÓMINA del panel.',
        },
      },
      required: [],
    },
  },
  {
    name: 'buscar_objetivos_por_nombre',
    description:
      'Resuelve nombre de sede/objetivo (o fragmento) a id_objetivo Firestore dentro de los clientes de la empresa (CRM). Usalo antes de listado_franco_ret_dia con id_objetivo_cercania cuando el usuario no pasó el id. Devuelve nombre_cliente y tiene_coordenadas. Si ambigua, pedí aclaración.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        texto: { type: SchemaType.STRING, description: 'Ej. "Casino", "Ministerio", "Planta Norte"' },
        limite: { type: SchemaType.NUMBER, description: '1 a 20, default 12.' },
      },
      required: ['texto'],
    },
  },
  {
    name: 'consultar_turnos_empleado',
    description:
      'Lista turnos reales desde Firestore de un legajo por idFirestore (colección empleados) en un rango de fechas inclusivo zona AR. Usá esto para saber si estaba planificado, borrador u operativo, y señales de presencia cuando existan.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        id_firestore_empleado: {
          type: SchemaType.STRING,
          description:
            'ID del doc empleados. Omití solo portal empleado (se fuerza automático el propio). Backoffice debe obtener id vía buscar_empleados_por_nombre salvo ya lo sepas.',
        },
        fecha_desde: {
          type: SchemaType.STRING,
          description:
            'YYYY-MM-DD desde (inclusive). Para "hoy" usá fechaReferenciaCliente (misma en desde y hasta si un solo día).',
        },
        fecha_hasta: { type: SchemaType.STRING, description: 'YYYY-MM-DD hasta (inclusive).' },
      },
      required: ['fecha_desde', 'fecha_hasta'],
    },
  },
  {
    name: 'resumen_presencias_objetivos_dia',
    description:
      'Para preguntas agregadas del tipo «cuántos presentes hay hoy», «resumen por objetivo», «cuántos ausentes», etc.: consulta turnos del día (zona AR) limitados a la empresa del usuario y alineados a la lógica del monitor de Operaciones. Usá fecha YYYY-MM-DD = fechaReferenciaCliente si el usuario dice "hoy". Opcional id_objetivo para un solo objetivo.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        fecha: {
          type: SchemaType.STRING,
          description: 'Día a analizar YYYY-MM-DD. Si omitís, se usa el hoy del cliente.',
        },
        id_objetivo: {
          type: SchemaType.STRING,
          description: 'Si el usuario nombra un objetivo puntual y ya conocés su id Firestore, filtrá; si no, omití y resumí toda la empresa.',
        },
      },
      required: [],
    },
  },
  {
    name: 'listado_turnos_operativos_dia',
    description:
      'Lista nombres/horarios/objetivos de los turnos visibles para la empresa un día (misma vista que Operaciones). Usalo para «quién está de turno hoy», «qué obligaciones tiene el equipo hoy». Fecha opcional (= hoy cliente). Opcional limite 8–120 filas si el usuario sólo necesita muestra.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        fecha: { type: SchemaType.STRING, description: 'YYYY-MM-DD; omitir = hoy del cliente.' },
        id_objetivo: {
          type: SchemaType.STRING,
          description: 'Filtrar un objetivo por id sólo si lo tenés; si no omití.',
        },
        limite: { type: SchemaType.NUMBER, description: 'Filas máximas en muestra_turnos (8–120, default implícito 96).' },
      },
      required: [],
    },
  },
  {
    name: 'listado_franco_ret_dia',
    description:
      'Para «quién está de franco», «quién en RET», listado por día: turnos F/FF/FP/FT o código RET en objetivos de la empresa (incluye planificación/borrador; no es el mismo filtro que cobertura operativa). Con id_objetivo_cercania + coordenadas en CRM y legajos, ordena candidatos por distancia Haversine km al objetivo (útil para «el más cercano en franco/RET a tal sitio»).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        fecha: { type: SchemaType.STRING, description: 'YYYY-MM-DD; omitir = hoy del cliente.' },
        tipo: {
          type: SchemaType.STRING,
          description: 'franco | ret | ambos (default ambos). Franco = códigos F, FF, FP, FT. RET = código RET.',
        },
        id_objetivo_cercania: {
          type: SchemaType.STRING,
          description:
            'Id Firestore del objetivo (CRM). Si el usuario dio sólo el nombre del sitio, llamá antes buscar_objetivos_por_nombre y usá id_objetivo de la coincidencia. Con coordenadas en CRM y legajos, la respuesta ordena por distancia km.',
        },
        limite: { type: SchemaType.NUMBER, description: 'Máximo de filas (8–160, default 80).' },
      },
      required: [],
    },
  },
  {
    name: 'contar_servicios_sla_vigentes_empresa',
    description:
      'Para «cuántos servicios activos», SLA del mes, tarjeta del panel: devuelve cuenta_para_tarjeta_servicios_activos_del_mes (misma lógica que el KPI del módulo Servicios / panel) y cuenta_objetivos_distintos_con_sla_en_ese_mes. Para «vigentes hoy» contractual estricto mirá cuenta_contratos_vigentes_en_el_dia_referencia. Usar SIEMPRE que pidan número; no inventar cifras.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        fecha: {
          type: SchemaType.STRING,
          description: 'YYYY-MM-DD del «hoy». Si omitís usar la fechaReferenciaCliente del contexto.',
        },
      },
      required: [],
    },
  },
  {
    name: 'resumen_horas_objetivo_sla_periodo',
    description:
      'Para «cuántas horas a planificar», «horas vendidas del SLA», «hs planificadas vs vendidas» de un objetivo/servicio en un mes: calcula horas_vendidas_sla_mes desde servicios_sla (mismo motor que Servicios y SLA) y horas_ya_planificadas_turnos_mes desde turnos del objetivo; devuelve horas_pendientes_a_planificar = vendidas − planificadas. Usar cuando ya nombraron el sitio/contrato (ej. tras contar_servicios_sla) o con texto_objetivo / id_objetivo. fecha_referencia = cualquier día del mes (ej. junio → 2026-06-15). Si el hilo previo citó **CLIENTE - OBJETIVO**, pasá texto_objetivo con el nombre del objetivo.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        id_objetivo: {
          type: SchemaType.STRING,
          description: 'Id Firestore del objetivo (CRM). Preferible si ya lo tenés de buscar_objetivos_por_nombre.',
        },
        texto_objetivo: {
          type: SchemaType.STRING,
          description: 'Fragmento del nombre del objetivo/sede si no tenés id (ej. "Obrador Malagueño", "CASISA").',
        },
        fecha_referencia: {
          type: SchemaType.STRING,
          description: 'YYYY-MM-DD dentro del mes a analizar; omitir = hoy del cliente.',
        },
        id_servicio_sla: {
          type: SchemaType.STRING,
          description: 'Opcional. Id o prefijo del doc servicios_sla si hay varios contratos para el mismo objetivo.',
        },
      },
      required: [],
    },
  },
  {
    name: 'resumen_horas_empleado_periodo',
    description:
      'Para «cuántas horas trabajó / tiene planificadas» un colaborador en un rango (semana, quincena, mes): agrega turnos Firestore del legajo con totales horas_planificadas_cobertura (excluye francos/licencias/RET según códigos estándar) y horas_reales_fichadas_sumadas cuando hay fichada y turno completado. Usar después de buscar_empleados_por_nombre si no hay id. Rango máximo ~98 días. No es liquidación legal: remitir a Reportes si piden noche/feriado/CCT fino.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        id_firestore_empleado: {
          type: SchemaType.STRING,
          description: 'ID documento empleados. Portal empleado: se ignora y se usa el propio legajo.',
        },
        fecha_desde: { type: SchemaType.STRING, description: 'YYYY-MM-DD inicio inclusive (zona AR).' },
        fecha_hasta: { type: SchemaType.STRING, description: 'YYYY-MM-DD fin inclusive.' },
      },
      required: ['fecha_desde', 'fecha_hasta'],
    },
  },
  {
    name: 'contar_empleados_plantilla_empresa',
    description:
      'Para «cuántos empleados en nómina», «vigiladores en plantilla», tarjeta del panel: devuelve cuenta_para_tarjeta_panel_empleados_nomina (status explícito activo/activo/activa, igual que el dashboard). cuenta_legajos_operativos_criterio_rrhh_incluye_sin_estado es el criterio amplio de lista RRHH (incluye legajos sin estado). NO sustituye «cuántos tienen turno hoy en planificación» salvo que lo pidan explícito.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        fecha_referencia: {
          type: SchemaType.STRING,
          description:
            'YYYY-MM-DD para rotular «hoy» / mes (default fechaReferenciaCliente). No filtra altas/bajas históricas por fecha si el legajo no tiene esos campos.',
        },
      },
      required: [],
    },
  },
];

export const ASSISTANT_TOOL_ROUNDS_MAX = 6;
