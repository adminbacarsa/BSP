/**
 * Atajo de clic derecho en la grilla de Planificación (escritorio).
 * No decide horas ni escribe turnos: dice qué ofrece el menú y arma las listas
 * con las mismas reglas de la solapa Nómina (`tipoDesdeRolDia` / `accionCobertura`).
 */
import { accionCobertura, tipoDesdeRolDia } from '@/lib/planificacion/coberturaEventualesUx';

export type ClaseCeldaMenu = 'ausente' | 'hueco' | 'ops' | 'sin_permiso' | 'no_aplica';

export type OpcionesMenuRapido = {
  clase: ClaseCeldaMenu;
  visible: boolean;
  titulo: string;
  asignar: boolean;
  extAdel: boolean;
  abrirCompleta: boolean;
  soloLectura: boolean;
};

const VACIO: OpcionesMenuRapido = {
  clase: 'no_aplica',
  visible: false,
  titulo: '',
  asignar: false,
  extAdel: false,
  abrirCompleta: false,
  soloLectura: false,
};

/** Qué muestra el menú según la celda. Operaciones gana sobre el permiso. */
export function opcionesMenuRapido(input: {
  esAusente: boolean;
  esHueco: boolean;
  cubiertoPorOps: boolean;
  puedeEditar: boolean;
}): OpcionesMenuRapido {
  const cubrible = input.esAusente || input.esHueco;
  if (!cubrible && !input.cubiertoPorOps) return VACIO;
  if (input.cubiertoPorOps) {
    return {
      clase: 'ops',
      visible: true,
      titulo: 'Cubierto desde Operaciones',
      asignar: false,
      extAdel: false,
      abrirCompleta: true,
      soloLectura: true,
    };
  }
  if (!input.puedeEditar) {
    return {
      clase: 'sin_permiso',
      visible: true,
      titulo: 'Sin permiso para corregir',
      asignar: false,
      extAdel: false,
      abrirCompleta: true,
      soloLectura: true,
    };
  }
  return {
    clase: input.esAusente ? 'ausente' : 'hueco',
    visible: true,
    titulo: input.esAusente ? 'Cubrir este día' : 'Cubrir hueco del SLA',
    asignar: true,
    extAdel: true,
    abrirCompleta: true,
    soloLectura: false,
  };
}

/** Celda vacía de un puesto al que le falta gente ese día. */
export function celdaEsHuecoSla(input: {
  tieneTurno: boolean;
  tieneAusencia: boolean;
  faltaPaxEnPuesto: boolean;
}): boolean {
  return !input.tieneTurno && !input.tieneAusencia && input.faltaPaxEnPuesto;
}

const LICENSE_DAY = new Set(['V', 'L', 'PG', 'A', 'E', 'AA', 'ART']);
const NON_AVAILABLE = new Set(['F', 'FF', 'FP', 'FT', 'V', 'L', 'PG', 'A', 'E', 'AA', 'PAST', 'LOCKED']);

/** Misma clasificación que `getEmpDayRole` del modal de cobertura. */
export function rolDesdeTurno(shift: {
  code?: string;
  isDeleted?: boolean;
  isFranco?: boolean;
  isFrancoTrabajado?: boolean;
} | null | undefined): 'RETEN' | 'ESC' | 'REF' | 'FREE' | 'FRANCO' | 'WORKING' | 'LICENCIA' {
  if (!shift || shift.isDeleted) return 'FREE';
  const code = String(shift.code || '').toUpperCase();
  if (shift.isFrancoTrabajado === true || code === 'FT') return 'WORKING';
  if (code === 'RET') return 'RETEN';
  if (code === 'ESC') return 'ESC';
  if (code === 'REF') return 'REF';
  if (LICENSE_DAY.has(code)) return 'LICENCIA';
  if (code === 'F' || code === 'FF' || code === 'FP' || shift.isFranco === true) return 'FRANCO';
  if (NON_AVAILABLE.has(code)) return 'FREE';
  return 'WORKING';
}

export type PersonaMenu = {
  id: string;
  nombre: string;
  rol: string;
  enCronograma: boolean;
};

const ORDEN_CRONOGRAMA = ['RETEN', 'ESC', 'REF', 'FREE'];

function seAsignaDirecto(rol: string): boolean {
  const tipo = tipoDesdeRolDia(rol);
  return !!tipo && accionCobertura(tipo) === 'asignar';
}

/**
 * Primero quien ya está en el cronograma de ese objetivo (RET → ESC → REF → libre).
 * El franco no entra (solo se consulta desde el modal).
 * Afuera: legajo activo sin turno ese día y sin licencia, que no está en ese cronograma.
 */
export function listasAsignarMenu(personas: PersonaMenu[], busqueda = ''): {
  cronograma: PersonaMenu[];
  fuera: PersonaMenu[];
} {
  const q = busqueda.trim().toLowerCase();
  const coincide = (p: PersonaMenu) => !q || p.nombre.toLowerCase().includes(q);
  const cronograma = personas
    .filter((p) => p.enCronograma && seAsignaDirecto(p.rol) && coincide(p))
    .sort((a, b) => {
      const ia = ORDEN_CRONOGRAMA.indexOf(a.rol);
      const ib = ORDEN_CRONOGRAMA.indexOf(b.rol);
      if (ia !== ib) return ia - ib;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
  const fuera = personas
    .filter((p) => !p.enCronograma && tipoDesdeRolDia(p.rol) === 'LIBRE' && seAsignaDirecto(p.rol) && coincide(p))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return { cronograma, fuera };
}

export function apellidoMarca(nombre: string | null | undefined): string {
  const raw = String(nombre || '').trim();
  if (!raw) return '';
  if (raw.includes(',')) return raw.split(',')[0].trim().toUpperCase();
  const parts = raw.split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] || raw).toUpperCase();
}

/** Tooltip de la celda cubierta por este atajo. */
export function textoMarcaMenuRapido(input: {
  modo: 'asignar' | 'split';
  cubreA?: string | null;
  tipo?: string | null;
  actor?: string | null;
  cuando?: string | null;
  ext?: string | null;
  adel?: string | null;
}): string {
  if (input.modo === 'split') {
    return `Ext+Adel: ${apellidoMarca(input.ext)} (ext) · ${apellidoMarca(input.adel)} (adel)`;
  }
  const tipo = input.tipo ? ` (${String(input.tipo).toUpperCase()})` : '';
  const por = input.actor && input.cuando ? ` · por ${input.actor} ${input.cuando}` : '';
  return `Cubre a ${apellidoMarca(input.cubreA)} · Asignado${tipo}${por}`;
}

/** El menú no se sale de la ventana. */
export function clampMenuEnViewport(
  clientX: number,
  clientY: number,
  panelW: number,
  panelH: number,
  vw: number,
  vh: number,
): { left: number; top: number } {
  const pad = 8;
  let left = clientX;
  let top = clientY;
  if (left + panelW > vw - pad) left = Math.max(pad, vw - panelW - pad);
  if (left < pad) left = pad;
  if (top + panelH > vh - pad) top = Math.max(pad, vh - panelH - pad);
  if (top < pad) top = pad;
  return { left, top };
}
