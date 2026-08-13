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
  const isRa = pkg.mode === 'early_departure';
  const hasExt = !!(pkg.extension?.employeeId);
  const novedadType = isLib
    ? 'LIBERACION_DOTACION'
    : isRa
      ? 'RETIRO_ANTICIPADO_PLANIFICADO'
      : 'COBERTURA_SPLIT_PLANIFICADA';
  const novedadTitle = isLib
    ? 'Liberación → RET + recomposición'
    : isRa
      ? 'Retiro anticipado + cobertura'
      : 'Cobertura split planificada';

  const description = isRa
    ? `${targetName} retiro anticipado (corte ${pkg.earlyDepartureCutTime || pkg.gapFrom}). Cubierto por ${adelName} adel ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime}. ${objectiveName} · ${fecha}`
    : isLib
      ? `${targetName} → RET (${pkg.redeployNote || 'evento/otro obj.'}). Backfill ${pos}: ${hasExt ? `${extName} ext ${pkg.extension!.fromTime}-${pkg.extension!.toTime} + ` : ''}${adelName} adel ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime}. ${objectiveName} · ${fecha}`
      : `Cubre ${targetName} (${pkg.target.code}) en ${pos}: ${hasExt ? `${extName} ext ${pkg.extension!.fromTime}-${pkg.extension!.toTime} + ` : ''}${adelName} adel ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime}. ${objectiveName} · ${fecha}`;

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

  if (isRa) {
    await notify(
      pkg.target.employeeId,
      'RETIRO_ANTICIPADO_PLANIFICADO',
      'Retiro anticipado',
      `El ${fecha} tu turno en ${pos} corta a las ${pkg.earlyDepartureCutTime || pkg.gapFrom}. Cobertura: ${adelName.split(',')[0]} desde esa hora. Objetivo: ${objectiveName}.`,
    );
  } else if (isLib) {
    await notify(
      pkg.target.employeeId,
      'RET_LIBERACION_PLANIFICADA',
      'Stand-by RET — convocable',
      `El ${fecha} pasás a RET en ${pos}. Tu turno queda cubierto por ${hasExt ? `${extName.split(',')[0]} + ` : ''}${adelName.split(',')[0]}. ${pkg.redeployNote ? `Destino: ${pkg.redeployNote}.` : 'Operaciones te convocará para otro objetivo.'}`,
    );
  }

  if (hasExt && pkg.extension) {
    await notify(
      pkg.extension.employeeId,
      'EXTENSION_PLANIFICADA',
      'Turno extendido',
      `El ${fecha} extendés en ${pos} ${pkg.extension.fromTime}-${pkg.extension.toTime} (+4h). ${isLib ? 'Motivo: liberación dotación.' : `Cubre a ${targetName.split(',')[0]}.`} Objetivo: ${objectiveName}.`,
    );
  }

  await notify(
    pkg.earlyStart.employeeId,
    'ADELANTO_PLANIFICADO',
    'Turno adelantado',
    `El ${fecha} entrás ${pkg.earlyStart.fromTime} en ${pos} (adelanto ${pkg.earlyStart.fromTime}-${pkg.earlyStart.toTime}). ${isRa ? 'Motivo: retiro anticipado.' : isLib ? 'Motivo: liberación dotación.' : `Cubre a ${targetName.split(',')[0]}.`} Objetivo: ${objectiveName}.`,
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
    if (!adelRow) continue;
    const isRa = !!(targetRow?.isRetiroAnticipado || targetRow?.coverageMode === 'EARLY_DEPARTURE');
    if (!extRow && !isRa && !liberated) continue;

    const anchorKey = String((extRow || adelRow || targetRow)?._key || '');
    const dateStr = anchorKey.split('_').slice(1).join('_');
    const targetEmpId = targetRow?.coversEmployeeId || (targetRow?._key as string)?.split('_')[0] || liberated?._key?.split('_')[0];
    if (!targetEmpId) continue;

    const targetEmp = employeesById[targetEmpId];
    const mode = liberated
      ? 'liberation'
      : isRa
        ? 'early_departure'
        : 'absence';

    packages.push({
      id,
      type: liberated
        ? 'LIBERATION_RECOMPOSITION'
        : isRa
          ? 'EARLY_DEPARTURE_COVERAGE'
          : 'ABSENCE_COVERAGE',
      mode,
      objectiveId,
      dateStr,
      target: {
        employeeId: targetEmpId,
        dateStr,
        positionName: targetRow?.positionName || adelRow.coversPositionName || extRow?.coversPositionName || 'General',
        code: liberated ? 'RET' : String(targetRow?.code || 'T'),
        label: targetEmp?.name || targetEmpId,
        kind: liberated || isRa ? 'working' : 'absence',
      },
      gapFrom: isRa
        ? (targetRow?.segmentToTime || targetRow?.adjustedEndTime || adelRow.segmentFromTime || '11:00')
        : (extRow?.segmentFromTime || extRow?.adjustedEndTime || '15:00'),
      gapTo: adelRow.segmentToTime || '23:00',
      gapPositionName: adelRow.coversPositionName || extRow?.coversPositionName || adelRow.positionName || 'General',
      ...(extRow
        ? {
            extension: {
              employeeId: (extRow._key as string).split('_')[0],
              role: 'EXTENSION' as const,
              positionName: extRow.coversPositionName || extRow.positionName,
              fromTime: extRow.segmentFromTime || '15:00',
              toTime: extRow.segmentToTime || extRow.adjustedEndTime || '19:00',
              homePositionName: extRow.positionName,
              baseCode: extRow.code,
            },
          }
        : {}),
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
      earlyDepartureCutTime: isRa
        ? (targetRow?.segmentToTime || targetRow?.adjustedEndTime || adelRow.segmentFromTime)
        : undefined,
      earlyDepartureStartTime: isRa ? targetRow?.segmentFromTime : undefined,
    });
  }

  return packages;
}
