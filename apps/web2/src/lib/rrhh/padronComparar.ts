/**
 * Compara el padrón (hoja SP) contra los legajos de la empresa.
 * No escribe nada: altas, cambios y bajas los confirma quien mira la pantalla.
 */
import { normalizeCuil } from '@/lib/eventuales/cuil.mjs';
import { elegirGuardia } from '@/lib/planificacion/modoRapido';
import { estadoEsActivo, type FilaPadron } from '@/lib/planificacion/padronAlta';

export type EmpleadoParaPadron = {
  id: string;
  legajo: string;
  apellido: string;
  nombre: string;
  dni: string;
  cuil: string;
  mail: string;
  telefono: string;
  domicilio: string;
  puesto: string;
  estado: string;
  ingreso: string;
  activo: boolean;
  objetivo?: string;
};

export type DiffCampo = { campo: string; antes: string; despues: string };

export type ItemNuevo = { tipo: 'nuevo'; clave: string; fila: FilaPadron };
export type ItemCambio = { tipo: 'cambio'; clave: string; fila: FilaPadron; empleado: EmpleadoParaPadron; diffs: DiffCampo[] };
export type ItemBaja = { tipo: 'baja'; clave: string; empleado: EmpleadoParaPadron; motivo: 'no_viene' | 'baja_padron' };
export type ItemIgual = { tipo: 'igual'; clave: string; fila: FilaPadron; empleado: EmpleadoParaPadron };

export type ComparacionPadron = {
  nuevos: ItemNuevo[];
  cambios: ItemCambio[];
  bajas: ItemBaja[];
  iguales: ItemIgual[];
};

const CAMPOS: Array<{ campo: string; deFila: (f: FilaPadron) => string; deEmp: (e: EmpleadoParaPadron) => string }> = [
  { campo: 'mail', deFila: (f) => f.mail, deEmp: (e) => e.mail },
  { campo: 'teléfono', deFila: (f) => f.telefono, deEmp: (e) => e.telefono },
  { campo: 'domicilio', deFila: (f) => f.domicilio, deEmp: (e) => e.domicilio },
  { campo: 'puesto', deFila: (f) => f.puesto, deEmp: (e) => e.puesto },
  { campo: 'ingreso', deFila: (f) => f.ingreso, deEmp: (e) => e.ingreso },
  { campo: 'apellido', deFila: (f) => f.apellido, deEmp: (e) => e.apellido },
  { campo: 'nombre', deFila: (f) => f.nombre, deEmp: (e) => e.nombre },
  { campo: 'DNI', deFila: (f) => f.dni, deEmp: (e) => e.dni },
  { campo: 'CUIL', deFila: (f) => f.cuil, deEmp: (e) => e.cuil },
];

