import './bootstrap-env';
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
export declare const createUser: functions.HttpsFunction & functions.Runnable<any>;
export declare const scheduleShift: functions.HttpsFunction & functions.Runnable<any>;
export declare const manageShifts: functions.HttpsFunction & functions.Runnable<any>;
export declare const auditShift: functions.HttpsFunction & functions.Runnable<any>;
export declare const manageData: functions.HttpsFunction & functions.Runnable<any>;
export declare const manageHierarchy: functions.HttpsFunction & functions.Runnable<any>;
export declare const manageEmployees: functions.HttpsFunction & functions.Runnable<any>;
export declare const manageSystemUsers: functions.HttpsFunction & functions.Runnable<any>;
export declare const manageAbsences: functions.HttpsFunction & functions.Runnable<any>;
export declare const managePatterns: functions.HttpsFunction & functions.Runnable<any>;
export declare const manageAgreements: functions.HttpsFunction & functions.Runnable<any>;
export declare const platformHealthCheck: functions.HttpsFunction & functions.Runnable<any>;
export declare const checkSystemHealth: functions.HttpsFunction & functions.Runnable<any>;
export declare const chatPlatformAssistant: functions.HttpsFunction & functions.Runnable<any>;
export declare const executeAgentAction: functions.HttpsFunction & functions.Runnable<any>;
export declare const modoDemoCron: functions.CloudFunction<unknown>;
export declare const onTurnoAbsenciaDetectada: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<functions.Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot>, {
    shiftId: string;
}>>;
export declare const autoPresenciaYCierre: functions.HttpsFunction & functions.Runnable<any>;
export declare const optimizePlanningGemini: functions.HttpsFunction & functions.Runnable<any>;
export { vplanRun } from './vplan';
export declare const runAutoSchedule: functions.HttpsFunction & functions.Runnable<any>;
export declare const runAjustarCrono: functions.HttpsFunction & functions.Runnable<any>;
export declare const runEquilibrarCrono: functions.HttpsFunction & functions.Runnable<any>;
export declare const crearUsuarioSistema: functions.HttpsFunction & functions.Runnable<any>;
/** Sincroniza custom claims de Auth con el rol en system_users (p. ej. tras editar rol en UI). */
export declare const syncSystemUserClaims: functions.HttpsFunction & functions.Runnable<any>;
export declare const limpiarBaseDeDatos: functions.HttpsFunction & functions.Runnable<any>;
export declare const requestCheckIn: functions.HttpsFunction & functions.Runnable<any>;
export declare const marcarAusenciaOperaciones: functions.HttpsFunction & functions.Runnable<any>;
export declare const revertirAusencia: functions.HttpsFunction & functions.Runnable<any>;
/**
 * Motor único de presencia + auto-relevo FIFO 1:1.
 * Canales: OPERATIONS | VIGI (vía executeAgentAction) | PORTAL (vía requestCheckIn).
 */
