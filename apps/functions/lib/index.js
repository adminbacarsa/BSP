"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmpresaAfipConfig = exports.saveEmpresaAfipCredentials = exports.lookupClientByCuit = exports.scheduledBackup = exports.onAusenciaCreatedFromPortal = exports.processEmpresaMigrateJob = exports.migrateEmpresaData = exports.processRestoreJob = exports.restoreBackup = exports.triggerBackup = exports.gestionarVacantes = exports.detectarAusencias = exports.autoCompletarTurnos = exports.sendTestNotification = exports.payrollApi = exports.onCronogramaPublished = exports.onTurnoWrite = exports.onNovedadCreated = exports.createClientPortalAccess = exports.activateAndSetPassword = exports.activateDevice = exports.createPortalAccess = exports.reportarAusencia = exports.registrarFichadaManual = exports.requestCheckIn = exports.limpiarBaseDeDatos = exports.syncSystemUserClaims = exports.crearUsuarioSistema = exports.optimizePlanningGemini = exports.chatPlatformAssistant = exports.checkSystemHealth = exports.platformHealthCheck = exports.manageAgreements = exports.managePatterns = exports.manageAbsences = exports.manageSystemUsers = exports.manageEmployees = exports.manageHierarchy = exports.manageData = exports.auditShift = exports.manageShifts = exports.scheduleShift = exports.createUser = void 0;
require("./bootstrap-env");
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const backup_service_1 = require("./backup/backup.service");
const restore_job_runner_1 = require("./backup/restore-job.runner");
const migrate_job_runner_1 = require("./backup/migrate-job.runner");
const empresa_migrate_service_1 = require("./backup/empresa-migrate.service");
const backup_auth_util_1 = require("./backup/backup-auth.util");
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
const assistantInteractionLog_1 = require("./assistant/assistantInteractionLog");
const planningGeminiServer_1 = require("./assistant/planningGeminiServer");
const planificacionEstadoKeys_1 = require("./assistant/planificacionEstadoKeys");
const lookupClientByCuitHandler_1 = require("./afip/lookupClientByCuitHandler");
const empresaAfipCredentialsHandler_1 = require("./afip/empresaAfipCredentialsHandler");
if (!admin.apps.length) {
    admin.initializeApp();
}
admin.firestore().settings({ ignoreUndefinedProperties: true });
let nestApp;
async function getService(service) {
    if (!nestApp) {
        nestApp = await (0, main_1.createNestApp)();
    }
    return nestApp.get(service);
}
const ADMIN_ROLES = ['admin', 'superadmin', 'SuperAdmin', 'Scheduler', 'HR_Manager', 'Manager', 'Operator', 'Supervisor'];
const ALL_EMPRESAS_SENTINEL = '__ALL__';
const ALLOWED_ROLES = ['admin', 'employee'];
exports.createUser = functions.https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'AutenticaciÃ³n requerida.');
    }
    const caller = await (0, backup_auth_util_1.resolveBackupCaller)(context.auth.uid, context.auth.token?.role);
    if (!caller.isPanelUser || !(0, backup_auth_util_1.isAdminBackupRole)(caller.sysRole || context.auth.token?.role)) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado. Solo administradores pueden crear usuarios.');
    }
    try {
        const authService = await getService(auth_service_1.AuthService);
        const { email, password, name, role: receivedRole, clientId, dni, fileNumber, address, empresaId: rawEmpresaId } = data;
        const targetEmpresaId = String(rawEmpresaId ?? caller.profileEmpresa ?? 'bacarsa').trim();
        if (!caller.isSuper && caller.profileEmpresa && targetEmpresaId !== caller.profileEmpresa) {
            throw new functions.https.HttpsError('permission-denied', 'No podÃ©s crear usuarios para otra empresa.');
        }
        if (!ALLOWED_ROLES.includes(receivedRole)) {
            throw new functions.https.HttpsError('invalid-argument', 'Rol invÃ¡lido.');
        }
        const validRole = receivedRole;
        const newEmployee = await authService.createEmployeeProfile(email, password, validRole, name, { clientId: clientId || '', dni, fileNumber, address, empresaId: targetEmpresaId });
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
                    message: `Replicado: ${result.created} turnos. (Omitidos: ${result.skipped} dÃ­as)`
                };
            default:
                throw new functions.https.HttpsError('invalid-argument', `AcciÃ³n desconocida: ${action}`);
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
        throw new functions.https.HttpsError('unauthenticated', 'Requiere autenticaciÃ³n.');
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
            default: throw new functions.https.HttpsError('invalid-argument', `AcciÃ³n desconocida: ${action}`);
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
            default: throw new functions.https.HttpsError('invalid-argument', `AcciÃ³n desconocida: ${action}`);
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
                    throw new functions.https.HttpsError('invalid-argument', 'Faltan parÃ¡metros (uid, month, year) para el reporte.');
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
                    throw new functions.https.HttpsError('invalid-argument', 'Formato de archivo invÃ¡lido. Se espera un array "rows".');
                }
                const importResult = await employeeService.importEmployees(payload.rows, callerAuth.uid);
                return { success: true, data: importResult };
            default: throw new functions.https.HttpsError('invalid-argument', `AcciÃ³n desconocida: ${action}`);
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
                throw new functions.https.HttpsError('invalid-argument', `AcciÃ³n desconocida: ${action}`);
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
        throw new functions.https.HttpsError('unauthenticated', 'Requiere autenticaciÃ³n.');
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
                throw new functions.https.HttpsError('invalid-argument', `AcciÃ³n desconocida: ${action}`);
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
            default: throw new functions.https.HttpsError('invalid-argument', 'AcciÃ³n invÃ¡lida');
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
            default: throw new functions.https.HttpsError('invalid-argument', `AcciÃ³n desconocida: ${action}`);
        }
    }
    catch (error) {
        console.error(`[AGREEMENT_ERROR] Action ${action} failed:`, error.message);
        throw new functions.https.HttpsError('internal', error.message);
    }
});
exports.platformHealthCheck = functions.https.onCall(async (_data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Requiere autenticaciÃ³n.');
    }
    const db = admin.firestore();
    const results = {};
    const t0 = Date.now();
    try {
        const snap = await db.collection('empresas').limit(1).get();
        results.firestore = { ok: true, latencyMs: Date.now() - t0, detail: `${snap.size} empresa(s) leÃ­da(s)` };
    }
    catch (e) {
        results.firestore = { ok: false, latencyMs: Date.now() - t0, detail: e.message };
    }
    const geminiKey = process.env.GEMINI_API_KEY || '';
    if (!geminiKey) {
        results.gemini = { ok: false, detail: 'GEMINI_API_KEY no configurada' };
    }
    else {
        const tg = Date.now();
        try {
            const { GoogleGenerativeAI } = await Promise.resolve().then(() => require('@google/generative-ai'));
            const genAI = new GoogleGenerativeAI(geminiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            await model.generateContent({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] });
            results.gemini = { ok: true, latencyMs: Date.now() - tg, detail: 'Respuesta OK' };
        }
        catch (e) {
            results.gemini = { ok: false, latencyMs: Date.now() - tg, detail: e.message?.slice(0, 120) };
        }
    }
    const gmailUser = process.env.GMAIL_USER || '';
    const gmailPass = process.env.GMAIL_PASS || '';
    if (!gmailUser || !gmailPass) {
        results.gmail = { ok: false, detail: 'GMAIL_USER / GMAIL_PASS no configurados' };
    }
    else {
        const tm = Date.now();
        try {
            const nodemailerMod = await Promise.resolve().then(() => require('nodemailer'));
            const transporter = nodemailerMod.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
            await transporter.verify();
            results.gmail = { ok: true, latencyMs: Date.now() - tm, detail: gmailUser };
        }
        catch (e) {
            results.gmail = { ok: false, latencyMs: Date.now() - tm, detail: e.message?.slice(0, 120) };
        }
    }
    const driveFolderId = process.env.DRIVE_BACKUP_FOLDER_ID || '';
    if (!driveFolderId) {
        results.drive = { ok: false, detail: 'DRIVE_BACKUP_FOLDER_ID no configurado' };
    }
    else {
        try {
            const snap = await db.collection('system_backups').orderBy('createdAt', 'desc').limit(1).get();
            if (!snap.empty) {
                const last = snap.docs[0].data();
                const ts = last.createdAt?.toDate?.()?.toISOString?.() ?? 'desconocido';
                results.drive = { ok: true, detail: `Ãšltimo backup: ${ts}` };
            }
            else {
                results.drive = { ok: true, detail: 'Sin backups registrados aÃºn' };
            }
        }
        catch (e) {
            results.drive = { ok: false, detail: e.message?.slice(0, 120) };
        }
    }
    try {
        const tokSnap = await db.collection('device_tokens').limit(1).get();
        results.fcm = { ok: true, detail: `Tokens registrados: ${tokSnap.size > 0 ? 'â‰¥1' : '0'}` };
    }
    catch (e) {
        results.fcm = { ok: false, detail: e.message };
    }
    const scheduledJobs = ['autoCompletarTurnos', 'detectarAusencias', 'gestionarVacantes', 'scheduledBackup'];
    const jobStatus = {};
    for (const job of scheduledJobs) {
        try {
            const snap = await db.collection('scheduled_job_logs').doc(job).get();
            if (snap.exists) {
                const d = snap.data();
                const ts = d.lastRunAt?.toDate?.()?.toISOString?.() ?? null;
                jobStatus[job] = ts ?? 'sin registro';
            }
            else {
                jobStatus[job] = 'sin registro';
            }
        }
        catch {
            jobStatus[job] = 'error';
        }
    }
    results.scheduledJobs = { ok: true, detail: JSON.stringify(jobStatus) };
    try {
        const [empSnap, sysSnap, empActivos] = await Promise.all([
            db.collection('empresas').get(),
            db.collection('system_users').get(),
            db.collection('empleados').where('active', '==', true).get(),
        ]);
        results.data = {
            ok: true,
            detail: `Empresas: ${empSnap.size} Â· Admins: ${sysSnap.size} Â· Empleados activos: ${empActivos.size}`,
        };
    }
    catch (e) {
        results.data = { ok: false, detail: e.message };
    }
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
    results.env = { ok: true, detail: isEmulator ? 'Emulador local' : 'ProducciÃ³n (Firebase)' };
    return { ok: Object.values(results).every(r => r.ok), results, nodeVersion: process.version, checkedAt: new Date().toISOString() };
});
exports.checkSystemHealth = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Requiere autenticaciÃ³n.');
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
async function chatPlatformAssistantHandler(data, context) {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'DebÃ©s estar logueado.');
    }
    const t0 = Date.now();
    const uid = context.auth.uid;
    const question = (0, assistantInteractionLog_1.extractLastUserQuestion)(data.messages ?? []);
    const empresaId = String(data.empresaId ?? '').trim();
    const moduleKey = typeof data.moduleKey === 'string' ? data.moduleKey.trim() : null;
    const pathname = String(data.pathname ?? '').slice(0, 400);
    const userEmail = context.auth.token?.email ||
        (context.auth.token?.email_verified != null ? String(context.auth.token?.email ?? '') : null) ||
        null;
    let reply;
    let hadError = false;
    let errorCode = null;
    let errorMessage = null;
    try {
        const tokenRole = String(context.auth.token?.role ?? '').trim() || undefined;
        const result = await (0, runPlatformAssistant_1.runPlatformAssistant)(uid, data, { tokenRole });
        reply = result.reply;
        return result;
    }
    catch (e) {
        hadError = true;
        if (e instanceof functions.https.HttpsError) {
            errorCode = String(e.code ?? 'https-error');
            errorMessage = truncateMsg(String(e.message ?? ''), 480);
            throw e;
        }
        console.error('[chatPlatformAssistant]', e?.message, e?.stack);
        const hint = truncateMsg(e?.message ?? 'Error asistente', 480);
        errorCode = 'internal';
        errorMessage = hint;
        throw new functions.https.HttpsError('failed-precondition', hint);
    }
    finally {
        const outcome = (0, assistantInteractionLog_1.classifyAssistantOutcome)(reply, hadError);
        void (0, assistantInteractionLog_1.writeAssistantInteractionLog)({
            empresaId,
            uid,
            userEmail,
            question,
            reply: reply ?? null,
            moduleKey,
            pathname,
            outcome,
            errorCode: hadError ? errorCode : null,
            errorMessage: hadError ? errorMessage : null,
            durationMs: Date.now() - t0,
        });
    }
}
function truncateMsg(s, max) {
    const t = String(s).trim();
    return t.length <= max ? t : `${t.slice(0, max - 3)}â€¦`;
}
exports.chatPlatformAssistant = process.env.FUNCTIONS_EMULATOR === 'true'
    ? functions.https.onCall(chatPlatformAssistantHandler)
    : functions
        .runWith({ secrets: ['GEMINI_API_KEY'], timeoutSeconds: 180, memory: '512MB' })
        .https.onCall(chatPlatformAssistantHandler);
