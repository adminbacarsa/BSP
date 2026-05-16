/** Resumen COSP para el asistente (no documentación aparte — mantener breve). */
export const COSP_PLATFORM_KNOWLEDGE = `
COSP es un sistema para empresas de seguridad privada (Grupo Bacar): planificación de turnos, operaciones en vivo, RRHH, clientes/objetivos, servicios y SLA (modelado de cobertura y análisis de esquema 6×2/6×1/4×2), reportes y configuración por empresa.

ADMIN — módulos típicos (menú lateral; al hablar con el usuario usá estos nombres, no URLs):
- Dashboard y Operaciones: monitor turnos activos/ausentes/vacantes, fichadas y novedades.
- Planificación y turnos: grillas mensuales por cliente/objetivo; planificado vs borrador; publicación vía colección Firestore planificacion_estados.
- RRHH: legajos, ausencias/licencias enlazadas a turnos cuando aplica.
- Clientes y objetivos (CRM): clientes con objetivos embebidos.
- Servicios y SLA: contratos SLA, puestos; herramientas de esquema de turnos.
- Reportes, Análisis operativo, Configuración: exportes y métricas; usuarios y roles por módulo (permisos read/create/update/delete). isSuperAdmin bypasea todo.

Portal empleado (vista guardia): turnos propios, presencia según políticas GPS/portal, solicitud de ausencias.

Portal cliente: consultas típicas del lado cliente cuando exista ese acceso.

Turnos colección Firestore turnos — campos comunes employeeId, objectiveId, ventanas horarias/fechas según desarrollo, código CCT donde aplique, presencia/isAbsent/isCompleted, borradores (draft). El servidor puede **totalizar horas planificadas de cobertura y horas reales fichadas** por colaborador y rango con **resumen_horas_empleado_periodo**; y **horas vendidas del SLA vs horas ya planificadas en la grilla** por objetivo/mes con **resumen_horas_objetivo_sla_periodo** (mismo criterio que comparar «Vendidas» vs «Hs. Plan.» en Planificación). Liquidación fina con nocturnas/feriados sigue en **Reportes y liquidación**.

Cuando las herramientas servidor están activadas: los datos concretos de la empresa (números, nombres, turnos) salen **solo** de esas lecturas Firestore; este párrafo describe el producto, no el contenido de la base. Sin herramientas o con nombres ambiguos: pedí aclaración y orientá en la UI.

Sesión temporal: ante dudas legales/liquidación oficial remití a RRHH/abogacía/manual interno autorizado.
`.trim();

/** Etiquetas cortas para el prompt (sin URLs; el asistente no debe repetir rutas al usuario salvo que pida la URL). */
export const ADMIN_MODULE_ROUTE_HINTS: Record<string, string> = {
  DASHBOARD: 'Panel principal (resumen y atajos).',
  OPERATIONS: 'Operaciones — monitor en tiempo real, vacantes, fichadas.',
  PLANNING: 'Planificación — grilla mensual, cliente/objetivo, publicar cronograma.',
  PLANNING_AI: 'Planificación — asistente de ajuste fino en la misma pantalla.',
  RRHH: 'RRHH — legajos, ausencias, licencias.',
  CLIENTS: 'Clientes y objetivos (CRM).',
  SERVICES: 'Servicios y SLA — contratos, puestos, esquemas de turno.',
  REPORTS: 'Reportes — horas y exportes.',
  ANALYSIS: 'Análisis operativo — métricas agregadas.',
  CONFIG: 'Configuración — empresa, usuarios y permisos.',
};

export const KNOWN_ADMIN_MODULE_KEYS = Object.keys(ADMIN_MODULE_ROUTE_HINTS);

/**
 * Guías operativas concretas (UX) injectadas sólo cuando el moduleKey coincide.
 * Mantener alineadas con la página real donde sea posible.
 */