export declare const registrarPresencia: functions.HttpsFunction & functions.Runnable<any>;
export declare const registrarFichadaManual: functions.HttpsFunction & functions.Runnable<any>;
export declare const reportarAusencia: functions.HttpsFunction & functions.Runnable<any>;
export declare const notificarLlegadaTarde: functions.HttpsFunction & functions.Runnable<any>;
export { getSwapPeople, getSwapCandidates, createSwapRequest, respondSwapRequest, confirmSwapRequest, cancelSwapRequest, approveSwapRequest, rejectSwapRequestSupervisor, } from './swap/swapPortal';
export { crearConvocatoriaCobertura, responderConvocatoriaCobertura, cancelarConvocatoriaCobertura, getCandidatosCobertura, checkConvocatoriaTimeouts, } from './coverage/convocatoriasCobertura';
export { respondEventoConvocatoria } from './eventos/eventoPortalCallables';
export declare const createPortalAccess: functions.HttpsFunction & functions.Runnable<any>;
export declare const activateDevice: functions.HttpsFunction & functions.Runnable<any>;
export declare const activateAndSetPassword: functions.HttpsFunction & functions.Runnable<any>;
export { requestGuardDeviceRegistration, approveGuardDeviceRegistration, rejectGuardDeviceRegistration, unbindGuardDevice, getGuardDeviceRegistrationStatus, listPendingGuardDeviceRegistrations, } from './auth/guardDeviceRegistration';
export declare const createClientPortalAccess: functions.HttpsFunction & functions.Runnable<any>;
export { onNovedadCreated } from './notifications/onNovedadCreated';
export { onTurnoWrite } from './notifications/onTurnoWrite';
export { onCronogramaPublished } from './notifications/onCronogramaPublished';
export { onEmployeeNotificationCreated } from './notifications/onEmployeeNotificationCreated';
export { onVacanteCorrectionCreated } from './notifications/onVacanteCorrectionCreated';
export { onGuardAbsenceDetected } from './notifications/onGuardAbsenceDetected';
export { onSolicitudEventoCreated } from './notifications/onSolicitudEventoCreated';
export { flushShiftNotifDigests } from './notifications/shiftNotifDigest';
export { payrollApi } from './payroll-api/handler';
export declare const createPayrollApiKey: functions.HttpsFunction & functions.Runnable<any>;
export declare const revokePayrollApiKey: functions.HttpsFunction & functions.Runnable<any>;
export declare const getPayrollSnapshotInternal: functions.HttpsFunction & functions.Runnable<any>;
export declare const sendTestNotification: functions.HttpsFunction & functions.Runnable<any>;
export declare const autoCompletarTurnos: functions.CloudFunction<unknown>;
export declare const detectarAusencias: functions.CloudFunction<unknown>;
export declare const gestionarVacantes: functions.CloudFunction<unknown>;
export declare const triggerBackup: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    id: string;
    driveFileId: string;
    driveLink: string;
    fileName: string;
    sizeBytes: number;
    collections: string[];
    totalDocs: number;
    createdAt: string;
    status: "ok" | "error";
    error?: string;
    empresaId?: string;
    jobId: string;
}>, unknown>;
/** Reconcilia el historial con Google Drive: borra de system_backups los registros cuyo archivo ya no existe. */
export declare const syncBackups: import("firebase-functions/v2/https").CallableFunction<any, Promise<import("./backup/backup.service").SyncDriveBackupsResult>, unknown>;
/** Borra un backup puntual (archivo en Drive + registro en Firestore). */
export declare const deleteBackup: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    deleted: boolean;
    driveDeleted: boolean;
}>, unknown>;
/** Encola restauración (rápido). El trabajo pesado corre en processRestoreJob (hasta 1 h). */
export declare const restoreBackup: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    jobId: string;
    queued: boolean;
}>, unknown>;
/** Ejecuta restore_jobs en background (hasta 60 min por invocación). */
export declare const processRestoreJob: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<functions.Change<import("firebase-functions/v2/firestore").DocumentSnapshot>, {
    jobId: string;
}>>;
/** Copia todos los datos de una empresa a otra (superadmin). IDs nuevos + empresaId destino. */
export declare const migrateEmpresaData: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    jobId: string;
    isComplete: boolean;
    nextColIndex: number;
    idMaps: Record<string, Record<string, string>>;
    docsCopied: number;
    docsDeleted: number;
    totalCollections: number;
}>, unknown>;
/** Ejecuta empresa_migrate_jobs en background. */
export declare const processEmpresaMigrateJob: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<functions.Change<import("firebase-functions/v2/firestore").DocumentSnapshot>, {
    jobId: string;
}>>;
export declare const onAusenciaCreatedFromPortal: functions.CloudFunction<functions.firestore.QueryDocumentSnapshot>;
/**
 * Retención: etiqueta archiveTier en turnos fuera de hot (diario 04:15 AR).
 * No borra docs — fase 1. Callable manual: tagTurnosArchiveTier.
 */
export declare const scheduledTagTurnosArchiveTier: import("firebase-functions/v2/scheduler").ScheduleFunction;
export declare const processEarlyWithdrawalCallable: functions.HttpsFunction & functions.Runnable<any>;
export declare const revertConvocadoFalseAbsences: functions.HttpsFunction & functions.Runnable<any>;
export declare const releaseInvalidRetentions: functions.HttpsFunction & functions.Runnable<any>;
export declare const releaseTraceAbsences: functions.HttpsFunction & functions.Runnable<any>;
export declare const tagTurnosArchiveTier: functions.HttpsFunction & functions.Runnable<any>;
export declare const scheduledBackup: import("firebase-functions/v2/scheduler").ScheduleFunction;
/** Actualiza el horario del backup automático en system_config/backup_schedule (solo SuperAdmin). */
export declare const updateBackupSchedule: import("firebase-functions/v2/https").CallableFunction<any, Promise<admin.firestore.DocumentData>, unknown>;
export declare const lookupClientByCuit: functions.HttpsFunction & functions.Runnable<any>;
export declare const saveEmpresaAfipCredentials: functions.HttpsFunction & functions.Runnable<any>;
export declare const getEmpresaAfipConfig: functions.HttpsFunction & functions.Runnable<any>;
export declare const getMobileAppConfig: functions.HttpsFunction & functions.Runnable<any>;
export declare const saveMobileAppConfig: functions.HttpsFunction & functions.Runnable<any>;
export declare const syncMobileAppEasEnv: functions.HttpsFunction & functions.Runnable<any>;
export declare const triggerMobileAppPreviewBuild: functions.HttpsFunction & functions.Runnable<any>;
export declare const refreshMobileAppBuildStatus: functions.HttpsFunction & functions.Runnable<any>;
export declare const scheduledAutoInjustificada: functions.CloudFunction<unknown>;
export declare const onAusenciaCertificado: functions.CloudFunction<functions.Change<functions.firestore.QueryDocumentSnapshot>>;
export declare const cleanupSlaDevueltas: functions.HttpsFunction;
export declare const setEmployeePortalPassword: functions.HttpsFunction & functions.Runnable<any>;
export declare const geocodeAddressProxy: functions.HttpsFunction & functions.Runnable<any>;
