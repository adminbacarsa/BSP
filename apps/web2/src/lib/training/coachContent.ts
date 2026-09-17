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
    title: 'Crear un cliente',
    instruction:
      'En CRM, hacé clic en el botón **"+ Cliente"** arriba a la derecha. ' +
      'Completá al menos el campo **Nombre** y **Dirección**, luego hacé clic en **"Guardar"**.',
    hint: 'Usá datos ficticios, por ejemplo: "Empresa Práctica SRL" — dirección: Av. Corrientes 1000.',
    targetRoute: '/admin/crm',
    targetRouteLabel: 'CRM',
    highlightSelector: '[data-action="nuevo-cliente"]',
  },
  {
    moduleKey: 'CLIENTS',
    stepId: 'crear_objetivo',
    title: 'Agregar sede/objetivo al cliente',
    instruction:
      'Abrí el cliente que acabás de crear (clic en su nombre). ' +
      'Ir a la pestaña **"SEDES"** → botón **"+ Nueva Sede"** (arriba a la derecha de la sección). ' +
      'Completá **Nombre de la sede** y **Dirección completa**, luego hacé clic en **"Guardar"**.',
    hint: 'Una sede es el lugar físico donde prestás el servicio (ej: "Planta Norte").',
    targetRoute: '/admin/crm',
    targetRouteLabel: 'CRM',
    highlightSelector: '[data-action="nueva-sede"]',
  },

  // ── RRHH ───────────────────────────────────────────────────────────────────
  {
    moduleKey: 'RRHH',
    stepId: 'ver_empleado',
    title: 'Explorar el legajo de un empleado',
    instruction:
      'En **RRHH**, buscá a uno de los guardias de práctica (ej: **Laura Fernández**). ' +
      'Hacé clic en su nombre para abrir el legajo. ' +
      'Revisá las solapas **Datos**, **Turnos** y **Novedades** para conocer la estructura del legajo.',
    hint: 'Los guardias de práctica ya están cargados: Laura Fernández, Roberto Gómez, Natalia Sosa, Marcelo Torres.',
    targetRoute: '/admin/rrhh',
    targetRouteLabel: 'RRHH',
  },
  {
    moduleKey: 'RRHH',
    stepId: 'cargar_novedad',
    title: 'Cargar una novedad al empleado',
    instruction:
      'Dentro del legajo abierto, hacé clic en **"+ Novedad"** o **"Agregar novedad"**. ' +
      'Seleccioná tipo **Licencia** o **Ausencia autorizada**, elegí una fecha y hacé clic en **"Guardar"**.',
    hint: 'Las novedades quedan registradas en el legajo y afectan la planificación del período.',
    targetRoute: '/admin/rrhh',
    targetRouteLabel: 'RRHH',
  },

  // ── SERVICES ───────────────────────────────────────────────────────────────
  {
    moduleKey: 'SERVICES',
    stepId: 'crear_sla',
    title: 'Crear un contrato SLA',
    instruction:
      'En **Servicios**, hacé clic en **"+ Nuevo SLA"** o **"+ Nuevo contrato"**. ' +
      'Seleccioná el cliente y la sede que creaste. ' +
      'Asignale un nombre al contrato y guardá.',
    hint: 'El SLA es el contrato de servicio que define qué puestos y bandas horarias cubre tu empresa.',
    targetRoute: '/admin/servicios',
    targetRouteLabel: 'Servicios',
  },
  {
    moduleKey: 'SERVICES',
    stepId: 'conf_puesto',
    title: 'Configurar puesto en el SLA',
    instruction:
      'Dentro del SLA que creaste, buscá la sección **"Puestos"** y agregá un puesto. ' +
      'Asignale un **nombre** (ej: "Acceso principal"), **cantidad 1**, seleccioná los **días activos** ' +
      'y al menos un turno (M=Mañana, T=Tarde, N=Noche). Guardá los cambios.',
    hint: 'Sin puestos configurados no podés generar turnos en Planificación.',
    targetRoute: '/admin/servicios',
    targetRouteLabel: 'Servicios',
  },

  // ── PLANNING ───────────────────────────────────────────────────────────────
  {
    moduleKey: 'PLANNING',
    stepId: 'crear_turnos',
    title: 'Asignar turnos en la grilla',
    instruction:
      'En **Planificación**, seleccioná el objetivo en el menú de la izquierda. ' +
      'Hacé **clic en una celda vacía** de la grilla (fila = empleado, columna = día). ' +
      'Elegí el código de turno (M, T o N) en el menú que aparece.',
    hint: 'Podés usar los guardias de práctica: Laura Fernández, Roberto Gómez, Natalia Sosa, Marcelo Torres.',
    targetRoute: '/admin/planificacion',
    targetRouteLabel: 'Planificación',
    highlightSelector: '[data-testid="grilla-celda"]',
  },
  {
    moduleKey: 'PLANNING',
    stepId: 'publicar_grilla',
    title: 'Publicar la grilla',
    instruction:
      'Con al menos un turno asignado, hacé clic en el botón **"Publicar"** (arriba a la derecha de la grilla). ' +
      'Confirmá la publicación. Las celdas publicadas quedan con color sólido en lugar de trazo.',
    hint: 'Publicar convierte el borrador en planificación oficial visible en Operaciones y Reportes.',
    targetRoute: '/admin/planificacion',
    targetRouteLabel: 'Planificación',
  },

  // ── OPERATIONS ─────────────────────────────────────────────────────────────
  {
    moduleKey: 'OPERATIONS',
    stepId: 'reg_presencia',
    title: 'Registrar presencia de un guardia',
    instruction:
      'En **Operaciones**, buscá la tarjeta del guardia en el turno activo. ' +
      'Hacé clic en el ícono de **check verde** (✓) o el botón **"Presente"** de la tarjeta. ' +
      'El guardia pasará a estado ACTIVO.',
    hint: 'Solo se pueden marcar presentes los turnos del día actual.',
    targetRoute: '/admin/operaciones',
    targetRouteLabel: 'Operaciones',
  },
  {
    moduleKey: 'OPERATIONS',
    stepId: 'gestionar_aus',
    title: 'Gestionar una ausencia',
    instruction:
      'En la tarjeta de un guardia con turno activo, hacé clic en **"Ausente"** o el ícono de **X roja**. ' +
      'El sistema generará una vacante. Observá el panel de vacantes — podés asignar cobertura ' +
      'haciendo clic en **"Cubrir"** y eligiendo un candidato.',
    hint: 'El protocolo de cobertura sigue: Sin turno → RET → ESC/REF → EXT 12h → FT.',
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
      'Elegí el objetivo de práctica (Fábrica Demo SRL) en el filtro de cliente/objetivo. ' +
      'Verificá que aparezcan los turnos planificados y las presencias registradas.',
    hint: 'Desde aquí podés exportar el reporte a Excel con el botón de descarga.',
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