const ALLOWED_PLANNING_AI_ROLES = ['admin', 'SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP', 'Manager', 'Scheduler', 'ADMIN_EMPRESA', 'ADMIN_PRUEBA'];
async function optimizePlanningGeminiHandler(data, context) {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'DebÃ©s estar logueado.');
    }
    const role = String(context.auth.token.role || '').trim();
    const { isSuperAdminRole } = await Promise.resolve().then(() => require('./common/role.util'));
    if (!isSuperAdminRole(role) && !ALLOWED_PLANNING_AI_ROLES.includes(role)) {
        throw new functions.https.HttpsError('permission-denied', 'Rol sin acceso a IA de planificaciÃ³n.');
    }
    const { resolveAssistantUser, empresaAllowed } = await Promise.resolve().then(() => require('./assistant/resolveAssistantUser'));
    const tokenRole = String(context.auth.token?.role ?? '').trim() || undefined;
    const profile = await resolveAssistantUser(context.auth.uid, { tokenRole });
    if (!profile) {
        throw new functions.https.HttpsError('permission-denied', 'Usuario no reconocido.');
    }
    const claimedEmp = String(data?.empresaId ?? data?.context?.empresaId ?? '').trim();
    if (!empresaAllowed(claimedEmp || undefined, profile)) {
        throw new functions.https.HttpsError('permission-denied', 'Empresa no permitida para este usuario.');
    }
    const ctx = data?.context;
    if (!ctx || typeof ctx !== 'object') {
        throw new functions.https.HttpsError('invalid-argument', 'Falta payload "context".');
    }
    try {
        return await (0, planningGeminiServer_1.runPlanningGeminiOptimize)(ctx);
    }
    catch (e) {
        if (e instanceof functions.https.HttpsError)
            throw e;
        console.error('[optimizePlanningGemini]', e?.message, e?.stack);
        const detail = e?.message || e?.toString?.() || 'Error Gemini planificaciÃ³n';
        throw new functions.https.HttpsError('internal', detail);
    }
}
const optimizePlanningGeminiRuntime = {
    timeoutSeconds: 180,
    memory: '512MB',
};
exports.optimizePlanningGemini = process.env.FUNCTIONS_EMULATOR === 'true'
    ? functions.runWith(optimizePlanningGeminiRuntime).https.onCall(optimizePlanningGeminiHandler)
    : functions
        .runWith({ ...optimizePlanningGeminiRuntime, secrets: ['GEMINI_API_KEY'] })
        .https.onCall(optimizePlanningGeminiHandler);
exports.crearUsuarioSistema = functions.https.onCall(async (data, context) => {
    if (!context.auth?.uid)
        throw new functions.https.HttpsError("unauthenticated", "Sin permisos.");
    const caller = await (0, backup_auth_util_1.resolveBackupCaller)(context.auth.uid, context.auth.token?.role);
    if (!caller.isPanelUser || !(0, backup_auth_util_1.isAdminBackupRole)(caller.sysRole || context.auth.token?.role)) {
        throw new functions.https.HttpsError('permission-denied', 'Solo administradores pueden crear usuarios de sistema.');
    }
    const { email, password, firstName, lastName, role, empresaId: rawEmpresaId, allEmpresas: rawAllEmpresas } = data;
    const roleNorm = (0, backup_auth_util_1.normalizeBackupRole)(role);
    const roleIsSuper = (0, backup_auth_util_1.isSuperAdminBackupRole)(roleNorm);
    const multiEmpresa = !roleIsSuper &&
        (rawAllEmpresas === true || String(rawEmpresaId ?? '').trim() === ALL_EMPRESAS_SENTINEL);
    if ((roleIsSuper || multiEmpresa) && !caller.isSuper) {
        throw new functions.https.HttpsError('permission-denied', 'Solo superadmin puede crear usuarios SuperAdmin o multi-empresa.');
    }
    let targetEmpresaId = '';
    let allEmpresas = false;
    if (roleIsSuper) {
        targetEmpresaId = '';
    }
    else if (multiEmpresa) {
        targetEmpresaId = '';
        allEmpresas = true;
    }
    else {
        targetEmpresaId = String(rawEmpresaId ?? caller.profileEmpresa ?? 'bacarsa').trim() || 'bacarsa';
        if (!caller.isSuper && caller.profileEmpresa && targetEmpresaId !== caller.profileEmpresa) {
            throw new functions.https.HttpsError('permission-denied', 'No podÃ©s crear usuarios para otra empresa.');
        }
    }
    try {
        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: `${firstName} ${lastName}`
        });
        await admin.auth().setCustomUserClaims(userRecord.uid, { role: roleNorm, type: 'SYSTEM' });
        await admin.firestore().collection("system_users").doc(userRecord.uid).set({
            uid: userRecord.uid,
            firstName,
            lastName,
            email,
            role: roleNorm,
            empresaId: targetEmpresaId,
            ...(allEmpresas ? { allEmpresas: true } : {}),
            status: 'ACTIVE',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { success: true };
    }
    catch (error) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});
