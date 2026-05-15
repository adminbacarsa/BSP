"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledBackup = exports.onAusenciaCreatedFromPortal = exports.restoreBackup = exports.triggerBackup = exports.gestionarVacantes = exports.detectarAusencias = exports.autoCompletarTurnos = exports.sendTestNotification = exports.payrollApi = exports.onTurnoWrite = exports.onNovedadCreated = exports.createClientPortalAccess = exports.createPortalAccess = exports.reportarAusencia = exports.registrarFichadaManual = exports.requestCheckIn = exports.limpiarBaseDeDatos = exports.crearUsuarioSistema = exports.chatPlatformAssistant = exports.checkSystemHealth = exports.manageAgreements = exports.managePatterns = exports.manageAbsences = exports.manageSystemUsers = exports.manageEmployees = exports.manageHierarchy = exports.manageData = exports.auditShift = exports.manageShifts = exports.scheduleShift = exports.createUser = void 0;
require("./bootstrap-env");
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const backup_service_1 = require("./backup/backup.service");
const restore_service_1 = require("./backup/restore.service");
const main_1 = require("./main");
const scheduling_service_1 = require("./scheduling/scheduling.service");
const auth_service_1 = require("./auth/auth.service");
const data_management_service_1 = require("./data-management/data-management.service");
const audit_service_1 = require("./scheduling/audit.service");
const client_service_1 = require("./data-management/client.service");
const employee_service_1 = require("./data-management/employee.service");
const system_user_service_1 = require("./data-management/system-user.service");
const absence_service_1 = require("./data-management/absence.service");
const pattern_service_1 = require("./scheduling/pattern.service");
const labor_agreement_service_1 = require("./data-management/labor-agreement.service");
const runPlatformAssistant_1 = require("./assistant/runPlatformAssistant");
if (!admin.apps.length) {
    admin.initializeApp();
}
let nestApp;
async function getService(service) {
    if (!nestApp) {
        nestApp = await (0, main_1.createNestApp)();
    }
    return nestApp.get(service);
}
const ADMIN_ROLES = ['admin', 'superadmin', 'SuperAdmin', 'Scheduler', 'HR_Manager', 'Manager', 'Operator', 'Supervisor'];
const ALLOWED_ROLES = ['admin', 'employee'];
exports.createUser = functions.https.onCall(async (data, context) => {
    const callerAuth = context.auth;
    if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role)) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado. Rol insuficiente.');
    }
    try {
        const authService = await getService(auth_service_1.AuthService);
        const { email, password, name, role: receivedRole, clientId, dni, fileNumber, address } = data;
        if (!ALLOWED_ROLES.includes(receivedRole)) {
            throw new functions.https.HttpsError('invalid-argument', 'Rol inválido.');
        }
        const validRole = receivedRole;
        const newEmployee = await authService.createEmployeeProfile(email, password, validRole, name, { clientId: clientId || '', dni, fileNumber, address });
        return { success: true, uid: newEmployee.uid };
    }
    catch (error) {
        const err = error;
        if (error instanceof functions.https.HttpsError)
            throw error;
        console.error('[CREATE_USER_FATAL]', err.message);
        throw new functions.https.HttpsError('internal', 'Error al crear usuario.');
    }
});
exports.scheduleShift = functions.https.onCall(async (data, context) => {
    const callerAuth = context.auth;
    if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role)) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado. Rol insuficiente.');
    }
    try {
        const schedulingService = await getService(scheduling_service_1.SchedulingService);
        const result = await schedulingService.assignShift(data, callerAuth.token);
        return { success: true, shiftId: result.id };
    }
    catch (error) {
        const err = error;
        if (error instanceof functions.https.HttpsError)
            throw error;
        console.error('[SCHEDULE_SHIFT_FATAL]', err.message);
        throw new functions.https.HttpsError('internal', `Error: ${err.message}`);
    }
});
exports.manageShifts = functions.https.onCall(async (data, context) => {
    const callerAuth = context.auth;
    const ALLOWED_PLANNING_ROLES = ['admin', 'SuperAdmin', 'Manager', 'Scheduler'];
    if (!callerAuth || !ALLOWED_PLANNING_ROLES.includes(callerAuth.token.role)) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
    }
    const { action, payload } = data;
    try {
        const schedulingService = await getService(scheduling_service_1.SchedulingService);
        switch (action) {
            case 'UPDATE_SHIFT':
                await schedulingService.updateShift(payload.id, payload.data);
                return { success: true, message: 'Turno actualizado.' };
            case 'DELETE_SHIFT':
                await schedulingService.deleteShift(payload.id);
                return { success: true, message: 'Turno eliminado.' };
            case 'REPLICATE_STRUCTURE':
                if (!payload.objectiveId || !payload.sourceDate || !payload.targetStartDate || !payload.targetEndDate) {
                    throw new functions.https.HttpsError('invalid-argument', 'Faltan fechas para replicar.');
                }
                const result = await schedulingService.replicateDailyStructure(payload.objectiveId, payload.sourceDate, payload.targetStartDate, payload.targetEndDate, callerAuth.uid);
                return {
                    success: true,
                    data: result,
                    message: `Replicado: ${result.created} turnos. (Omitidos: ${result.skipped} días)`
                };
            default:
                throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${action}`);
        }
    }
    catch (error) {
        const err = error;
        console.error(`[SHIFT_ERROR] Action ${action} failed:`, err.message);
        if (error instanceof functions.https.HttpsError)
            throw error;
        throw new functions.https.HttpsError('internal', err.message);
    }
});
exports.auditShift = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Requiere autenticación.');
    const { shiftId, action, coords, isManualOverride } = data;
    try {
        const auditService = await getService(audit_service_1.AuditService);
        const result = await auditService.auditShiftAction(shiftId, action, coords || null, context.auth.uid, context.auth.token.role, isManualOverride || false);
        return { success: true, newStatus: result.status };
    }
    catch (error) {
        const err = error;
        if (error instanceof functions.https.HttpsError)
            throw error;
        console.error('[AUDIT_SHIFT_FATAL]', err.message);
        throw new functions.https.HttpsError('internal', err.message);
    }
});
exports.manageData = functions.https.onCall(async (data, context) => {
    const callerAuth = context.auth;
    if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role)) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
    }
    const { action, payload } = data;
    try {
        const dmService = await getService(data_management_service_1.DataManagementService);
        switch (action) {
            case 'CREATE_OBJECTIVE': return { success: true, data: await dmService.createObjective(payload) };
            case 'GET_ALL_OBJECTIVES': return { success: true, data: await dmService.findAllObjectives(payload?.clientId) };
            case 'GET_CLIENT_BY_ID': return { success: true, data: await dmService.getClientById(payload.clientId) };
            default: throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${action}`);
        }
    }
    catch (error) {
        const err = error;
        if (error instanceof functions.https.HttpsError)
            throw error;
        console.error('[DATA_MANAGEMENT_FATAL]', err.message);
        throw new functions.https.HttpsError('internal', err.message);
    }
});
exports.manageHierarchy = functions.https.onCall(async (data, context) => {
    const callerAuth = context.auth;
    if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role)) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
    }
    const { action, payload } = data;
    try {
        const clientService = await getService(client_service_1.ClientService);
        switch (action) {
            case 'CREATE_CLIENT': return { success: true, data: await clientService.createClient(payload) };
            case 'GET_CLIENT': return { success: true, data: await clientService.getClient(payload.id) };
            case 'GET_ALL_CLIENTS': return { success: true, data: await clientService.findAllClients() };
            case 'UPDATE_CLIENT':
                await clientService.updateClient(payload.id, payload.data);
                return { success: true, message: 'Cliente actualizado' };
            case 'DELETE_CLIENT':
                await clientService.deleteClient(payload.id);
                return { success: true, message: 'Cliente eliminado' };
            case 'CREATE_OBJECTIVE': return { success: true, data: await clientService.createObjective(payload) };
            case 'UPDATE_OBJECTIVE':
                await clientService.updateObjective(payload.id, payload.data);
                return { success: true, message: 'Objetivo actualizado correctamente' };
            case 'CREATE_CONTRACT': return { success: true, data: await clientService.createServiceContract(payload) };
            case 'UPDATE_CONTRACT':
                await clientService.updateServiceContract(payload.id, payload.data);
                return { success: true, message: 'Servicio actualizado' };
            case 'DELETE_CONTRACT':
                await clientService.deleteServiceContract(payload.id);
                return { success: true, message: 'Servicio eliminado' };
            case 'CREATE_SHIFT_TYPE': return { success: true, data: await clientService.createShiftType(payload) };
            case 'GET_SHIFT_TYPES': return { success: true, data: await clientService.getShiftTypesByContract(payload.contractId) };
            case 'UPDATE_SHIFT_TYPE':
                await clientService.updateShiftType(payload.id, payload.data);
                return { success: true, message: 'Modalidad actualizada' };
            case 'DELETE_SHIFT_TYPE':
                await clientService.deleteShiftType(payload.id);
                return { success: true, message: 'Modalidad eliminada' };
            default: throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${action}`);
        }
    }
    catch (error) {
        const err = error;
        console.error(`[HIERARCHY_ERROR] Action ${action} failed:`, err.message);
        if (error instanceof functions.https.HttpsError)
            throw error;
        throw new functions.https.HttpsError('internal', `Error: ${err.message}`);
    }
});
exports.manageEmployees = functions.https.onCall(async (data, context) => {
    const callerAuth = context.auth;
    if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role)) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
    }
    const { action, payload } = data;
    try {
        const employeeService = await getService(employee_service_1.EmployeeService);
        switch (action) {
            case 'GET_ALL_EMPLOYEES':
                const employees = await employeeService.findAllEmployees(payload?.clientId);
                return { success: true, data: employees };
            case 'GET_WORKLOAD_REPORT':
                if (!payload.uid || !payload.month || !payload.year) {
                    throw new functions.https.HttpsError('invalid-argument', 'Faltan parámetros (uid, month, year) para el reporte.');
                }
                const report = await employeeService.getEmployeeWorkload(payload.uid, payload.month, payload.year);
                return { success: true, data: report };
            case 'UPDATE_EMPLOYEE':
                await employeeService.updateEmployee(payload.uid, payload.data);
                return { success: true, message: 'Datos actualizados.' };
            case 'DELETE_EMPLOYEE':
                await employeeService.deleteEmployee(payload.uid);
                return { success: true, message: 'Empleado eliminado.' };
            case 'IMPORT_EMPLOYEES':
                if (!payload.rows || !Array.isArray(payload.rows)) {
                    throw new functions.https.HttpsError('invalid-argument', 'Formato de archivo inválido. Se espera un array "rows".');
                }
                const importResult = await employeeService.importEmployees(payload.rows, callerAuth.uid);
                return { success: true, data: importResult };
            default: throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${action}`);
        }
    }
    catch (error) {
        const err = error;
        console.error(`[EMPLOYEE_ERROR] Action ${action} failed:`, err.message);
        if (error instanceof functions.https.HttpsError)
            throw error;
        throw new functions.https.HttpsError('internal', err.message);
    }
});
exports.manageSystemUsers = functions.https.onCall(async (data, context) => {
    const callerAuth = context.auth;
    if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role)) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
    }
    const { action, payload } = data;
    try {
        const sysUserService = await getService(system_user_service_1.SystemUserService);
        switch (action) {
            case 'CREATE_USER':
                await sysUserService.createSystemUser(payload);
                return { success: true, message: 'Administrador creado exitosamente.' };
            case 'GET_ALL_USERS':
                const users = await sysUserService.findAll();
                return { success: true, data: users };
            case 'UPDATE_USER':
                await sysUserService.updateSystemUser(payload.uid, payload.data);
                return { success: true, message: 'Administrador actualizado.' };
            case 'DELETE_USER':
                await sysUserService.deleteSystemUser(payload.uid);
                return { success: true, message: 'Administrador eliminado.' };
            default:
                throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${action}`);
        }
    }
    catch (error) {
        const err = error;
        console.error(`[SYS_USER_ERROR] ${action} failed:`, err.message);
        if (error instanceof functions.https.HttpsError)
            throw error;
        throw new functions.https.HttpsError('internal', err.message);
    }
});
exports.manageAbsences = functions.https.onCall(async (data, context) => {
    const callerAuth = context.auth;
    if (!callerAuth) {
        throw new functions.https.HttpsError('unauthenticated', 'Requiere autenticación.');
    }
    const { action, payload } = data;
    const isAdmin = ADMIN_ROLES.includes(callerAuth.token.role);
    const isSelf = payload.employeeId === callerAuth.uid;
    if (!isAdmin && !(isSelf && action === 'CREATE_ABSENCE')) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
    }
    try {
        const absenceService = await getService(absence_service_1.AbsenceService);
        switch (action) {
            case 'CREATE_ABSENCE':
                return { success: true, data: await absenceService.createAbsence(payload) };
            default:
                throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${action}`);
        }
    }
    catch (error) {
        const err = error;
        console.error(`[ABSENCE_ERROR] Action ${action} failed:`, err.message);
        if (error instanceof functions.https.HttpsError)
            throw error;
        if (err.message.includes('Conflict')) {
            throw new functions.https.HttpsError('failed-precondition', err.message);
        }
        throw new functions.https.HttpsError('internal', err.message);
    }
});
exports.managePatterns = functions.https.onCall(async (data, context) => {
    const callerAuth = context.auth;
    if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role)) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
    }
    const { action, payload } = data;
    try {
        const patternService = await getService(pattern_service_1.PatternService);
        switch (action) {
            case 'CREATE_PATTERN':
                return patternService.createPattern(payload, callerAuth.uid);
            case 'GET_PATTERNS':
                return patternService.getPatternsByContract(payload.contractId);
            case 'DELETE_PATTERN':
                await patternService.deletePattern(payload.id);
                return { success: true };
            case 'GENERATE_VACANCIES':
                return patternService.generateVacancies(payload.contractId, payload.month, payload.year, payload.objectiveId);
            case 'CLEAR_VACANCIES':
                return patternService.clearVacancies(payload.objectiveId, payload.month, payload.year);
            default: throw new functions.https.HttpsError('invalid-argument', 'Acción inválida');
        }
    }
    catch (error) {
        console.error(`[PATTERN_ERROR] Action ${action} failed:`, error.message);
        throw new functions.https.HttpsError('internal', error.message);
    }
});
exports.manageAgreements = functions.https.onCall(async (data, context) => {
    const callerAuth = context.auth;
    if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role)) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
    }
    const { action, payload } = data;
    try {
        const agreementService = await getService(labor_agreement_service_1.LaborAgreementService);
        switch (action) {
            case 'CREATE': return { success: true, data: await agreementService.create(payload) };
            case 'GET_ALL': return { success: true, data: await agreementService.findAll() };
            case 'UPDATE':
                await agreementService.update(payload.id, payload.data);
                return { success: true };
            case 'DELETE':
                await agreementService.delete(payload.id);
                return { success: true };
            case 'INITIALIZE_DEFAULTS':
                const msg = await agreementService.initializeDefaults();
                return { success: true, message: msg };
            default: throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${action}`);
        }
    }
    catch (error) {
        console.error(`[AGREEMENT_ERROR] Action ${action} failed:`, error.message);
        throw new functions.https.HttpsError('internal', error.message);
    }
});
exports.checkSystemHealth = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Requiere autenticación.');
    }
    const start = Date.now();
    try {
        await admin.firestore().listCollections();
        const end = Date.now();
        return {
            status: 'ok',
            nodeVersion: process.version,
            database: {
                status: 'connected',
                latencyMs: end - start
            }
        };
    }
    catch (error) {
        console.error('[HEALTH_CHECK_ERROR]', error);
        return {
            status: 'error',
            nodeVersion: process.version,
            database: {
                status: 'disconnected',
                latencyMs: -1,
                error: error.message
            }
        };
    }
});
exports.chatPlatformAssistant = functions
    .runWith({ secrets: ['GEMINI_API_KEY'] })
    .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Debés estar logueado.');
    }
    try {
        return await (0, runPlatformAssistant_1.runPlatformAssistant)(context.auth.uid, data);
    }
    catch (e) {
        if (e instanceof functions.https.HttpsError)
            throw e;
        console.error('[chatPlatformAssistant]', e?.message, e?.stack);
        throw new functions.https.HttpsError('internal', e?.message ?? 'Error asistente');
    }
});
exports.crearUsuarioSistema = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError("unauthenticated", "Sin permisos.");
    const { email, password, firstName, lastName, role, empresaId } = data;
    try {
        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: `${firstName} ${lastName}`
        });
        await admin.auth().setCustomUserClaims(userRecord.uid, { role, type: 'SYSTEM' });
        await admin.firestore().collection("system_users").doc(userRecord.uid).set({
            uid: userRecord.uid,
            firstName,
            lastName,
            email,
            role,
            empresaId: empresaId ?? 'bacarsa',
            status: 'ACTIVE',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { success: true };
    }
    catch (error) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});
function normalizeSystemRole(role) {
    return String(role ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}
async function assertCanRunDangerousMaintenance(uid) {
    const snap = await admin.firestore().collection("system_users").doc(uid).get();
    if (!snap.exists) {
        throw new functions.https.HttpsError("permission-denied", "Usuario de sistema no encontrado.");
    }
    const r = normalizeSystemRole(snap.data()?.role);
    const allowed = new Set(["SUPERADMIN", "SUPER_ADMIN", "ADMIN"]);
    if (!allowed.has(r)) {
        throw new functions.https.HttpsError("permission-denied", "Solo cuentas ADMIN o SUPERADMIN pueden ejecutar la limpieza masiva.");
    }
}
exports.limpiarBaseDeDatos = functions.runWith({ timeoutSeconds: 540 }).https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError("unauthenticated", "Rechazado.");
    await assertCanRunDangerousMaintenance(context.auth.uid);
    const { target } = data;
    const db = admin.firestore();
    let path = "";
    if (target === 'AUDIT')
        path = 'historial_operaciones';
    else if (target === 'SHIFTS')
        path = 'turnos';
    else
        throw new functions.https.HttpsError("invalid-argument", "Target inválido");
    await db.recursiveDelete(db.collection(path));
    return { success: true };
});
exports.requestCheckIn = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sin permisos.');
    const { shiftId, coords, recordedAt } = data;
    const db = admin.firestore();
    const shiftRef = db.collection('turnos').doc(shiftId);
    const shiftDoc = await shiftRef.get();
    if (!shiftDoc.exists)
        throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');
    const shiftData = shiftDoc.data();
    const empSnap = await db.collection('empleados').where('uid', '==', context.auth.uid).limit(1).get();
    if (empSnap.empty)
        throw new functions.https.HttpsError('not-found', 'Empleado no encontrado.');
    const empId = empSnap.docs[0].id;
    if (shiftData.employeeId !== empId)
        throw new functions.https.HttpsError('permission-denied', 'Turno no pertenece al empleado.');
    const now = admin.firestore.FieldValue.serverTimestamp();
    await shiftRef.update({
        isPresent: true,
        status: 'PRESENT',
        checkInTime: now,
        checkInRequestedAt: now,
        checkInMethod: 'PORTAL_GPS',
        checkInCoords: coords || null,
        checkInRecordedAt: recordedAt || null,
    });
    try {
        await db.collection('novedades').add({
            type: 'INGRESO_AUTOREGISTRO',
            shiftId,
            employeeId: empId,
            employeeName: shiftData.employeeName || '',
            objectiveId: shiftData.objectiveId || '',
            objectiveName: shiftData.objectiveName || '',
            clientName: shiftData.clientName || '',
            empresaId: shiftData.empresaId || null,
            coords: coords || null,
            description: `Ingreso por portal: ${shiftData.employeeName || empId}`,
            createdAt: now,
            status: 'unread',
            viewed: false,
        });
    }
    catch (e) {
        console.warn('[requestCheckIn] No se pudo crear novedad:', e?.message);
    }
    return { success: true };
});
exports.registrarFichadaManual = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError("unauthenticated", "Sin permisos.");
    const { shiftId, notes, method } = data;
    const db = admin.firestore();
    try {
        const shiftRef = db.collection('turnos').doc(shiftId);
        const shiftDoc = await shiftRef.get();
        if (!shiftDoc.exists)
            throw new Error("Turno no encontrado");
        await shiftRef.update({
            status: 'PRESENT',
            checkInTime: admin.firestore.FieldValue.serverTimestamp(),
            checkInMethod: method || 'MANUAL',
            checkInOperator: context.auth.uid,
            operatorNotes: notes || ''
        });
        await db.collection('audit_logs').add({
            action: 'MANUAL_CHECKIN',
            shiftId,
            operator: context.auth.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        return { success: true };
    }
    catch (error) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});
exports.reportarAusencia = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError("unauthenticated", "Sin permisos.");
    const { shiftId, reason, type } = data;
    const db = admin.firestore();
    try {
        const shiftRef = db.collection('turnos').doc(shiftId);
        await shiftRef.update({
            status: 'ABSENT',
            absenceType: type || 'NO_SHOW',
            absenceReason: reason || '',
            absenceReportedBy: context.auth.uid,
            absenceReportedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { success: true };
    }
    catch (error) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});
const nodemailer = require("nodemailer");
function buildPortalEmailHtml(resetLink) {
    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1e3a5f;padding:32px 40px;text-align:center;">
            <p style="color:#fff;font-size:20px;font-weight:bold;margin:0;letter-spacing:1px;">BACAR SA. SEGURIDAD PRIVADA</p>
            <p style="color:#93c5fd;font-size:12px;margin:6px 0 0;letter-spacing:2px;text-transform:uppercase;">Portal de Empleados · COSP</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="color:#1e293b;font-size:16px;line-height:1.7;margin:0 0 16px;">Bacar sa. Seguridad Privada te ha otorgado acceso al <strong>Portal de Empleados de COSP</strong>.</p>
            <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 28px;">Hacé clic en el botón de abajo para crear tu contraseña y acceder al portal:</p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
              <tr>
                <td style="background:#1e3a5f;border-radius:8px;">
                  <a href="${resetLink}" target="_blank" style="display:inline-block;padding:14px 36px;color:#fff;font-size:15px;font-weight:bold;text-decoration:none;letter-spacing:0.5px;">CREAR CONTRASEÑA</a>
                </td>
              </tr>
            </table>
            <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 8px;">Una vez que crees tu contraseña, podrás ver tus turnos, novedades y más.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0;">
            <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0;">Si no esperabas este email, podés ignorarlo. El enlace caduca en 24 horas.</p>
            <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:10px 0 0;">Si el botón no funciona, copiá este enlace en tu navegador:<br>
              <a href="${resetLink}" style="color:#3b82f6;word-break:break-all;">${resetLink}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="color:#64748b;font-size:13px;margin:0;">Saludos,<br><strong>Equipo Operativo · Bacar sa. Seguridad Privada</strong></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
function buildPortalEmailText(resetLink) {
    return `Bacar sa. Seguridad Privada te ha otorgado acceso al Portal de Empleados de COSP.

Hacé clic en el siguiente enlace para crear tu contraseña y acceder al portal:

${resetLink}

Una vez que crees tu contraseña, podrás ver tus turnos, novedades y más.

Si no esperabas este email, podés ignorarlo. El enlace caduca en 24 horas.

Saludos,
Equipo Operativo - Bacar sa. Seguridad Privada`;
}
exports.createPortalAccess = functions.https.onCall(async (data, context) => {
    const callerAuth = context.auth;
    if (!callerAuth) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
    }
    const tokenRole = callerAuth.token.role || '';
    let hasAccess = ADMIN_ROLES.some(r => r.toLowerCase() === tokenRole.toLowerCase());
    if (!hasAccess) {
        try {
            const sysDoc = await admin.firestore().collection('system_users').doc(callerAuth.uid).get();
            if (sysDoc.exists) {
                const fsRole = sysDoc.data()?.role || '';
                hasAccess = ADMIN_ROLES.some(r => r.toLowerCase() === fsRole.toLowerCase());
            }
        }
        catch (_) { }
    }
    if (!hasAccess) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
    }
    const { employeeIds } = data;
    if (!employeeIds?.length) {
        throw new functions.https.HttpsError('invalid-argument', 'Se requiere al menos un empleado.');
    }
    const gmailUser = process.env.GMAIL_USER || '';
    const gmailPass = process.env.GMAIL_PASS || '';
    if (!gmailUser || !gmailPass) {
        throw new functions.https.HttpsError('failed-precondition', 'Servicio de email no configurado. Definir GMAIL_USER y GMAIL_PASS en apps/functions/.env y redesplegar.');
    }
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });
    const db = admin.firestore();
    const results = [];
    for (const empId of employeeIds) {
        try {
            const empDoc = await db.collection('empleados').doc(empId).get();
            if (!empDoc.exists) {
                results.push({ empId, email: '', success: false, error: 'Empleado no encontrado', alreadyExisted: false });
                continue;
            }
            const emp = empDoc.data();
            const email = (emp.email || emp.correo || '').toString().trim().toLowerCase();
            if (!email) {
                results.push({ empId, email: '', success: false, error: 'Sin email registrado', alreadyExisted: false });
                continue;
            }
            const name = (emp.name || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Empleado');
            let uid;
            let alreadyExisted = false;
            try {
                const existing = await admin.auth().getUserByEmail(email);
                uid = existing.uid;
                alreadyExisted = true;
            }
            catch (e) {
                if (e.code === 'auth/user-not-found') {
                    const tempPass = Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 6).toUpperCase();
                    const newUser = await admin.auth().createUser({ email, password: tempPass, displayName: name });
                    await admin.auth().setCustomUserClaims(newUser.uid, { role: 'employee', type: 'employee' });
                    uid = newUser.uid;
                }
                else {
                    throw e;
                }
            }
            const resetLink = await admin.auth().generatePasswordResetLink(email, {
                url: 'https://comtroldata.web.app/empleado/dashboard',
            });
            await transporter.sendMail({
                from: `"Bacar sa. Seguridad Privada" <${gmailUser}>`,
                to: email,
                subject: 'Acceso al Portal de Empleados - COSP',
                html: buildPortalEmailHtml(resetLink),
                text: buildPortalEmailText(resetLink),
            });
            const staleSnap = await db.collection('empleados')
                .where('uid', '==', uid)
                .get();
            const cleanupBatch = db.batch();
            let needsCleanup = false;
            staleSnap.docs.forEach(d => {
                if (d.id !== empId) {
                    cleanupBatch.update(d.ref, { uid: admin.firestore.FieldValue.delete() });
                    needsCleanup = true;
                }
            });
            if (needsCleanup)
                await cleanupBatch.commit();
            await db.collection('empleados').doc(empId).update({
                uid,
                portalInvite: {
                    sent: true,
                    sentAt: admin.firestore.FieldValue.serverTimestamp(),
                    email,
                    sentBy: callerAuth.uid,
                }
            });
            results.push({ empId, email, success: true, alreadyExisted });
        }
        catch (err) {
            results.push({ empId, email: '', success: false, error: err.message, alreadyExisted: false });
        }
    }
    return { success: true, results };
});
function buildClientPortalEmailHtml(resetLink, clientName) {
    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1e3a5f;padding:32px 40px;text-align:center;">
            <p style="color:#fff;font-size:20px;font-weight:bold;margin:0;letter-spacing:1px;">BACAR SA. SEGURIDAD PRIVADA</p>
            <p style="color:#93c5fd;font-size:12px;margin:6px 0 0;letter-spacing:2px;text-transform:uppercase;">Portal de Clientes · COSP</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="color:#1e293b;font-size:16px;line-height:1.7;margin:0 0 16px;">Bacar sa. Seguridad Privada te ha otorgado acceso al <strong>Portal de Clientes de COSP</strong> para gestionar el personal autorizado de <strong>${clientName}</strong>.</p>
            <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 28px;">Hacé clic en el botón de abajo para crear tu contraseña y acceder al portal:</p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
              <tr>
                <td style="background:#4f46e5;border-radius:8px;">
                  <a href="${resetLink}" target="_blank" style="display:inline-block;padding:14px 36px;color:#fff;font-size:15px;font-weight:bold;text-decoration:none;letter-spacing:0.5px;">CREAR CONTRASEÑA</a>
                </td>
              </tr>
            </table>
            <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 8px;">Una vez que crees tu contraseña, podrás consultar los accesos del día y gestionar el personal autorizado de tus objetivos.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0;">
            <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0;">Si no esperabas este email, podés ignorarlo. El enlace caduca en 24 horas.</p>
            <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:10px 0 0;">Si el botón no funciona, copiá este enlace en tu navegador:<br>
              <a href="${resetLink}" style="color:#3b82f6;word-break:break-all;">${resetLink}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="color:#64748b;font-size:13px;margin:0;">Saludos,<br><strong>Equipo Operativo · Bacar sa. Seguridad Privada</strong></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
function buildClientPortalEmailText(resetLink, clientName) {
    return `Bacar sa. Seguridad Privada te ha otorgado acceso al Portal de Clientes de COSP para gestionar el personal autorizado de ${clientName}.

Hacé clic en el siguiente enlace para crear tu contraseña y acceder al portal:

${resetLink}

Una vez que crees tu contraseña, podrás consultar los accesos del día y gestionar el personal autorizado de tus objetivos.

Si no esperabas este email, podés ignorarlo. El enlace caduca en 24 horas.

Saludos,
Equipo Operativo - Bacar sa. Seguridad Privada`;
}
exports.createClientPortalAccess = functions.https.onCall(async (data, context) => {
    const callerAuth = context.auth;
    if (!callerAuth) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
    }
    const tokenRole = callerAuth.token.role || '';
    let hasAccess = ADMIN_ROLES.some(r => r.toLowerCase() === tokenRole.toLowerCase());
    if (!hasAccess) {
        try {
            const sysDoc = await admin.firestore().collection('system_users').doc(callerAuth.uid).get();
            if (sysDoc.exists) {
                const fsRole = sysDoc.data()?.role || '';
                hasAccess = ADMIN_ROLES.some(r => r.toLowerCase() === fsRole.toLowerCase());
            }
        }
        catch (_) { }
    }
    if (!hasAccess) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
    }
    const { clientId, clientName, nombre, email, objectiveIds } = data;
    if (!clientId || !clientName || !nombre || !email) {
        throw new functions.https.HttpsError('invalid-argument', 'Se requieren clientId, clientName, nombre y email.');
    }
    const gmailUser = process.env.GMAIL_USER || '';
    const gmailPass = process.env.GMAIL_PASS || '';
    if (!gmailUser || !gmailPass) {
        throw new functions.https.HttpsError('failed-precondition', 'Servicio de email no configurado. Definir GMAIL_USER y GMAIL_PASS en apps/functions/.env y redesplegar.');
    }
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
    });
    const db = admin.firestore();
    const normalizedEmail = email.trim().toLowerCase();
    let uid;
    let alreadyExisted = false;
    try {
        const existing = await admin.auth().getUserByEmail(normalizedEmail);
        uid = existing.uid;
        alreadyExisted = true;
    }
    catch (e) {
        if (e.code === 'auth/user-not-found') {
            const tempPass = Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 6).toUpperCase();
            const newUser = await admin.auth().createUser({ email: normalizedEmail, password: tempPass, displayName: nombre });
            await admin.auth().setCustomUserClaims(newUser.uid, { role: 'client', type: 'client_user' });
            uid = newUser.uid;
        }
        else {
            throw e;
        }
    }
    const resetLink = await admin.auth().generatePasswordResetLink(normalizedEmail, {
        url: 'https://comtroldata.web.app/cliente/dashboard',
    });
    await transporter.sendMail({
        from: `"Bacar sa. Seguridad Privada" <${gmailUser}>`,
        to: normalizedEmail,
        subject: 'Acceso al Portal de Clientes - COSP',
        html: buildClientPortalEmailHtml(resetLink, clientName),
        text: buildClientPortalEmailText(resetLink, clientName),
    });
    const existingSnap = await db.collection('client_users').where('uid', '==', uid).get();
    const clientUserData = {
        uid,
        clientId,
        clientName,
        nombre: nombre.trim(),
        email: normalizedEmail,
        activo: true,
        objectiveIds: objectiveIds || [],
        portalInvite: {
            sent: true,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            email: normalizedEmail,
            sentBy: callerAuth.uid,
        },
    };
    if (!existingSnap.empty) {
        await existingSnap.docs[0].ref.update(clientUserData);
    }
    else {
        await db.collection('client_users').add({
            ...clientUserData,
            creadoEn: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    return { success: true, alreadyExisted, email: normalizedEmail };
});
var onNovedadCreated_1 = require("./notifications/onNovedadCreated");
Object.defineProperty(exports, "onNovedadCreated", { enumerable: true, get: function () { return onNovedadCreated_1.onNovedadCreated; } });
var onTurnoWrite_1 = require("./notifications/onTurnoWrite");
Object.defineProperty(exports, "onTurnoWrite", { enumerable: true, get: function () { return onTurnoWrite_1.onTurnoWrite; } });
var handler_1 = require("./payroll-api/handler");
Object.defineProperty(exports, "payrollApi", { enumerable: true, get: function () { return handler_1.payrollApi; } });
exports.sendTestNotification = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
    const db = admin.firestore();
    const uid = context.auth.uid;
    const tokensSnap = await db.collection('device_tokens').where('uid', '==', uid).get();
    const tokens = tokensSnap.docs
        .map(d => d.data()?.token)
        .filter((t) => typeof t === 'string' && t.length > 10);
    if (!tokens.length)
        throw new functions.https.HttpsError('not-found', 'No device tokens found');
    const title = data?.title || 'CronoApp';
    const body = data?.body || 'Notificación de prueba';
    const message = {
        notification: { title, body },
        webpush: {
            notification: { title, body, icon: '/icons/icon-192x192.png', requireInteraction: false },
            fcmOptions: { link: '/empleado/dashboard' },
        },
        tokens,
    };
    const result = await admin.messaging().sendEachForMulticast(message);
    return { successCount: result.successCount, failureCount: result.failureCount };
});
exports.autoCompletarTurnos = functions
    .region('us-central1')
    .pubsub.schedule('every 5 minutes')
    .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    const nowMs = now.toMillis();
    const cutoff = admin.firestore.Timestamp.fromMillis(nowMs - 5 * 60 * 1000);
    const RELIEF_WINDOW_MS = 2 * 60 * 60 * 1000;
    const snap = await db.collection('turnos')
        .where('status', '==', 'PRESENT')
        .where('endTime', '<=', cutoff)
        .get();
    if (snap.empty)
        return null;
    const completeBatch = db.batch();
    const auditBatch = db.batch();
    let completed = 0;
    let alertedNoRelief = 0;
    for (const docSnap of snap.docs) {
        const shift = docSnap.data();
        if (shift.isRetention === true)
            continue;
        if ((shift.status || '') === 'INTERRUPTED')
            continue;
        const endTimeMs = shift.endTime?.toMillis?.() ?? 0;
        if (!endTimeMs)
            continue;
        const windowStart = admin.firestore.Timestamp.fromMillis(endTimeMs - RELIEF_WINDOW_MS);
        const windowEnd = admin.firestore.Timestamp.fromMillis(endTimeMs + RELIEF_WINDOW_MS);
        const relieveSnap = await db.collection('turnos')
            .where('objectiveId', '==', shift.objectiveId)
            .where('positionName', '==', shift.positionName)
            .where('startTime', '>=', windowStart)
            .where('startTime', '<=', windowEnd)
            .get();
        const relieveDocs = relieveSnap.docs.filter(d => d.id !== docSnap.id);
        const relievePresent = relieveDocs.find(d => {
            const s = d.data().status || '';
            return s === 'PRESENT' || s === 'COMPLETED';
        });
        const relievePending = relieveDocs.find(d => {
            const data = d.data();
            if (!data.employeeId || data.employeeId === 'VACANTE')
                return false;
            if (data.isUnassigned === true)
                return false;
            const s = data.status || '';
            return s === 'PENDING' || s === 'PLAN' || s === '' || (!s);
        });
        if (relievePresent) {
            completeBatch.update(docSnap.ref, {
                status: 'COMPLETED',
                isCompleted: true,
                realEndTime: now,
                autoCompletedAt: now,
                autoCompletedBy: 'SYSTEM_SCHEDULER',
                autoCloseReason: 'RELEVO_PRESENTE',
            });
            const logRef = db.collection('audit_logs').doc();
            auditBatch.set(logRef, {
                action: 'AUTO_COMPLETE_SHIFT',
                actorName: 'Sistema (Scheduler)',
                actorUid: 'SYSTEM',
                module: 'OPERACIONES',
                shiftId: docSnap.id,
                details: `Turno cerrado por relevo entrante ya presente: ${shift.employeeName || ''} — ${shift.objectiveName || ''}`,
                timestamp: now,
            });
            completed++;
        }
        else if (relievePending) {
            const existing = await db.collection('novedades')
                .where('shiftId', '==', docSnap.id)
                .where('type', '==', 'RELEVO_NO_PRESENTADO')
                .limit(1).get();
            if (existing.empty) {
                const novRef = db.collection('novedades').doc();
                auditBatch.set(novRef, {
                    type: 'RELEVO_NO_PRESENTADO',
                    status: 'PENDIENTE',
                    shiftId: docSnap.id,
                    reliefShiftId: relievePending.id,
                    objectiveId: shift.objectiveId,
                    objectiveName: shift.objectiveName || '',
                    clientId: shift.clientId || null,
                    employeeName: shift.employeeName || '',
                    reliefEmployeeName: relievePending.data().employeeName || '',
                    positionName: shift.positionName || '',
                    description: `El relevo de ${shift.employeeName || ''} en ${shift.objectiveName || ''} no se presentó. Puesto en riesgo.`,
                    createdAt: now,
                    source: 'SYSTEM_SCHEDULER',
                });
                alertedNoRelief++;
            }
        }
        else {
            completeBatch.update(docSnap.ref, {
                status: 'COMPLETED',
                isCompleted: true,
                realEndTime: now,
                autoCompletedAt: now,
                autoCompletedBy: 'SYSTEM_SCHEDULER',
                autoCloseReason: 'SIN_RELEVO',
            });
            const logRef = db.collection('audit_logs').doc();
            auditBatch.set(logRef, {
                action: 'AUTO_COMPLETE_SHIFT',
                actorName: 'Sistema (Scheduler)',
                actorUid: 'SYSTEM',
                module: 'OPERACIONES',
                shiftId: docSnap.id,
                details: `Turno finalizado (sin relevo): ${shift.employeeName || ''} — ${shift.objectiveName || ''}`,
                timestamp: now,
            });
            completed++;
        }
    }
    await completeBatch.commit();
    await auditBatch.commit();
    console.log(`[autoCompletarTurnos] Completados: ${completed} | Alertas sin relevo: ${alertedNoRelief}`);
    return null;
});
const SKIP_STATUSES = new Set(['PRESENT', 'ABSENT', 'COMPLETED', 'INTERRUPTED', 'CANCELLED']);
const SKIP_CODES = new Set(['F', 'FF', 'V', 'L', 'A', 'E', 'AA', 'FP']);
async function getEmployeeTokens(db, employeeId) {
    if (!employeeId || employeeId === 'VACANTE')
        return [];
    const empDoc = await db.collection('empleados').doc(employeeId).get();
    const authUid = empDoc.data()?.uid;
    if (!authUid)
        return [];
    const tokenSnap = await db.collection('device_tokens').where('uid', '==', authUid).get();
    return tokenSnap.docs.map(d => d.data()?.token).filter((t) => typeof t === 'string' && t.length > 10);
}
exports.detectarAusencias = functions
    .region('us-central1')
    .pubsub.schedule('every 5 minutes')
    .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    const nowMs = now.toMillis();
    const windowFrom = admin.firestore.Timestamp.fromMillis(nowMs - 8 * 60 * 60 * 1000);
    const windowTo = admin.firestore.Timestamp.fromMillis(nowMs - 30 * 60 * 1000);
    const snap = await db.collection('turnos')
        .where('startTime', '>=', windowFrom)
        .where('startTime', '<=', windowTo)
        .get();
    if (snap.empty)
        return null;
    let alerts = 0;
    let absents = 0;
    for (const docSnap of snap.docs) {
        const shift = docSnap.data();
        if (shift.draft === true)
            continue;
        if (SKIP_STATUSES.has(shift.status || ''))
            continue;
        if (shift.isPresent === true || shift.isCompleted === true)
            continue;
        if (shift.isUnassigned === true)
            continue;
        if (shift.isReportedToPlanning === true)
            continue;
        if (SKIP_CODES.has((shift.code || '').toUpperCase()))
            continue;
        if (!shift.employeeId || shift.employeeId === 'VACANTE')
            continue;
        const startMs = shift.startTime?.toMillis?.() ?? 0;
        if (!startMs)
            continue;
        const elapsedMin = (nowMs - startMs) / 60000;
        if (elapsedMin >= 30) {
            if (shift.absenceDetectedAt)
                continue;
            if (shift.lateArrivalAt)
                continue;
            await docSnap.ref.update({
                status: 'ABSENT',
                isAbsent: true,
                absenceType: 'AA',
                absenceDetectedAt: now,
                absenceDetectedBy: 'SYSTEM_SCHEDULER',
            });
            const tokens = await getEmployeeTokens(db, shift.employeeId);
            if (tokens.length > 0) {
                const startStr = shift.startTime?.toDate
                    ? shift.startTime.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' })
                    : '';
                try {
                    await admin.messaging().sendEachForMulticast({
                        tokens,
                        notification: {
                            title: '⚠️ Ausencia registrada',
                            body: `No se registró tu presencia en el turno de las ${startStr} en ${shift.objectiveName || ''}. Reportate a Operaciones.`,
                        },
                        webpush: {
                            notification: {
                                title: '⚠️ Ausencia registrada',
                                body: `No registraste presencia en ${shift.objectiveName || ''} (${startStr}). Ingresá al portal si estás presente.`,
                                icon: '/icons/icon-192x192.png',
                                requireInteraction: true,
                            },
                            fcmOptions: { link: '/empleado/dashboard' },
                        },
                    });
                }
                catch (e) {
                    console.warn(`[detectarAusencias] Push error para ${shift.employeeId}:`, e);
                }
            }
            const shiftDate = shift.startTime?.toDate ? shift.startTime.toDate() : new Date(startMs);
            const dateStr = `${shiftDate.getFullYear()}-${String(shiftDate.getMonth() + 1).padStart(2, '0')}-${String(shiftDate.getDate()).padStart(2, '0')}`;
            const ausenciaExistsSnap = await db.collection('ausencias')
                .where('shiftId', '==', docSnap.id)
                .limit(1).get();
            if (ausenciaExistsSnap.empty) {
                await db.collection('ausencias').add({
                    employeeId: shift.employeeId,
                    employeeName: shift.employeeName || '',
                    startDate: dateStr,
                    endDate: dateStr,
                    type: 'Injustificada',
                    absenceType: 'AA',
                    origin: 'AUTO_T30',
                    shiftId: docSnap.id,
                    objectiveId: shift.objectiveId || null,
                    objectiveName: shift.objectiveName || '',
                    clientId: shift.clientId || null,
                    positionName: shift.positionName || '',
                    status: 'APPROVED',
                    createdAt: now,
                    source: 'SYSTEM_SCHEDULER',
                });
            }
            const existsSnap = await db.collection('novedades')
                .where('shiftId', '==', docSnap.id)
                .where('type', '==', 'AUSENCIA_AUTO')
                .limit(1).get();
            if (existsSnap.empty) {
                await db.collection('novedades').add({
                    type: 'AUSENCIA_AUTO',
                    status: 'PENDIENTE',
                    shiftId: docSnap.id,
                    employeeId: shift.employeeId,
                    employeeName: shift.employeeName || '',
                    objectiveId: shift.objectiveId || null,
                    objectiveName: shift.objectiveName || '',
                    clientId: shift.clientId || null,
                    positionName: shift.positionName || '',
                    description: `${shift.employeeName || 'Empleado'} no se presentó al turno en ${shift.objectiveName || ''} (detectado a los ${Math.round(elapsedMin)} min).`,
                    createdAt: now,
                    source: 'SYSTEM_SCHEDULER',
                });
            }
            await db.collection('audit_logs').add({
                action: 'AUTO_MARK_ABSENT',
                actorName: 'Sistema (Scheduler)',
                actorUid: 'SYSTEM',
                module: 'OPERACIONES',
                shiftId: docSnap.id,
                details: `Ausencia automática: ${shift.employeeName || ''} — ${shift.objectiveName || ''} (${Math.round(elapsedMin)} min)`,
                timestamp: now,
            });
            absents++;
        }
    }
    console.log(`[detectarAusencias] Alertas: ${alerts} | Marcados ausentes: ${absents}`);
    return null;
});
exports.gestionarVacantes = functions
    .region('us-central1')
    .pubsub.schedule('every 5 minutes')
    .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    const nowMs = now.toMillis();
    const windowStart = admin.firestore.Timestamp.fromMillis(nowMs - 12 * 60 * 60 * 1000);
    const windowEnd = admin.firestore.Timestamp.fromMillis(nowMs + 4 * 60 * 60 * 1000);
    const snap = await db.collection('turnos')
        .where('startTime', '>=', windowStart)
        .where('startTime', '<=', windowEnd)
        .get();
    if (snap.empty)
        return null;
    let sentToPlanning = 0;
    let sentToProtocol = 0;
    for (const docSnap of snap.docs) {
        const shift = docSnap.data();
        if (shift.isUnassigned !== true && shift.employeeId !== 'VACANTE')
            continue;
        const st = (shift.status || '').toUpperCase();
        if (['CANCELLED', 'COMPLETED', 'PRESENT'].includes(st))
            continue;
        if (shift.isResolvedByOps === true)
            continue;
        if (SKIP_CODES.has((shift.code || '').toUpperCase()))
            continue;
        const startMs = shift.startTime?.toMillis?.() ?? 0;
        if (!startMs)
            continue;
        const minutesUntil = (startMs - nowMs) / 60000;
        if (minutesUntil < 0 && !shift.vacanteProtocoloAt) {
            await docSnap.ref.update({ vacanteProtocoloAt: now, vacanteEscalada: true });
            const existsProto = await db.collection('novedades')
                .where('shiftId', '==', docSnap.id)
                .where('type', '==', 'VACANTE_PROTOCOLO_COBERTURA')
                .limit(1).get();
            if (existsProto.empty) {
                await db.collection('novedades').add({
                    type: 'VACANTE_PROTOCOLO_COBERTURA',
                    status: 'PENDIENTE',
                    shiftId: docSnap.id,
                    objectiveId: shift.objectiveId || null,
                    objectiveName: shift.objectiveName || '',
                    clientId: shift.clientId || null,
                    positionName: shift.positionName || '',
                    description: `⚠️ PROTOCOLO: Vacante ACTIVA en ${shift.objectiveName || ''} (${shift.positionName || ''}) sin cobertura. Turno ya iniciado hace ${Math.round(Math.abs(minutesUntil))} min.`,
                    minutesUntilStart: Math.round(minutesUntil),
                    createdAt: now,
                    source: 'SYSTEM_SCHEDULER',
                });
            }
            await db.collection('audit_logs').add({
                action: 'VACANTE_PROTOCOLO_AUTO',
                actorName: 'Sistema (Scheduler)',
                actorUid: 'SYSTEM',
                module: 'OPERACIONES',
                shiftId: docSnap.id,
                details: `Protocolo activado (turno ya iniciado): vacante sin cubrir en ${shift.objectiveName || ''} — ${Math.round(Math.abs(minutesUntil))} min activo`,
                timestamp: now,
            });
            sentToProtocol++;
            continue;
        }
        if (minutesUntil <= 60 && !shift.vacanteProtocoloAt) {
            await docSnap.ref.update({
                vacanteProtocoloAt: now,
                vacanteEscalada: true,
            });
            const existsProto = await db.collection('novedades')
                .where('shiftId', '==', docSnap.id)
                .where('type', '==', 'VACANTE_PROTOCOLO_COBERTURA')
                .limit(1).get();
            if (existsProto.empty) {
                await db.collection('novedades').add({
                    type: 'VACANTE_PROTOCOLO_COBERTURA',
                    status: 'PENDIENTE',
                    shiftId: docSnap.id,
                    objectiveId: shift.objectiveId || null,
                    objectiveName: shift.objectiveName || '',
                    clientId: shift.clientId || null,
                    positionName: shift.positionName || '',
                    description: `⚠️ PROTOCOLO: Vacante en ${shift.objectiveName || ''} (${shift.positionName || ''}) sin cubrir a ${Math.round(minutesUntil)} min del inicio. Requiere acción inmediata de Operaciones.`,
                    minutesUntilStart: Math.round(minutesUntil),
                    createdAt: now,
                    source: 'SYSTEM_SCHEDULER',
                });
            }
            await db.collection('audit_logs').add({
                action: 'VACANTE_PROTOCOLO_AUTO',
                actorName: 'Sistema (Scheduler)',
                actorUid: 'SYSTEM',
                module: 'OPERACIONES',
                shiftId: docSnap.id,
                details: `Protocolo activado: vacante sin cubrir en ${shift.objectiveName || ''} — ${Math.round(minutesUntil)} min para el inicio`,
                timestamp: now,
            });
            sentToProtocol++;
        }
        else if (minutesUntil <= 180 && !shift.vacanteReportadaAt && !shift.isReportedToPlanning) {
            await docSnap.ref.update({
                isReportedToPlanning: true,
                vacanteReportadaAt: now,
                reportedBy: 'SYSTEM_SCHEDULER',
            });
            const existsPlan = await db.collection('novedades')
                .where('shiftId', '==', docSnap.id)
                .where('type', '==', 'VACANTE_A_PLANIFICACION')
                .limit(1).get();
            if (existsPlan.empty) {
                await db.collection('novedades').add({
                    type: 'VACANTE_A_PLANIFICACION',
                    status: 'PENDIENTE',
                    shiftId: docSnap.id,
                    objectiveId: shift.objectiveId || null,
                    objectiveName: shift.objectiveName || '',
                    clientId: shift.clientId || null,
                    positionName: shift.positionName || '',
                    description: `Vacante devuelta a Planificación: ${shift.objectiveName || ''} (${shift.positionName || ''}) inicia en ${Math.round(minutesUntil)} min. Asignar empleado urgente.`,
                    minutesUntilStart: Math.round(minutesUntil),
                    createdAt: now,
                    source: 'SYSTEM_SCHEDULER',
                });
            }
            await db.collection('audit_logs').add({
                action: 'VACANTE_DEVUELTA_PLANIFICACION_AUTO',
                actorName: 'Sistema (Scheduler)',
                actorUid: 'SYSTEM',
                module: 'PLANIFICACION',
                shiftId: docSnap.id,
                details: `Vacante auto-devuelta: ${shift.objectiveName || ''} — ${Math.round(minutesUntil)} min para el inicio`,
                timestamp: now,
            });
            sentToPlanning++;
        }
    }
    console.log(`[gestionarVacantes] A planificación: ${sentToPlanning} | Protocolos: ${sentToProtocol}`);
    return null;
});
exports.triggerBackup = functions
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .https.onCall(async (_data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida');
    const role = context.auth.token.role;
    const allowed = ['admin', 'superadmin', 'SuperAdmin'];
    if (!allowed.includes(role))
        throw new functions.https.HttpsError('permission-denied', 'Solo administradores');
    const folderId = process.env.DRIVE_BACKUP_FOLDER_ID;
    if (!folderId)
        throw new functions.https.HttpsError('failed-precondition', 'Variable DRIVE_BACKUP_FOLDER_ID no configurada.');
    try {
        const result = await (0, backup_service_1.runBackup)(folderId);
        return result;
    }
    catch (e) {
        const db = admin.firestore();
        await db.collection('system_backups').add({
            status: 'error',
            error: e?.message || 'Error desconocido',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        throw new functions.https.HttpsError('internal', e?.message || 'Error al ejecutar backup');
    }
});
exports.restoreBackup = functions
    .runWith({ timeoutSeconds: 540, memory: '1GB' })
    .https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida');
    const role = context.auth.token.role;
    if (!['admin', 'superadmin', 'SuperAdmin'].includes(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Solo administradores');
    }
    const { driveFileId, mode, jobId } = data;
    if (!driveFileId)
        throw new functions.https.HttpsError('invalid-argument', 'driveFileId requerido');
    if (!['merge', 'full'].includes(mode))
        throw new functions.https.HttpsError('invalid-argument', 'mode debe ser merge o full');
    try {
        return await (0, restore_service_1.runRestore)(driveFileId, mode, jobId);
    }
    catch (e) {
        throw new functions.https.HttpsError('internal', e?.message || 'Error al restaurar');
    }
});
exports.onAusenciaCreatedFromPortal = functions
    .region('us-central1')
    .runWith({ timeoutSeconds: 30, memory: '128MB' })
    .firestore.document('ausencias/{id}')
    .onCreate(async (snap) => {
    const data = snap.data();
    if (!data || data.source !== 'EMPLEADO')
        return null;
    const absenceCase = data.absenceCase || 'PROGRAMADA';
    if (absenceCase === 'PROGRAMADA')
        return null;
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    let empresaId = data.empresaId || null;
    if (!empresaId && data.employeeId) {
        const empDoc = await db.collection('empleados').doc(data.employeeId).get();
        empresaId = empDoc.data()?.empresaId || null;
    }
    const novedadType = absenceCase === 'CORTO_PLAZO' ? 'AUSENCIA_CORTO_PLAZO' : 'AVISO_AUSENCIA_ANTICIPADA';
    const title = absenceCase === 'CORTO_PLAZO'
        ? 'Ausencia urgente — menos de 4hs'
        : 'Aviso de ausencia anticipada';
    const desc = absenceCase === 'CORTO_PLAZO'
        ? `${data.employeeName || 'Empleado'} reportó ausencia urgente (menos de 4hs) desde el portal`
        : `${data.employeeName || 'Empleado'} reportó ausencia anticipada desde el portal`;
    await db.collection('novedades').add({
        type: novedadType,
        title,
        status: 'pending',
        employeeId: data.employeeId || '',
        employeeName: data.employeeName || '',
        objectiveId: data.objectiveId || null,
        objectiveName: data.objectiveName || '',
        positionName: data.positionName || '',
        clientId: data.clientId || null,
        shiftId: data.shiftId || null,
        absenceCase,
        handledBy: data.handledBy || 'OPERATIONS',
        urgency: absenceCase === 'CORTO_PLAZO' ? 'HIGH' : 'MEDIUM',
        minutesBeforeShift: data.minutesBeforeShift ?? null,
        description: desc,
        createdAt: now,
        source: 'PORTAL_EMPLEADO',
        reportedBy: 'SISTEMA',
        empresaId,
    });
    return null;
});
exports.scheduledBackup = functions
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .pubsub.schedule('0 3 * * *')
    .timeZone('America/Argentina/Buenos_Aires')
    .onRun(async () => {
    const folderId = process.env.DRIVE_BACKUP_FOLDER_ID;
    if (!folderId) {
        console.warn('[scheduledBackup] DRIVE_BACKUP_FOLDER_ID no configurado');
        return null;
    }
    try {
        const result = await (0, backup_service_1.runBackup)(folderId);
        console.log(`[scheduledBackup] OK: ${result.fileName} — ${result.totalDocs} docs`);
    }
    catch (e) {
        console.error('[scheduledBackup] Error:', e);
    }
    return null;
});
//# sourceMappingURL=index.js.map