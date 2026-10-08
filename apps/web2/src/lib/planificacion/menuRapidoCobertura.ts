/**
 * Atajo de clic derecho en la grilla de Planificación (escritorio).
 * El menú solo ofrece «Asignar a…», «Ext / Adel» y el modal completo; la persona
 * se elige tocándola en la grilla («modo elegir»). Acá vive lo que decide cada clic,
 * el texto de la franja y los días que se pueden repetir. No escribe turnos.
 */
import { addDays, format, parseISO } from 'date-fns';
import { accionCobertura, tipoDesdeRolDia } from '@/lib/planificacion/coberturaEventualesUx';

export type ClaseCeldaMenu = 'ausente' | 'hueco' | 'ops' | 'sin_permiso' | 'mes_cerrado' | 'no_aplica';

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
  mesCerrado?: boolean;
}): OpcionesMenuRapido {
  if (input.mesCerrado) {
    return {
      clase: 'mes_cerrado',
      visible: true,
      titulo: 'Mes cerrado',
      asignar: false,
      extAdel: false,
      abrirCompleta: false,
      soloLectura: true,
    };
  }
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

export type RolDiaMenu = 'RETEN' | 'ESC' | 'REF' | 'FREE' | 'FRANCO' | 'WORKING' | 'LICENCIA';

/** Misma clasificación que `getEmpDayRole` del modal de cobertura. */
export function rolDesdeTurno(shift: {
  code?: string;
  isDeleted?: boolean;
  isFranco?: boolean;
  isFrancoTrabajado?: boolean;
} | null | undefined): RolDiaMenu {
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

function seAsignaDirecto(rol: string): boolean {
  const tipo = tipoDesdeRolDia(rol);
  return !!tipo && accionCobertura(tipo) === 'asignar';
}

export type PersonaFuera = {
  id: string;
  nombre: string;
  rol: string;
  enCronograma: boolean;
};

/** «Buscar fuera del cronograma»: legajo activo de otro cronograma, sin turno ni licencia ese día. */
export function buscarFueraDelCronograma(personas: PersonaFuera[], busqueda = '', max = 12): PersonaFuera[] {
  const q = busqueda.trim().toLowerCase();
  return personas
    .filter((p) => !p.enCronograma && tipoDesdeRolDia(p.rol) === 'LIBRE' && seAsignaDirecto(p.rol))
    .filter((p) => !q || p.nombre.toLowerCase().includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, max);
}

export function apellidoMarca(nombre: string | null | undefined): string {
  const raw = String(nombre || '').trim();
  if (!raw) return '';
  if (raw.includes(',')) return raw.split(',')[0].trim().toUpperCase();
  const parts = raw.split(/\s+/).filter(Boolean);
  return (parts[parts.length - 1] || raw).toUpperCase();
}

export function fechaCorta(dateStr: string): string {
  const [, m, d] = String(dateStr).split('-');
  return d && m ? `${d}/${m}` : dateStr;
}

export type AccionElegir = 'asignar' | 'split';
export type PasoElegir = 'asignar' | 'ext' | 'adel';

export type ModoElegirTexto = {
  accion: AccionElegir;
  clase: 'ausente' | 'hueco';
  titular: string;
  codigoAusencia?: string | null;
  positionName?: string | null;
  dateStr: string;
  banda: string;
  horario?: string | null;
  extNombre?: string | null;
  extTramo?: string | null;
};

export function pasoDeModo(accion: AccionElegir, extId: string | null | undefined): PasoElegir {
  if (accion === 'asignar') return 'asignar';
  return extId ? 'adel' : 'ext';
}

/** «BAEZ · V · 08/10 · M 07:00–15:00» o «hueco Puesto 1 · 08/10 · M 07:00–15:00». */
function queSeCubre(m: ModoElegirTexto): string {
  const horario = m.horario && m.horario !== '—' ? ` ${m.horario}` : '';
  const franja = `${m.banda}${horario}`;
  if (m.clase === 'hueco') {
    return `el hueco${m.positionName ? ` de ${m.positionName}` : ''} · ${fechaCorta(m.dateStr)} · ${franja}`;
  }
  const codigo = m.codigoAusencia ? ` · ${m.codigoAusencia}` : '';
  return `${apellidoMarca(m.titular)}${codigo} · ${fechaCorta(m.dateStr)} · ${franja}`;
}

/** «Nadie arranca a las 16:30 · Aplicar solo la extensión hasta 16:30». */
export function textoTramoSolo(lado: 'ext' | 'adel', hm: string): string {
  if (lado === 'ext') return `Nadie arranca a las ${hm} · Aplicar solo la extensión hasta ${hm}`;
  return `Nadie termina a las ${hm} · Aplicar solo el adelanto desde ${hm}`;
}

/** Texto de la franja fija mientras la grilla espera el clic. */
export function textoFranjaElegir(m: ModoElegirTexto): string {
  if (m.accion === 'asignar') return `Elegí quién cubre ${m.clase === 'hueco' ? '' : 'a '}${queSeCubre(m)}`;
  if (m.extNombre) {
    const tramo = m.extTramo ? ` ${m.extTramo}` : '';
    return `Extiende ${apellidoMarca(m.extNombre)}${tramo} → ahora elegí quién adelanta`;
  }
  return `Ext / Adel para ${queSeCubre(m)}: elegí quién extiende`;
}

export type ClicElegir = {
  paso: PasoElegir;
  candidatoId: string;
  titularId?: string | null;
  puedeEditar: boolean;
  rol: RolDiaMenu;
  /** Código de licencia ese día, si tiene. */
  codigoLicencia?: string | null;
  /** «M 07:00–15:00»: el turno que ya tiene ese día. */
  turnoTexto?: string | null;
  /** Ext / Adel: quién puede extender o adelantar ese día (las listas del modal). */
  candidatosBanda?: readonly string[];
  bandaHueco?: string | null;
  /** Inicio y fin reales del hueco, y del turno tocado. */
  inicioHueco?: string | null;
  finHueco?: string | null;
  finTurno?: string | null;
  inicioTurno?: string | null;
  nombreCandidato?: string | null;
  extId?: string | null;
  /** Lo que `evaluateCoverageDayGuards` dejó en blocked (descanso < 8 h, licencia). */
  bloqueos?: readonly string[];
};

function hmMasMin(hm: string, delta: number): string {
  const m = String(hm).match(/(\d{1,2}):(\d{2})/);
  if (!m) return hm;
  const total = ((Number(m[1]) * 60 + Number(m[2]) + delta) % (24 * 60) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export type ResultadoClic = { ok: boolean; motivo?: string };

/** Lo que valida cada clic en modo elegir. Mismas reglas que el modal, sin listas. */
export function validarClicElegir(c: ClicElegir): ResultadoClic {
  if (!c.puedeEditar) return { ok: false, motivo: 'Sin permiso para corregir este mes' };
  if (c.titularId && c.candidatoId === c.titularId) {
    return { ok: false, motivo: 'Es el titular de la ausencia' };
  }
  if (c.rol === 'LICENCIA') {
    return { ok: false, motivo: `De licencia ese día${c.codigoLicencia ? ` (${c.codigoLicencia})` : ''}` };
  }
  if (c.paso === 'asignar') {
    if (c.rol === 'WORKING') {
      return { ok: false, motivo: `Se pisa con su turno${c.turnoTexto ? ` ${c.turnoTexto}` : ''}` };
    }
    if (c.rol === 'FRANCO') {
      return { ok: false, motivo: 'Está de franco: al franco se le pregunta (Abrir cobertura completa…)' };
    }
    if (!seAsignaDirecto(c.rol)) return { ok: false, motivo: 'No se puede asignar directo' };
  } else {
    if (c.paso === 'adel' && c.extId && c.candidatoId === c.extId) {
      return { ok: false, motivo: 'Ya extiende: el adelanto lo hace otra persona' };
    }
    const lista = c.candidatosBanda || [];
    if (!lista.includes(c.candidatoId)) {
      const quien = c.nombreCandidato ? `${c.nombreCandidato} ` : '';
      if (c.paso === 'ext') {
        const hora = c.inicioHueco || '';
        const desde = hora ? hmMasMin(hora, -30) : '';
        const detalle = c.finTurno ? `. ${quien}termina ${c.finTurno}` : '';
        const ventana = hora && desde ? `entre las ${desde} y las ${hora}` : 'a la hora de inicio o hasta 30 min antes';
        return { ok: false, motivo: `Para extender, su turno tiene que terminar ${ventana}${detalle}` };
      }
      const hora = c.finHueco || '';
      const hasta = hora ? hmMasMin(hora, 30) : '';
      const detalle = c.inicioTurno ? `. ${quien}arranca ${c.inicioTurno}` : '';
      const ventana = hora && hasta ? `entre las ${hora} y las ${hasta}` : 'a la hora de fin o hasta 30 min después';
      return { ok: false, motivo: `Para adelantar, su turno tiene que arrancar ${ventana}${detalle}` };
    }
  }
  if (c.bloqueos && c.bloqueos.length) return { ok: false, motivo: c.bloqueos[0] };
  return { ok: true };
}

/** Días seguidos (antes y después) en que el titular tiene la misma ausencia. */
export function bloqueAusencia(dateStr: string, mismaAusencia: (d: string) => boolean, max = 62): string[] {
  const out = [dateStr];
  const base = parseISO(dateStr);
  for (let i = 1; i <= max; i++) {
    const d = format(addDays(base, -i), 'yyyy-MM-dd');
    if (!mismaAusencia(d)) break;
    out.unshift(d);
  }
  for (let i = 1; i <= max; i++) {
    const d = format(addDays(base, i), 'yyyy-MM-dd');
    if (!mismaAusencia(d)) break;
    out.push(d);
  }
  return out;
}

/** Los otros días del bloque que siguen sin cubrir. */
export function diasParaRepetir(bloque: readonly string[], dateStr: string, cubierto: (d: string) => boolean): string[] {
  return bloque.filter((d) => d !== dateStr && !cubierto(d));
}

/** «Repetir con la misma persona los otros 3 días de V (09/10 → 11/10)». */
export function textoRepetir(dias: readonly string[], codigo?: string | null): string {
  if (!dias.length) return '';
  const de = codigo ? ` de ${codigo}` : '';
  if (dias.length === 1) return `Repetir con la misma persona el otro día${de} (${fechaCorta(dias[0])})`;
  return `Repetir con la misma persona los otros ${dias.length} días${de} (${fechaCorta(dias[0])} → ${fechaCorta(dias[dias.length - 1])})`;
}

export type ResultadoDia = { dia: string; motivo: string | null };

/** Qué se aplicó y qué se salteó al repetir; nunca a medias en silencio. */
export function resumenRepetir(resultados: readonly ResultadoDia[]): {
  aplicados: string[];
  salteados: { dia: string; motivo: string }[];
  texto: string;
} {
  const aplicados = resultados.filter((r) => !r.motivo).map((r) => r.dia);
  const salteados = resultados.filter((r) => !!r.motivo).map((r) => ({ dia: r.dia, motivo: String(r.motivo) }));
  const partes: string[] = [];
  if (aplicados.length) partes.push(`Aplicado a ${aplicados.length} ${aplicados.length === 1 ? 'día' : 'días'}`);
  else partes.push('No se aplicó a ningún día');
  if (salteados.length) {
    partes.push(`No se aplicó: ${salteados.map((s) => `${fechaCorta(s.dia)} (${s.motivo})`).join(' · ')}`);
  }
  return { aplicados, salteados, texto: partes.join('. ') };
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

/** Etiqueta chica dentro de la celda: a quién cubre, o si extiende / adelanta. */
export function marcaCeldaMenuRapido(rol: 'CUBRE' | 'EXT' | 'ADEL' | 'TITULAR' | null | undefined, cubreA?: string | null): string {
  if (rol === 'EXT') return 'EXT';
  if (rol === 'ADEL') return 'ADEL';
  if (rol === 'CUBRE') return apellidoMarca(cubreA).slice(0, 6);
  return '';
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