exports.syncSystemUserClaims = functions.https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
        throw new functions.https.HttpsError('unauthenticated', 'AutenticaciÃ³n requerida');
    }
    const targetUid = String(data?.uid ?? context.auth.uid).trim();
    const db = admin.firestore();
    if (targetUid !== context.auth.uid) {
        const callerSnap = await db.collection('system_users').doc(context.auth.uid).get();
        const callerRole = (0, backup_auth_util_1.normalizeBackupRole)(callerSnap.data()?.role);
        const tokenRole = (0, backup_auth_util_1.normalizeBackupRole)(context.auth.token?.role);
        const callerSuper = (0, backup_auth_util_1.isSuperAdminBackupRole)(callerRole) || (0, backup_auth_util_1.isSuperAdminBackupRole)(tokenRole);
        if (!callerSuper) {
            throw new functions.https.HttpsError('permission-denied', 'Solo superadmin puede sincronizar otros usuarios.');
        }
    }
    const snap = await db.collection('system_users').doc(targetUid).get();
    if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'Usuario de sistema no encontrado.');
    }
    const role = (0, backup_auth_util_1.normalizeBackupRole)(snap.data()?.role);
    if (!role) {
        throw new functions.https.HttpsError('failed-precondition', 'El usuario no tiene rol asignado.');
    }
    await admin.auth().setCustomUserClaims(targetUid, { role, type: 'SYSTEM' });
    return { ok: true, uid: targetUid, role };
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
        throw new functions.https.HttpsError("invalid-argument", "Target invÃ¡lido");
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
    if (shiftData.isAbsent === true || shiftData.status === 'ABSENT') {
        throw new functions.https.HttpsError('failed-precondition', 'Tu turno fue registrado como ausencia. ContactÃ¡ al operador para gestionar tu ingreso.');
    }
    const nowTs = admin.firestore.Timestamp.now();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const nowMs = nowTs.toMillis();
    const scheduledStartTs = shiftData.startTime ?? null;
    const isEarlyStart = shiftData.isEarlyStart === true;
    const realStartTime = isEarlyStart
        ? (shiftData.adjustedStartTime || scheduledStartTs || now)
        : (scheduledStartTs || now);
    const scheduledStartMs = scheduledStartTs?.toMillis?.() ?? 0;
    const isLate = scheduledStartMs > 0 && nowMs > scheduledStartMs + 5 * 60 * 1000;
    await shiftRef.update({
        isPresent: true,
        status: 'PRESENT',
        checkInTime: now,
        realStartTime,
        checkInRequestedAt: now,
        checkInMethod: 'PORTAL_GPS',
        checkInCoords: coords || null,
        checkInRecordedAt: recordedAt || null,
        isLate,
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
    try {
        const objectiveId = shiftData.objectiveId || '';
        const positionName = (shiftData.positionName || '').trim().toLowerCase();
        const empresaId = shiftData.empresaId || null;
        const incomingName = shiftData.employeeName || 'Un guardia';
        const objectiveName = shiftData.objectiveName || '';
        if (objectiveId && positionName && empresaId) {
            const activeSnap = await db.collection('turnos')
                .where('empresaId', '==', empresaId)
                .where('objectiveId', '==', objectiveId)
                .where('isPresent', '==', true)
                .where('isCompleted', '==', false)
                .get();
            const nowMs = nowTs.toMillis();
            const incomingStartMs = shiftData.startTime?.toMillis?.() ?? nowMs;
            const RELEVO_TOLERANCE_MS = 90 * 60 * 1000;
            const FIFTEEN_MIN_MS = 15 * 60 * 1000;
            const toRelieve = activeSnap.docs
                .filter(d => {
                const dat = d.data();
                if ((dat.positionName || '').trim().toLowerCase() !== positionName)
                    return false;
                if (d.id === shiftId || dat.employeeId === empId)
                    return false;
                if (dat.isRetention === true)
                    return true;
                const outEndMs = dat.endTime?.toMillis?.() ?? 0;
                if (outEndMs > 0 && (outEndMs - nowMs) <= FIFTEEN_MIN_MS)
                    return true;
                return false;
            })
                .sort((a, b) => {
                const da = a.data(), db2 = b.data();
                if (da.isRetention && !db2.isRetention)
                    return -1;
                if (!da.isRetention && db2.isRetention)
                    return 1;
                const aStart = da.realStartTime?.toMillis?.() ?? da.checkInTime?.toMillis?.() ?? da.startTime?.toMillis?.() ?? 0;
                const bStart = db2.realStartTime?.toMillis?.() ?? db2.checkInTime?.toMillis?.() ?? db2.startTime?.toMillis?.() ?? 0;
                return aStart - bStart;
            });
            for (const outDoc of toRelieve) {
                const outData = outDoc.data();
                const outEmpId = outData.employeeId;
                const outName = outData.employeeName || 'Guardia';
                const outPosName = outData.positionName || '';
                const outScheduledEndMs = outData.endTime?.toMillis?.() ?? 0;
                const isEarlyRelevo = outScheduledEndMs > 0 && nowMs < outScheduledEndMs;
                const outgoingRealEnd = isEarlyRelevo
                    ? outData.endTime
                    : admin.firestore.FieldValue.serverTimestamp();
                await outDoc.ref.update({
                    isCompleted: true,
                    isPresent: false,
                    status: 'COMPLETED',
                    realEndTime: outgoingRealEnd,
                    relievedBy: empId,
                    relievedByName: incomingName,
                    relievedAt: admin.firestore.FieldValue.serverTimestamp(),
                    autoRelevo: true,
                    relievedEarly: isEarlyRelevo,
                });
                await db.collection('novedades').add({
                    type: 'RELEVO_AUTOMATICO',
                    status: 'ATENDIDA',
                    empresaId,
                    objectiveId,
                    objectiveName,
                    positionName: outPosName,
                    employeeId: empId,
                    employeeName: incomingName,
                    relievedEmployeeId: outEmpId,
                    relievedEmployeeName: outName,
                    description: `${incomingName} relevÃ³ a ${outName} en ${objectiveName}${outPosName ? ' â€” ' + outPosName : ''}`,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    autoProcessed: true,
                    source: 'AUTO_RELEVO',
                });
                const outEmpDoc = await db.collection('empleados').doc(outEmpId).get();
                const outEmpUid = outEmpDoc.exists ? outEmpDoc.data()?.uid : undefined;
                const [byEmpId, byUid] = await Promise.all([
                    db.collection('device_tokens').where('employeeId', '==', outEmpId).get(),
                    outEmpUid
                        ? db.collection('device_tokens').where('uid', '==', outEmpUid).get()
                        : Promise.resolve({ docs: [] }),
                ]);
                const tokenSet = new Set();
                [...byEmpId.docs, ...byUid.docs].forEach(d => {
                    const t = d.data()?.token;
                    if (typeof t === 'string' && t.length > 10)
                        tokenSet.add(t);
                });
                const tokens = Array.from(tokenSet);
                const notifTitle = 'âœ… Turno finalizado â€” relevado';
                const notifBody = `Fuiste relevado por ${incomingName} en ${objectiveName}. Tu turno ha finalizado.`;
                let notifDocId = null;
                try {
                    const notifRef = await db.collection('user_notifications').add({
                        uid: outEmpUid || null,
                        employeeId: outEmpId,
                        title: notifTitle,
                        body: notifBody,
                        type: 'RELEVO_AUTOMATICO',
                        turnoId: outDoc.id,
                        read: false,
                        readAt: null,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    notifDocId = notifRef.id;
                }
                catch (e) {
                    console.warn('[requestCheckIn] Error guardando notificaciÃ³n relevo:', e?.message);
                }
                if (tokens.length > 0) {
                    try {
                        const link = `/empleado/dashboard${notifDocId ? `?notif=${notifDocId}` : ''}`;
                        await admin.messaging().sendEachForMulticast({
                            data: {
                                type: 'RELEVO_AUTOMATICO',
                                title: notifTitle,
                                body: notifBody,
                                turnoId: outDoc.id,
                                employeeId: outEmpId,
                                notificationId: notifDocId || '',
                                link,
                            },
                            webpush: {
                                headers: { Urgency: 'high' },
                                fcmOptions: { link },
                            },
                            tokens,
                        });
                        console.log(`[requestCheckIn] Relevo push enviado a ${outName} (${tokens.length} token/s)`);
                    }
                    catch (e) {
                        console.warn('[requestCheckIn] Error enviando push relevo:', e?.message);
                    }
                }
                else {
                    console.warn(`[requestCheckIn] Sin tokens para ${outName} (${outEmpId})`);
                }
            }
        }
    }
    catch (e) {
        console.warn('[requestCheckIn] Error en auto-relevo:', e?.message);
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
function buildPortalEmailHtml(activationLink, empresaNombre) {
    const nombre = empresaNombre || 'Bacar sa. Seguridad Privada';
    const nombreUpper = nombre.toUpperCase();
    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1e3a5f;padding:32px 40px;text-align:center;">
            <p style="color:#fff;font-size:20px;font-weight:bold;margin:0;letter-spacing:1px;">${nombreUpper}</p>
            <p style="color:#93c5fd;font-size:12px;margin:6px 0 0;letter-spacing:2px;text-transform:uppercase;">Portal de Empleados Â· COSP</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="color:#1e293b;font-size:16px;line-height:1.7;margin:0 0 16px;">${nombre} te ha otorgado acceso al <strong>Portal de Empleados de COSP</strong>.</p>
            <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 28px;">AbrÃ­ este email <strong>desde tu celular</strong> y tocÃ¡ el botÃ³n para crear tu contraseÃ±a y vincular tu dispositivo en un solo paso:</p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
              <tr>
                <td style="background:#0f766e;border-radius:8px;">
                  <a href="${activationLink}" target="_blank" style="display:inline-block;padding:16px 40px;color:#fff;font-size:16px;font-weight:bold;text-decoration:none;letter-spacing:0.5px;">ACTIVAR MI CUENTA</a>
                </td>
              </tr>
            </table>
            <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 8px;">Con este paso podrÃ¡s ver tus turnos, marcar presencia y gestionar novedades.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0;">
            <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0;">Este enlace expira en 48 horas y es de un solo uso. Si no esperabas este email, podÃ©s ignorarlo.</p>
            <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:10px 0 0;">Si el botÃ³n no funciona, copiÃ¡ este enlace en tu navegador:<br>
              <a href="${activationLink}" style="color:#3b82f6;word-break:break-all;">${activationLink}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="color:#64748b;font-size:13px;margin:0;">Saludos,<br><strong>Equipo Operativo Â· ${nombre}</strong></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
function buildPortalEmailText(activationLink, empresaNombre) {
    const nombre = empresaNombre || 'Bacar sa. Seguridad Privada';
    return `${nombre} te ha otorgado acceso al Portal de Empleados de COSP.

AbrÃ­ este email desde tu celular y tocÃ¡ el siguiente enlace para crear tu contraseÃ±a y vincular tu dispositivo en un solo paso:

${activationLink}

Este enlace expira en 48 horas y es de un solo uso.

Saludos,
Equipo Operativo - ${nombre}`;
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
    const empresaNombreCache = {};
    for (const empId of employeeIds) {
        try {
            const empDoc = await db.collection('empleados').doc(empId).get();
            if (!empDoc.exists) {
                results.push({ empId, email: '', success: false, error: 'Empleado no encontrado', alreadyExisted: false });
                continue;
            }
            const emp = empDoc.data();
            const email = (emp.email || emp.correo || '').toString().trim().toLowerCase();
            const empresaId = (emp.empresaId || '').toString();
            let empresaNombre = 'Bacar sa. Seguridad Privada';
            if (empresaId) {
                if (empresaNombreCache[empresaId] !== undefined) {
                    empresaNombre = empresaNombreCache[empresaId];
                }
                else {
                    try {
                        const empDoc2 = await db.collection('empresas').doc(empresaId).get();
                        if (empDoc2.exists) {
                            empresaNombre = empDoc2.data().nombre || empDoc2.data().name || empresaNombre;
                        }
                    }
                    catch (_) { }
                    empresaNombreCache[empresaId] = empresaNombre;
                }
            }
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
            const crypto = await Promise.resolve().then(() => require('crypto'));
            const activationToken = crypto.randomUUID();
            const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
            await db.collection('device_activations').doc(activationToken).set({
                employeeId: empId,
                uid,
                email,
                expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
                used: false,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            const activationLink = `https://comtroldata.web.app/empleado/activar/?t=${activationToken}`;
            await transporter.sendMail({
                from: `"${empresaNombre}" <${gmailUser}>`,
                to: email,
                subject: `Acceso al Portal de Empleados - ${empresaNombre}`,
                html: buildPortalEmailHtml(activationLink, empresaNombre),
                text: buildPortalEmailText(activationLink, empresaNombre),
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
exports.activateDevice = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesiÃ³n primero.');
    }
    const { token, deviceInfo, deviceId } = data;
    if (!token) {
        throw new functions.https.HttpsError('invalid-argument', 'Token requerido.');
    }
    const db = admin.firestore();
    const tokenRef = db.collection('device_activations').doc(token);
    const tokenDoc = await tokenRef.get();
    if (!tokenDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Token de activaciÃ³n invÃ¡lido.');
    }
    const td = tokenDoc.data();
    if (td.used) {
        throw new functions.https.HttpsError('already-exists', 'Este enlace ya fue utilizado.');
    }
    if (td.expiresAt.toDate() < new Date()) {
        throw new functions.https.HttpsError('deadline-exceeded', 'El enlace de activaciÃ³n expirÃ³. PedÃ­ uno nuevo al administrador.');
    }
    if (td.uid !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'Este enlace no corresponde a tu cuenta.');
    }
    await tokenRef.update({ used: true, usedAt: admin.firestore.FieldValue.serverTimestamp() });
    const deviceRef = db.collection('device_tokens').doc(context.auth.uid);
    await deviceRef.set({
        uid: context.auth.uid,
        employeeId: td.employeeId,
        verified: true,
        source: 'email_link',
        activatedAt: admin.firestore.FieldValue.serverTimestamp(),
        deviceInfo: deviceInfo || {},
        deviceId: deviceId || null,
    });
    return { success: true, employeeId: td.employeeId };
});
exports.activateAndSetPassword = functions.https.onCall(async (data, _context) => {
    const { token, password, deviceId, deviceInfo } = data;
    if (!token)
        throw new functions.https.HttpsError('invalid-argument', 'Token requerido.');
    if (!password || password.length < 6) {
        throw new functions.https.HttpsError('invalid-argument', 'La contraseÃ±a debe tener al menos 6 caracteres.');
    }
    const db = admin.firestore();
    const tokenRef = db.collection('device_activations').doc(token);
    const tokenDoc = await tokenRef.get();
    if (!tokenDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Enlace invÃ¡lido o ya utilizado.');
    }
    const td = tokenDoc.data();
    if (td.used) {
        throw new functions.https.HttpsError('already-exists', 'Este enlace ya fue utilizado. Tu dispositivo puede estar activo.');
    }
    if (td.expiresAt.toDate() < new Date()) {
        throw new functions.https.HttpsError('deadline-exceeded', 'El enlace expirÃ³. Pedile al administrador que te reenvÃ­e el mail de acceso.');
    }
    const { uid, employeeId } = td;
    const userRecord = await admin.auth().getUser(uid);
    const email = userRecord.email;
    if (!email)
        throw new functions.https.HttpsError('internal', 'El usuario no tiene email configurado.');
    await admin.auth().updateUser(uid, { password });
    await tokenRef.update({ used: true, usedAt: admin.firestore.FieldValue.serverTimestamp() });
    await db.collection('device_tokens').doc(uid).set({
        uid,
        employeeId,
        verified: true,
        source: 'email_link',
        activatedAt: admin.firestore.FieldValue.serverTimestamp(),
        deviceInfo: deviceInfo || {},
        deviceId: deviceId || null,
    });
    return { email, employeeId };
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
            <p style="color:#93c5fd;font-size:12px;margin:6px 0 0;letter-spacing:2px;text-transform:uppercase;">Portal de Clientes Â· COSP</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <p style="color:#1e293b;font-size:16px;line-height:1.7;margin:0 0 16px;">Bacar sa. Seguridad Privada te ha otorgado acceso al <strong>Portal de Clientes de COSP</strong> para gestionar el personal autorizado de <strong>${clientName}</strong>.</p>
            <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 28px;">HacÃ© clic en el botÃ³n de abajo para crear tu contraseÃ±a y acceder al portal:</p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
              <tr>
                <td style="background:#4f46e5;border-radius:8px;">
                  <a href="${resetLink}" target="_blank" style="display:inline-block;padding:14px 36px;color:#fff;font-size:15px;font-weight:bold;text-decoration:none;letter-spacing:0.5px;">CREAR CONTRASEÃ‘A</a>
                </td>
              </tr>
            </table>
            <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 8px;">Una vez que crees tu contraseÃ±a, podrÃ¡s consultar los accesos del dÃ­a y gestionar el personal autorizado de tus objetivos.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0;">
            <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0;">Si no esperabas este email, podÃ©s ignorarlo. El enlace caduca en 24 horas.</p>
            <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:10px 0 0;">Si el botÃ³n no funciona, copiÃ¡ este enlace en tu navegador:<br>
              <a href="${resetLink}" style="color:#3b82f6;word-break:break-all;">${resetLink}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="color:#64748b;font-size:13px;margin:0;">Saludos,<br><strong>Equipo Operativo Â· Bacar sa. Seguridad Privada</strong></p>
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

HacÃ© clic en el siguiente enlace para crear tu contraseÃ±a y acceder al portal:

${resetLink}

Una vez que crees tu contraseÃ±a, podrÃ¡s consultar los accesos del dÃ­a y gestionar el personal autorizado de tus objetivos.

Si no esperabas este email, podÃ©s ignorarlo. El enlace caduca en 24 horas.

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
var onCronogramaPublished_1 = require("./notifications/onCronogramaPublished");
Object.defineProperty(exports, "onCronogramaPublished", { enumerable: true, get: function () { return onCronogramaPublished_1.onCronogramaPublished; } });
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
    const body = data?.body || 'NotificaciÃ³n de prueba';
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
        const relieveDocs = relieveSnap.docs.filter(d => d.id !== docSnap.id && sameTenantShift(shift, d.data()));
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
        const relieveAbsent = relieveDocs.find(d => {
            const data = d.data();
            return data.isAbsent === true || data.status === 'ABSENT';
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
                details: `Turno cerrado por relevo entrante ya presente: ${shift.employeeName || ''} â€” ${shift.objectiveName || ''}`,
                timestamp: now,
            });
            completed++;
        }
        else if (relievePending) {
            if (!shift.isRetention) {
                completeBatch.update(docSnap.ref, {
                    isRetention: true,
                    retentionReason: `RELEVO_NO_PRESENTADO: ${relievePending.data().employeeName || 'relevo'} no se presentÃ³`,
                    autoRetentionAt: now,
                });
            }
            const retTokensB = await getEmployeeTokens(db, shift.employeeId);
            if (retTokensB.length > 0) {
                await admin.messaging().sendEachForMulticast({
                    tokens: retTokensB,
                    notification: {
                        title: 'â° Quedaste en retenciÃ³n',
                        body: `Tu relevo (${relievePending.data().employeeName || 'el guardia'}) no se presentÃ³ en ${shift.objectiveName || 'el puesto'}. PermanecÃ© hasta aviso de Operaciones.`,
                    },
                    webpush: {
                        notification: { icon: '/icons/icon-192x192.png', requireInteraction: true },
                        fcmOptions: { link: '/empleado/dashboard' },
                    },
                }).catch(e => console.warn('[autoCompletarTurnos] Push retenciÃ³n B error:', e));
            }
            const existingB = await db.collection('novedades')
                .where('shiftId', '==', docSnap.id)
                .where('type', '==', 'RETENCION_SIN_RELEVO')
                .limit(1).get();
            if (existingB.empty) {
                const novRef = db.collection('novedades').doc();
                auditBatch.set(novRef, {
                    type: 'RETENCION_SIN_RELEVO',
                    status: 'PENDIENTE',
                    shiftId: docSnap.id,
                    reliefShiftId: relievePending.id,
                    objectiveId: shift.objectiveId,
                    objectiveName: shift.objectiveName || '',
                    clientId: shift.clientId || null,
                    empresaId: shiftEmpresaId(shift) || null,
                    employeeName: shift.employeeName || '',
                    reliefEmployeeName: relievePending.data().employeeName || '',
                    positionName: shift.positionName || '',
                    description: `â° RETENCIÃ“N: ${shift.employeeName || ''} en ${shift.objectiveName || ''} (${shift.positionName || ''}) â€” su relevo no se presentÃ³. Requiere cobertura urgente.`,
                    createdAt: now,
                    source: 'SYSTEM_SCHEDULER',
                });
                alertedNoRelief++;
            }
        }
        else if (relieveAbsent) {
            if (!shift.isRetention) {
                completeBatch.update(docSnap.ref, {
                    isRetention: true,
                    retentionReason: `RELEVO_AUSENTE: ${relieveAbsent.data().employeeName || 'relevo'} no se presentÃ³`,
                    autoRetentionAt: now,
                });
            }
            const retTokensB2 = await getEmployeeTokens(db, shift.employeeId);
            if (retTokensB2.length > 0) {
                await admin.messaging().sendEachForMulticast({
                    tokens: retTokensB2,
                    notification: {
                        title: 'â° Quedaste en retenciÃ³n',
                        body: `Tu relevo (${relieveAbsent.data().employeeName || 'el guardia'}) no se presentÃ³ en ${shift.objectiveName || 'el puesto'}. PermanecÃ© hasta aviso de Operaciones.`,
                    },
                    webpush: {
                        notification: { icon: '/icons/icon-192x192.png', requireInteraction: true },
                        fcmOptions: { link: '/empleado/dashboard' },
                    },
                }).catch(e => console.warn('[autoCompletarTurnos] Push retenciÃ³n B2 error:', e));
            }
            const existing = await db.collection('novedades')
                .where('shiftId', '==', docSnap.id)
                .where('type', '==', 'RETENCION_SIN_RELEVO')
                .limit(1).get();
            if (existing.empty) {
                const novRef = db.collection('novedades').doc();
                auditBatch.set(novRef, {
                    type: 'RETENCION_SIN_RELEVO',
                    status: 'PENDIENTE',
                    shiftId: docSnap.id,
                    objectiveId: shift.objectiveId,
                    objectiveName: shift.objectiveName || '',
                    clientId: shift.clientId || null,
                    empresaId: shiftEmpresaId(shift) || null,
                    employeeName: shift.employeeName || '',
                    positionName: shift.positionName || '',
                    description: `âš ï¸ RETENCIÃ“N FORZADA: ${shift.employeeName || ''} en ${shift.objectiveName || ''} (${shift.positionName || ''}) â€” su relevo no se presentÃ³. Requiere cobertura urgente.`,
                    createdAt: now,
                    source: 'SYSTEM_SCHEDULER',
                });
                alertedNoRelief++;
            }
        }
        else {
            const empId = shiftEmpresaId(shift);
            let requiresContinuousCoverage = false;
            try {
                const slaSnap = await db.collection('servicios_sla')
                    .where('objectiveId', '==', shift.objectiveId)
                    .where('status', '==', 'active')
                    .limit(1).get();
                if (!slaSnap.empty) {
                    const slaData = slaSnap.docs[0].data();
                    const positions = slaData.positions || [];
                    const posName = (shift.positionName || '').trim().toLowerCase();
                    const matchedPos = positions.find((p) => (p.name || '').trim().toLowerCase() === posName);
                    requiresContinuousCoverage = Array.isArray(matchedPos?.allowedShiftTypes) && matchedPos.allowedShiftTypes.length > 0;
                }
            }
            catch (e) {
                console.warn('[autoCompletarTurnos] Error checking SLA:', e);
            }
            if (requiresContinuousCoverage) {
                if (!shift.isRetention) {
                    completeBatch.update(docSnap.ref, {
                        isRetention: true,
                        retentionReason: 'SIN_RELEVO_24H: puesto con cobertura continua requerida',
                        autoRetentionAt: now,
                    });
                }
                const retTokensC = await getEmployeeTokens(db, shift.employeeId);
                if (retTokensC.length > 0) {
                    await admin.messaging().sendEachForMulticast({
                        tokens: retTokensC,
                        notification: {
                            title: '⏰ Quedaste retenido',
                            body: `Permanecé en ${shift.objectiveName || 'el puesto'} hasta nuevo aviso. No hay relevo registrado.`,
                        },
                        webpush: {
                            notification: { icon: '/icons/icon-192x192.png', requireInteraction: true },
                            fcmOptions: { link: '/empleado/dashboard' },
                        },
                    }).catch(e => console.warn('[autoCompletarTurnos] Push retención C2 error:', e));
                }
                const existingC = await db.collection('novedades')
                    .where('shiftId', '==', docSnap.id)
                    .where('type', '==', 'RETENCION_SIN_RELEVO')
                    .limit(1).get();
                if (existingC.empty) {
                    const novRef = db.collection('novedades').doc();
                    auditBatch.set(novRef, {
                        type: 'RETENCION_SIN_RELEVO',
                        status: 'PENDIENTE',
                        shiftId: docSnap.id,
                        objectiveId: shift.objectiveId,
                        objectiveName: shift.objectiveName || '',
                        clientId: shift.clientId || null,
                        empresaId: empId || null,
                        employeeName: shift.employeeName || '',
                        positionName: shift.positionName || '',
                        description: `⏰ RETENCIÓN: ${shift.employeeName || ''} en ${shift.objectiveName || ''} (${shift.positionName || ''}) — puesto 24HS sin relevo registrado.`,
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
                    autoCloseReason: 'SIN_RELEVO_CUSTOM',
                });
                const logRef = db.collection('audit_logs').doc();
                auditBatch.set(logRef, {
                    action: 'AUTO_COMPLETE_SHIFT',
                    actorName: 'Sistema (Scheduler)',
                    actorUid: 'SYSTEM',
                    module: 'OPERACIONES',
                    shiftId: docSnap.id,
                    details: `Turno finalizado (puesto CUSTOM sin relevo): ${shift.employeeName || ''} — ${shift.objectiveName || ''}`,
                    timestamp: now,
                });
                completed++;
            }
        }
    }
    await completeBatch.commit();
    await auditBatch.commit();
    console.log(`[autoCompletarTurnos] Completados: ${completed} | Alertas sin relevo: ${alertedNoRelief}`);
    return null;
});
const SKIP_STATUSES = new Set(['PRESENT', 'ABSENT', 'COMPLETED', 'INTERRUPTED', 'CANCELLED']);
const SKIP_CODES = new Set(['F', 'FF', 'V', 'L', 'A', 'E', 'AA', 'FP']);
function shiftEmpresaId(shift) {
    return String(shift.empresaId ?? '').trim();
}
function sameTenantShift(a, b) {
    const ae = shiftEmpresaId(a);
    const be = shiftEmpresaId(b);
    if (ae && be)
        return ae === be;
    if (ae && !be)
        return false;
    return true;
}
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
    const earlyFrom = admin.firestore.Timestamp.fromMillis(nowMs - 10 * 60 * 1000);
    const earlyTo = admin.firestore.Timestamp.fromMillis(nowMs);
    const earlySnap = await db.collection('turnos')
        .where('startTime', '>=', earlyFrom)
        .where('startTime', '<=', earlyTo)
        .get();
    for (const earlyDoc of earlySnap.docs) {
        const s = earlyDoc.data();
        if (s.draft === true || s.isPresent || s.isCompleted || s.isAbsent)
            continue;
        if (s.isUnassigned || !s.employeeId || s.employeeId === 'VACANTE')
            continue;
        if (SKIP_CODES.has((s.code || '').toUpperCase()))
            continue;
        if (SKIP_STATUSES.has(s.status || ''))
            continue;
        if (s.earlyRetentionAlertAt)
            continue;
        if (s.lateArrivalAt || s.notifiedAbsent)
            continue;
        const empId = shiftEmpresaId(s);
        const posName = (s.positionName || '').trim().toLowerCase();
        if (!s.objectiveId || !posName || !empId)
            continue;
        await earlyDoc.ref.update({ earlyRetentionAlertAt: now });
        try {
            const presentSnap = await db.collection('turnos')
                .where('empresaId', '==', empId)
                .where('objectiveId', '==', s.objectiveId)
                .where('isPresent', '==', true)
                .where('isCompleted', '==', false)
                .get();
            const toAlert = presentSnap.docs.filter(d => {
                const dat = d.data();
                return (dat.positionName || '').trim().toLowerCase() === posName
                    && dat.employeeId !== s.employeeId;
            });
            for (const retDoc of toAlert) {
                const retData = retDoc.data();
                const retTokens = await getEmployeeTokens(db, retData.employeeId);
                if (retTokens.length > 0) {
                    await admin.messaging().sendEachForMulticast({
                        tokens: retTokens,
                        notification: {
                            title: 'â³ El entrante aÃºn no llegÃ³',
                            body: `${s.employeeName || 'El guardia siguiente'} no marcÃ³ presencia en ${s.objectiveName || 'el puesto'}. Espera aviso de Operaciones antes de retirarte.`,
                        },
                        webpush: {
                            notification: { icon: '/icons/icon-192x192.png', requireInteraction: true },
                            fcmOptions: { link: '/empleado/dashboard' },
                        },
                    }).catch(e => console.warn('[detectarAusencias] Push alerta temprana error:', e));
                }
                console.log(`[detectarAusencias] Alerta temprana enviada a ${retData.employeeName} (saliente en ${s.objectiveName})`);
            }
        }
        catch (e) {
            console.warn('[detectarAusencias] Error en alerta temprana retenciÃ³n:', e);
        }
    }
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
        const planningOrigins = new Set(['', 'PLANIFICADOR', 'SLA_VIRTUAL', undefined]);
        if (planningOrigins.has(shift.origin) && shift.objectiveId) {
            const { year: chkYear, month: chkMonth } = (0, planificacionEstadoKeys_1.ymCordobaParts)(new Date(startMs));
            const empId = shiftEmpresaId(shift);
            const docIds = (0, planificacionEstadoKeys_1.planificacionEstadoLookupDocIds)(empId, shift.objectiveId, chkYear, chkMonth);
            const planDocs = await Promise.all(docIds.map(id => db.doc(`planificacion_estados/${id}`).get()));
            if (!planDocs.some(s => s.exists))
                continue;
        }
        const elapsedMin = (nowMs - startMs) / 60000;
        if (elapsedMin >= 60) {
            if (shift.absenceDetectedAt)
                continue;
            if (shift.lateArrivalAt)
                continue;
            if (shift.notifiedAbsent === true)
                continue;
            if (shift.isReten === true || shift.origin === 'RETEN')
                continue;
            const endMs = shift.endTime?.toMillis?.() ?? 0;
            if (endMs > 0 && endMs > nowMs + 6 * 60 * 60 * 1000)
                continue;
            await docSnap.ref.update({
                status: 'ABSENT',
                isAbsent: true,
                absenceType: 'AA',
                absenceDetectedAt: now,
                absenceDetectedBy: 'SYSTEM_SCHEDULER',
            });
            const objectiveId = shift.objectiveId || '';
            const positionName = (shift.positionName || '').trim().toLowerCase();
            const empId = shiftEmpresaId(shift);
            if (objectiveId && positionName && empId) {
                try {
                    const presentSnap = await db.collection('turnos')
                        .where('empresaId', '==', empId)
                        .where('objectiveId', '==', objectiveId)
                        .where('isPresent', '==', true)
                        .where('isCompleted', '==', false)
                        .get();
                    const toRetain = presentSnap.docs.filter(d => {
                        const dat = d.data();
                        return (dat.positionName || '').trim().toLowerCase() === positionName
                            && dat.employeeId !== shift.employeeId;
                    });
                    for (const retDoc of toRetain) {
                        const retData = retDoc.data();
                        if (!retData.isRetention) {
                            await retDoc.ref.update({
                                isRetention: true,
                                retentionReason: `AUSENCIA_AA: ${shift.employeeName || 'guardia'} no se presentÃ³`,
                                autoRetentionAt: now,
                            });
                            const retTokens = await getEmployeeTokens(db, retData.employeeId);
                            if (retTokens.length > 0) {
                                await admin.messaging().sendEachForMulticast({
                                    tokens: retTokens,
                                    notification: {
                                        title: 'â° Quedaste en retenciÃ³n',
                                        body: `${shift.employeeName || 'El guardia siguiente'} no se presentÃ³ en ${shift.objectiveName || 'el puesto'}. PermanecÃ© en el puesto hasta aviso de Operaciones.`,
                                    },
                                    webpush: {
                                        notification: { icon: '/icons/icon-192x192.png', requireInteraction: true },
                                        fcmOptions: { link: '/empleado/dashboard' },
                                    },
                                }).catch(e => console.warn('[detectarAusencias] Push retenciÃ³n error:', e));
                            }
                            await db.collection('novedades').add({
                                type: 'RETENCION_POR_AUSENCIA',
                                status: 'PENDIENTE',
                                empresaId: empId,
                                objectiveId,
                                objectiveName: shift.objectiveName || '',
                                positionName: shift.positionName || '',
                                employeeId: retData.employeeId,
                                employeeName: retData.employeeName || '',
                                absentEmployeeId: shift.employeeId,
                                absentEmployeeName: shift.employeeName || '',
                                description: `${retData.employeeName || 'Guardia'} retenido automÃ¡ticamente â€” ${shift.objectiveName} Â· ${shift.positionName} â€” por ausencia de ${shift.employeeName}`,
                                createdAt: now,
                                source: 'SYSTEM_SCHEDULER',
                            });
                        }
                    }
                }
                catch (e) {
                    console.warn('[detectarAusencias] Error en retenciÃ³n automÃ¡tica:', e);
                }
            }
            const tokens = await getEmployeeTokens(db, shift.employeeId);
            if (tokens.length > 0) {
                const startStr = shift.startTime?.toDate
                    ? shift.startTime.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' })
                    : '';
                try {
                    await admin.messaging().sendEachForMulticast({
                        tokens,
                        notification: {
                            title: 'âš ï¸ Ausencia registrada',
                            body: `No se registrÃ³ tu presencia en el turno de las ${startStr} en ${shift.objectiveName || ''}. Reportate a Operaciones.`,
                        },
                        webpush: {
                            notification: {
                                title: 'âš ï¸ Ausencia registrada',
                                body: `No registraste presencia en ${shift.objectiveName || ''} (${startStr}). IngresÃ¡ al portal si estÃ¡s presente.`,
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
            const arDate = new Date(startMs - 3 * 60 * 60 * 1000);
            const dateStr = `${arDate.getUTCFullYear()}-${String(arDate.getUTCMonth() + 1).padStart(2, '0')}-${String(arDate.getUTCDate()).padStart(2, '0')}`;
            const ausenciaExistsSnap = await db.collection('ausencias')
                .where('shiftId', '==', docSnap.id)
                .limit(1).get();
            const buildHorario = () => {
                const st = shift.startTime?.toDate ? shift.startTime.toDate() : new Date(startMs);
                const et = shift.endTime?.toMillis ? new Date(shift.endTime.toMillis()) : null;
                const fmtT = (d) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
                return et ? `${fmtT(st)} - ${fmtT(et)}` : fmtT(st);
            };
            if (!ausenciaExistsSnap.empty) {
                const existingAbs = ausenciaExistsSnap.docs[0];
                const existingData = existingAbs.data();
                if (existingData.startDate !== dateStr || existingData.endDate !== dateStr) {
                    const horario = buildHorario();
                    await existingAbs.ref.update({
                        startDate: dateStr,
                        endDate: dateStr,
                        reason: `No presentacion al turno ${horario} - ${shift.objectiveName || ''} (${shift.positionName || ''})`,
                    });
                    console.log(`[detectarAusencias] Fecha corregida: ${existingData.startDate} → ${dateStr} para turno ${docSnap.id}`);
                }
            }
            else {
                await db.collection('ausencias').add({
                    employeeId: shift.employeeId,
                    employeeName: shift.employeeName || '',
                    startDate: dateStr,
                    endDate: dateStr,
                    type: 'No Presentacion',
                    absenceType: 'AA',
                    origin: 'AUTO_T30',
                    shiftId: docSnap.id,
                    objectiveId: shift.objectiveId || null,
                    objectiveName: shift.objectiveName || '',
                    clientId: shift.clientId || null,
                    empresaId: shiftEmpresaId(shift) || null,
                    positionName: shift.positionName || '',
                    shiftCode: (shift.code || '').toUpperCase() || null,
                    reason: `No presentacion al turno ${buildHorario()} - ${shift.objectiveName || ''} (${shift.positionName || ''})`,
                    status: 'Confirmada',
                    hasCertificate: false,
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
                    empresaId: shiftEmpresaId(shift) || null,
                    positionName: shift.positionName || '',
                    description: `${shift.employeeName || 'Empleado'} no se presentÃ³ al turno en ${shift.objectiveName || ''} (detectado a los ${Math.round(elapsedMin)} min).`,
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
                details: `Ausencia automÃ¡tica: ${shift.employeeName || ''} â€” ${shift.objectiveName || ''} (${Math.round(elapsedMin)} min)`,
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
                    empresaId: shiftEmpresaId(shift) || null,
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
                    empresaId: shiftEmpresaId(shift) || null,
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
                    empresaId: shiftEmpresaId(shift) || null,
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
    const GRACE_MINUTES = 60;
    const graceCutoff = admin.firestore.Timestamp.fromMillis(nowMs - GRACE_MINUTES * 60 * 1000);
    const staleProtos = await db.collection('novedades')
        .where('type', '==', 'VACANTE_PROTOCOLO_COBERTURA')
        .where('status', '==', 'PENDIENTE')
        .where('createdAt', '<=', graceCutoff)
        .limit(50)
        .get();
    let autoClosed = 0;
    for (const nDoc of staleProtos.docs) {
        const n = nDoc.data();
        if (n.shiftId) {
            const turnoSnap = await db.collection('turnos').doc(n.shiftId).get();
            if (turnoSnap.exists) {
                const t = turnoSnap.data();
                const directlyCovered = t.isPresent || t.status === 'PRESENT' || t.status === 'COMPLETED'
                    || t.isResolvedByOps || t.resolvedBy === 'OPERACIONES' || t.status === 'COVERED';
                let coveredByNewShift = false;
                if (!directlyCovered && t.objectiveId && t.positionName) {
                    const slotStartMs = t.startTime?.toMillis?.() ?? 0;
                    const slotEndMs = t.endTime?.toMillis?.() ?? 0;
                    if (slotStartMs > 0) {
                        const coverSnap = await db.collection('turnos')
                            .where('objectiveId', '==', t.objectiveId)
                            .where('isPresent', '==', true)
                            .limit(10).get();
                        coveredByNewShift = coverSnap.docs.some(d => {
                            const r = d.data();
                            const rStart = r.startTime?.toMillis?.() ?? 0;
                            const rEnd = r.endTime?.toMillis?.() ?? slotEndMs;
                            const samePos = (r.positionName || '').toLowerCase() === (t.positionName || '').toLowerCase();
                            const overlaps = rStart <= slotEndMs && rEnd >= slotStartMs;
                            const isOps = ['RETEN', 'OPERATIONS_COVERAGE', 'EARLY_START'].includes(r.origin || '');
                            return samePos && overlaps && (isOps || r.absenceShiftId === n.shiftId);
                        });
                    }
                }
                if (directlyCovered || coveredByNewShift) {
                    await nDoc.ref.update({ status: 'ATENDIDA', atendidaAt: now, atendidaPor: 'SISTEMA_AUTO', autoResolved: true });
                    autoClosed++;
                    continue;
                }
            }
        }
        await nDoc.ref.update({
            status: 'ATENDIDA',
            atendidaAt: now,
            atendidaPor: 'SISTEMA_AUTO',
            autoResolved: true,
            sinCobertura: true,
        });
        await db.collection('audit_logs').add({
            action: 'COBERTURA_VENCIDA_AUTO',
            actorName: 'Sistema (Auto)',
            actorUid: 'SYSTEM',
            module: 'OPERACIONES',
            shiftId: n.shiftId || null,
            details: `Protocolo de cobertura cerrado automáticamente (${GRACE_MINUTES} min sin gestión): ${n.objectiveName || ''} — ${n.positionName || ''}`,
            objectiveId: n.objectiveId || null,
            timestamp: now,
        });
        autoClosed++;
    }
    if (autoClosed > 0) {
        console.log(`[gestionarVacantes] Protocolos auto-cerrados: ${autoClosed}`);
    }
    return null;
});
exports.triggerBackup = functions
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .https.onCall(async (data, context) => {
    await (0, backup_auth_util_1.assertBackupCallableAllowed)(context);
    const folderId = await (0, backup_service_1.resolveDriveBackupFolderId)();
    if (!folderId)
        throw new functions.https.HttpsError('failed-precondition', 'Variable DRIVE_BACKUP_FOLDER_ID no configurada.');
    const db = admin.firestore();
    const claimedEmpresa = String(data?.empresaId ?? '').trim();
    let empresaId = claimedEmpresa;
    const caller = await (0, backup_auth_util_1.resolveBackupCaller)(context.auth.uid, context.auth.token?.role);
    if (!caller.isSuper) {
        empresaId = caller.profileEmpresa || 'bacarsa';
    }
    else if (!empresaId) {
        empresaId = caller.profileEmpresa;
    }
    const scopeEmpresa = !!empresaId;
    try {
        const result = await (0, backup_service_1.runBackup)(folderId, { empresaId, scopeEmpresa, source: 'triggerBackup' });
        return result;
    }
    catch (e) {
        const errDoc = {
            status: 'error',
            error: e?.message || 'Error desconocido',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            ...(empresaId ? { empresaId } : {}),
            ...(scopeEmpresa ? { scopeEmpresa: true } : {}),
        };
        if (scopeEmpresa && empresaId) {
            await db.collection('system_backups').doc(`${empresaId}_latest`).set(errDoc);
        }
        else {
            await db.collection('system_backups').add(errDoc);
        }
        throw new functions.https.HttpsError('internal', e?.message || 'Error al ejecutar backup');
    }
});
exports.restoreBackup = functions
    .region('us-central1')
    .runWith({ timeoutSeconds: 120, memory: '512MB' })
    .https.onCall(async (data, context) => {
    await (0, backup_auth_util_1.assertBackupCallableAllowed)(context);
    const payload = (data ?? {});
    try {
        const { jobId, restoreOpts, fileName } = await (0, restore_job_runner_1.assertRestoreRequestAllowed)(context.auth.uid, context.auth.token?.role, payload);
        const db = admin.firestore();
        const storagePath = String(payload.storagePath ?? '').trim();
        const driveFileId = String(payload.driveFileId ?? '').trim();
        await db.collection('restore_jobs').doc(jobId).set({
            status: 'queued',
            phase: 'En cola…',
            mode: payload.mode,
            fileName,
            empresaId: restoreOpts.empresaId ?? '',
            scopeEmpresa: restoreOpts.scopeEmpresa === true,
            migracionCompleta: restoreOpts.migracionCompleta === true,
            tenantImport: restoreOpts.tenantImport === true,
            sourceEmpresaId: restoreOpts.sourceEmpresaId ?? '',
            storagePath: storagePath || null,
            driveFileId: driveFileId || null,
            requestedBy: context.auth.uid,
            docsRestored: 0,
            docsDeleted: 0,
            total: 0,
            resumeColIndex: 0,
            idMaps: null,
            error: null,
            queuedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { jobId, queued: true };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : 'Error al encolar restauración';
        if (/pertenece a otra empresa|plataforma completa|Solo superadmin|panel de administración/i.test(msg)) {
            throw new functions.https.HttpsError('permission-denied', msg);
        }
        if (/storagePath inválido|merge o full|storagePath requerido|driveFileId/i.test(msg)) {
            throw new functions.https.HttpsError('invalid-argument', msg);
        }
        throw new functions.https.HttpsError('internal', msg);
    }
});
exports.processRestoreJob = functions
    .region('us-central1')
    .runWith({ timeoutSeconds: 540, memory: '4GB' })
    .firestore.document('restore_jobs/{jobId}')
    .onWrite(async (change) => {
    const after = change.after;
    if (!after.exists)
        return;
    const data = after.data() ?? {};
    const status = String(data.status ?? '');
    const beforeStatus = change.before.exists
        ? String(change.before.data()?.status ?? '')
        : '';
    const jobId = after.id;
    const shouldRunQueued = status === 'queued' && beforeStatus !== 'queued';
    const STUCK_RUNNING_MS = 3 * 60 * 1000;
    let shouldRecoverStuck = false;
    if (status === 'running' && beforeStatus === 'running') {
        const startedAt = data.startedAt?.toDate?.();
        if (startedAt && Date.now() - startedAt.getTime() > STUCK_RUNNING_MS) {
            shouldRecoverStuck = true;
        }
    }
    if (!shouldRunQueued && !shouldRecoverStuck)
        return;
    if (shouldRecoverStuck) {
        const db = admin.firestore();
        const reclaimed = await db.runTransaction(async (tx) => {
            const snap = await tx.get(after.ref);
            const cur = String(snap.data()?.status ?? '');
            if (cur !== 'running')
                return false;
            const started = snap.data()?.startedAt?.toDate?.();
            if (!started || Date.now() - started.getTime() <= STUCK_RUNNING_MS)
                return false;
            tx.update(after.ref, {
                status: 'queued',
                phase: 'Reintentando tras timeout del worker anterior…',
                error: null,
            });
            return true;
        });
        if (!reclaimed)
            return;
    }
    try {
        await (0, restore_job_runner_1.executeRestoreJob)(jobId);
    }
    catch (e) {
        console.error('[processRestoreJob] failed', jobId, e);
    }
});
exports.migrateEmpresaData = functions
    .region('us-central1')
    .runWith({ timeoutSeconds: 120, memory: '1GB' })
    .https.onCall(async (data, context) => {
    await (0, backup_auth_util_1.assertBackupCallableAllowed)(context);
    const payload = (data ?? {});
    try {
        const { jobId, sourceEmpresaId, targetEmpresaId } = await (0, migrate_job_runner_1.assertMigrateEmpresaRequestAllowed)(context.auth.uid, context.auth.token?.role, payload);
        const db = admin.firestore();
        const startColIndex = Number(payload.startColIndex ?? 0);
        const idMaps = (0, empresa_migrate_service_1.deserializeIdMaps)(payload.idMaps ?? null);
        const docsCopied = Number(payload.docsCopied ?? 0);
        const docsDeleted = Number(payload.docsDeleted ?? 0);
        if (startColIndex === 0) {
            await db.collection('empresa_migrate_jobs').doc(jobId).set({
                status: 'running',
                phase: 'Iniciando migración…',
                sourceEmpresaId,
                targetEmpresaId,
                requestedBy: context.auth.uid,
                docsCopied: 0,
                docsDeleted: 0,
                startedAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        const result = await (0, empresa_migrate_service_1.runEmpresaMigrate)(sourceEmpresaId, targetEmpresaId, jobId, {
            startColIndex,
            collectionsPerRun: 1,
            idMaps,
            docsCopied,
            docsDeleted,
        });
        const idMapsSerialized = (0, empresa_migrate_service_1.serializeIdMaps)(result.idMaps ?? {});
        if (result.isComplete) {
            await db.collection('empresa_migrate_jobs').doc(jobId).set({
                status: 'done',
                phase: 'Completado',
                docsCopied: result.docsCopied,
                docsDeleted: result.docsDeleted,
                completedAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        return {
            jobId,
            isComplete: result.isComplete,
            nextColIndex: result.nextColIndex ?? 0,
            idMaps: idMapsSerialized,
            docsCopied: result.docsCopied,
            docsDeleted: result.docsDeleted,
            totalCollections: result.totalCollections ?? 0,
        };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : 'Error en migración';
        if (/Solo superadmin|Solo usuarios del panel|no existe|obligatorias|misma empresa/i.test(msg)) {
            throw new functions.https.HttpsError('permission-denied', msg);
        }
        throw new functions.https.HttpsError('internal', msg);
    }
});
exports.processEmpresaMigrateJob = functions
    .region('us-central1')
    .runWith({ timeoutSeconds: 540, memory: '4GB' })
    .firestore.document('empresa_migrate_jobs/{jobId}')
    .onWrite(async (change) => {
    const after = change.after;
    if (!after.exists)
        return;
    const status = String(after.data()?.status ?? '');
    if (status !== 'queued')
        return;
    const beforeStatus = change.before.exists
        ? String(change.before.data()?.status ?? '')
        : '';
    if (beforeStatus === 'queued')
        return;
    const jobId = after.id;
    try {
        await (0, migrate_job_runner_1.executeEmpresaMigrateJob)(jobId);
    }
    catch (e) {
        console.error('[processEmpresaMigrateJob] failed', jobId, e);
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
    .region('us-central1')
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .pubsub.schedule('0 3 * * *')
    .timeZone('America/Argentina/Buenos_Aires')
    .onRun(async () => {
    const db = admin.firestore();
    const folderId = await (0, backup_service_1.resolveDriveBackupFolderId)();
    if (!folderId) {
        const msg = 'DRIVE_BACKUP_FOLDER_ID no configurado (ni fallback en system_backups)';
        console.error('[scheduledBackup]', msg);
        await db.collection('system_backups').add({
            status: 'error',
            error: msg,
            source: 'scheduledBackup',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return null;
    }
    const jobLogRef = db.collection('scheduled_job_logs').doc('scheduledBackup');
    try {
        const result = await (0, backup_service_1.runBackup)(folderId, { source: 'scheduledBackup' });
        console.log(`[scheduledBackup] OK: ${result.fileName} — ${result.totalDocs} docs`);
        await jobLogRef.set({
            lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
            lastStatus: 'ok',
            lastFileName: result.fileName,
            totalDocs: result.totalDocs,
            error: null,
        }, { merge: true });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[scheduledBackup] Error:', e);
        await db.collection('system_backups').add({
            status: 'error',
            error: msg.slice(0, 500),
            source: 'scheduledBackup',
            backupScope: 'platform',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await jobLogRef.set({
            lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
            lastStatus: 'error',
            error: msg.slice(0, 500),
        }, { merge: true });
    }
    return null;
});
const afipLookupSecrets = ['AFIP_CUIT', 'AFIP_CERT', 'AFIP_PRIVATE_KEY', 'AFIP_PRODUCTION'];
const functionsEmulator = process.env.FUNCTIONS_EMULATOR === 'true' ||
    Boolean(process.env.FIREBASE_EMULATOR_HUB) ||
    Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const lookupClientByCuitRuntime = {
    timeoutSeconds: 60,
    memory: '256MB',
};
if (!functionsEmulator)
    lookupClientByCuitRuntime.secrets = [...afipLookupSecrets];
exports.lookupClientByCuit = functionsEmulator
    ? functions.https.onCall(lookupClientByCuitHandler_1.lookupClientByCuitHandler)
    : functions.runWith(lookupClientByCuitRuntime).https.onCall(lookupClientByCuitHandler_1.lookupClientByCuitHandler);
exports.saveEmpresaAfipCredentials = functions.https.onCall(empresaAfipCredentialsHandler_1.saveEmpresaAfipCredentialsHandler);
exports.getEmpresaAfipConfig = functions.https.onCall(empresaAfipCredentialsHandler_1.getEmpresaAfipConfigHandler);
//# sourceMappingURL=index.js.map