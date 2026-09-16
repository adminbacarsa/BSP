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
  targetRoute: string;       // ruta donde se ejecuta el paso
  targetRouteLabel: string;  // nombre legible de la ruta para el link de navegación
  /** Selector CSS del elemento a resaltar (opcional, para highlight futuro) */
  highlightSelector?: string;
}

export const COACH_STEPS: CoachStep[] = [
  // ── CLIENTS ────────────────────────────────────────────────────────────────
  {
    moduleKey: 'CLIENTS',
    stepId: 'crear_cliente',
    title: 'Crear un cliente',
    instruction:
      'En la pantalla de CRM, hacé clic en el botón **"+ Nuevo cliente"** (arriba a la derecha). ' +
      'Completá al menos Nombre y dirección, luego guardá.',
    hint: 'Usá datos ficticios, por ejemplo: "Empresa Práctica SRL".',
    targetRoute: '/admin/crm',
    targetRouteLabel: 'CRM',
    highlightSelector: '[data-action="nuevo-cliente"]',
  },
  {
    moduleKey: 'CLIENTS',
    stepId: 'crear_objetivo',
    title: 'Agregar objetivo/sede',
    instruction:
      'Dentro del cliente que acabás de crear, buscá la sección **"Objetivos"** y agregá al menos un objetivo con nombre y dirección.',
    hint: 'Un objetivo es el lugar físico donde prestás el servicio (ej: "Planta Norte").',
    targetRoute: '/admin/crm',
    targetRouteLabel: 'CRM',
  },

  // ── SERVICES ───────────────────────────────────────────────────────────────
  {
    moduleKey: 'SERVICES',
    stepId: 'crear_sla',
    title: 'Crear un SLA/contrato',
    instruction:
      'En **Servicios**, asociá un contrato SLA al objetivo creado. ' +
      'Definí al menos un puesto con código de turno (M, T o N).',
    hint: 'El SLA determina cuántos guardias cubre cada puesto y en qué bandas horarias.',
    targetRoute: '/admin/servicios',
    targetRouteLabel: 'Servicios',
  },
  {
    moduleKey: 'SERVICES',
    stepId: 'conf_puesto',
    title: 'Configurar puesto',
    instruction:
      'Revisá el puesto dentro del SLA: asegurate de que tenga días activos y al menos un turno asignado. Guardá los cambios.',
    targetRoute: '/admin/servicios',
    targetRouteLabel: 'Servicios',
  },

  // ── PLANNING ───────────────────────────────────────────────────────────────
  {
    moduleKey: 'PLANNING',
    stepId: 'crear_turnos',
    title: 'Asignar turnos en la grilla',
    instruction:
      'En **Planificación**, seleccioná el objetivo y el mes actual. ' +
      'Asigná al menos un empleado a un turno de la grilla (clic en la celda vacía y elegí el código).',
    hint: 'Podés usar los guardias ficticios: Laura Fernández, Roberto Gómez, etc.',
    targetRoute: '/admin/planificacion',
    targetRouteLabel: 'Planificación',
    highlightSelector: '[data-testid="grilla-celda"]',
  },
  {
    moduleKey: 'PLANNING',
    stepId: 'publicar_grilla',
    title: 'Publicar la grilla',
    instruction:
      'Con turnos asignados, presioná el botón **"Publicar"** para hacer la planificación efectiva. ' +
      'Las celdas de días pasados deben quedar en gris.',
    hint: 'Publicar convierte el borrador en planificación oficial visible en Operaciones.',
    targetRoute: '/admin/planificacion',
    targetRouteLabel: 'Planificación',
  },

  // ── OPERATIONS ─────────────────────────────────────────────────────────────
  {
    moduleKey: 'OPERATIONS',
    stepId: 'reg_presencia',
    title: 'Registrar presencia de un guardia',
    instruction:
      'En **Operaciones**, localizá un turno activo y marcalo como **Presente** ' +
      'usando el botón de check en la tarjeta del guardia.',
    targetRoute: '/admin/operaciones',
    targetRouteLabel: 'Operaciones',
  },
  {
    moduleKey: 'OPERATIONS',
    stepId: 'gestionar_aus',
    title: 'Gestionar una ausencia',
    instruction:
      'Marcá un turno como **Ausente** y observá cómo el sistema genera una vacante. ' +
      'Intentá asignar cobertura desde el panel de vacantes.',
    hint: 'El protocolo de cobertura sigue el orden: Sin turno → RET → ESC/REF → EXT → FT.',
    targetRoute: '/admin/operaciones',
    targetRouteLabel: 'Operaciones',
  },

  // ── RRHH ───────────────────────────────────────────────────────────────────
  {
    moduleKey: 'RRHH',
    stepId: 'cargar_novedad',
    title: 'Cargar una novedad',
    instruction:
      'En **RRHH**, buscá un empleado y cargá una novedad de tipo Licencia o Ausencia autorizada ' +
      'para la fecha de práctica.',
    targetRoute: '/admin/rrhh',
    targetRouteLabel: 'RRHH',
  },

  // ── REPORTS ────────────────────────────────────────────────────────────────
  {
    moduleKey: 'REPORTS',
    stepId: 'ver_reporte',
    title: 'Consultar el reporte de período',
    instruction:
      'En **Reportes**, seleccioná el mes actual y el objetivo sandbox. ' +
      'Verificá que aparezcan los turnos planificados y las presencias registradas.',
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