function norm(v: string): string {
  return String(v || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function legajoClave(v: string): string {
  return String(v || '').replace(/\D/g, '').replace(/^0+/, '');
}

function claveDe(fila: FilaPadron, i: number): string {
  return legajoClave(fila.legajo) || normalizeCuil(fila.cuil) || fila.dni || `fila_${i}`;
}

function diffsDe(fila: FilaPadron, emp: EmpleadoParaPadron): DiffCampo[] {
  const out: DiffCampo[] = [];
  for (const c of CAMPOS) {
    const antes = String(c.deEmp(emp) || '').trim();
    const despues = String(c.deFila(fila) || '').trim();
    if (!despues) continue;
    const igual = c.campo === 'CUIL'
      ? (normalizeCuil(antes) || norm(antes)) === (normalizeCuil(despues) || norm(despues))
      : c.campo === 'DNI'
        ? antes.replace(/\D/g, '') === despues.replace(/\D/g, '')
        : norm(antes) === norm(despues);
    if (!igual) out.push({ campo: c.campo, antes: antes || '—', despues });
  }
  return out;
}

function nombreFila(f: FilaPadron): string {
  return `${f.apellido}, ${f.nombre}`.replace(/^,\s*|,\s*$/g, '').trim();
}

/** Legajo, después CUIL o DNI, después apellido y nombre (el mismo matcher del pegado). */
export function emparejarPadron(filas: FilaPadron[], empleados: EmpleadoParaPadron[]): Array<{ fila: FilaPadron; empleado: EmpleadoParaPadron | null; indice: number }> {
  const libres = new Set(empleados.map((e) => e.id));
  const porLeg = new Map<string, EmpleadoParaPadron[]>();
  for (const e of empleados) {
    const k = legajoClave(e.legajo);
    if (!k) continue;
    const arr = porLeg.get(k) || [];
    arr.push(e);
    porLeg.set(k, arr);
  }
  return filas.map((fila, indice) => {
    const leg = legajoClave(fila.legajo);
    if (leg) {
      const hits = (porLeg.get(leg) || []).filter((e) => libres.has(e.id));
      if (hits.length === 1) {
        libres.delete(hits[0].id);
        return { fila, empleado: hits[0], indice };
      }
    }
    const cuil = normalizeCuil(fila.cuil);
    const dni = fila.dni.replace(/\D/g, '');
    const porDoc = empleados.filter((e) => libres.has(e.id) && (
      (cuil && normalizeCuil(e.cuil) === cuil) || (dni.length >= 7 && e.dni.replace(/\D/g, '') === dni)
    ));
    if (porDoc.length === 1) {
      libres.delete(porDoc[0].id);
      return { fila, empleado: porDoc[0], indice };
    }
    const guardias = empleados.filter((e) => libres.has(e.id)).map((e, i) => ({
      fila: i,
      nombre: `${e.apellido}, ${e.nombre}`.replace(/^,\s*|,\s*$/g, '').trim() || e.legajo,
      legajo: e.legajo,
      id: e.id,
    }));
    const hit = elegirGuardia(nombreFila(fila), '', guardias, new Set());
    if (hit) {
      const emp = empleados.find((e) => e.id === guardias[hit.fila].id) || null;
      if (emp) libres.delete(emp.id);
      return { fila, empleado: emp, indice };
    }
    return { fila, empleado: null, indice };
  });
}

export function compararPadron(filas: FilaPadron[], empleados: EmpleadoParaPadron[]): ComparacionPadron {
  const pares = emparejarPadron(filas, empleados);
  const tomados = new Set(pares.map((p) => p.empleado?.id).filter(Boolean) as string[]);
  const nuevos: ItemNuevo[] = [];
  const cambios: ItemCambio[] = [];
  const bajas: ItemBaja[] = [];
  const iguales: ItemIgual[] = [];
  for (const p of pares) {
    const clave = claveDe(p.fila, p.indice);
    if (!p.empleado) {
      if (estadoEsActivo(p.fila.estado)) nuevos.push({ tipo: 'nuevo', clave, fila: p.fila });
      continue;
    }
    if (p.empleado.activo && !estadoEsActivo(p.fila.estado)) {
      bajas.push({ tipo: 'baja', clave, empleado: p.empleado, motivo: 'baja_padron' });
      continue;
    }
    const diffs = diffsDe(p.fila, p.empleado);
    if (diffs.length) cambios.push({ tipo: 'cambio', clave, fila: p.fila, empleado: p.empleado, diffs });
    else iguales.push({ tipo: 'igual', clave, fila: p.fila, empleado: p.empleado });
  }
  for (const e of empleados) {
    if (!e.activo || tomados.has(e.id)) continue;
    bajas.push({ tipo: 'baja', clave: e.id, empleado: e, motivo: 'no_viene' });
  }
  return { nuevos, cambios, bajas, iguales };
}

export function textoDiff(d: DiffCampo): string {
  return `${d.campo}: ${d.antes} → ${d.despues}`;
}

export function idDocPadron(empresaId: string, legajo: string): string {
  const leg = String(legajo || '').trim().replace(/[/#?[\]*]/g, '_');
  return `${empresaId}_${leg || 'sin_legajo'}`;
}

export function fechaPadronVisible(iso: string): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}