const PLANNING_OPS = `
Planificación: la vista central es una **grilla mensual** (los días del mes suelen aparecer como columnas y cada fila suele corresponder al personal cargado por objetivo). Hay selectores/sección de contexto para **Cliente** y **Objetivo** antes de poder interpretar la grilla para un sitio puntual.

Para ubicar quién tiene algo planificado en un día dado dentro de ese mes:

1. Asegurate de tener **Cliente** y **Objetivo** correctos.

2. Mové el período navegador de fecha/mes (flechas o control de período cercano al título) hasta el **mes que contiene el día**.

3. En la **grilla**, ubicá **la columna del día buscado** y recorré las filas de guardias: la celda muestra código CCT/franco/licencia/etc. donde esté cargado algo.

4. Si el objetivo muestra sólo coberturas operativas o “no aparece” la planificación al guardia hasta que RRHH/publique: mencioná **publicación de planificación** del mes/objetivo (documento planificacion_estados en backend; en UI suele estar el flujo «publicar/notificar cronograma» cuando el usuario lo use).
`.trim();

const OPERATIONS_OPS = `
Operaciones: monitor en tiempo cercano por objetivos/puestos; vacantes, ausencias tardías, fichadas. Usá filtros de fecha/período o barra lateral según apareza en esa versión cuando el usuario no vea algo.
`.trim();

const RRHH_OPS = `
RRHH: legajos por empleado; ausencias y licencias; novedades. Para turnos específicos a veces se cruza desde el legajo → ausencias enlazadas a shiftId donde aplique.
`.trim();

const SERVICES_OPS = `
Servicios y SLA: contratos, puestos y modelado operativo sin costeo. Cambios pueden impactar qué combinaciones código/puesto permite el planificador.
`.trim();

const REPORTS_OPS = `
Reportes: exportes/consultas de horas liquidación según período y filtros. Recordá período/fecha correctos ante totales inconsistentes.
`.trim();

const CLIENTS_OPS = `
Clientes y objetivos (CRM): clientes con **objetivos** embebidos. Objetivos alimentan servicios SLA y después el selector de objetivo en planificación.
`.trim();

const CONFIG_OPS = `
Configuración: empresa, usuarios y **roles**/permiso por módulo (read/create/update/delete). Si algo “no aparece”: rol/módulo.
`.trim();

const EMPLOYEE_PORTAL_OPS = `
Portal empleado: sólo vista propia — turnos aceptados/recibidos, marcar presencia según política, solicitar ausencias. No orientar con URLs de administración salvo el usuario pregunte por el acceso de oficina.
`.trim();

const CLIENT_PORTAL_OPS = `
Portal cliente: consultas y datos limitados según ese diseño — sin información de otros contratos/clientes.
`.trim();

/** Texto español corto por clave inferida en cliente. */
const MODULE_OPS: Record<string, string> = {
  PLANNING: PLANNING_OPS,
  PLANNING_AI: PLANNING_OPS,
  OPERATIONS: OPERATIONS_OPS,
  RRHH: RRHH_OPS,
  CLIENTS: CLIENTS_OPS,
  SERVICES: SERVICES_OPS,
  REPORTS: REPORTS_OPS,
  ANALYSIS:
    'Análisis operativo: métricas y vistas agregadas; probá período/objetivos visibles cuando no cuadren totales.',
  CONFIG: CONFIG_OPS,
  DASHBOARD:
    'Dashboard: atajo a KPIs/atención rápida; la guía puntual viene del módulo al que lleve cada tarjeta o menú lateral.',
  EMPLOYEE_PORTAL: EMPLOYEE_PORTAL_OPS,
  CLIENT_PORTAL: CLIENT_PORTAL_OPS,
};

export function operationalGuideForModuleKey(moduleKey: string | null | undefined): string {
  const k = typeof moduleKey === 'string' ? moduleKey.trim() : '';
  if (!k || !MODULE_OPS[k]) return '';
  return `GUÍA OPERATIVA (moduleKey="${k}" — sólo usar si la pregunta es procedimental/UI):\n${MODULE_OPS[k]}`;
}
