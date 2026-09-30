/**
 * Perfil del eventual al iniciar sesión (docs/EVENTUALES-DISENO.md §7).
 * No hay un único legajo: `listarTurnosEventual` confirma la cuenta y las empresas;
 * los legajos salen de `empleados` por `bolsaCuil` y se atan al uid para que las
 * reglas de turnos, alertas y convocatorias funcionen igual que para un guardia.
 */
import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import type { EmpleadoPortal } from '@cosp/portal-types';
import { type EventualLegajo, type ListarTurnosEventualResponse } from '@cosp/portal-core';
import { getPortalCallables } from './portal';

export type EventualPerfil = {
  bolsaCuil: string;
  legajos: EventualLegajo[];
  empresasNombres: Record<string, string>;
  /** Legajo principal (compat con pantallas de un solo legajo). */
  principal: { id: string; data: Record<string, unknown> } | null;
};

function legajoActivo(data: Record<string, unknown>): boolean {
  const status = String(data.status || '').toUpperCase();
  return status !== 'INACTIVE';
}

export async function readEmpresasNombres(
  db: Firestore,
  empresaIds: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    [...new Set(empresaIds.filter(Boolean))].map(async (id) => {
      try {
        const snap = await getDoc(doc(db, 'empresas', id));
        if (!snap.exists()) return;
        const d = snap.data();
        const nombre = String(d.name || d.nombre || '').trim();
        if (nombre) out[id] = nombre;
      } catch {
        /* sin nombre: se muestra el id */
      }
    }),
  );
  return out;
}

export async function loadEventualPerfil(
  db: Firestore,
  user: User,
  claimCuil: string | null,
): Promise<EventualPerfil> {
  const { listarTurnosEventual } = getPortalCallables();
  const res = await listarTurnosEventual();
  const data = (res?.data ?? {}) as Partial<ListarTurnosEventualResponse>;
  const bolsaCuil = String(data.bolsaCuil || claimCuil || '').trim();
  if (!bolsaCuil) throw new Error('No es un eventual de la bolsa.');

  const legajosSnap = await getDocs(
    query(collection(db, 'empleados'), where('bolsaCuil', '==', bolsaCuil)),
  );
  const rows = legajosSnap.docs
    .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
    .filter((r) => legajoActivo(r.data));

  const legajos: EventualLegajo[] = [];
  for (const r of rows) {
    const empresaId = String(r.data.empresaId || '').trim();
    if (!empresaId) continue;
    legajos.push({ empresaId, employeeId: r.id });
    if (r.data.uid !== user.uid) {
      try {
        await updateDoc(doc(db, 'empleados', r.id), { uid: user.uid });
      } catch {
        /* reglas / emulador */
      }
    }
  }

  const empresaIds = [
    ...new Set([...legajos.map((l) => l.empresaId), ...((data.empresas || []).filter(Boolean) as string[])]),
  ];
  const empresasNombres = await readEmpresasNombres(db, empresaIds);
  for (const l of legajos) l.empresaNombre = empresasNombres[l.empresaId];

  return {
    bolsaCuil,
    legajos,
    empresasNombres,
    principal: rows[0] ?? null,
  };
}

export function mapEventualEmpleado(
  perfil: EventualPerfil,
  uid: string,
): EmpleadoPortal | null {
  const p = perfil.principal;
  if (!p) return null;
  const d = p.data;
  return {
    id: p.id,
    uid,
    email: d.email as string | undefined,
    firstName: (d.firstName || d.nombre) as string | undefined,
    lastName: (d.lastName || d.apellido) as string | undefined,
    fileNumber: (d.fileNumber || d.legajo) as string | undefined,
    cuil: (d.cuil as string | undefined) || perfil.bolsaCuil,
    dni: d.dni as string | undefined,
    category: (d.category || d.categoria) as string | undefined,
    photoUrl: d.photoUrl as string | undefined,
    empresaId: d.empresaId as string | undefined,
    deviceId: (d.deviceId as string | null | undefined) ?? null,
  };
}
