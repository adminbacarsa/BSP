/**
 * Utilidades para soporte multiempresa.
 * La migración agrega el campo `empresaId` a todos los documentos
 * existentes y marca la empresa como migrada en su propio documento.
 */
import {
  collection, getDocs, writeBatch, doc, setDoc,
} from 'firebase/firestore';
import { db } from './firebase';

/** Colecciones que participan en el aislamiento por empresa */
const COLECCIONES = [
  'empleados',
  'clients',
  'clientes',
  'turnos',
  'ausencias',
  'novedades',
  'swap_requests',
  'contratos_servicio',
  'tipos_turno',
  'servicios_sla',
  'objetivos',
  'audit_logs',
  'user_notifications',
];

export interface ProgresoMigracion {
  mensaje: string;
  procesados: number;
  total: number;
  completa: boolean;
  error?: string;
}

/**
 * Recorre todas las colecciones y agrega `empresaId` a los documentos que no lo tienen.
 * Al finalizar marca `migracionCompleta: true` en el documento de la empresa.
 */
export async function migrarEmpresa(
  empresaId: string,
  onProgreso: (p: ProgresoMigracion) => void
): Promise<void> {
  try {
    // 1. Cargar todos los snapshots en paralelo
    onProgreso({ mensaje: 'Leyendo colecciones...', procesados: 0, total: 0, completa: false });

    const snapshots = await Promise.allSettled(
      COLECCIONES.map(col => getDocs(collection(db, col)))
    );

    // 2. Filtrar solo docs sin empresaId
    const tareas: Array<{ ref: any }> = [];
    snapshots.forEach(result => {
      if (result.status === 'fulfilled') {
        result.value.docs.forEach(d => {
          if (!d.data().empresaId) tareas.push({ ref: d.ref });
        });
      }
    });

    const total = tareas.length;
    onProgreso({ mensaje: `${total} documentos para migrar`, procesados: 0, total, completa: false });

    if (total === 0) {
      // Nada que migrar — marcar como completa igualmente
      await marcarMigracionCompleta(empresaId);
      onProgreso({ mensaje: '¡Todo ya está migrado!', procesados: 0, total: 0, completa: true });
      return;
    }

    // 3. Procesar en lotes de 490 (límite Firestore: 500)
    let procesados = 0;
    for (let i = 0; i < tareas.length; i += 490) {
      const lote = tareas.slice(i, i + 490);
      const batch = writeBatch(db);
      lote.forEach(({ ref }) => batch.update(ref, { empresaId }));
      await batch.commit();
      procesados += lote.length;
      onProgreso({
        mensaje: `Migrando... ${procesados} / ${total}`,
        procesados,
        total,
        completa: false,
      });
    }

    // 4. Crear el doc de la empresa si no existe y marcarla como migrada
    await marcarMigracionCompleta(empresaId);
    onProgreso({ mensaje: '¡Migración completada!', procesados: total, total, completa: true });

  } catch (err: any) {
    onProgreso({
      mensaje: 'Error en la migración',
      procesados: 0,
      total: 0,
      completa: false,
      error: err.message || String(err),
    });
    throw err;
  }
}

async function marcarMigracionCompleta(empresaId: string) {
  await setDoc(
    doc(db, 'empresas', empresaId),
    { migracionCompleta: true, migracionFecha: new Date().toISOString() },
    { merge: true }
  );
}

/**
 * Crea o actualiza un documento de empresa en la colección `empresas`.
 */
export async function guardarEmpresa(
  empresaId: string,
  datos: { name: string; cuit?: string; direccion?: string; plan?: string }
): Promise<void> {
  await setDoc(
    doc(db, 'empresas', empresaId),
    { ...datos, active: true, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}
