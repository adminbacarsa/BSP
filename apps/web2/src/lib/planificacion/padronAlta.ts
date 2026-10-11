/**
 * Alta de legajo desde el padrón (Excel en el navegador, nunca se sube).
 * El matcher es el mismo del pegado (`elegirGuardia`). La validación replica el alta de RRHH
 * y suma CUIL con dígito verificador.
 */
import { normalizeCuil } from '@/lib/eventuales/cuil.mjs';
import { normalizeGeneroImport } from '@/lib/planificacion/genderPreference';
import { elegirGuardia } from '@/lib/planificacion/modoRapido';

export type FilaPadron = {
  legajo: string;
  apellido: string;
  nombre: string;
  dni: string;
  cuil: string;
  mail: string;
  telefono: string;
  domicilio: string;
  tipo: string;
  area: string;
  puesto: string;
  objetivo: string;
  nacimiento: string;
  genero: '' | 'M' | 'F';
  ingreso: string;
  estado: string;
  ultimaActividad: string;
};

export type AltaForm = {
  apellido: string;
  nombre: string;
  legajo: string;
  dni: string;
  cuil: string;
  mail: string;
  telefono: string;
  domicilio: string;
  nacimiento: string;
  genero: '' | 'M' | 'F';
  ingreso: string;
  estadoPadron: string;
  puestoPadron: string;
  objectiveId: string;
  clientId: string;
  empresaId: string;
};

export type LegajoConocido = {
  id: string;
  empresaId: string;
  dni: string;
  cuil: string;
  fileNumber: string;
  name: string;
};

export type DecisionAlta =
  | { accion: 'crear'; avisos: string[]; doc: Record<string, unknown> }
  | { accion: 'habilitar'; avisos: string[]; existente: LegajoConocido }
  | { accion: 'bloquear'; mensaje: string };

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

let padronSesion: FilaPadron[] | null = null;

/** El padrón vive en memoria de la pestaña. No se guarda en disco ni se sube. */
export function padronEnSesion(): FilaPadron[] | null {
  return padronSesion;
}

export function recordarPadron(filas: FilaPadron[]): void {
  padronSesion = filas;
}

export function olvidarPadron(): void {
  padronSesion = null;
}

function txt(v: unknown): string {
  return String(v ?? '').trim();
}

function digitos(v: unknown): string {
  return txt(v).replace(/\D/g, '');
}

/** Serial de Excel (días desde 1899-12-30) o texto dd/mm/aaaa → YYYY-MM-DD. */
export function fechaDePadron(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const s = txt(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${y}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return '';
}

function esEncabezado(row: unknown[]): boolean {
  const c0 = txt(row[0]).toUpperCase();
  return c0 === 'LEGAJO' || c0 === 'NRO' || c0 === 'N°' || c0.includes('LEGAJO');
}

/**
 * Hoja SP sin encabezado. Columnas: 0 legajo, 1 apellido, 2 nombre, 3 DNI, 4 CUIL,
 * 5 mail, 6 teléfono, 7 domicilio, 8 tipo, 9 área, 10 puesto, 11 objetivo,
 * 12 nacimiento, 13 género, 16 ingreso, 18 estado.
 */
export function filasDesdeHoja(rows: unknown[][]): FilaPadron[] {
  const out: FilaPadron[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || esEncabezado(row)) continue;
    const apellido = txt(row[1]);
    const nombre = txt(row[2]);
    const legajo = txt(row[0]);
    if (!apellido && !nombre && !legajo) continue;
    out.push({
      legajo,
      apellido,
      nombre,
      dni: digitos(row[3]),
      cuil: digitos(row[4]),
      mail: txt(row[5]),
      telefono: txt(row[6]),
      domicilio: txt(row[7]),
      tipo: txt(row[8]),
      area: txt(row[9]),
      puesto: txt(row[10]),
      objetivo: txt(row[11]),
      nacimiento: fechaDePadron(row[12]),
      genero: normalizeGeneroImport(row[13]),
      ingreso: fechaDePadron(row[16]),
      estado: txt(row[18]),
      ultimaActividad: fechaDePadron(row[19]),
    });
  }
  return out;
}

export function partirNombrePlanilla(nombre: string): { apellido: string; nombre: string } {
  const t = txt(nombre);
  if (t.includes(',')) {
    const [a, n] = t.split(',');
    return { apellido: a.trim(), nombre: (n || '').trim() };
  }
  const p = t.split(/\s+/).filter(Boolean);
  return { apellido: p[0] || '', nombre: p.slice(1).join(' ') };
}

export function formVacio(nombrePlanilla: string, legajo: string, ctx: { empresaId: string; objectiveId: string; clientId: string }): AltaForm {
  const partes = partirNombrePlanilla(nombrePlanilla);
  return {
    apellido: partes.apellido,
    nombre: partes.nombre,
    legajo: txt(legajo),
    dni: '',
    cuil: '',
    mail: '',
    telefono: '',
    domicilio: '',
    nacimiento: '',
    genero: '',
    ingreso: '',
    estadoPadron: '',
    puestoPadron: '',
    objectiveId: ctx.objectiveId,
    clientId: ctx.clientId,
    empresaId: ctx.empresaId,
  };
}

export function formDesdeFila(fila: FilaPadron, ctx: { empresaId: string; objectiveId: string; clientId: string }): AltaForm {
  return {
    apellido: fila.apellido,
    nombre: fila.nombre,
    legajo: fila.legajo,
    dni: fila.dni,
    cuil: fila.cuil,
    mail: fila.mail,
    telefono: fila.telefono,
    domicilio: fila.domicilio,
    nacimiento: fila.nacimiento,
    genero: fila.genero,
    ingreso: fila.ingreso,
    estadoPadron: fila.estado,
    puestoPadron: fila.puesto,
    objectiveId: ctx.objectiveId,
    clientId: ctx.clientId,
    empresaId: ctx.empresaId,
  };
}

