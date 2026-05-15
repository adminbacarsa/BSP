/** Resumen COSP para el asistente (no documentación aparte — mantener breve). */
export const COSP_PLATFORM_KNOWLEDGE = `
COSP es un sistema para empresas de seguridad privada (Grupo Bacar): planificación de turnos, operaciones en vivo, RRHH, clientes/objetivos, servicios y SLA (modelado de cobertura y análisis de esquema 6×2/6×1/4×2), reportes y configuración por empresa.

ADMIN — Rutas típicas bajo /admin:
- Dashboard, Operaciones (/admin/operaciones): monitor turnos activos/ausentes/vacantes, fichadas y novedades.
- Planificación (/admin/planificacion): grillas mensuales por cliente/objetivo; turnos planificados vs borrador; publicación vía colección Firestore planificacion_estados.
- RRHH (/admin/rrhh): legajos, ausencias/licencias enlazadas a turnos cuando aplica.
- CRM (/admin/crm): clientes con objetivos embebidos.
- Servicios (/admin/servicios): contratos SLA, puestos; herramientas de esquema de turnos.
- Reportes (/admin/reportes), Análisis (/admin/analisis), Config (/admin/configuracion): usuarios y roles por módulos (permisos read/create/update/delete). isSuperAdmin bypasea todo.

Portal empleado (/empleado/*): el guardia ve sus turnos, puede marcar presencia según políticas GPS/portal y solicitar ausencias.

Portal cliente (/cliente/*): consultas típicas del lado cliente cuando exista ese acceso.

Turnos colección Firestore turnos — campos comunes employeeId, objectiveId, ventanas horarias/fechas según desarrollo, código CCT donde aplique, presencia/isAbsent/isCompleted, borradores (draft).

Cuando las herramientas servidor están activadas en contexto: podés consultar esos datos dentro de la empresa de la sesión y del permiso READ (no ves el DOM de la grilla pero sí turnos vinculados a legajos). Sin herramientas o con consulta ambigua en nombres: pedí aclaración y orientá en la UI como siempre.

Sesión temporal: ante dudas legales/liquidación oficial remití a RRHH/abogacía/manual interno autorizado.
`.trim();

export const ADMIN_MODULE_ROUTE_HINTS: Record<string, string> = {
  DASHBOARD: '/admin — panel principal.',
  OPERATIONS: '/admin/operaciones — operaciones tiempo real.',
  PLANNING: '/admin/planificacion — planificación y turnos.',
  PLANNING_AI: '/admin/planificacion — IA de ajuste fino dentro de planificación.',
  RRHH: '/admin/rrhh — legajos, ausencias, novedades de personal.',
  CLIENTS: '/admin/crm — clientes y objetivos.',
  SERVICES: '/admin/servicios — servicios contratados / SLA.',
  REPORTS: '/admin/reportes — reportes y liquidación.',
  ANALYSIS: '/admin/analisis — análisis operativo.',
  CONFIG: '/admin/configuracion — empresa, usuarios, roles.',
};

export const KNOWN_ADMIN_MODULE_KEYS = Object.keys(ADMIN_MODULE_ROUTE_HINTS);

/**
 * Guías operativas concretas (UX) injectadas sólo cuando el moduleKey coincide.
 * Mantener alineadas con la página real donde sea posible.
 */
const PLANNING_OPS = `
Planificación (/admin/planificacion): la vista central es una **grilla mensual** (los días del mes suelen aparecer como columnas y cada fila suele corresponder al personal cargado por objetivo). Hay selectores/sección de contexto para **Cliente** y **Objetivo** antes de poder interpretar la grilla para un sitio puntual.

Para ubicar quién tiene algo planificado en un día dado dentro de ese mes:
1. Asegurate de tener **Cliente** y **Objetivo** correctos.
2. Mové el período navegador de fecha/mes (flechas o control de período cercano al título) hasta el **mes que contiene el día**.
3. En la **grilla**, ubicá **la columna del día buscado** y recorré las filas de guardias: la celda muestra código CCT/franco/licencia/etc. donde esté cargado algo.
4. Si el objetivo muestra sólo coberturas operativas o “no aparece” la planificación al guardia hasta que RRHH/publique: mencioná **publicación de planificación** del mes/objetivo (documento planificacion_estados en backend; en UI suele estar el flujo «publicar/notificar cronograma» cuando el usuario lo use).
`.trim();

const OPERATIONS_OPS = `
Operaciones (/admin/operaciones): monitor en tiempo cercano por objetivos/puestos; vacantes, ausencias tardías, fichadas. Usá filtros de fecha/período o barra lateral según apareza en esa versión cuando el usuario no vea algo.
`.trim();

const RRHH_OPS = `
RRHH (/admin/rrhh): legajos por empleado; ausencias y licencias; novedades. Para turnos específicos a veces se cruza desde el legajo → ausencias enlazadas a shiftId donde aplique.
`.trim();

const SERVICES_OPS = `
Servicios (/admin/servicios): contratos SLA, puestos y modelado operativo sin costeo. Cambios pueden impactar qué combinaciones código/puesto permite el planificador.
`.trim();

const REPORTS_OPS = `
Reportes (/admin/reportes): exportes/consultas de horas liquidación según período y filtros. Recordá período/fecha correctos ante totales inconsistentes.
`.trim();

const CLIENTS_OPS = `
CRM (/admin/crm): clientes con **objetivos** embebidos. Objetivos alimentan servicios SLA y después el selector de objetivo en planificación.
`.trim();

const CONFIG_OPS = `
Configuración (/admin/configuracion): empresa, usuarios y **roles**/permiso por módulo (read/create/update/delete). Si algo “no aparece”: rol/módulo.
`.trim();

const EMPLOYEE_PORTAL_OPS = `
Portal empleado (/empleado/*): sólo vista propia — turnos aceptados/recibidos, marcar presencia según política, solicitar ausencias. No rutas administrativas salvo mención breve.
`.trim();

const CLIENT_PORTAL_OPS = `
Portal cliente (/cliente/*): consultas y datos limitados según ese diseño — sin información de otros contratos/clientes.
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
    'Análisis (/admin/analisis): métricas y vistas agregadas; probá período/objetivos visibles cuando no cuadren totales.',
  CONFIG: CONFIG_OPS,
  DASHBOARD:
    'Dashboard (/admin): atajo a KPIs/atención rápida; la guía puntual viene del módulo al que lleve cada tarjeta o menú lateral.',
  EMPLOYEE_PORTAL: EMPLOYEE_PORTAL_OPS,
  CLIENT_PORTAL: CLIENT_PORTAL_OPS,
};

export function operationalGuideForModuleKey(moduleKey: string | null | undefined): string {
  const k = typeof moduleKey === 'string' ? moduleKey.trim() : '';
  if (!k || !MODULE_OPS[k]) return '';
  return `GUÍA OPERATIVA (moduleKey="${k}" — sólo usar si la pregunta es procedimental/UI):\n${MODULE_OPS[k]}`;
}
