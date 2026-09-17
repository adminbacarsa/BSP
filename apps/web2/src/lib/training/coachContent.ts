/**
 * Contenido del coach in-situ por módulo, paso y ruta.
 * Cada entrada define qué mostrarle al alumno y en qué ruta debe estar.
 */

export interface CoachStep {
  moduleKey: string;
  stepId: string;
  title: string;
  instruction: string;
  hint?: string;
  targetRoute: string;
  targetRouteLabel: string;
  highlightSelector?: string;
}

export const COACH_STEPS: CoachStep[] = [
  // ── CLIENTS ────────────────────────────────────────────────────────────────
  {
    moduleKey: 'CLIENTS',
    stepId: 'crear_cliente',
    title: '¿Qué es un Cliente? Creá el primero',
    instruction:
      'Un **cliente** es la empresa o institución que contrata tus servicios de seguridad. ' +
      'Antes de planificar cualquier guardia, el sistema necesita saber para quién trabajás.\n\n' +
      '**Paso a paso:**\n' +
      '1. Mirá arriba a la derecha: el botón naranja **"+ CLIENTE"** — hacé clic ahí.\n' +
      '2. En **Nombre comercial** escribí: **Banco del Sur SA**\n' +
      '3. En **Razón social** escribí: **Banco del Sur Sociedad Anónima**\n' +
      '4. En **Dirección** escribí: **Av. Corrientes 1234, CABA**\n' +
      '5. Clic en **CREAR CLIENTE** para guardar.',
    hint: '💡 Si tenés el CUIT del cliente, escribilo y hacé clic en AFIP — el sistema autocompleta razón social e impuestos del padrón.',
    targetRoute: '/admin/crm',
    targetRouteLabel: 'CRM',
    highlightSelector: '[data-action="nuevo-cliente"]',
  },
  {
    moduleKey: 'CLIENTS',
    stepId: 'crear_objetivo',
    title: '¿Qué es una Sede? Creá el primer objetivo',
    instruction:
      'Una **sede u objetivo** es el lugar físico donde vas a prestar el servicio: una sucursal, un edificio, una planta. ' +
      'El sistema la pone en el mapa y la usa para GPS de los guardias.\n\n' +
      '**Paso a paso:**\n' +
      '1. Hacé clic en **VER DETALLE** del cliente "Banco del Sur SA".\n' +
      '2. Hacé clic en la pestaña **SEDES**.\n' +
      '3. Clic en **+ NUEVA SEDE** (arriba a la derecha de esa sección).\n' +
      '4. En **Nombre de la sede** escribí: **Sucursal Centro**\n' +
      '5. En **Dirección completa** escribí: **Av. Corrientes 1234, Buenos Aires**\n' +
      '6. Clic en el botón naranja de ubicación (📍) para geolocalizar.\n' +
      '7. Clic en **GUARDAR**.',
    hint: '💡 Geolocalizar la sede activa el check-in por GPS: el guardia solo puede marcar entrada estando a menos de 80 metros del edificio.',
    targetRoute: '/admin/crm',
    targetRouteLabel: 'CRM',
    highlightSelector: '[data-action="nueva-sede"]',
  },

  // ── RRHH ───────────────────────────────────────────────────────────────────
  {
    moduleKey: 'RRHH',
    stepId: 'ver_empleado',
    title: '¿Qué es un Legajo? Explorá uno',
    instruction:
      'El **legajo** es el expediente digital de cada guardia: sus datos personales, categoría CCT, objetivo asignado, vacaciones y más. ' +
      'El planificador usa esta información para saber quién puede cubrir qué turno.\n\n' +
      '**Paso a paso:**\n' +
      '1. En el panel izquierdo buscá a **"Laura Fernández"** (guardia de práctica).\n' +
      '2. Hacé clic en su nombre — su legajo se abre a la derecha.\n' +
      '3. Explorá la solapa **PERSONAL**: email, teléfono y dirección (necesarios para notificaciones).\n' +
      '4. Abrí la solapa **LABORAL**: fijate el convenio (CCT 422/05), categoría y objetivo preferido.\n' +
      '5. Abrí la solapa **VOLANTE**: objetivos donde puede cubrir como comodín si hay ausencia.',
    hint: '💡 Un legajo sin email no puede acceder al portal del guardia ni recibir notificaciones de turno.',
    targetRoute: '/admin/rrhh',
    targetRouteLabel: 'RRHH',
  },
  {
    moduleKey: 'RRHH',
    stepId: 'cargar_novedad',
    title: '¿Qué es una Novedad? Registrá una',
    instruction:
      'Una **novedad** es cualquier situación que cambia la disponibilidad del guardia: vacaciones, enfermedad, permiso gremial, licencia. ' +
      'Si cargás una novedad antes de planificar, el sistema no le asigna turno en esos días.\n\n' +
      '**Paso a paso:**\n' +
      '1. Hacé clic en la pestaña **NOVEDADES** (barra superior del módulo RRHH).\n' +
      '2. Clic en el botón **+ NUEVA NOVEDAD** (rojo/naranja, arriba a la derecha).\n' +
      '3. En **Empleado** buscá y seleccioná a **Roberto Gómez**.\n' +
      '4. En **Tipo** elegí **Licencia**.\n' +
      '5. En **Estado** elegí **Autorizada**.\n' +
      '6. Poné una fecha de inicio y fin (ej: 3 días del mes actual).\n' +
      '7. Clic en **Registrar** (botón rojo).',
    hint: '💡 Regla de oro: cargá las vacaciones y licencias del mes antes de armar el cronograma, así el planificador las respeta automáticamente.',
    targetRoute: '/admin/rrhh',
    targetRouteLabel: 'RRHH',
  },

  // ── SERVICES ───────────────────────────────────────────────────────────────
  {
    moduleKey: 'SERVICES',
    stepId: 'crear_sla',
    title: '¿Qué es un Servicio/SLA? Creá el contrato',
    instruction:
      'El **SLA (contrato de servicio)** define exactamente cuántas horas de seguridad prometiste al cliente, en qué turno y con cuántos guardias. ' +
      'Sin esto, el Planificador no sabe qué cubrir.\n\n' +
      '**Paso a paso:**\n' +
      '1. En Servicios, hacé clic en **+ NUEVO SERVICIO** (botón naranja, arriba a la derecha).\n' +
      '2. En **Cliente** seleccioná **Banco del Sur SA**.\n' +
      '3. En **Objetivo** seleccioná **Sucursal Centro**.\n' +
      '4. Dejá las fechas de Inicio y Fin del mes actual.\n' +
      '5. Clic en **Guardar** (el servicio queda en borrador, sin puestos todavía).',
    hint: '💡 El contador superior derecho muestra el total de horas del contrato. Se calcula automáticamente cuando agregás los puestos.',
    targetRoute: '/admin/servicios',
    targetRouteLabel: 'Servicios',
  },
  {
    moduleKey: 'SERVICES',
    stepId: 'conf_puesto',
    title: '¿Qué es un Puesto? Configurá uno',
    instruction:
      'Un **puesto** define un rol de seguridad dentro del contrato: cuántos guardias necesitás, en qué horario y cuántos días. ' +
      'Por ejemplo: "Acceso principal — 1 guardia, turno Mañana (M), lunes a viernes".\n\n' +
      '**Paso a paso:**\n' +
      '1. Dentro del servicio que creaste, clic en **+ AGREGAR PUESTO**.\n' +
      '2. En **Nombre del puesto** escribí: **Acceso Principal**\n' +
      '3. En **Tipo de cobertura** elegí **12 HORAS DIURNO**.\n' +
      '4. En **PAX** (personas por turno) poné **1**.\n' +
      '5. Marcá los **días activos**: L, M, X, J, V (lunes a viernes).\n' +
      '6. Clic en **Confirmar** y luego **Guardar** el servicio.',
    hint: '💡 PAX = cantidad de guardias por banda horaria. Si ponés PAX 2 en turno 24hs: necesitás 2 personas a las 7hs, 2 a las 15hs y 2 a las 23hs. El sistema calcula cuántos guardias necesitás en total según CCT 422/05.',
    targetRoute: '/admin/servicios',
    targetRouteLabel: 'Servicios',
  },

  // ── PLANNING ───────────────────────────────────────────────────────────────
  {
    moduleKey: 'PLANNING',
    stepId: 'crear_turnos',
    title: '¿Cómo funciona la grilla? Asigná un turno',
    instruction:
      'La **grilla de planificación** es el cronograma del mes. Cada fila es un guardia, cada columna es un día, y en cada celda ponés el código de turno.\n\n' +
      '**Códigos más usados:** M = Mañana (07:00–15:00), T = Tarde (15:00–23:00), N = Noche (23:00–07:00), F = Franco (día libre).\n\n' +
      '**Paso a paso:**\n' +
      '1. Arriba seleccioná el **Cliente** "Banco del Sur SA" y el **Objetivo** "Sucursal Centro".\n' +
      '2. En la columna de la izquierda vas a ver los guardias asignados (ej: Laura Fernández).\n' +
      '3. Hacé **clic en una celda vacía** de cualquier día.\n' +
      '4. En el modal que aparece, elegí el código **M** (Mañana).\n' +
      '5. Clic en **Confirmar**. La celda queda con la letra M.',
    hint: '💡 Si seleccionás varias celdas con clic+arrastrar, podés asignar el mismo turno a todos los días seleccionados de una vez — mucho más rápido que celda por celda.',
    targetRoute: '/admin/planificacion',
    targetRouteLabel: 'Planificación',
  },
  {
    moduleKey: 'PLANNING',
    stepId: 'publicar_grilla',
    title: 'Publicar el cronograma',
    instruction:
      'Un cronograma en **BORRADOR** no impacta la operación ni es visible para los guardias. ' +
      'Hay que **publicarlo** para que sea oficial.\n\n' +
      '**Paso a paso:**\n' +
      '1. Verificá que el **Diagnóstico de Cobertura** (badge naranja arriba) muestre los días completos.\n' +
      '2. Clic en el botón **GUARDAR** si hay cambios pendientes (la barra "Planificando como..." lo indica).\n' +
      '3. Clic en el botón **PUBLICAR** (arriba a la derecha de la grilla).\n' +
      '4. El badge cambia a **PUBLICADO** (verde) — las celdas muestran un punto verde en la esquina.\n\n' +
      'Una vez publicado, los guardias ven sus turnos en el portal del colaborador.',
    hint: '💡 Para corregir un cronograma ya publicado: botón CORREGIR → hacer cambios → GUARDAR → RE-PUBLICAR. Sin RE-PUBLICAR, los guardias no ven los cambios.',
    targetRoute: '/admin/planificacion',
    targetRouteLabel: 'Planificación',
  },

  // ── OPERATIONS ─────────────────────────────────────────────────────────────
  {
    moduleKey: 'OPERATIONS',
    stepId: 'reg_presencia',
    title: '¿Qué es el Centro de Control? Registrá presencia',
    instruction:
      'El **Centro de Control (Operaciones)** es el monitor en tiempo real del día: ves qué guardias están en turno, quiénes marcaron presencia y quiénes faltan.\n\n' +
      '**Paso a paso:**\n' +
      '1. En Operaciones vas a ver las tarjetas de los guardias con turno hoy.\n' +
      '2. Buscá una tarjeta con estado **"En turno"** o **"Pendiente"**.\n' +
      '3. Hacé clic en el ícono de **check verde (✓)** o el botón **"Presente"**.\n' +
      '4. El guardia pasa a estado **ACTIVO** — la tarjeta cambia de color.',
    hint: '💡 Si el guardia tiene GPS activo, el sistema registra automáticamente la presencia cuando está cerca del objetivo. El check manual es el respaldo cuando falla el GPS.',
    targetRoute: '/admin/operaciones',
    targetRouteLabel: 'Operaciones',
  },
  {
    moduleKey: 'OPERATIONS',
    stepId: 'gestionar_aus',
    title: 'Gestionar una ausencia en tiempo real',
    instruction:
      'Cuando un guardia falta, el sistema genera una **vacante** y sugiere quién puede cubrirla siguiendo el protocolo CCT: primero guardias sin turno, luego los que están en RET (retén), luego extensión de jornada, y como último recurso el Franco Trabajado (FT).\n\n' +
      '**Paso a paso:**\n' +
      '1. En la tarjeta de un guardia, hacé clic en **"Ausente"** o el ícono de X roja.\n' +
      '2. Confirmá el tipo de ausencia (Injustificada AA o Enfermedad E).\n' +
      '3. El sistema muestra el **panel de vacantes** con candidatos sugeridos.\n' +
      '4. Elegí un candidato y hacé clic en **"Cubrir"**.\n' +
      '5. El turno queda asignado y la vacante se cierra.',
    hint: '💡 Protocolo de cobertura (menor a mayor costo): Sin turno → RET → ESC → Extensión 12hs → Franco Trabajado (FT). El sistema propone siempre la opción más económica primero.',
    targetRoute: '/admin/operaciones',
    targetRouteLabel: 'Operaciones',
  },

  // ── REPORTS ────────────────────────────────────────────────────────────────
  {
    moduleKey: 'REPORTS',
    stepId: 'ver_reporte',
    title: 'Consultar el reporte de período',
    instruction:
      'En **Reportes**, seleccioná el **mes actual** en el selector de período. ' +
      'Elegí el objetivo de práctica en el filtro de cliente/objetivo. ' +
      'Verificá que aparezcan los turnos planificados y las presencias registradas.',
    hint: '💡 Desde aquí podés exportar el reporte a Excel con el botón de descarga.',
    targetRoute: '/admin/reportes',
    targetRouteLabel: 'Reportes',
  },
];

/** Devuelve el paso activo del coach según el módulo y los pasos completados */
export function getActiveCoachStep(
  currentModuleKey: string | null,
  progress: Record<string, { stepsCompleted: string[] }>,
): CoachStep | null {
  if (!currentModuleKey) return null;
  const modProgress = progress[currentModuleKey];
  const completed = modProgress?.stepsCompleted ?? [];

  return (
    COACH_STEPS.find(
      s => s.moduleKey === currentModuleKey && !completed.includes(s.stepId),
    ) ?? null
  );
}
