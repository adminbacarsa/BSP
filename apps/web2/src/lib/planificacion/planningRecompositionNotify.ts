import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { stampEmpresaId } from '@/lib/multiempresa';
import type { RecompositionPackage } from './planningRecomposition.types';

function fmtDateAr(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/** Notificaciones al guardia + novedad plataforma tras publicar paquete. */
export async function emitRecompositionNotifications(
  pkg: RecompositionPackage,
  ctx: {
    empresaId: string;
    clientId?: string;
    objectiveId: string;
    objectiveName: string;
    extName: string;
    adelName: string;
    targetName: string;
  },
) {
  const { empresaId, clientId, objectiveId, objectiveName, extName, adelName, targetName } = ctx;
  const fecha = fmtDateAr(pkg.dateStr);
  const pos = pkg.gapPositionName;
  const isLib = pkg.mode === 'liberation';
  const novedadType = isLib ? 'LIBERACION_DOTACION' : 'COBERTURA_SPLIT_PLANIFICADA';
  const novedadTitle = isLib ? 'Liberación → RET + recomposición' : 'Cobertura split planificada';

  const description = isLib
    ? `${targetName} → RET (${pkg.redeployNote || 'evento/otro obj.'}). Backfill ${pos}: ${extName} ext ${pkg.extension.fromTime}-${pkg.extension.toTime} + ${adelName} adel ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime}. ${objectiveName} · ${fecha}`
    : `Cubre ${targetName} (${pkg.target.code}) en ${pos}: ${extName} ext ${pkg.extension.fromTime}-${pkg.extension.toTime} + ${adelName} adel ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime}. ${objectiveName} · ${fecha}`;

  await addDoc(collection(db, 'novedades'), stampEmpresaId({
    type: novedadType,
    title: novedadTitle,
    status: 'pending',
    objectiveId,
    objectiveName,
    clientId: clientId || null,
    description,
    coveragePackageId: pkg.id,
    createdAt: serverTimestamp(),
    reportedBy: 'PLANIFICACION',
  }, empresaId));

  const notify = async (userId: string, type: string, title: string, body: string) => {
    if (!userId) return;
    await addDoc(collection(db, 'user_notifications'), stampEmpresaId({
      userId,
      employeeId: userId,
      type,
      title,
      body,
      read: false,
      objectiveId,
      coveragePackageId: pkg.id,
      scheduledDate: pkg.dateStr,
      requiresAck: true,
      createdAt: serverTimestamp(),
    }, empresaId));
  };

  if (isLib) {
    await notify(
      pkg.target.employeeId,
      'RET_LIBERACION_PLANIFICADA',
      'Stand-by RET — convocable',
      `El ${fecha} pasás a RET en ${pos}. Tu turno queda cubierto por ${extName.split(',')[0]} + ${adelName.split(',')[0]}. ${pkg.redeployNote ? `Destino: ${pkg.redeployNote}.` : 'Operaciones te convocará para otro objetivo.'}`,
    );
  }

  await notify(
    pkg.extension.employeeId,
    'EXTENSION_PLANIFICADA',
    'Turno extendido',
    `El ${fecha} extendés en ${pos} ${pkg.extension.fromTime}-${pkg.extension.toTime} (+4h). ${isLib ? 'Motivo: liberación dotación.' : `Cubre a ${targetName.split(',')[0]}.`} Objetivo: ${objectiveName}.`,
  );

  await notify(
    pkg.earlyStart.employeeId,
    'ADELANTO_PLANIFICADO',
    'Turno adelantado',
    `El ${fecha} entrás ${pkg.earlyStart.fromTime} en ${pos} (adelanto ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime}). ${isLib ? 'Motivo: liberación dotación.' : `Cubre a ${targetName.split(',')[0]}.`} Objetivo: ${objectiveName}.`,
  );
}

/** Agrupa pendingChanges por coveragePackageId y reconstruye paquetes para notificar. */
export function extractPackagesFromPending(
  pendingChanges: Record<string, any>,
  employeesById: Record<string, any>,
  objectiveId: string,
): RecompositionPackage[] {
  const byPkg = new Map<string, Record<string, any>[]>();

  for (const [key, change] of Object.entries(pendingChanges)) {
    if (!change?.coveragePackageId || change.isDeleted) continue;
    if (change.objectiveId && change.objectiveId !== objectiveId) continue;
    const list = byPkg.get(change.coveragePackageId) || [];
    list.push({ ...change, _key: key });
    byPkg.set(change.coveragePackageId, list);
  }

  const packages: RecompositionPackage[] = [];

  for (const [id, rows] of byPkg) {
    const liberated = rows.find(r => r.coverageSegmentRole === 'LIBERATED');
    const targetRow = rows.find(r => r.coverageSegmentRole === 'TARGET') || liberated;
    const extRow = rows.find(r => r.coverageSegmentRole === 'EXTENSION');
    const adelRow = rows.find(r => r.coverageSegmentRole === 'EARLY_START');
    if (!extRow || !adelRow) continue;

    const dateStr = (extRow._key as string).split('_').slice(1).join('_');
    const targetEmpId = targetRow?.coversEmployeeId || (targetRow?._key as string)?.split('_')[0] || liberated?._key?.split('_')[0];
    if (!targetEmpId) continue;

    const targetEmp = employeesById[targetEmpId];
    const mode = liberated ? 'liberation' : 'absence';

    packages.push({
      id,
      type: liberated ? 'LIBERATION_RECOMPOSITION' : 'ABSENCE_COVERAGE',
      mode,
      objectiveId,
      dateStr,
      target: {
        employeeId: targetEmpId,
        dateStr,
        positionName: targetRow?.positionName || extRow.coversPositionName || 'General',
        code: liberated ? 'RET' : String(targetRow?.code || 'T'),
        label: targetEmp?.name || targetEmpId,
        kind: liberated ? 'working' : 'absence',
      },
      gapFrom: extRow.segmentFromTime || extRow.adjustedEndTime || '15:00',
      gapTo: adelRow.segmentToTime || '23:00',
      gapPositionName: extRow.coversPositionName || extRow.positionName || 'General',
      extension: {
        employeeId: (extRow._key as string).split('_')[0],
        role: 'EXTENSION',
        positionName: extRow.coversPositionName || extRow.positionName,
        fromTime: extRow.segmentFromTime || '15:00',
        toTime: extRow.segmentToTime || extRow.adjustedEndTime || '19:00',
        homePositionName: extRow.positionName,
        baseCode: extRow.code,
      },
      earlyStart: {
        employeeId: (adelRow._key as string).split('_')[0],
        role: 'EARLY_START',
        positionName: adelRow.positionName,
        fromTime: adelRow.segmentFromTime || adelRow.adjustedStartTime || '19:00',
        toTime: adelRow.segmentToTime || '23:00',
        baseCode: adelRow.code,
      },
      liberationReason: liberated?.liberationReason,
      redeployNote: liberated?.redeployNote,
    });
  }

  return packages;
}
