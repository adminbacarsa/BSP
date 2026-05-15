/** Resumen COSP para el asistente (no documentación aparte — mantener breve). */
export const COSP_PLATFORM_KNOWLEDGE = `
COSP es un sistema para empresas de seguridad privada (Grupo Bacar): planificación de turnos, operaciones en vivo, RRHH, clientes/objetivos, servicios y SLA (modelado de cobertura y análisis de esquema 6×2/6×1/4×2), reportes y configuración por empresa.

ADMIN — Rutas típicas bajo /admin:
- Dashboard, Operaciones (/admin/operaciones): monitor turnos activos/ausentes/vacantes, fichadas y novedades.
- Planificación (/admin/planificacion): armado de grillas por objetivo/guardias; hay reglas de origen turno planificado vs operativo y publicación vía planificacion_estados.
- RRHH (/admin/rrhh): legajos, ausencias/licencias enlazadas a turnos cuando aplica.
- CRM (/admin/crm): clientes con objetivos embebidos.
- Servicios (/admin/servicios): contratos SLA, puestos; asistente de turnos/roación sin costeo.
- Reportes (/admin/reportes), Análisis (/admin/analisis), Config (/admin/configuracion): usuarios y roles por módulos (permisos read/create/update/delete). isSuperAdmin bypasea todo.

Portal empleado (/empleado/*): guardia ve sus turnos, puede marcar presencia según políticas GPS/portal y solicitar ausencias; no administra cuenta de otros.

Portal cliente (/cliente/* si existe): accesos/consultas del lado cliente; más acotado.

Turnos Firestore colección turnos — campos comunes employeeId, objectiveId, start/end, status, código CCT si aplica, presencia/isAbsent/isCompleted, borradores (draft), vacantes sin asignación. No inventar IDs ni datos específicos de un día: cuando no conocés estado real, guiá rutas paso a paso y revisá filtros/períodos.

Sesión temporaria: este chat es orientativo por ruta/perfil visible; ante dudas legales o liquidación oficial remití a RRHH/abogacía/manual interno autorizado.

Respuestas: español Argentina, cortas y prácticas, sin inventar rutas nuevas fuera del patrón /admin/, /empleado/, /cliente/.
`.trim();

export const ADMIN_MODULE_ROUTE_HINTS: Record<string, string> = {
  DASHBOARD: '/admin — panel principal.',
  OPERATIONS: '/admin/operaciones — operaciones tiempo real.',
  PLANNING: '/admin/planificacion — planificación y turnos.',
  PLANNING_AI: '/admin/planificacion — optimización/IA dentro de planificación.',
  RRHH: '/admin/rrhh — legajos, ausencias, novedades de personal.',
  CLIENTS: '/admin/crm — clientes y objetivos.',
  SERVICES: '/admin/servicios — servicios contratados / SLA.',
  REPORTS: '/admin/reportes — reportes y liquidación.',
  ANALYSIS: '/admin/analisis — análisis operativo.',
  CONFIG: '/admin/configuracion — empresa, usuarios, roles.',
};

export const KNOWN_ADMIN_MODULE_KEYS = Object.keys(ADMIN_MODULE_ROUTE_HINTS);