/** Mismo matcher del pegado: legajo, después apellido+nombre exacto, después parecido. */
export function buscarEnPadron(filas: FilaPadron[], q: { legajo?: string; nombre: string }): { fila: FilaPadron; via: 'legajo' | 'nombre' | 'parecido' } | null {
  const guardias = filas.map((f, i) => ({
    fila: i,
    nombre: `${f.apellido}, ${f.nombre}`.replace(/^,\s*|,\s*$/g, '').trim(),
    legajo: f.legajo,
  }));
  const hit = elegirGuardia(q.nombre, q.legajo || '', guardias, new Set());
  if (!hit) return null;
  return { fila: filas[hit.fila], via: hit.via };
}

export function estadoEsActivo(estado: string): boolean {
  const n = txt(estado).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (!n) return true;
  if (n.includes('INACT') || n.includes('BAJA') || n.includes('SUSPEND')) return false;
  return n === 'ACTIVO' || n === 'ACTIVE' || n.endsWith('ACTIVO');
}

function legajoClave(v: string): string {
  return digitos(v).replace(/^0+/, '');
}

function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Misma forma que guarda el alta de RRHH (`handleSave`), más nacimiento. */
export function docDeAlta(form: AltaForm): Record<string, unknown> {
  const apellido = txt(form.apellido);
  const nombre = txt(form.nombre);
  const ingreso = fechaDePadron(form.ingreso) || hoyIso();
  const nacimiento = fechaDePadron(form.nacimiento);
  return {
    firstName: nombre,
    lastName: apellido,
    name: `${apellido}, ${nombre}`.toUpperCase(),
    dni: digitos(form.dni),
    cuil: digitos(form.cuil),
    fileNumber: txt(form.legajo),
    email: txt(form.mail),
    phone: txt(form.telefono),
    address: txt(form.domicilio),
    birthDate: nacimiento,
    fechaNacimiento: nacimiento,
    lat: null,
    lng: null,
    category: 'Vigilador',
    cct: '',
    laborAgreement: '',
    status: 'activo',
    role: 'employee',
    contractType: 'FullTime',
    periodType: 'Mensual',
    startDate: ingreso,
    cycleStartDay: 26,
    maxHours: 200,
    preferredClientId: txt(form.clientId),
    preferredObjectiveId: txt(form.objectiveId),
    sizes: { shirt: '', pants: '', shoes: '' },
    restriccionesObjetivo: [],
    restriccionesCliente: [],
    conflictosEmpleados: [],
    genero: form.genero || '',
    volante: [],
    aptitudes: [],
    empresaId: txt(form.empresaId),
  };
}

export function decidirAlta(form: AltaForm, existentes: LegajoConocido[], empresaId: string): DecisionAlta {
  const apellido = txt(form.apellido);
  const nombre = txt(form.nombre);
  const legajo = txt(form.legajo);
  const dni = digitos(form.dni);
  const cuil = normalizeCuil(form.cuil);
  if (!apellido) return { accion: 'bloquear', mensaje: 'El apellido es obligatorio' };
  if (!nombre) return { accion: 'bloquear', mensaje: 'El nombre es obligatorio' };
  if (!legajo) return { accion: 'bloquear', mensaje: 'El legajo es obligatorio' };
  if (dni.length < 7) return { accion: 'bloquear', mensaje: 'El DNI es obligatorio' };
  if (!cuil) return { accion: 'bloquear', mensaje: 'El CUIL no es válido (dígito verificador)' };
  const mail = txt(form.mail);
  if (mail && !mail.includes('@')) return { accion: 'bloquear', mensaje: 'El mail no es válido' };

  const misma = (e: LegajoConocido) => txt(e.empresaId) === txt(empresaId);
  const leg = existentes.find((e) => misma(e) && legajoClave(e.fileNumber) && legajoClave(e.fileNumber) === legajoClave(legajo));
  if (leg) return { accion: 'bloquear', mensaje: `Ya existe un empleado con ese número de legajo (${leg.name})` };
  const porDni = existentes.find((e) => misma(e) && digitos(e.dni) === dni);
  if (porDni) return { accion: 'bloquear', mensaje: `Ya existe un empleado con ese DNI (${porDni.name})` };
  const porCuil = existentes.find((e) => misma(e) && normalizeCuil(e.cuil) === cuil);
  if (porCuil) return { accion: 'bloquear', mensaje: `Ya existe un empleado con ese CUIL (${porCuil.name})` };

  const avisos: string[] = [];
  if (form.estadoPadron && !estadoEsActivo(form.estadoPadron)) {
    avisos.push(`En el padrón figura «${form.estadoPadron}», no Activo.`);
  }
  const puesto = txt(form.puestoPadron);
  if (puesto && puesto.toUpperCase() !== 'VIGILADOR') avisos.push(`En el padrón el puesto es «${puesto}». El alta queda como Vigilador.`);

  const otra = existentes.find((e) => !misma(e) && (digitos(e.dni) === dni || normalizeCuil(e.cuil) === cuil));
  if (otra) {
    avisos.unshift(`Ya existe en otra empresa del grupo (${otra.name}). Se habilita acá, sin duplicar el legajo.`);
    return { accion: 'habilitar', avisos, existente: otra };
  }
  return { accion: 'crear', avisos, doc: docDeAlta({ ...form, dni, cuil }) };
}

export function nombreMes(monthIndex0: number): string {
  return MESES[monthIndex0] || '';
}
