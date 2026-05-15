import { SchemaType } from '@google/generative-ai';

/** Declaraciones para Gemini — nombres en snake_case estable. */
export const ASSISTANT_FUNCTION_DECLARATIONS = [
  {
    name: 'buscar_empleados_por_nombre',
    description:
      'Busca colaboradores por fragmento de nombre o apellido dentro de la empresa del usuario admin. Devuelve idFirestore necesario para consultar_turnos_empleado. Si hay varias coincidencias, pedí aclaración antes de afirmar presencia.',
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
    name: 'contar_empleados_plantilla_empresa',
    description:
      'Para «cuántos empleados en plantilla», «cuántos legajos activos», «personal de la empresa este mes» en sentido nómina: cuenta documentos en `empleados` con empresaId actual. Activo = activo/active o sin estado (misma lógica que lista RRHH); inactivo = inactivo/inactive. NO sustituye «cuántos tienen turno cargado en la grilla del mes» salvo que el usuario pida explícitamente planificación.',
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
