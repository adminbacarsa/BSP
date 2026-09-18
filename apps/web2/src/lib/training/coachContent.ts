/**
 * Contenido del coach in-situ por módulo, paso y ruta.
 * Cada entrada define qué mostrarle al alumno y en qué ruta debe estar.
 */

export interface ChainHighlight {
  selector: string;
  hint: string;
}

export interface CoachStep {
  moduleKey: string;
  stepId: string;
  title: string;
  instruction: string;
  hint?: string;
  targetRoute: string;
  targetRouteLabel: string;
  highlightSelector?: string;
  highlightChain?: ChainHighlight[];
  isPractice?: boolean;
  /** true = el sistema no puede detectarlo automáticamente; habilita el botón manual */
  manualComplete?: boolean;
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
    hint: '💡 Clic en el botón ARCA — en modo capacitación autocompleta automáticamente con datos de demostración (no necesitás CUIT real).',
    targetRoute: '/admin/crm',
    targetRouteLabel: 'CRM',
    highlightSelector: '[data-action="nuevo-cliente"]',
    highlightChain: [
      { selector: '[data-action="crm-nuevo-nombre"]', hint: '→ Escribí el Nombre comercial (ej: Distribuidora Córdoba SA)' },
      { selector: '[data-action="crm-nuevo-razonsocial"]', hint: '→ Completá la Razón social completa (ej: Distribuidora Córdoba Sociedad Anónima)' },
      { selector: '[data-action="crm-nuevo-arca"]', hint: '→ Clic en ARCA para autocompletar dirección e impuestos del padrón' },
      { selector: '[data-action="crm-nuevo-crear"]', hint: '→ Clic en CREAR CLIENTE para guardar' },
    ],
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
    highlightChain: [
      { selector: '[data-action="crm-sede-nombre"]', hint: '→ Escribí el nombre de la sede (ej: Sucursal Centro)' },
      { selector: '[data-action="crm-sede-direccion"]', hint: '→ Ingresá la dirección completa (ej: Av. Colón 1234, Córdoba)' },
      { selector: '[data-action="crm-sede-geolocalize"]', hint: '→ Clic en el botón de ubicación 📍 para geolocalizar en el mapa' },
      { selector: '[data-action="guardar-sede"]', hint: '→ Clic en GUARDAR para crear la sede' },
    ],
  },

  // ── RRHH ───────────────────────────────────────────────────────────────────
  {
    moduleKey: 'RRHH',
    stepId: 'ver_empleado',
    manualComplete: true,
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
      '2. Clic en el botón **+ NUEVA NOVEDAD** (rojo/naranja, arriba a la derecha — el sistema lo va a resaltar).\n' +
      '3. En **Empleado** buscá y seleccioná a **Roberto Gómez**.\n' +
      '4. En **Tipo** elegí **Licencia**.\n' +
      '5. En **Estado** elegí **Autorizada**.\n' +
      '6. Poné una fecha de inicio y fin (ej: 3 días del mes actual).\n' +
      '7. Clic en **Registrar** (botón rojo).',
    hint: '💡 Regla de oro: cargá las vacaciones y licencias del mes antes de armar el cronograma, así el planificador las respeta automáticamente.',
    targetRoute: '/admin/rrhh',
    targetRouteLabel: 'RRHH',
    highlightSelector: '[data-action="nueva-novedad"]',
    highlightChain: [
      { selector: '[data-action="rrhh-novedad-empleado"]', hint: '→ Buscá y seleccioná el empleado (ej: Roberto Gómez)' },
      { selector: '[data-action="rrhh-novedad-tipo"]', hint: '→ Elegí el Tipo de novedad (ej: Licencia)' },
      { selector: '[data-action="rrhh-novedad-estado"]', hint: '→ Elegí el Estado (ej: Autorizada)' },
      { selector: '[data-action="rrhh-novedad-fecha"]', hint: '→ Seleccioná la Fecha de inicio de la novedad' },
      { selector: '[data-action="rrhh-novedad-registrar"]', hint: '→ Clic en REGISTRAR para guardar la novedad' },
    ],
  },

  // ── SERVICES ───────────────────────────────────────────────────────────────
  {
    moduleKey: 'SERVICES',
    stepId: 'crear_sla',
    title: '¿Qué es un Servicio/SLA? Creá el contrato',
    instruction:
      'El **SLA (contrato de servicio)** define cuántas horas de seguridad prometiste al cliente, en qué turno y con cuántos guardias. ' +
      'Sin esto, el Planificador no sabe qué cubrir.\n\n' +
      '**Paso a paso:**\n' +
      '1. Clic en el botón azul **+ NUEVO SERVICIO** (arriba a la derecha — el sistema lo va a resaltar).\n' +
      '2. En **Cliente** seleccioná el cliente de práctica que aparece en la lista (ej: "Fábrica Demo SRL").\n' +
      '3. En **Objetivo** seleccioná la sede disponible (ej: "Planta Norte").\n' +
      '4. Dejá las fechas de Inicio y Fin del mes actual.\n' +
      '5. Clic en **Guardar** — el servicio queda creado sin puestos todavía.',
    hint: '💡 El contador arriba a la derecha muestra las horas totales del contrato. Se calcula automáticamente al agregar los puestos.',
    targetRoute: '/admin/servicios',
    targetRouteLabel: 'Servicios',
    highlightSelector: '[data-action="nuevo-servicio"]',
    highlightChain: [
      { selector: '[data-action="sla-form-cliente"]', hint: '→ Seleccioná el CLIENTE en el desplegable (el que creaste en el módulo CRM)' },
      { selector: '[data-action="sla-form-objetivo"]', hint: '→ Seleccioná el OBJETIVO (sede) del cliente' },
      { selector: '[data-action="sla-form-guardar"]', hint: '→ Clic en GUARDAR para crear el contrato' },
    ],
  },
  {
    moduleKey: 'SERVICES',
    stepId: 'conf_puesto_24hs',
    title: 'Puesto 24 horas — Cobertura continua',
    instruction:
      'Un puesto **24 horas** cubre el objetivo las 24hs del día en 3 bandas: Mañana (07–15hs), Tarde (15–23hs) y Noche (23–07hs). ' +
      'Es el tipo más común en contratos de seguridad.\n\n' +
      '**Paso a paso:**\n' +
      '1. Dentro del servicio que creaste, clic en **+ AGREGAR PUESTO**.\n' +
      '2. En **Nombre del puesto** escribí: **Control y Vigilancia**\n' +
      '3. En **Tipo de cobertura** elegí **24 HORAS (Lunes a Lunes)**.\n' +
      '4. En **PAX** escribí **2** (2 guardias por banda = 6 personas por día).\n' +
      '5. Dejá los días activos L a D (todos los días).\n' +
      '6. En **Inicio M** dejá **07:00** — T y N se encadenan automáticamente.\n' +
      '7. Clic en **Confirmar** para agregar el puesto.',
    hint: '💡 Con PAX 2 en 24hs: el sistema calcula que necesitás mínimo 8 guardias rotativos según CCT 422/05 (ciclo 6+2, 180hs/mes cada uno).',
    targetRoute: '/admin/servicios',
    targetRouteLabel: 'Servicios',
  },
  {
    moduleKey: 'SERVICES',
    stepId: 'conf_puesto_custom',
    title: 'Puesto personalizado — Horario a medida',
    instruction:
      'Un puesto **personalizado** permite definir exactamente qué días y en qué horario opera, con PAX distinto por turno. ' +
      'Ideal para puestos que no funcionan todos los días o con horario especial.\n\n' +
      '**Paso a paso:**\n' +
      '1. En el mismo servicio, clic en **+ AGREGAR PUESTO** (nuevo puesto).\n' +
      '2. En **Nombre del puesto** escribí: **Recepción Diurna**\n' +
      '3. En **Tipo de cobertura** elegí **PERSONALIZADO / TURNOS ESPECÍFICOS**.\n' +
      '4. Clic en **+ Agregar turno** → elegí turno estándar **Mañana (8h)**.\n' +
      '5. Marcá solo los días **L, M, X, J, V** (lunes a viernes).\n' +
      '6. En **PAX** de ese turno poné **1**.\n' +
      '7. Clic en **+ Agregar** y luego **Confirmar**.\n' +
      '8. Guardá el servicio con el botón **Guardar** al pie del formulario.',
    hint: '💡 Este puesto genera solo 1 guardia por turno Mañana, de lunes a viernes. El planificador va a crear exactamente esas vacantes — ni más ni menos.',
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
      '1. Arriba seleccioná el **Cliente** y el **Objetivo** que configuraste (los que aparecen en la lista).\n' +
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
      '3. Clic en el botón **PUBLICAR** (arriba a la derecha de la grilla — el sistema lo va a resaltar).\n' +
      '4. El badge cambia a **PUBLICADO** (verde) — las celdas muestran un punto verde en la esquina.\n\n' +
      'Una vez publicado, los guardias ven sus turnos en el portal del colaborador.',
    hint: '💡 Para corregir un cronograma ya publicado: botón CORREGIR → hacer cambios → GUARDAR → RE-PUBLICAR. Sin RE-PUBLICAR, los guardias no ven los cambios.',
    targetRoute: '/admin/planificacion',
    targetRouteLabel: 'Planificación',
    highlightSelector: '[data-action="publicar-cronograma"]',
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

  // ── PRÁCTICAS ──────────────────────────────────────────────────────────────
  {
    moduleKey: 'CLIENTS',
    stepId: 'practica',
    isPractice: true,
    title: 'Tu turno: creá un cliente completo',
    instruction:
      'Creá un cliente nuevo (nombre y razón social distintos) con al menos una sede geolocalizada. Sin guía — usá lo que aprendiste.\n\n' +
      '**Lo que tiene que quedar:**\n' +
      '• Un cliente guardado con razón social y dirección.\n' +
      '• Una sede con dirección y pin en el mapa.\n\n' +
      'Cuando lo tengas listo, hacé clic en **"Completé el ejercicio"**.',
    hint: '💡 Probá el botón ARCA — en modo capacitación carga datos de demostración automáticamente.',
    targetRoute: '/admin/crm',
    targetRouteLabel: 'CRM',
  },
  {
    moduleKey: 'RRHH',
    stepId: 'practica',
    isPractice: true,
    title: 'Tu turno: registrá una novedad de vacaciones',
    instruction:
      'Registrá una novedad de **Vacaciones** (estado Autorizada) para cualquier empleado del listado, con al menos 5 días en el mes actual. Sin guía.\n\n' +
      '**Lo que tiene que quedar:**\n' +
      '• Novedad tipo Vacaciones, estado Autorizada.\n' +
      '• Fechas dentro del mes actual.\n\n' +
      'Cuando lo tengas listo, hacé clic en **"Completé el ejercicio"**.',
    hint: '💡 Tip: cargá las vacaciones del mes antes de armar el cronograma, así el planificador las respeta.',
    targetRoute: '/admin/rrhh',
    targetRouteLabel: 'RRHH',
  },
  {
    moduleKey: 'SERVICES',
    stepId: 'practica',
    isPractice: true,
    title: 'Tu turno: armá un SLA de principio a fin',
    instruction:
      'Creá un nuevo SLA con un puesto 24hs ("Portería y Acceso", PAX 1) para el cliente de práctica. Sin guía paso a paso.\n\n' +
      '**Lo que tiene que quedar:**\n' +
      '• SLA guardado con cliente y sede.\n' +
      '• Al menos un puesto configurado con turnos activos.\n\n' +
      'Cuando lo tengas listo, hacé clic en **"Completé el ejercicio"**.',
    hint: '💡 El contador de horas del contrato se actualiza automáticamente al agregar puestos.',
    targetRoute: '/admin/servicios',
    targetRouteLabel: 'Servicios',
  },
  {
    moduleKey: 'PLANNING',
    stepId: 'practica',
    isPractice: true,
    title: 'Tu turno: armá y publicá un cronograma',
    instruction:
      'Asigná al menos 3 turnos (M, T o N) en días distintos para el objetivo de práctica, y publicá la grilla. Sin guía.\n\n' +
      '**Lo que tiene que quedar:**\n' +
      '• Al menos 3 celdas con código de turno.\n' +
      '• Grilla en estado **PUBLICADO** (verde).\n\n' +
      'Cuando lo tengas listo, hacé clic en **"Completé el ejercicio"**.',
    hint: '💡 Seleccioná varias celdas arrastrando para asignar el mismo código de golpe.',
    targetRoute: '/admin/planificacion',
    targetRouteLabel: 'Planificación',
  },
  {
    moduleKey: 'OPERATIONS',
    stepId: 'practica',
    isPractice: true,
    title: 'Tu turno: gestioná el turno en tiempo real',
    instruction:
      'Registrá la presencia de al menos un guardia con turno activo, o gestioná una ausencia cubriendo la vacante. Sin guía.\n\n' +
      '**Lo que tiene que quedar:**\n' +
      '• Al menos un guardia en estado **ACTIVO** (presente), o una vacante cubierta.\n\n' +
      'Si el panel está vacío, primero publicá el cronograma del módulo anterior.\n\n' +
      'Cuando lo tengas listo, hacé clic en **"Completé el ejercicio"**.',
    hint: '💡 El check manual es el respaldo cuando falla el GPS del guardia.',
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
