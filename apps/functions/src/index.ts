import './bootstrap-env';
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { runBackup, resolveDriveBackupFolderId } from './backup/backup.service';
import { shouldScopeQueriesToEmpresa } from './assistant/assistantEmpresaScope';
import { runRestore, runRestoreFromStorage, RestoreMode } from './backup/restore.service';
import { assertRestoreRequestAllowed, executeRestoreJob, RestoreRequestPayload } from './backup/restore-job.runner';
import {
  assertMigrateEmpresaRequestAllowed,
  executeEmpresaMigrateJob,
  MigrateEmpresaRequestPayload,
} from './backup/migrate-job.runner';
import { runEmpresaMigrate, serializeIdMaps, deserializeIdMaps } from './backup/empresa-migrate.service';
import {
  assertBackupCallableAllowed,
  normalizeBackupRole,
  resolveBackupCaller,
  isSuperAdminBackupRole,
  isAdminBackupRole,
} from './backup/backup-auth.util';
import { createNestApp } from './main';
import { INestApplicationContext } from '@nestjs/common';

// Servicios expuestos por NestJS
import { SchedulingService } from './scheduling/scheduling.service';
import { AuthService } from './auth/auth.service';
import { DataManagementService } from './data-management/data-management.service';
import { AuditService } from './scheduling/audit.service';
import { ClientService } from './data-management/client.service';
import { EmployeeService } from './data-management/employee.service';
import { SystemUserService } from './data-management/system-user.service';
import { AbsenceService } from './data-management/absence.service';
import { PatternService } from './scheduling/pattern.service';
import { LaborAgreementService } from './data-management/labor-agreement.service';

// Interfaces
import { EmployeeRole } from './common/interfaces/employee.interface';
import { runPlatformAssistant, type AssistantChatPayload } from './assistant/runPlatformAssistant';
import {
  classifyAssistantOutcome,
  extractLastUserQuestion,
  writeAssistantInteractionLog,
} from './assistant/assistantInteractionLog';
import { runPlanningGeminiOptimize, type GeminiRespuesta } from './assistant/planningGeminiServer';
import { ymCordobaParts, planificacionEstadoLookupDocIds } from './assistant/planificacionEstadoKeys';
import { lookupClientByCuitHandler } from './afip/lookupClientByCuitHandler';
import {
  getEmpresaAfipConfigHandler,
  saveEmpresaAfipCredentialsHandler,
} from './afip/empresaAfipCredentialsHandler';

// InicializaciÃ³n de Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}
admin.firestore().settings({ ignoreUndefinedProperties: true });

let nestApp: INestApplicationContext;

async function getService<T>(service: new (...args: any[]) => T): Promise<T> {
  if (!nestApp) {
    nestApp = await createNestApp();
  }
  return nestApp.get<T>(service); 
}

// Roles Administrativos
const ADMIN_ROLES = ['admin', 'superadmin', 'SuperAdmin', 'Scheduler', 'HR_Manager', 'Manager', 'Operator', 'Supervisor'];

/** Alineado con web2 `ALL_EMPRESAS_VALUE` en systemUser.ts */
const ALL_EMPRESAS_SENTINEL = '__ALL__';
const ALLOWED_ROLES: EmployeeRole[] = ['admin', 'employee'];


// =========================================================
// 1. GESTIÓN DE USUARIOS (AUTH)
// =========================================================
export const createUser = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'AutenticaciÃ³n requerida.');
  }
  const caller = await resolveBackupCaller(context.auth.uid, context.auth.token?.role);
  if (!caller.isPanelUser || !isAdminBackupRole(caller.sysRole || context.auth.token?.role)) {
    throw new functions.https.HttpsError('permission-denied', 'Acceso denegado. Solo administradores pueden crear usuarios.');
  }

  try {
    const authService = await getService(AuthService);
    const { email, password, name, role: receivedRole, clientId, dni, fileNumber, address, empresaId: rawEmpresaId } = data;
    const targetEmpresaId = String(rawEmpresaId ?? caller.profileEmpresa ?? 'bacarsa').trim();
    if (!caller.isSuper && caller.profileEmpresa && targetEmpresaId !== caller.profileEmpresa) {
      throw new functions.https.HttpsError('permission-denied', 'No podÃ©s crear usuarios para otra empresa.');
    }
    
    if (!ALLOWED_ROLES.includes(receivedRole as EmployeeRole)) {
       throw new functions.https.HttpsError('invalid-argument', 'Rol invÃ¡lido.');
    }

    const validRole = receivedRole as EmployeeRole;

    const newEmployee = await authService.createEmployeeProfile(
        email, 
        password, 
        validRole, 
        name,
        { clientId: clientId || '', dni, fileNumber, address, empresaId: targetEmpresaId }
    );
    return { success: true, uid: newEmployee.uid };
  } catch (error: any) {
    const err = error as Error;
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('[CREATE_USER_FATAL]', err.message);
    throw new functions.https.HttpsError('internal', 'Error al crear usuario.');
  }
});

// =========================================================
// 2. MOTOR DE AGENDAMIENTO (CREAR TURNOS INDIVIDUALES)
// =========================================================
export const scheduleShift = functions.https.onCall(async (data, context) => {
  const callerAuth = context.auth;
  if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role as string)) {
    throw new functions.https.HttpsError('permission-denied', 'Acceso denegado. Rol insuficiente.');
  }

  try {
    const schedulingService = await getService(SchedulingService);
    const result = await schedulingService.assignShift(data, callerAuth.token);
    return { success: true, shiftId: result.id };
  } catch (error: any) {
    const err = error as Error;
    if (error instanceof functions.https.HttpsError) throw error;
    
    console.error('[SCHEDULE_SHIFT_FATAL]', err.message);
    throw new functions.https.HttpsError('internal', `Error: ${err.message}`);
  }
});

// =========================================================
// 3. GESTIÓN DE TURNOS (EDITAR / ELIMINAR / REPLICAR)
// =========================================================
export const manageShifts = functions.https.onCall(async (data, context) => {
  const callerAuth = context.auth;
  const ALLOWED_PLANNING_ROLES = ['admin', 'SuperAdmin', 'Manager', 'Scheduler'];

  if (!callerAuth || !ALLOWED_PLANNING_ROLES.includes(callerAuth.token.role as string)) {
    throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
  }

  const { action, payload } = data as { action: string, payload: any };

  try {
    const schedulingService = await getService(SchedulingService);

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
        const result = await schedulingService.replicateDailyStructure(
            payload.objectiveId,
            payload.sourceDate,
            payload.targetStartDate,
            payload.targetEndDate,
            callerAuth.uid
        );
        return { 
            success: true, 
            data: result, 
            message: `Replicado: ${result.created} turnos. (Omitidos: ${result.skipped} dÃ­as)` 
        };
      default:
        throw new functions.https.HttpsError('invalid-argument', `AcciÃ³n desconocida: ${action}`);
    }
  } catch (error: any) {
    const err = error as Error;
    console.error(`[SHIFT_ERROR] Action ${action} failed:`, err.message);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', err.message);
  }
});

// =========================================================
// 4. AUDITORÃA (GEOFENCING & MANUAL OVERRIDE)
// =========================================================
export const auditShift = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Requiere autenticaciÃ³n.');

  const { shiftId, action, coords, isManualOverride } = data;

  try {
    const auditService = await getService(AuditService);
    
    const result = await auditService.auditShiftAction(
        shiftId, 
        action, 
        coords || null, 
        context.auth.uid,
        context.auth.token.role as string, 
        isManualOverride || false          
    );
    
    return { success: true, newStatus: result.status };
  } catch (error: any) {
    const err = error as Error;
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('[AUDIT_SHIFT_FATAL]', err.message);
    throw new functions.https.HttpsError('internal', err.message);
  }
});

// =========================================================
// 5. GESTIÓN DE DATOS BÃSICOS
// =========================================================
export const manageData = functions.https.onCall(async (data, context) => {
  const callerAuth = context.auth;
  if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role as string)) {
    throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
  }

  const { action, payload } = data;
  try {
    const dmService = await getService(DataManagementService);
    switch (action) {
      case 'CREATE_OBJECTIVE': return { success: true, data: await dmService.createObjective(payload) };
      case 'GET_ALL_OBJECTIVES': return { success: true, data: await dmService.findAllObjectives(payload?.clientId) };
      case 'GET_CLIENT_BY_ID': return { success: true, data: await dmService.getClientById(payload.clientId) };
      default: throw new functions.https.HttpsError('invalid-argument', `AcciÃ³n desconocida: ${action}`);
    }
  } catch (error: any) {
    const err = error as Error;
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('[DATA_MANAGEMENT_FATAL]', err.message);
    throw new functions.https.HttpsError('internal', err.message);
  }
});

// =========================================================
// 6. GESTIÓN DE JERARQUÃA COMERCIAL
// =========================================================
export const manageHierarchy = functions.https.onCall(async (data, context) => {
  const callerAuth = context.auth;
  if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role as string)) {
    throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
  }
  
  const { action, payload } = data as { action: string, payload: any };

  try {
    const clientService = await getService(ClientService);

    switch (action) {
      case 'CREATE_CLIENT': return { success: true, data: await clientService.createClient(payload) };
      case 'GET_CLIENT': return { success: true, data: await clientService.getClient(payload.id) };
      case 'GET_ALL_CLIENTS': return { success: true, data: await clientService.findAllClients() };
      case 'UPDATE_CLIENT': await clientService.updateClient(payload.id, payload.data); return { success: true, message: 'Cliente actualizado' };
      case 'DELETE_CLIENT': await clientService.deleteClient(payload.id); return { success: true, message: 'Cliente eliminado' };

      case 'CREATE_OBJECTIVE': return { success: true, data: await clientService.createObjective(payload) };
      case 'UPDATE_OBJECTIVE': await clientService.updateObjective(payload.id, payload.data); return { success: true, message: 'Objetivo actualizado correctamente' };
      
      case 'CREATE_CONTRACT': return { success: true, data: await clientService.createServiceContract(payload) };
      case 'UPDATE_CONTRACT': await clientService.updateServiceContract(payload.id, payload.data); return { success: true, message: 'Servicio actualizado' };
      case 'DELETE_CONTRACT': await clientService.deleteServiceContract(payload.id); return { success: true, message: 'Servicio eliminado' };

      case 'CREATE_SHIFT_TYPE': return { success: true, data: await clientService.createShiftType(payload) };
      case 'GET_SHIFT_TYPES': return { success: true, data: await clientService.getShiftTypesByContract(payload.contractId) };
      case 'UPDATE_SHIFT_TYPE': await clientService.updateShiftType(payload.id, payload.data); return { success: true, message: 'Modalidad actualizada' };
      case 'DELETE_SHIFT_TYPE': await clientService.deleteShiftType(payload.id); return { success: true, message: 'Modalidad eliminada' };
      
      default: throw new functions.https.HttpsError('invalid-argument', `AcciÃ³n desconocida: ${action}`);
    }
  } catch (error: any) {
    const err = error as Error;
    console.error(`[HIERARCHY_ERROR] Action ${action} failed:`, err.message);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', `Error: ${err.message}`);
  }
});

// =========================================================
// 7. GESTIÓN DE EMPLEADOS (RRHH) - (INCLUYE REPORTE DE CARGA Y IMPORTACIÓN)
// =========================================================
export const manageEmployees = functions.https.onCall(async (data, context) => {
  const callerAuth = context.auth;
  if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role as string)) {
    throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
  }
  
  const { action, payload } = data as { action: string, payload: any };
  try {
    const employeeService = await getService(EmployeeService);
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

      // ðŸ›' NUEVO: IMPORTACIÓN MASIVA
      case 'IMPORT_EMPLOYEES':
        if (!payload.rows || !Array.isArray(payload.rows)) {
             throw new functions.https.HttpsError('invalid-argument', 'Formato de archivo invÃ¡lido. Se espera un array "rows".');
        }
        const importResult = await employeeService.importEmployees(payload.rows, callerAuth.uid);
        return { success: true, data: importResult };
        
      default: throw new functions.https.HttpsError('invalid-argument', `AcciÃ³n desconocida: ${action}`);
    }
  } catch (error: any) {
    const err = error as Error;
    console.error(`[EMPLOYEE_ERROR] Action ${action} failed:`, err.message);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', err.message);
  }
});

// =========================================================
// 8. GESTIÓN DE USUARIOS DEL SISTEMA (ADMINS)
// =========================================================
export const manageSystemUsers = functions.https.onCall(async (data, context) => {
  const callerAuth = context.auth;
  if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role as string)) {
    throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
  }
  
  const { action, payload } = data as { action: string, payload: any };

  try {
    const sysUserService = await getService(SystemUserService);

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
  } catch (error: any) {
    const err = error as Error;
    console.error(`[SYS_USER_ERROR] ${action} failed:`, err.message);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', err.message);
  }
});

// =========================================================
// 9. GESTIÓN DE NOVEDADES (AUSENCIAS)
// =========================================================
export const manageAbsences = functions.https.onCall(async (data, context) => {
  const callerAuth = context.auth;
  if (!callerAuth) {
    throw new functions.https.HttpsError('unauthenticated', 'Requiere autenticaciÃ³n.');
  }

  const { action, payload } = data as { action: string, payload: any };

  const isAdmin = ADMIN_ROLES.includes(callerAuth.token.role as string);
  const isSelf = payload.employeeId === callerAuth.uid;

  if (!isAdmin && !(isSelf && action === 'CREATE_ABSENCE')) {
      throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
  }

  try {
    const absenceService = await getService(AbsenceService);

    switch (action) {
      case 'CREATE_ABSENCE':
        return { success: true, data: await absenceService.createAbsence(payload) };
      default:
        throw new functions.https.HttpsError('invalid-argument', `AcciÃ³n desconocida: ${action}`);
    }
  } catch (error: any) {
    const err = error as Error;
    console.error(`[ABSENCE_ERROR] Action ${action} failed:`, err.message);
    if (error instanceof functions.https.HttpsError) throw error;
    if (err.message.includes('Conflict')) {
        throw new functions.https.HttpsError('failed-precondition', err.message);
    }
    throw new functions.https.HttpsError('internal', err.message);
  }
});

// =========================================================
// 10. GESTIÓN DE PATRONES DE SERVICIO (AUTOMATIZACIÓN)
// =========================================================
export const managePatterns = functions.https.onCall(async (data, context) => {
  const callerAuth = context.auth;
  if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role as string)) {
      throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
  }

  const { action, payload } = data as { action: string, payload: any };

  try {
    const patternService = await getService(PatternService);

    switch(action) {
        case 'CREATE_PATTERN': 
            return patternService.createPattern(payload, callerAuth.uid);
        
        case 'GET_PATTERNS': 
            return patternService.getPatternsByContract(payload.contractId);
        
        case 'DELETE_PATTERN': 
            await patternService.deletePattern(payload.id); 
            return { success: true };
        case 'GENERATE_VACANCIES': 
            return patternService.generateVacancies(
                payload.contractId, 
                payload.month, 
                payload.year, 
                payload.objectiveId 
            );
        case 'CLEAR_VACANCIES':
            return patternService.clearVacancies(
                payload.objectiveId,
                payload.month,
                payload.year
            );
        default: throw new functions.https.HttpsError('invalid-argument', 'AcciÃ³n invÃ¡lida');
    }
  } catch (error: any) {
      console.error(`[PATTERN_ERROR] Action ${action} failed:`, error.message);
      throw new functions.https.HttpsError('internal', error.message);
  }
});

// =========================================================
// 11. GESTIÓN DE CONVENIOS (NUEVO)
// =========================================================
export const manageAgreements = functions.https.onCall(async (data, context) => {
    const callerAuth = context.auth;
    if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role as string)) {
        throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
    }
    
    const { action, payload } = data as { action: string, payload: any };
  
    try {
        const agreementService = await getService(LaborAgreementService);
  
        switch (action) {
            case 'CREATE': return { success: true, data: await agreementService.create(payload) };
            case 'GET_ALL': return { success: true, data: await agreementService.findAll() };
            case 'UPDATE': await agreementService.update(payload.id, payload.data); return { success: true };
            case 'DELETE': await agreementService.delete(payload.id); return { success: true };
            // CARGA DE DATOS POR DEFECTO
            case 'INITIALIZE_DEFAULTS': 
                const msg = await agreementService.initializeDefaults();
                return { success: true, message: msg };
                
            default: throw new functions.https.HttpsError('invalid-argument', `AcciÃ³n desconocida: ${action}`);
        }
    } catch (error: any) {
        console.error(`[AGREEMENT_ERROR] Action ${action} failed:`, error.message);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

// =========================================================
// 12. DIAGNÓSTICO DE SISTEMA (HEALTH CHECK)
// =========================================================

export const platformHealthCheck = functions.https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Requiere autenticaciÃ³n.');
  }

  const db = admin.firestore();
  const results: Record<string, { ok: boolean; latencyMs?: number; detail?: string }> = {};

  // â"€â"€ Firestore â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const t0 = Date.now();
  try {
    const snap = await db.collection('empresas').limit(1).get();
    results.firestore = { ok: true, latencyMs: Date.now() - t0, detail: `${snap.size} empresa(s) leÃ­da(s)` };
  } catch (e: any) {
    results.firestore = { ok: false, latencyMs: Date.now() - t0, detail: e.message };
  }

  // â"€â"€ Gemini API â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const geminiKey = process.env.GEMINI_API_KEY || '';
  if (!geminiKey) {
    results.gemini = { ok: false, detail: 'GEMINI_API_KEY no configurada' };
  } else {
    const tg = Date.now();
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      await model.generateContent({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] });
      results.gemini = { ok: true, latencyMs: Date.now() - tg, detail: 'Respuesta OK' };
    } catch (e: any) {
      results.gemini = { ok: false, latencyMs: Date.now() - tg, detail: e.message?.slice(0, 120) };
    }
  }

  // â"€â"€ Gmail SMTP â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const gmailUser = process.env.GMAIL_USER || '';
  const gmailPass = process.env.GMAIL_PASS || '';
  if (!gmailUser || !gmailPass) {
    results.gmail = { ok: false, detail: 'GMAIL_USER / GMAIL_PASS no configurados' };
  } else {
    const tm = Date.now();
    try {
      const nodemailerMod = await import('nodemailer');
      const transporter = nodemailerMod.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
      await transporter.verify();
      results.gmail = { ok: true, latencyMs: Date.now() - tm, detail: gmailUser };
    } catch (e: any) {
      results.gmail = { ok: false, latencyMs: Date.now() - tm, detail: e.message?.slice(0, 120) };
    }
  }

  // â"€â"€ Google Drive â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const driveFolderId = process.env.DRIVE_BACKUP_FOLDER_ID || '';
  if (!driveFolderId) {
    results.drive = { ok: false, detail: 'DRIVE_BACKUP_FOLDER_ID no configurado' };
  } else {
    try {
      const snap = await db.collection('system_backups').orderBy('createdAt', 'desc').limit(1).get();
      if (!snap.empty) {
        const last = snap.docs[0].data();
        const ts = last.createdAt?.toDate?.()?.toISOString?.() ?? 'desconocido';
        results.drive = { ok: true, detail: `Ãšltimo backup: ${ts}` };
      } else {
        results.drive = { ok: true, detail: 'Sin backups registrados aÃºn' };
      }
    } catch (e: any) {
      results.drive = { ok: false, detail: e.message?.slice(0, 120) };
    }
  }

  // â"€â"€ FCM (Push Notifications) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  try {
    const tokSnap = await db.collection('device_tokens').limit(1).get();
    results.fcm = { ok: true, detail: `Tokens registrados: ${tokSnap.size > 0 ? 'â‰¥1' : '0'}` };
  } catch (e: any) {
    results.fcm = { ok: false, detail: e.message };
  }

  // â"€â"€ Scheduled jobs — Ãºltima ejecuciÃ³n â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const scheduledJobs = ['autoCompletarTurnos', 'detectarAusencias', 'gestionarVacantes', 'scheduledBackup'];
  const jobStatus: Record<string, string> = {};
  for (const job of scheduledJobs) {
    try {
      const snap = await db.collection('scheduled_job_logs').doc(job).get();
      if (snap.exists) {
        const d = snap.data()!;
        const ts = d.lastRunAt?.toDate?.()?.toISOString?.() ?? null;
        jobStatus[job] = ts ?? 'sin registro';
      } else {
        jobStatus[job] = 'sin registro';
      }
    } catch {
      jobStatus[job] = 'error';
    }
  }
  results.scheduledJobs = { ok: true, detail: JSON.stringify(jobStatus) };

  // â"€â"€ Conteos de datos â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
  } catch (e: any) {
    results.data = { ok: false, detail: e.message };
  }

  // â"€â"€ Entorno â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
  results.env = { ok: true, detail: isEmulator ? 'Emulador local' : 'ProducciÃ³n (Firebase)' };

  return { ok: Object.values(results).every(r => r.ok), results, nodeVersion: process.version, checkedAt: new Date().toISOString() };
});
export const checkSystemHealth = functions.https.onCall(async (data, context) => {
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
  } catch (error: any) {
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

// =========================================================
// 12b. ASISTENTE VIRTUAL (Gemini vÃ­a Functions)
// ProducciÃ³n: Secret Manager — `GEMINI_API_KEY`. Emulador: NO usar secrets (no se montan):
// misma llamable sin runWith para que cargue GEMINI desde apps/functions/.env (bootstrap-env.ts).
// =========================================================
async function chatPlatformAssistantHandler(
  data: AssistantChatPayload,
  context: functions.https.CallableContext,
): Promise<{ reply: string }> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'DebÃ©s estar logueado.');
  }

  const t0 = Date.now();
  const uid = context.auth.uid;
  const question = extractLastUserQuestion(data.messages ?? []);
  const empresaId = String(data.empresaId ?? '').trim();
  const moduleKey = typeof data.moduleKey === 'string' ? data.moduleKey.trim() : null;
  const pathname = String(data.pathname ?? '').slice(0, 400);
  const userEmail =
    (context.auth.token?.email as string | undefined) ||
    (context.auth.token?.email_verified != null ? String(context.auth.token?.email ?? '') : null) ||
    null;

  let reply: string | undefined;
  let hadError = false;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const tokenRole = String(context.auth.token?.role ?? '').trim() || undefined;
    const result = await runPlatformAssistant(uid, data, { tokenRole });
    reply = result.reply;
    return result;
  } catch (e: any) {
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
  } finally {
    const outcome = classifyAssistantOutcome(reply, hadError);
    void writeAssistantInteractionLog({
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

function truncateMsg(s: string, max: number): string {
  const t = String(s).trim();
  return t.length <= max ? t : `${t.slice(0, max - 3)}â€¦`;
}

export const chatPlatformAssistant =
  process.env.FUNCTIONS_EMULATOR === 'true'
    ? functions.https.onCall(chatPlatformAssistantHandler)
    : functions
        .runWith({ secrets: ['GEMINI_API_KEY'], timeoutSeconds: 180, memory: '512MB' })
        .https.onCall(chatPlatformAssistantHandler);

const ALLOWED_PLANNING_AI_ROLES = ['admin', 'SuperAdmin', 'SUPERADMIN', 'SUPER_ADMIN', 'SP', 'Manager', 'Scheduler', 'ADMIN_EMPRESA', 'ADMIN_PRUEBA'];

async function optimizePlanningGeminiHandler(
  data: { context?: Record<string, unknown>; empresaId?: string },
  context: functions.https.CallableContext,
): Promise<GeminiRespuesta> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'DebÃ©s estar logueado.');
  }
  const role = String(context.auth.token.role || '').trim();
  const { isSuperAdminRole } = await import('./common/role.util');
  if (!isSuperAdminRole(role) && !ALLOWED_PLANNING_AI_ROLES.includes(role)) {
    throw new functions.https.HttpsError('permission-denied', 'Rol sin acceso a IA de planificaciÃ³n.');
  }
  const { resolveAssistantUser, empresaAllowed } = await import('./assistant/resolveAssistantUser');
  const tokenRole = String(context.auth.token?.role ?? '').trim() || undefined;
  const profile = await resolveAssistantUser(context.auth.uid, { tokenRole });
  if (!profile) {
    throw new functions.https.HttpsError('permission-denied', 'Usuario no reconocido.');
  }
  const claimedEmp = String(data?.empresaId ?? (data?.context as any)?.empresaId ?? '').trim();
  if (!empresaAllowed(claimedEmp || undefined, profile)) {
    throw new functions.https.HttpsError('permission-denied', 'Empresa no permitida para este usuario.');
  }
  const ctx = data?.context;
  if (!ctx || typeof ctx !== 'object') {
    throw new functions.https.HttpsError('invalid-argument', 'Falta payload "context".');
  }
  try {
    return await runPlanningGeminiOptimize(ctx as any);
  } catch (e: any) {
    if (e instanceof functions.https.HttpsError) throw e;
    console.error('[optimizePlanningGemini]', e?.message, e?.stack);
    const detail = e?.message || e?.toString?.() || 'Error Gemini planificaciÃ³n';
    throw new functions.https.HttpsError('internal', detail);
  }
}

const optimizePlanningGeminiRuntime = {
  timeoutSeconds: 180,
  memory: '512MB' as const,
};

export const optimizePlanningGemini =
  process.env.FUNCTIONS_EMULATOR === 'true'
    ? functions.runWith(optimizePlanningGeminiRuntime).https.onCall(optimizePlanningGeminiHandler)
    : functions
        .runWith({ ...optimizePlanningGeminiRuntime, secrets: ['GEMINI_API_KEY'] })
        .https.onCall(optimizePlanningGeminiHandler);

// --- FUNCIONES DE SISTEMA INYECTADAS POR SCRIPT ---

// 1. Crear Usuario de SISTEMA (Admin, RRHH, etc)
export const crearUsuarioSistema = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) throw new functions.https.HttpsError("unauthenticated", "Sin permisos.");

  const caller = await resolveBackupCaller(context.auth.uid, context.auth.token?.role);
  if (!caller.isPanelUser || !isAdminBackupRole(caller.sysRole || context.auth.token?.role)) {
    throw new functions.https.HttpsError('permission-denied', 'Solo administradores pueden crear usuarios de sistema.');
  }
  
  const { email, password, firstName, lastName, role, empresaId: rawEmpresaId, allEmpresas: rawAllEmpresas } = data;
  const roleNorm = normalizeBackupRole(role);
  const roleIsSuper = isSuperAdminBackupRole(roleNorm);
  const multiEmpresa =
    !roleIsSuper &&
    (rawAllEmpresas === true || String(rawEmpresaId ?? '').trim() === ALL_EMPRESAS_SENTINEL);

  if ((roleIsSuper || multiEmpresa) && !caller.isSuper) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Solo superadmin puede crear usuarios SuperAdmin o multi-empresa.',
    );
  }

  let targetEmpresaId = '';
  let allEmpresas = false;
  if (roleIsSuper) {
    targetEmpresaId = '';
  } else if (multiEmpresa) {
    targetEmpresaId = '';
    allEmpresas = true;
  } else {
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
  } catch (error: any) {
    throw new functions.https.HttpsError("internal", error.message);
  }
});

/** Sincroniza custom claims de Auth con el rol en system_users (p. ej. tras editar rol en UI). */
export const syncSystemUserClaims = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'AutenticaciÃ³n requerida');
  }
  const targetUid = String((data as { uid?: string })?.uid ?? context.auth.uid).trim();
  const db = admin.firestore();

  if (targetUid !== context.auth.uid) {
    const callerSnap = await db.collection('system_users').doc(context.auth.uid).get();
    const callerRole = normalizeBackupRole(callerSnap.data()?.role);
    const tokenRole = normalizeBackupRole(context.auth.token?.role);
    const callerSuper =
      isSuperAdminBackupRole(callerRole) || isSuperAdminBackupRole(tokenRole);
    if (!callerSuper) {
      throw new functions.https.HttpsError('permission-denied', 'Solo superadmin puede sincronizar otros usuarios.');
    }
  }

  const snap = await db.collection('system_users').doc(targetUid).get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Usuario de sistema no encontrado.');
  }
  const role = normalizeBackupRole(snap.data()?.role);
  if (!role) {
    throw new functions.https.HttpsError('failed-precondition', 'El usuario no tiene rol asignado.');
  }
  await admin.auth().setCustomUserClaims(targetUid, { role, type: 'SYSTEM' });
  return { ok: true, uid: targetUid, role };
});

/** Roles que pueden ejecutar limpieza masiva (coincide con ids en `roles` / `system_users.role`). */
function normalizeSystemRole(role: unknown): string {
  return String(role ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}

async function assertCanRunDangerousMaintenance(uid: string): Promise<void> {
  const snap = await admin.firestore().collection("system_users").doc(uid).get();
  if (!snap.exists) {
    throw new functions.https.HttpsError("permission-denied", "Usuario de sistema no encontrado.");
  }
  const r = normalizeSystemRole(snap.data()?.role);
  const allowed = new Set(["SUPERADMIN", "SUPER_ADMIN", "ADMIN"]);
  if (!allowed.has(r)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Solo cuentas ADMIN o SUPERADMIN pueden ejecutar la limpieza masiva."
    );
  }
}

// 2. Limpieza Masiva (Zona de Peligro)
export const limpiarBaseDeDatos = functions.runWith({ timeoutSeconds: 540 }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Rechazado.");

    await assertCanRunDangerousMaintenance(context.auth.uid);

    const { target } = data;
    const db = admin.firestore();
    let path = "";

    if (target === 'AUDIT') path = 'historial_operaciones';
    else if (target === 'SHIFTS') path = 'turnos';
    else throw new functions.https.HttpsError("invalid-argument", "Target invÃ¡lido");

    await db.recursiveDelete(db.collection(path));
    return { success: true };
});


// --- OPERATIVA: FICHADAS MANUALES Y RRHH ---

// 0. Check-in desde el portal del empleado (GPS ya validado en cliente)
export const requestCheckIn = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sin permisos.');
    const { shiftId, coords, recordedAt, idempotencyKey } = data;
    const db = admin.firestore();

    const shiftRef = db.collection('turnos').doc(shiftId);
    const shiftDoc = await shiftRef.get();
    if (!shiftDoc.exists) throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');

    const shiftData = shiftDoc.data()!;

    const callerRole = String(context.auth.token?.role ?? context.auth.token?.['custom:role'] ?? '');
    const callerIsSuperAdmin = isSuperAdminBackupRole(callerRole);

    const empSnap = await db.collection('empleados').where('uid', '==', context.auth.uid).limit(1).get();
    let empId: string;
    if (empSnap.empty) {
        if (callerIsSuperAdmin) {
            if (!shiftData.employeeId) throw new functions.https.HttpsError('not-found', 'Turno sin empleado asignado.');
            empId = shiftData.employeeId;
        } else {
            throw new functions.https.HttpsError('not-found', 'Empleado no encontrado.');
        }
    } else {
        empId = empSnap.docs[0].id;
        if (!callerIsSuperAdmin && shiftData.employeeId !== empId) {
            throw new functions.https.HttpsError('permission-denied', 'Turno no pertenece al empleado.');
        }
    }

    const { processPortalCheckIn } = await import('./fichajes/applyPortalCheckIn');

    try {
        const result = await processPortalCheckIn(db, {
            shiftId,
            empId,
            coords: coords || null,
            recordedAt: recordedAt || null,
            idempotencyKey: idempotencyKey || null,
            source: 'PORTAL_GPS',
        });
        return { success: true, fichajeId: result.fichajeId, alreadyApplied: result.alreadyApplied === true };
    } catch (e) {
        const msg = (e as Error)?.message || '';
        if (msg === 'SHIFT_ABSENT') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Tu turno fue registrado como ausencia. Contactá al operador para gestionar tu ingreso.',
            );
        }
        if (msg === 'TURNO_NOT_FOUND') {
            throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');
        }
        throw new functions.https.HttpsError('internal', msg || 'Error al registrar fichaje.');
    }
});

// 1. Fichada Manual (Operador de Radio / Supervisor)
export const registrarFichadaManual = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sin permisos.");
    
    // data: { shiftId, notes, method: 'RADIO' | 'PHONE' }
    const { shiftId, notes, method } = data;
    const db = admin.firestore();

    try {
        const shiftRef = db.collection('turnos').doc(shiftId);
        const shiftDoc = await shiftRef.get();

        if (!shiftDoc.exists) throw new Error("Turno no encontrado");

        // Actualizamos el turno a estado "PRESENT"
        await shiftRef.update({
            status: 'PRESENT',
            checkInTime: admin.firestore.FieldValue.serverTimestamp(),
            checkInMethod: method || 'MANUAL', // 'RADIO', 'PHONE', 'WHATSAPP'
            checkInOperator: context.auth.uid, // QuiÃ©n validÃ³ la fichada
            operatorNotes: notes || ''
        });

        // Log de auditorÃ­a (opcional)
        await db.collection('audit_logs').add({
            action: 'MANUAL_CHECKIN',
            shiftId,
            operator: context.auth.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true };
    } catch (error: any) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});

// 2. Reporte de Ausencia (RRHH / Operador)
export const reportarAusencia = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sin permisos.");

    // data: { shiftId, reason, type: 'SICK' | 'NO_SHOW' | 'LATE' }
    const { shiftId, reason, type } = data;
    const db = admin.firestore();

    try {
        const shiftRef = db.collection('turnos').doc(shiftId);
        
        await shiftRef.update({
            status: 'ABSENT',
            absenceType: type || 'NO_SHOW', // Enfermedad, Faltazo, etc.
            absenceReason: reason || '',
            absenceReportedBy: context.auth.uid,
            absenceReportedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true };
    } catch (error: any) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});


// =========================================================
// 12b. NOTIFICAR LLEGADA TARDE DESDE PORTAL
// =========================================================
export const notificarLlegadaTarde = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sin permisos.');

    const { shiftId } = data;
    if (!shiftId) throw new functions.https.HttpsError('invalid-argument', 'shiftId requerido.');

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();

    try {
        const shiftRef = db.collection('turnos').doc(shiftId);
        const shiftSnap = await shiftRef.get();
        if (!shiftSnap.exists) throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');

        const shiftData = shiftSnap.data() as any;

        await shiftRef.update({
            lateArrivalAt: now,
            checkInStatus: 'LATE_PENDING',
        });

        // Crear novedad para notificar al operador en CC
        try {
            await db.collection('novedades').add({
                type: 'LLEGADA_TARDE_AVISO',
                shiftId,
                employeeId: shiftData.employeeId || context.auth.uid,
                employeeName: shiftData.employeeName || '',
                objectiveId: shiftData.objectiveId || '',
                objectiveName: shiftData.objectiveName || '',
                clientName: shiftData.clientName || '',
                empresaId: shiftData.empresaId || null,
                description: (shiftData.employeeName || 'El guardia') + ' aviso que llegara tarde a ' + (shiftData.objectiveName || 'su puesto'),
                createdAt: now,
                status: 'unread',
                viewed: false,
            });
        } catch (e) {
            console.warn('[notificarLlegadaTarde] No se pudo crear novedad:', (e as Error)?.message);
        }

        return { success: true };
    } catch (error: any) {
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', error.message);
    }
});

// =========================================================
// 13. ENVÃO DE ACCESO AL PORTAL DE EMPLEADOS
// =========================================================
import * as nodemailer from 'nodemailer';

function buildPortalEmailHtml(activationLink: string, empresaNombre: string): string {
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

function buildPortalEmailText(activationLink: string, empresaNombre: string): string {
  const nombre = empresaNombre || 'Bacar sa. Seguridad Privada';
  return `${nombre} te ha otorgado acceso al Portal de Empleados de COSP.

AbrÃ­ este email desde tu celular y tocÃ¡ el siguiente enlace para crear tu contraseÃ±a y vincular tu dispositivo en un solo paso:

${activationLink}

Este enlace expira en 48 horas y es de un solo uso.

Saludos,
Equipo Operativo - ${nombre}`;
}

export const createPortalAccess = functions.https.onCall(async (data, context) => {
  const callerAuth = context.auth;
  if (!callerAuth) {
    throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
  }

  // Check 1: token claim (rÃ¡pido, sin Firestore)
  const tokenRole = (callerAuth.token.role as string) || '';
  let hasAccess = ADMIN_ROLES.some(r => r.toLowerCase() === tokenRole.toLowerCase());

  // Check 2 (fallback): verificar en system_users por si el claim no fue configurado
  if (!hasAccess) {
    try {
      const sysDoc = await admin.firestore().collection('system_users').doc(callerAuth.uid).get();
      if (sysDoc.exists) {
        const fsRole = (sysDoc.data()?.role as string) || '';
        hasAccess = ADMIN_ROLES.some(r => r.toLowerCase() === fsRole.toLowerCase());
      }
    } catch (_) { /* ignorer, hasAccess stays false */ }
  }

  if (!hasAccess) {
    throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
  }

  const { employeeIds } = data as { employeeIds: string[] };
  if (!employeeIds?.length) {
    throw new functions.https.HttpsError('invalid-argument', 'Se requiere al menos un empleado.');
  }

  // Credenciales SMTP — definir en apps/functions/.env (GMAIL_USER y GMAIL_PASS)
  const gmailUser = process.env.GMAIL_USER || '';
  const gmailPass = process.env.GMAIL_PASS || '';

  if (!gmailUser || !gmailPass) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Servicio de email no configurado. Definir GMAIL_USER y GMAIL_PASS en apps/functions/.env y redesplegar.'
    );
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  });

  const db = admin.firestore();
  const results: { empId: string; email: string; success: boolean; error?: string; alreadyExisted: boolean }[] = [];
  const empresaNombreCache: Record<string, string> = {};

  for (const empId of employeeIds) {
    try {
      const empDoc = await db.collection('empleados').doc(empId).get();
      if (!empDoc.exists) {
        results.push({ empId, email: '', success: false, error: 'Empleado no encontrado', alreadyExisted: false });
        continue;
      }

      const emp = empDoc.data()!;
      const email = (emp.email || emp.correo || '').toString().trim().toLowerCase();

      // Resolver nombre de empresa (con cache para no repetir lecturas)
      const empresaId = (emp.empresaId || '').toString();
      let empresaNombre = 'Bacar sa. Seguridad Privada';
      if (empresaId) {
        if (empresaNombreCache[empresaId] !== undefined) {
          empresaNombre = empresaNombreCache[empresaId];
        } else {
          try {
            const empDoc2 = await db.collection('empresas').doc(empresaId).get();
            if (empDoc2.exists) {
              empresaNombre = empDoc2.data()!.nombre || empDoc2.data()!.name || empresaNombre;
            }
          } catch (_) {}
          empresaNombreCache[empresaId] = empresaNombre;
        }
      }
      if (!email) {
        results.push({ empId, email: '', success: false, error: 'Sin email registrado', alreadyExisted: false });
        continue;
      }

      const name = (emp.name || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Empleado');

      // Crear usuario Auth si no existe
      let uid: string;
      let alreadyExisted = false;
      try {
        const existing = await admin.auth().getUserByEmail(email);
        uid = existing.uid;
        alreadyExisted = true;
      } catch (e: any) {
        if (e.code === 'auth/user-not-found') {
          const tempPass = Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 6).toUpperCase();
          const newUser = await admin.auth().createUser({ email, password: tempPass, displayName: name });
          await admin.auth().setCustomUserClaims(newUser.uid, { role: 'employee', type: 'employee' });
          uid = newUser.uid;
        } else {
          throw e;
        }
      }

      // Generar token de activaciÃ³n (UUID, expira 48h) — Ãºnico link para crear contraseÃ±a + activar dispositivo
      const crypto = await import('crypto');
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

      // Enviar email — solo se marca como enviado si el envÃ­o fue exitoso
      await transporter.sendMail({
        from: `"${empresaNombre}" <${gmailUser}>`,
        to: email,
        subject: `Acceso al Portal de Empleados - ${empresaNombre}`,
        html: buildPortalEmailHtml(activationLink, empresaNombre),
        text: buildPortalEmailText(activationLink, empresaNombre),
      });

      // Limpiar uid de cualquier otro documento que ya lo tenga (evita duplicados)
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
      if (needsCleanup) await cleanupBatch.commit();

      // Marcar invitaciÃ³n SOLO despuÃ©s del envÃ­o exitoso
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
    } catch (err: any) {
      results.push({ empId, email: '', success: false, error: err.message, alreadyExisted: false });
    }
  }

  return { success: true, results };
});

// =========================================================
// 14. ACTIVACIÓN DE DISPOSITIVO (device binding vÃ­a email)
// =========================================================

export const activateDevice = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesiÃ³n primero.');
  }
  const { token, deviceInfo, deviceId } = data as { token: string; deviceInfo?: Record<string, string>; deviceId?: string };
  if (!token) {
    throw new functions.https.HttpsError('invalid-argument', 'Token requerido.');
  }

  const db = admin.firestore();
  const tokenRef = db.collection('device_activations').doc(token);
  const tokenDoc = await tokenRef.get();

  if (!tokenDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Token de activaciÃ³n invÃ¡lido.');
  }

  const td = tokenDoc.data()!;

  if (td.used) {
    throw new functions.https.HttpsError('already-exists', 'Este enlace ya fue utilizado.');
  }

  if (td.expiresAt.toDate() < new Date()) {
    throw new functions.https.HttpsError('deadline-exceeded', 'El enlace de activaciÃ³n expirÃ³. PedÃ­ uno nuevo al administrador.');
  }

  if (td.uid !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'Este enlace no corresponde a tu cuenta.');
  }

  // Marcar token como usado
  await tokenRef.update({ used: true, usedAt: admin.firestore.FieldValue.serverTimestamp() });

  // Guardar dispositivo verificado — doc ID = uid (un dispositivo por usuario)
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

// =========================================================
// 15. ACTIVACIÓN COMPLETA: contraseÃ±a + dispositivo en un paso (sin auth previa)
// =========================================================

export const activateAndSetPassword = functions.https.onCall(async (data, _context) => {
  const { token, password, deviceId, deviceInfo } = data as {
    token: string;
    password: string;
    deviceId?: string;
    deviceInfo?: Record<string, string>;
  };

  if (!token) throw new functions.https.HttpsError('invalid-argument', 'Token requerido.');
  if (!password || password.length < 6) {
    throw new functions.https.HttpsError('invalid-argument', 'La contraseÃ±a debe tener al menos 6 caracteres.');
  }

  const db = admin.firestore();
  const tokenRef = db.collection('device_activations').doc(token);
  const tokenDoc = await tokenRef.get();

  if (!tokenDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Enlace invÃ¡lido o ya utilizado.');
  }

  const td = tokenDoc.data()!;

  if (td.used) {
    throw new functions.https.HttpsError('already-exists', 'Este enlace ya fue utilizado. Tu dispositivo puede estar activo.');
  }

  if (td.expiresAt.toDate() < new Date()) {
    throw new functions.https.HttpsError('deadline-exceeded', 'El enlace expirÃ³. Pedile al administrador que te reenvÃ­e el mail de acceso.');
  }

  const { uid, employeeId } = td;

  // Obtener email del usuario para devolvÃ©rselo al front (necesario para signIn)
  const userRecord = await admin.auth().getUser(uid);
  const email = userRecord.email;
  if (!email) throw new functions.https.HttpsError('internal', 'El usuario no tiene email configurado.');

  // 1. Establecer contraseÃ±a
  await admin.auth().updateUser(uid, { password });

  // 2. Marcar token como usado
  await tokenRef.update({ used: true, usedAt: admin.firestore.FieldValue.serverTimestamp() });

  // 3. Registrar dispositivo verificado
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

// =========================================================
// 16. ACCESO AL PORTAL DE CLIENTES
// =========================================================

function buildClientPortalEmailHtml(resetLink: string, clientName: string): string {
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
                  <a href="${resetLink}" target="_blank" style="display:inline-block;padding:14px 36px;color:#fff;font-size:15px;font-weight:bold;text-decoration:none;letter-spacing:0.5px;">CREAR CONTRASEÃ'A</a>
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

function buildClientPortalEmailText(resetLink: string, clientName: string): string {
  return `Bacar sa. Seguridad Privada te ha otorgado acceso al Portal de Clientes de COSP para gestionar el personal autorizado de ${clientName}.

HacÃ© clic en el siguiente enlace para crear tu contraseÃ±a y acceder al portal:

${resetLink}

Una vez que crees tu contraseÃ±a, podrÃ¡s consultar los accesos del dÃ­a y gestionar el personal autorizado de tus objetivos.

Si no esperabas este email, podÃ©s ignorarlo. El enlace caduca en 24 horas.

Saludos,
Equipo Operativo - Bacar sa. Seguridad Privada`;
}

export const createClientPortalAccess = functions.https.onCall(async (data, context) => {
  const callerAuth = context.auth;
  if (!callerAuth) {
    throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
  }

  const tokenRole = (callerAuth.token.role as string) || '';
  let hasAccess = ADMIN_ROLES.some(r => r.toLowerCase() === tokenRole.toLowerCase());

  if (!hasAccess) {
    try {
      const sysDoc = await admin.firestore().collection('system_users').doc(callerAuth.uid).get();
      if (sysDoc.exists) {
        const fsRole = (sysDoc.data()?.role as string) || '';
        hasAccess = ADMIN_ROLES.some(r => r.toLowerCase() === fsRole.toLowerCase());
      }
    } catch (_) { /* ignore */ }
  }

  if (!hasAccess) {
    throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
  }

  const { clientId, clientName, nombre, email, objectiveIds, empresaId } = data as {
    clientId: string;
    clientName: string;
    nombre: string;
    email: string;
    objectiveIds?: string[];
    empresaId?: string;
  };

  if (!clientId || !clientName || !nombre || !email) {
    throw new functions.https.HttpsError('invalid-argument', 'Se requieren clientId, clientName, nombre y email.');
  }

  const gmailUser = process.env.GMAIL_USER || '';
  const gmailPass = process.env.GMAIL_PASS || '';

  if (!gmailUser || !gmailPass) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Servicio de email no configurado. Definir GMAIL_USER y GMAIL_PASS en apps/functions/.env y redesplegar.'
    );
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  });

  const db = admin.firestore();
  const normalizedEmail = email.trim().toLowerCase();

  // Crear o reutilizar usuario Auth
  let uid: string;
  let alreadyExisted = false;
  try {
    const existing = await admin.auth().getUserByEmail(normalizedEmail);
    uid = existing.uid;
    alreadyExisted = true;
  } catch (e: any) {
    if (e.code === 'auth/user-not-found') {
      const tempPass = Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 6).toUpperCase();
      const newUser = await admin.auth().createUser({ email: normalizedEmail, password: tempPass, displayName: nombre });
      await admin.auth().setCustomUserClaims(newUser.uid, { role: 'client', type: 'client_user' });
      uid = newUser.uid;
    } else {
      throw e;
    }
  }

  // Generar enlace de reset
  const resetLink = await admin.auth().generatePasswordResetLink(normalizedEmail, {
    url: 'https://comtroldata.web.app/cliente/dashboard',
  });

  // Enviar email
  await transporter.sendMail({
    from: `"Bacar sa. Seguridad Privada" <${gmailUser}>`,
    to: normalizedEmail,
    subject: 'Acceso al Portal de Clientes - COSP',
    html: buildClientPortalEmailHtml(resetLink, clientName),
    text: buildClientPortalEmailText(resetLink, clientName),
  });

  // Intentar obtener empresaId del doc clients si no vino en el payload
  let resolvedEmpresaId = empresaId || '';
  if (!resolvedEmpresaId) {
    try {
      const clientDoc = await db.collection('clients').doc(clientId).get();
      if (clientDoc.exists) resolvedEmpresaId = clientDoc.data()?.empresaId || '';
    } catch { /* ignore */ }
  }

  const clientUserData: Record<string, any> = {
    uid,
    clientId,
    clientName,
    nombre: nombre.trim(),
    email: normalizedEmail,
    activo: true,
    objectiveIds: objectiveIds || [],
    ...(resolvedEmpresaId ? { empresaId: resolvedEmpresaId } : {}),
    portalInvite: {
      sent: true,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      email: normalizedEmail,
      sentBy: callerAuth.uid,
    },
  };

  // El doc canónico de client_users usa el UID como ID (el portal lee con
  // getDoc(doc('client_users', uid)) y las reglas asumen docId == uid).
  const canonicalRef = db.collection('client_users').doc(uid);
  const canonicalSnap = await canonicalRef.get();
  await canonicalRef.set(
    {
      ...clientUserData,
      ...(canonicalSnap.exists ? {} : { creadoEn: admin.firestore.FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );

  // Migrar/limpiar docs legacy con ID autogenerado para el mismo uid (evita duplicados en el CRM).
  try {
    const legacySnap = await db.collection('client_users').where('uid', '==', uid).get();
    const batch = db.batch();
    let hasLegacy = false;
    legacySnap.docs.forEach((d) => {
      if (d.id !== uid) {
        batch.delete(d.ref);
        hasLegacy = true;
      }
    });
    if (hasLegacy) await batch.commit();
  } catch { /* ignore */ }

  return { success: true, alreadyExisted, email: normalizedEmail };
});

// =========================================================
// Notifications
// =========================================================
export { onNovedadCreated } from './notifications/onNovedadCreated';
export { onTurnoWrite } from './notifications/onTurnoWrite';
export { onCronogramaPublished } from './notifications/onCronogramaPublished';

// =========================================================
// Payroll API (HTTP) — para sistemas de liquidaciÃ³n externos
// =========================================================
export { payrollApi } from './payroll-api/handler';

export const sendTestNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  const db = admin.firestore();
  const uid = context.auth.uid;
  const tokensSnap = await db.collection('device_tokens').where('uid', '==', uid).get();
  const tokens = tokensSnap.docs
    .map(d => d.data()?.token)
    .filter((t): t is string => typeof t === 'string' && t.length > 10);
  if (!tokens.length) throw new functions.https.HttpsError('not-found', 'No device tokens found');
  const title: string = data?.title || 'CronoApp';
  const body: string  = data?.body  || 'NotificaciÃ³n de prueba';
  const message: admin.messaging.MulticastMessage = {
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

// =========================================================
// 15. AUTO-COMPLETAR TURNOS (SCHEDULED - cada 5 minutos)
// =========================================================
// LÃ³gica:
//   A) Turno tiene relevo ya PRESENTE → cerrar (el handover no lo cerrÃ³, safety net)
//   B) Turno tiene relevo pero NO llegÃ³ → NO cerrar, crear novedad de AUSENCIA_RELEVO
//   C) Turno sin relevo programado → cerrar directamente al vencimiento
export const autoCompletarTurnos = functions
  .region('us-central1')
  .pubsub.schedule('every 5 minutes')
  .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    const nowMs = now.toMillis();

    // Turnos PRESENT cuyo endTime pasÃ³ hace al menos 5 minutos
    const cutoff = admin.firestore.Timestamp.fromMillis(nowMs - 5 * 60 * 1000);
    // Ventana para buscar relevo: startTime dentro de Â±2h del endTime del turno saliente
    const RELIEF_WINDOW_MS = 2 * 60 * 60 * 1000;

    const snap = await db.collection('turnos')
      .where('status', '==', 'PRESENT')
      .where('endTime', '<=', cutoff)
      .get();

    if (snap.empty) return null;

    const completeBatch  = db.batch();
    const auditBatch     = db.batch();
    let completed = 0;
    let alertedNoRelief = 0;

    for (const docSnap of snap.docs) {
      const shift = docSnap.data();

      if ((shift.status || '') === 'INTERRUPTED') continue;

      // Retenciones automáticas (autoRetentionAt existe): cerrar si llevan >2h sin cambio
      // Retenciones manuales del operador (sin autoRetentionAt): nunca tocar
      if (shift.isRetention === true) {
        const autoRetentionMs = shift.autoRetentionAt?.toMillis?.() ?? 0;
        if (!autoRetentionMs) {
          // Retención manual del operador (sin autoRetentionAt).
          // Usar endTime como referencia: si el turno lleva >6h vencido → cerrar.
          const endMs2 = shift.endTime?.toMillis?.() ?? 0;
          if (!endMs2) continue;
          const minutesSinceEnd = (nowMs - endMs2) / 60000;
          if (minutesSinceEnd < 360) continue; // <6h → respetar decisión del operador
          // >6h sin resolver → auto-cerrar igual que timeout de CF
        } else {
          const minutesInRetention = (nowMs - autoRetentionMs) / 60000;
          if (minutesInRetention < 120) continue; // <2h → esperar más
        }
        // >2h de retención automática o >6h de retención manual → auto-cerrar
        completeBatch.update(docSnap.ref, {
          status: 'COMPLETED',
          isCompleted: true,
          isPresent: false,
          completedAt: now,
          completedBy: 'Sistema',
          completionReason: 'AUTO_END_CF_RETENTION_TIMEOUT',
        });
        completed++;
        continue;
      }

      const endTimeMs: number = shift.endTime?.toMillis?.() ?? 0;
      if (!endTimeMs) continue;

      // Buscar turnos entrantes en el mismo objetivo + posiciÃ³n
      // cuyo startTime estÃ© dentro de Â±2h del endTime del turno saliente
      const windowStart = admin.firestore.Timestamp.fromMillis(endTimeMs - RELIEF_WINDOW_MS);
      const windowEnd   = admin.firestore.Timestamp.fromMillis(endTimeMs + RELIEF_WINDOW_MS);

      const relieveSnap = await db.collection('turnos')
        .where('objectiveId',  '==', shift.objectiveId)
        .where('positionName', '==', shift.positionName)
        .where('startTime', '>=', windowStart)
        .where('startTime', '<=', windowEnd)
        .get();

      // Filtrar el turno propio y exigir mismo tenant cuando el turno saliente estÃ¡ etiquetado
      const relieveDocs = relieveSnap.docs.filter(d =>
        d.id !== docSnap.id && sameTenantShift(shift, d.data()),
      );

      const relievePresent = relieveDocs.find(d => {
        const s = d.data().status || '';
        return s === 'PRESENT' || s === 'COMPLETED';
      });
      // Solo contar como relevo pendiente un turno con empleado REAL asignado.
      // Las vacantes (employeeId === 'VACANTE' / isUnassigned) no son relevos vÃ¡lidos —
      // si se cuentan, el turno saliente nunca se cierra y queda como retenido indefinidamente.
      const relievePending = relieveDocs.find(d => {
        const data = d.data();
        if (!data.employeeId || data.employeeId === 'VACANTE') return false;
        if (data.isUnassigned === true) return false;
        const s = data.status || '';
        return s === 'PENDING' || s === 'PLAN' || s === '' || (!s);
      });

      // Relevo ausente: retén convocado que no se presentó (status ABSENT)
      const relieveAbsent = relieveDocs.find(d => {
        const data = d.data();
        return data.isAbsent === true || data.status === 'ABSENT';
      });

      if (relievePresent) {
        // CASO A: El relevo ya estÃ¡ presente — safety net, cerrar el turno saliente
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

      } else if (relievePending) {
        // CASO B: Relevo programado pero no llegÃ³ → retener al guardia + push + novedad
        // Poner en retención (o asegurar autoRetentionAt si ya fue marcado manualmente sin él)
        if (!shift.isRetention || !shift.autoRetentionAt) {
          completeBatch.update(docSnap.ref, {
            isRetention: true,
            retentionReason: `RELEVO_NO_PRESENTADO: ${relievePending.data().employeeName || 'relevo'} no se presentó`,
            autoRetentionAt: now,
          });
        }
        // Push al guardia retenido
        const retTokensB = await getEmployeeTokens(db, shift.employeeId as string);
        if (retTokensB.length > 0) {
          await admin.messaging().sendEachForMulticast({
            tokens: retTokensB,
            notification: {
              title: '⏰ Quedaste en retención',
              body: `Tu relevo (${relievePending.data().employeeName || 'el guardia'}) no se presentó en ${shift.objectiveName || 'el puesto'}. Permanecé hasta aviso de Operaciones.`,
            },
            webpush: {
              notification: { icon: '/icons/icon-192x192.png', requireInteraction: true },
              fcmOptions: { link: '/empleado/dashboard' },
            },
          }).catch(e => console.warn('[autoCompletarTurnos] Push retención B error:', e));
        }
        // Novedad para operaciones (una sola vez)
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
            description: `⏰ RETENCIÓN: ${shift.employeeName || ''} en ${shift.objectiveName || ''} (${shift.positionName || ''}) — su relevo no se presentó. Requiere cobertura urgente.`,
            createdAt: now,
            source: 'SYSTEM_SCHEDULER',
          });
          alertedNoRelief++;
        }

      } else if (relieveAbsent) {
        // CASO B2: El relevo fue convocado (retén) pero no se presentó y fue marcado ausente
        // → Retención forzada + push + novedad
        if (!shift.isRetention || !shift.autoRetentionAt) {
          completeBatch.update(docSnap.ref, {
            isRetention: true,
            retentionReason: `RELEVO_AUSENTE: ${relieveAbsent.data().employeeName || 'relevo'} no se presentó`,
            autoRetentionAt: now,
          });
        }
        // Push al guardia retenido
        const retTokensB2 = await getEmployeeTokens(db, shift.employeeId as string);
        if (retTokensB2.length > 0) {
          await admin.messaging().sendEachForMulticast({
            tokens: retTokensB2,
            notification: {
              title: '⏰ Quedaste en retención',
              body: `Tu relevo (${relieveAbsent.data().employeeName || 'el guardia'}) no se presentó en ${shift.objectiveName || 'el puesto'}. Permanecé hasta aviso de Operaciones.`,
            },
            webpush: {
              notification: { icon: '/icons/icon-192x192.png', requireInteraction: true },
              fcmOptions: { link: '/empleado/dashboard' },
            },
          }).catch(e => console.warn('[autoCompletarTurnos] Push retención B2 error:', e));
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
            description: `⚠️ RETENCIÓN FORZADA: ${shift.employeeName || ''} en ${shift.objectiveName || ''} (${shift.positionName || ''}) — su relevo no se presentó. Requiere cobertura urgente.`,
            createdAt: now,
            source: 'SYSTEM_SCHEDULER',
          });
          alertedNoRelief++;
        }

      } else {
        // CASO C: Sin ningún relevo registrado.
        // Verificar si el puesto requiere cobertura continua (24HS) consultando el SLA.
        // Si es 24HS (tiene allowedShiftTypes con slots M/T/N) → retener al guardia.
        // Si es CUSTOM/parcial (sin slots de rotación) → cerrar el turno.
        const empId = shiftEmpresaId(shift);
        let requiresContinuousCoverage = false;
        try {
          const slaSnap = await db.collection('servicios_sla')
            .where('objectiveId', '==', shift.objectiveId)
            .where('status', '==', 'active')
            .limit(1).get();
          if (!slaSnap.empty) {
            const slaData = slaSnap.docs[0].data();
            const positions: any[] = slaData.positions || [];
            const posName = (shift.positionName || '').trim().toLowerCase();
            const matchedPos = positions.find((p: any) => (p.name || '').trim().toLowerCase() === posName);
            // Puesto con allowedShiftTypes definidos → rotación 24h → cobertura continua
            requiresContinuousCoverage = Array.isArray(matchedPos?.allowedShiftTypes) && matchedPos.allowedShiftTypes.length > 0;
          }
        } catch (e) {
          console.warn('[autoCompletarTurnos] Error checking SLA:', e);
        }

        if (requiresContinuousCoverage) {
          // CASO C2: Puesto 24HS sin relevo → retener al guardia + push
          if (!shift.isRetention || !shift.autoRetentionAt) {
            completeBatch.update(docSnap.ref, {
              isRetention: true,
              retentionReason: 'SIN_RELEVO_24H: puesto con cobertura continua requerida',
              autoRetentionAt: now,
            });
          }
          const retTokensC = await getEmployeeTokens(db, shift.employeeId as string);
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
        } else {
          // CASO C: Puesto CUSTOM/parcial sin continuidad → cerrar turno automáticamente
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

// =========================================================
// 16. DETECTAR AUSENCIAS (SCHEDULED - cada 5 minutos)
// =========================================================
// Fases:
//   ALERTA  (startTime + 15min): push al empleado "Â¿EstÃ¡s en tu puesto?"
//   AUSENTE (startTime + 60min): marcar ABSENT + novedad operaciones
const SKIP_STATUSES = new Set(['PRESENT', 'ABSENT', 'COMPLETED', 'INTERRUPTED', 'CANCELLED']);
const SKIP_CODES    = new Set(['F', 'FF', 'V', 'L', 'A', 'E', 'AA', 'FP']);

function shiftEmpresaId(shift: FirebaseFirestore.DocumentData): string {
  return String(shift.empresaId ?? '').trim();
}

function sameTenantShift(
  a: FirebaseFirestore.DocumentData,
  b: FirebaseFirestore.DocumentData,
): boolean {
  const ae = shiftEmpresaId(a);
  const be = shiftEmpresaId(b);
  if (ae && be) return ae === be;
  if (ae && !be) return false;
  return true;
}

async function getEmployeeTokens(db: admin.firestore.Firestore, employeeId: string): Promise<string[]> {
  if (!employeeId || employeeId === 'VACANTE') return [];
  const empDoc = await db.collection('empleados').doc(employeeId).get();
  const authUid: string | undefined = empDoc.data()?.uid;
  if (!authUid) return [];
  const tokenSnap = await db.collection('device_tokens').where('uid', '==', authUid).get();
  return tokenSnap.docs.map(d => d.data()?.token).filter((t): t is string => typeof t === 'string' && t.length > 10);
}

export const detectarAusencias = functions
  .region('us-central1')
  .pubsub.schedule('every 5 minutes')
  .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    const nowMs = now.toMillis();

    // â"€â"€ BLOQUE 1: alerta temprana de retenciÃ³n a T+0 â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    // Turnos que acaban de iniciar (0-10 min) sin check-in → avisar al guardia saliente
    // Los guardias marcan a T-15, asÃ­ que T+0 sin check-in = ya estÃ¡ retrasado
    const earlyFrom = admin.firestore.Timestamp.fromMillis(nowMs - 10 * 60 * 1000);
    const earlyTo   = admin.firestore.Timestamp.fromMillis(nowMs);

    const earlySnap = await db.collection('turnos')
      .where('startTime', '>=', earlyFrom)
      .where('startTime', '<=', earlyTo)
      .get();

    for (const earlyDoc of earlySnap.docs) {
      const s = earlyDoc.data();
      if (s.draft === true || s.isPresent || s.isCompleted || s.isAbsent) continue;
      if (s.isUnassigned || !s.employeeId || s.employeeId === 'VACANTE') continue;
      if (SKIP_CODES.has((s.code || '').toUpperCase())) continue;
      if (SKIP_STATUSES.has(s.status || '')) continue;
      if (s.earlyRetentionAlertAt) continue;  // ya se procesÃ³
      if (s.lateArrivalAt || s.notifiedAbsent) continue; // tiene aviso previo

      const empId = shiftEmpresaId(s);
      const posName = (s.positionName || '').trim().toLowerCase();

      if (!s.objectiveId || !posName || !empId) continue;

      // Marcar que ya se enviÃ³ la alerta temprana
      await earlyDoc.ref.update({ earlyRetentionAlertAt: now });

      // Buscar guardia saliente presente en el mismo puesto
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
      } catch (e) {
        console.warn('[detectarAusencias] Error en alerta temprana retenciÃ³n:', e);
      }
    }

    // â"€â"€ BLOQUE 2: ausencia automÃ¡tica AA a T+30 â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    // Ventana: turnos que empezaron entre hace 8h y hace 30min
    const windowFrom = admin.firestore.Timestamp.fromMillis(nowMs - 8 * 60 * 60 * 1000);
    const windowTo   = admin.firestore.Timestamp.fromMillis(nowMs - 30 * 60 * 1000);

    const snap = await db.collection('turnos')
      .where('startTime', '>=', windowFrom)
      .where('startTime', '<=', windowTo)
      .get();

    if (snap.empty) return null;

    let alerts = 0;
    let absents = 0;

    for (const docSnap of snap.docs) {
      const shift = docSnap.data();

      // Saltar si ya estÃ¡ resuelto o si es una vacante (vacantes tienen su propio flujo)
      if (shift.draft === true) continue;              // borrador no publicado
      if (SKIP_STATUSES.has(shift.status || '')) continue;
      if (shift.isPresent === true || shift.isCompleted === true) continue;
      if (shift.isUnassigned === true) continue;         // vacante → no es ausencia
      if (shift.isReportedToPlanning === true) continue; // ya gestionado
      if (SKIP_CODES.has((shift.code || '').toUpperCase())) continue;
      if (!shift.employeeId || shift.employeeId === 'VACANTE') continue;

      const startMs: number = shift.startTime?.toMillis?.() ?? 0;
      if (!startMs) continue;

      // Turnos de planificaciÃ³n (SLA_VIRTUAL, PLANIFICADOR o sin origin) solo se procesan
      // si el cronograma del objetivo/mes estÃ¡ publicado; RETEN y OPERATIONS_COVERAGE son
      // operativos explÃ­citos y siempre se procesan.
      const planningOrigins = new Set(['', 'PLANIFICADOR', 'SLA_VIRTUAL', undefined]);
      if (planningOrigins.has(shift.origin) && shift.objectiveId) {
        const { year: chkYear, month: chkMonth } = ymCordobaParts(new Date(startMs));
        const empId = shiftEmpresaId(shift);
        const docIds = planificacionEstadoLookupDocIds(empId, shift.objectiveId, chkYear, chkMonth);
        const planDocs = await Promise.all(docIds.map(id => db.doc(`planificacion_estados/${id}`).get()));
        if (!planDocs.some(s => s.exists)) continue; // cronograma no publicado → no generar ausencia
      }

      const elapsedMin = (nowMs - startMs) / 60000;

      // â"€â"€ AUSENTE: T+30 sin marcar presente → ausencia automÃ¡tica AA â"€â"€
      // T+60: guardia tiene 60 min para marcar presencia antes de ser marcado AA
      if (elapsedMin >= 60) {
        // Evitar procesar dos veces — pero antes corregir fecha si hay ausencia con fecha incorrecta
        if (shift.absenceDetectedAt) {
          // Corrección retroactiva: turnos nocturnos cuya ausencia fue guardada con fecha UTC en vez de UTC-3
          try {
            const fixArDate = new Date(startMs - 3 * 60 * 60 * 1000);
            const fixDateStr = `${fixArDate.getUTCFullYear()}-${String(fixArDate.getUTCMonth() + 1).padStart(2, '0')}-${String(fixArDate.getUTCDate()).padStart(2, '0')}`;
            const fixSnap = await db.collection('ausencias').where('shiftId', '==', docSnap.id).limit(1).get();
            if (!fixSnap.empty) {
              const fixData = fixSnap.docs[0].data();
              if (fixData.startDate !== fixDateStr || fixData.endDate !== fixDateStr) {
                const st = shift.startTime?.toDate ? shift.startTime.toDate() : new Date(startMs);
                const et = shift.endTime?.toMillis ? new Date(shift.endTime.toMillis()) : null;
                const fmtT = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
                const horario = et ? `${fmtT(st)} - ${fmtT(et)}` : fmtT(st);
                await fixSnap.docs[0].ref.update({
                  startDate: fixDateStr,
                  endDate: fixDateStr,
                  reason: `No presentacion al turno ${horario} - ${shift.objectiveName || ''} (${shift.positionName || ''})`,
                });
                console.log(`[detectarAusencias] Corrección fecha retro: ${fixData.startDate} → ${fixDateStr} turno ${docSnap.id}`);
              }
            }
          } catch (fixErr) {
            console.warn('[detectarAusencias] Error corrección fecha retro:', fixErr);
          }
          continue;
        }
        // Guardia con aviso de llegada tarde: no marcar ausente automÃ¡ticamente
        if (shift.lateArrivalAt) continue;
        // Caso 2: operador registrÃ³ aviso anticipado → no marcar AA
        if (shift.notifiedAbsent === true) continue;
        // Retenes no se auto-detectan como ausentes — son convocados urgentes
        if (shift.isReten === true || shift.origin === 'RETEN') continue;
        // Fix timezone: no marcar AA si el turno termina en el futuro LEJANO
        // (evita marcar turnos nocturnos 11 PM - 7 AM a las pocas horas de iniciados)
        const endMs = shift.endTime?.toMillis?.() ?? 0;
        if (endMs > 0 && endMs > nowMs + 6 * 60 * 60 * 1000) continue; // turno termina en >6h → saltear

        // 1. Marcar ABSENT AA
        await docSnap.ref.update({
          status: 'ABSENT',
          isAbsent: true,
          absenceType: 'AA',
          absenceDetectedAt: now,
          absenceDetectedBy: 'SYSTEM_SCHEDULER',
        });

        // 2. Retención automÃ¡tica: si hay un guardia presente en el mismo puesto, retenerlo
        const objectiveId   = shift.objectiveId   || '';
        const positionName  = (shift.positionName || '').trim().toLowerCase();
        const empId         = shiftEmpresaId(shift);
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
              // Marcar como en retenciÃ³n si no lo estÃ¡ ya
              if (!retData.isRetention) {
                // Si el guardia a retener aún tiene turno activo, el timer de 2h debe arrancar
                // desde su hora de fin planificada (no desde ahora), para que el auto-cierre
                // se dispare correctamente a los 2h DESPUÉS de que termine su propio turno.
                const retEndMs = retData.endTime?.toMillis?.() ?? 0;
                const retentionAt = retEndMs > nowMs
                  ? admin.firestore.Timestamp.fromMillis(retEndMs)
                  : now;
                await retDoc.ref.update({
                  isRetention:     true,
                  retentionReason: `AUSENCIA_AA: ${shift.employeeName || 'guardia'} no se presentó`,
                  autoRetentionAt: retentionAt,
                });
                // Push al guardia retenido
                const retTokens = await getEmployeeTokens(db, retData.employeeId);
                if (retTokens.length > 0) {
                  await admin.messaging().sendEachForMulticast({
                    tokens: retTokens,
                    notification: {
                      title: '⏰ Quedaste en retención',
                      body: `${shift.employeeName || 'El guardia siguiente'} no se presentó en ${shift.objectiveName || 'el puesto'}. Permanecé en el puesto hasta aviso de Operaciones.`,
                    },
                    webpush: {
                      notification: { icon: '/icons/icon-192x192.png', requireInteraction: true },
                      fcmOptions: { link: '/empleado/dashboard' },
                    },
                  }).catch(e => console.warn('[detectarAusencias] Push retención error:', e));
                }
                // Novedad para operaciones
                await db.collection('novedades').add({
                  type: 'RETENCION_POR_AUSENCIA',
                  status: 'PENDIENTE',
                  empresaId: empId,
                  objectiveId,
                  objectiveName:        shift.objectiveName || '',
                  positionName:         shift.positionName  || '',
                  employeeId:           retData.employeeId,
                  employeeName:         retData.employeeName || '',
                  absentEmployeeId:     shift.employeeId,
                  absentEmployeeName:   shift.employeeName  || '',
                  description: `${retData.employeeName || 'Guardia'} retenido automÃ¡ticamente — ${shift.objectiveName} Â· ${shift.positionName} — por ausencia de ${shift.employeeName}`,
                  createdAt: now,
                  source: 'SYSTEM_SCHEDULER',
                });
              }
            }
          } catch (e) {
            console.warn('[detectarAusencias] Error en retenciÃ³n automÃ¡tica:', e);
          }
        }

        // 3. Push al empleado ausente (si tiene token)
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
                body: `No se registrÃ³ tu presencia en el turno de las ${startStr} en ${shift.objectiveName || ''}. Reportate a Operaciones.`,
              },
              webpush: {
                notification: {
                  title: '⚠️ Ausencia registrada',
                  body: `No registraste presencia en ${shift.objectiveName || ''} (${startStr}). IngresÃ¡ al portal si estÃ¡s presente.`,
                  icon: '/icons/icon-192x192.png',
                  requireInteraction: true,
                },
                fcmOptions: { link: '/empleado/dashboard' },
              },
            });
          } catch (e) {
            console.warn(`[detectarAusencias] Push error para ${shift.employeeId}:`, e);
          }
        }

        // 3. Registro en colección 'ausencias' — fecha en AR (UTC-3)
        // Turno nocturno 23hs: en UTC son las 02hs del día siguiente → restar 3h para obtener fecha local
        const arDate = new Date(startMs - 3 * 60 * 60 * 1000);
        const dateStr = `${arDate.getUTCFullYear()}-${String(arDate.getUTCMonth() + 1).padStart(2, '0')}-${String(arDate.getUTCDate()).padStart(2, '0')}`;
        const ausenciaExistsSnap = await db.collection('ausencias')
          .where('shiftId', '==', docSnap.id)
          .limit(1).get();
        // Helper local para el horario del turno
        const buildHorario = () => {
          const st = shift.startTime?.toDate ? shift.startTime.toDate() : new Date(startMs);
          const et = shift.endTime?.toMillis ? new Date(shift.endTime.toMillis()) : null;
          const fmtT = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
          return et ? `${fmtT(st)} - ${fmtT(et)}` : fmtT(st);
        };
        if (!ausenciaExistsSnap.empty) {
          // Corregir fecha si fue guardada con UTC en lugar de UTC-3 (turnos nocturnos)
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
        } else {
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

        // 4. Novedad para operaciones (solo una por turno)
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
            description: `${shift.employeeName || 'Empleado'} no se presentó al turno en ${shift.objectiveName || ''} (detectado a los ${Math.round(elapsedMin)} min).`,
            createdAt: now,
            source: 'SYSTEM_SCHEDULER',
          });
        }

        // 4. Audit log
        await db.collection('audit_logs').add({
          action: 'AUTO_MARK_ABSENT',
          actorName: 'Sistema (Scheduler)',
          actorUid: 'SYSTEM',
          module: 'OPERACIONES',
          shiftId: docSnap.id,
          details: `Ausencia automÃ¡tica: ${shift.employeeName || ''} — ${shift.objectiveName || ''} (${Math.round(elapsedMin)} min)`,
          timestamp: now,
        });

        absents++;
      }
    }

    console.log(`[detectarAusencias] Alertas: ${alerts} | Marcados ausentes: ${absents}`);
    return null;
  });

// =========================================================
export const gestionarVacantes = functions
  .region('us-central1')
  .pubsub.schedule('every 5 minutes')
  .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    const nowMs = now.toMillis();

    // Buscar vacantes: próximas 4h + últimas 12h (captura vacantes ya iniciadas sin cobertura)
    const windowStart = admin.firestore.Timestamp.fromMillis(nowMs - 12 * 60 * 60 * 1000);
    const windowEnd   = admin.firestore.Timestamp.fromMillis(nowMs + 4 * 60 * 60 * 1000);

    // Filtrar isUnassigned en memoria para evitar índice compuesto
    const snap = await db.collection('turnos')
      .where('startTime', '>=', windowStart)
      .where('startTime', '<=', windowEnd)
      .get();

    if (snap.empty) return null;

    let sentToPlanning = 0;
    let sentToProtocol = 0;

    for (const docSnap of snap.docs) {
      const shift = docSnap.data();

      // Solo vacantes sin asignación
      if (shift.isUnassigned !== true && shift.employeeId !== 'VACANTE') continue;

      // Ignorar si ya fue cancelada o resuelta
      const st = (shift.status || '').toUpperCase();
      if (['CANCELLED', 'COMPLETED', 'PRESENT'].includes(st)) continue;
      if (shift.isResolvedByOps === true) continue;
      if (SKIP_CODES.has((shift.code || '').toUpperCase())) continue;

      const startMs: number = shift.startTime?.toMillis?.() ?? 0;
      if (!startMs) continue;
      const minutesUntil = (startMs - nowMs) / 60000;

      // ── Ya iniciada (minutesUntil < 0): escalar directo a Protocolo ──
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

      // ── T-1h: Protocolo de Cobertura ──────────────────────────────
      if (minutesUntil <= 60 && !shift.vacanteProtocoloAt) {
        await docSnap.ref.update({
          vacanteProtocoloAt: now,
          vacanteEscalada: true,
        });

        // Evitar duplicar novedad
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

      // ── T-3h: Devolver a Planificación ────────────────────────────
      } else if (minutesUntil <= 180 && !shift.vacanteReportadaAt && !shift.isReportedToPlanning) {
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

    // ── AUTO-CIERRE: protocolos de cobertura vencidos (60 min de gracia) ─────
    // Si pasaron más de 60 minutos desde el inicio del turno sin que se resuelva,
    // se cierra automáticamente como "sin cobertura confirmada".
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

      // Verificar que el turno original no fue cubierto
      if (n.shiftId) {
        const turnoSnap = await db.collection('turnos').doc(n.shiftId).get();
        if (turnoSnap.exists) {
          const t = turnoSnap.data()!;
          // Fix 2: verificar también cobertura vía turno nuevo (RETEN/FRANCO/EARLY_START)
          const directlyCovered = t.isPresent || t.status === 'PRESENT' || t.status === 'COMPLETED'
            || t.isResolvedByOps || t.resolvedBy === 'OPERACIONES' || t.status === 'COVERED';

          // Buscar si se creó un turno de retén/operativo para el mismo slot
          let coveredByNewShift = false;
          if (!directlyCovered && t.objectiveId && t.positionName) {
            const slotStartMs = t.startTime?.toMillis?.() ?? 0;
            const slotEndMs   = t.endTime?.toMillis?.()   ?? 0;
            if (slotStartMs > 0) {
              const coverSnap = await db.collection('turnos')
                .where('objectiveId', '==', t.objectiveId)
                .where('isPresent', '==', true)
                .limit(10).get();
              coveredByNewShift = coverSnap.docs.some(d => {
                const r = d.data();
                const rStart = r.startTime?.toMillis?.() ?? 0;
                const rEnd   = r.endTime?.toMillis?.()   ?? slotEndMs;
                const samePos = (r.positionName || '').toLowerCase() === (t.positionName || '').toLowerCase();
                const overlaps = rStart <= slotEndMs && rEnd >= slotStartMs;
                const isOps = ['RETEN','OPERATIONS_COVERAGE','EARLY_START'].includes(r.origin || '');
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

      // Turno no cubierto y venció el tiempo de gracia → confirmar sin cobertura
      await nDoc.ref.update({
        status: 'ATENDIDA',
        atendidaAt: now,
        atendidaPor: 'SISTEMA_AUTO',
        autoResolved: true,
        sinCobertura: true,
      });

      // Registro en audit_logs
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

// =========================================================
// BACKUP — Firestore → Google Drive
// =========================================================
export const triggerBackup = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (data, context) => {
    await assertBackupCallableAllowed(context);

    const folderId = await resolveDriveBackupFolderId();
    if (!folderId) throw new functions.https.HttpsError('failed-precondition', 'Variable DRIVE_BACKUP_FOLDER_ID no configurada.');

    const db = admin.firestore();
    const claimedEmpresa = String((data as { empresaId?: string })?.empresaId ?? '').trim();
    let empresaId = claimedEmpresa;
    const caller = await resolveBackupCaller(context.auth!.uid, context.auth!.token?.role);
    if (!caller.isSuper) {
      empresaId = caller.profileEmpresa || 'bacarsa';
    } else if (!empresaId) {
      empresaId = caller.profileEmpresa;
    }

    const scopeEmpresa = !!empresaId;

    try {
      const result = await runBackup(folderId, { empresaId, scopeEmpresa, source: 'triggerBackup' });
      return result;
    } catch (e: any) {
      const errDoc = {
        status: 'error',
        error: e?.message || 'Error desconocido',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(empresaId ? { empresaId } : {}),
        ...(scopeEmpresa ? { scopeEmpresa: true } : {}),
      };
      if (scopeEmpresa && empresaId) {
        await db.collection('system_backups').doc(`${empresaId}_latest`).set(errDoc);
      } else {
        await db.collection('system_backups').add(errDoc);
      }
      throw new functions.https.HttpsError('internal', e?.message || 'Error al ejecutar backup');
    }
  });

/** Encola restauración (rápido). El trabajo pesado corre en processRestoreJob (hasta 1 h). */
export const restoreBackup = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data, context) => {
    await assertBackupCallableAllowed(context);
    const payload = (data ?? {}) as RestoreRequestPayload;
    try {
      const { jobId, restoreOpts, fileName } = await assertRestoreRequestAllowed(
        context.auth!.uid,
        context.auth!.token?.role,
        payload,
      );
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
        requestedBy: context.auth!.uid,
        docsRestored: 0,
        docsDeleted: 0,
        total: 0,
        resumeColIndex: 0,
        idMaps: null,
        error: null,
        queuedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { jobId, queued: true };
    } catch (e: unknown) {
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

/** Ejecuta restore_jobs en background (hasta 9 min por invocación). */
export const processRestoreJob = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 540, memory: '4GB' })
  .firestore.document('restore_jobs/{jobId}')
  .onWrite(async (change) => {
    const after = change.after;
    if (!after.exists) return;
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
      const startedAt = data.startedAt?.toDate?.() as Date | undefined;
      if (startedAt && Date.now() - startedAt.getTime() > STUCK_RUNNING_MS) {
        shouldRecoverStuck = true;
      }
    }

    if (!shouldRunQueued && !shouldRecoverStuck) return;

    if (shouldRecoverStuck) {
      const db = admin.firestore();
      const reclaimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(after.ref);
        const cur = String(snap.data()?.status ?? '');
        if (cur !== 'running') return false;
        const started = snap.data()?.startedAt?.toDate?.() as Date | undefined;
        if (!started || Date.now() - started.getTime() <= STUCK_RUNNING_MS) return false;
        tx.update(after.ref, {
          status: 'queued',
          phase: 'Reintentando tras timeout del worker anterior…',
          error: null,
        });
        return true;
      });
      if (!reclaimed) return;
    }

    try {
      await executeRestoreJob(jobId);
    } catch (e) {
      console.error('[processRestoreJob] failed', jobId, e);
    }
  });

/** Copia todos los datos de una empresa a otra (superadmin). IDs nuevos + empresaId destino. */
export const migrateEmpresaData = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 120, memory: '1GB' })
  .https.onCall(async (data, context) => {
    await assertBackupCallableAllowed(context);
    const payload = (data ?? {}) as MigrateEmpresaRequestPayload & {
      startColIndex?: number;
      idMaps?: Record<string, Record<string, string>> | null;
      docsCopied?: number;
      docsDeleted?: number;
    };
    try {
      const { jobId, sourceEmpresaId, targetEmpresaId } = await assertMigrateEmpresaRequestAllowed(
        context.auth!.uid,
        context.auth!.token?.role,
        payload,
      );
      const db = admin.firestore();
      const startColIndex = Number(payload.startColIndex ?? 0);
      const idMaps = deserializeIdMaps(payload.idMaps ?? null);
      const docsCopied = Number(payload.docsCopied ?? 0);
      const docsDeleted = Number(payload.docsDeleted ?? 0);

      if (startColIndex === 0) {
        await db.collection('empresa_migrate_jobs').doc(jobId).set({
          status: 'running',
          phase: 'Iniciando migración…',
          sourceEmpresaId,
          targetEmpresaId,
          requestedBy: context.auth!.uid,
          docsCopied: 0,
          docsDeleted: 0,
          startedAt: FieldValue.serverTimestamp(),
        });
      }

      const result = await runEmpresaMigrate(sourceEmpresaId, targetEmpresaId, jobId, {
        startColIndex,
        collectionsPerRun: 1,
        idMaps,
        docsCopied,
        docsDeleted,
      });

      const idMapsSerialized = serializeIdMaps(result.idMaps ?? {});

      if (result.isComplete) {
        await db.collection('empresa_migrate_jobs').doc(jobId).set({
          status: 'done',
          phase: 'Completado',
          docsCopied: result.docsCopied,
          docsDeleted: result.docsDeleted,
          completedAt: FieldValue.serverTimestamp(),
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error en migración';
      if (/Solo superadmin|Solo usuarios del panel|no existe|obligatorias|misma empresa/i.test(msg)) {
        throw new functions.https.HttpsError('permission-denied', msg);
      }
      throw new functions.https.HttpsError('internal', msg);
    }
  });

/** Ejecuta empresa_migrate_jobs en background. */
export const processEmpresaMigrateJob = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 540, memory: '4GB' })
  .firestore.document('empresa_migrate_jobs/{jobId}')
  .onWrite(async (change) => {
    const after = change.after;
    if (!after.exists) return;
    const status = String(after.data()?.status ?? '');
    if (status !== 'queued') return;
    const beforeStatus = change.before.exists
      ? String(change.before.data()?.status ?? '')
      : '';
    if (beforeStatus === 'queued') return;

    const jobId = after.id;
    try {
      await executeEmpresaMigrateJob(jobId);
    } catch (e) {
      console.error('[processEmpresaMigrateJob] failed', jobId, e);
    }
  });

// =========================================================
// 18. TRIGGER: AUSENCIA DESDE PORTAL EMPLEADO
// =========================================================
// Cuando un empleado envía solicitud de ausencia para hoy desde el portal,
// el sistema ya clasificó el caso (absenceCase) y ahora crea la novedad
// urgente correspondiente para que Operaciones pueda actuar.
export const onAusenciaCreatedFromPortal = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 30, memory: '128MB' })
  .firestore.document('ausencias/{id}')
  .onCreate(async (snap) => {
    const data = snap.data();
    if (!data || data.source !== 'EMPLEADO') return null;

    const absenceCase: string = data.absenceCase || 'PROGRAMADA';
    if (absenceCase === 'PROGRAMADA') return null; // sin urgencia, no genera novedad operativa

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    // Buscar empresaId del empleado si no viene en el documento
    let empresaId: string | null = data.empresaId || null;
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

// Backup automático diario a las 3:00 AM (America/Argentina/Buenos_Aires)
export const scheduledBackup = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('0 3 * * *')
  .timeZone('America/Argentina/Buenos_Aires')
  .onRun(async () => {
    const db = admin.firestore();
    const folderId = await resolveDriveBackupFolderId();
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
      const result = await runBackup(folderId, { source: 'scheduledBackup' });
      console.log(`[scheduledBackup] OK: ${result.fileName} — ${result.totalDocs} docs`);
      await jobLogRef.set({
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
        lastStatus: 'ok',
        lastFileName: result.fileName,
        totalDocs: result.totalDocs,
        error: null,
      }, { merge: true });
    } catch (e: unknown) {
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

// Consulta padrón AFIP (Constancia de Inscripción) — certificado en Secret Manager / .env emulador
const afipLookupSecrets = ['AFIP_CUIT', 'AFIP_CERT', 'AFIP_PRIVATE_KEY', 'AFIP_PRODUCTION'] as const;
const functionsEmulator =
  process.env.FUNCTIONS_EMULATOR === 'true' ||
  Boolean(process.env.FIREBASE_EMULATOR_HUB) ||
  Boolean(process.env.FIRESTORE_EMULATOR_HOST);
// Secrets en SM: montar siempre en Cloud (un deploy sin DEPLOY_AFIP_WITH_SECRETS los dejaba vacíos).
const lookupClientByCuitRuntime: { timeoutSeconds: number; memory: '256MB'; secrets?: string[] } = {
  timeoutSeconds: 60,
  memory: '256MB',
};
if (!functionsEmulator) lookupClientByCuitRuntime.secrets = [...afipLookupSecrets];

export const lookupClientByCuit = functionsEmulator
  ? functions.https.onCall(lookupClientByCuitHandler)
  : functions.runWith(lookupClientByCuitRuntime).https.onCall(lookupClientByCuitHandler);

export const saveEmpresaAfipCredentials = functions.https.onCall(saveEmpresaAfipCredentialsHandler);
export const getEmpresaAfipConfig = functions.https.onCall(getEmpresaAfipConfigHandler);

// =========================================================
// 19. SCHEDULER: AUTO-INJUSTIFICADA a las 23:45 ARG
// =========================================================
// Marca como Injustificada toda ausencia AA del día que no tenga
// certificado cargado y que RRHH no haya clasificado antes de medianoche.
export const scheduledAutoInjustificada = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 300, memory: '256MB' })
  .pubsub.schedule('45 23 * * *')
  .timeZone('America/Argentina/Buenos_Aires')
  .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    // Fecha de hoy en ARG (YYYY-MM-DD)
    const todayArg = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const todayStr = `${todayArg.getUTCFullYear()}-${String(todayArg.getUTCMonth() + 1).padStart(2, '0')}-${String(todayArg.getUTCDate()).padStart(2, '0')}`;

    console.log(`[autoInjustificada] Procesando ausencias del día ${todayStr}`);

    // Buscar ausencias AA del día sin certificado y sin clasificar
    const snap = await db.collection('ausencias')
      .where('startDate', '==', todayStr)
      .where('status', '==', 'Confirmada')
      .get();

    if (snap.empty) {
      console.log('[autoInjustificada] Sin ausencias pendientes.');
      return null;
    }

    const batch = db.batch();
    let count = 0;

    snap.docs.forEach((doc) => {
      const data = doc.data();
      // Solo AA sin certificado
      const absType = String(data.absenceType || data.type || '').toUpperCase();
      const isAA = absType === 'AA' || data.type === 'No Presentacion' || data.type === 'No Presentación';
      if (!isAA) return;
      if (data.certificateUrl) return; // tiene certificado → no tocar
      batch.update(doc.ref, {
        status: 'Injustificada',
        autoInjustificadaAt: now,
        reason: `${data.reason || 'No presentación'} — Auto-injustificada por sistema (sin certificado al 23:45)`,
      });
      count++;
    });

    if (count > 0) {
      await batch.commit();
      console.log(`[autoInjustificada] ${count} ausencias marcadas Injustificada.`);
    }
    return null;
  });

// =========================================================
// 20. TRIGGER: CERTIFICADO PRESENTADO → NOVEDAD RRHH
// =========================================================
// Cuando el empleado sube un certificado médico desde el portal,
// se crea una novedad en RRHH para que lo revisen y clasifiquen la ausencia.
export const onAusenciaCertificado = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 30, memory: '128MB' })
  .firestore.document('ausencias/{ausenciaId}')
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();

    // Solo actuar cuando certificateUrl pasa de vacío a tener valor
    if (after.certificateUrl && !before.certificateUrl) {
      const db = admin.firestore();
      const now = admin.firestore.Timestamp.now();

      await db.collection('novedades').add({
        type: 'CERTIFICADO_PRESENTADO',
        title: 'Certificado presentado',
        description: `${after.employeeName || 'Empleado'} presentó certificado médico para su ausencia del ${after.startDate || ''}`,
        status: 'pending',
        employeeId: after.employeeId || '',
        employeeName: after.employeeName || '',
        objectiveId: after.objectiveId || null,
        objectiveName: after.objectiveName || '',
        positionName: after.positionName || '',
        clientId: after.clientId || null,
        shiftId: after.shiftId || null,
        ausenciaId: change.after.id,
        certificateUrl: after.certificateUrl,
        absenceDate: after.startDate || '',
        urgency: 'HIGH',
        handledBy: 'RRHH',
        empresaId: after.empresaId || null,
        createdAt: now,
        source: 'PORTAL_EMPLEADO',
        reportedBy: 'SISTEMA',
      });

      console.log(`[onAusenciaCertificado] Novedad creada para ausencia ${change.after.id}`);
    }
    return null;
  });

// checkLlegadaTardeReiterada → ver src/ausencias/llegadaTardeUtils.ts

// =========================================================
// UTILIDAD: LIMPIAR DEVUELTAS SLA FALSAS (una sola ejecución)
// POST /cleanupSlaDevueltas?secret=<CLEANUP_SECRET>&empresaId=<ID>
// Elimina turnos origin='SLA_VIRTUAL' + status='REPORTED_TO_PLANNING'
// y las novedades type='DEVUELTA_PLANNING' origin='SLA_VIRTUAL'.
// =========================================================
export const cleanupSlaDevueltas = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    const secret = req.query.secret as string | undefined;
    const expectedSecret = process.env.CLEANUP_SECRET || 'crono-cleanup-2024';
    if (secret !== expectedSecret) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const empresaId = (req.query.empresaId as string | undefined) || null;
    const db = admin.firestore();
    const BATCH_LIMIT = 400;

    let deletedTurnos = 0;
    let deletedNovedades = 0;
    const deletedTurnoIds: string[] = [];

    // ── 1. Borrar turnos SLA_VIRTUAL + REPORTED_TO_PLANNING ──────────────
    let turnosQ = db.collection('turnos')
      .where('origin', '==', 'SLA_VIRTUAL')
      .where('status', '==', 'REPORTED_TO_PLANNING');
    if (empresaId) turnosQ = turnosQ.where('empresaId', '==', empresaId) as any;

    const turnosSnap = await turnosQ.get();
    console.log(`[cleanupSlaDevueltas] Turnos a borrar: ${turnosSnap.size}`);

    const turnoBatches: admin.firestore.WriteBatch[] = [];
    let currentBatch = db.batch();
    let batchCount = 0;
    turnosSnap.docs.forEach(doc => {
      currentBatch.delete(doc.ref);
      deletedTurnoIds.push(doc.id);
      batchCount++;
      if (batchCount >= BATCH_LIMIT) {
        turnoBatches.push(currentBatch);
        currentBatch = db.batch();
        batchCount = 0;
      }
    });
    if (batchCount > 0) turnoBatches.push(currentBatch);
    for (const batch of turnoBatches) await batch.commit();
    deletedTurnos = turnosSnap.size;

    // ── 2. Borrar novedades DEVUELTA_PLANNING / SLA_VIRTUAL ──────────────
    let novedadesQ = db.collection('novedades')
      .where('origin', '==', 'SLA_VIRTUAL');
    if (empresaId) novedadesQ = novedadesQ.where('empresaId', '==', empresaId) as any;

    const novedadesSnap = await novedadesQ.get();
    console.log(`[cleanupSlaDevueltas] Novedades a borrar: ${novedadesSnap.size}`);

    let novBatch = db.batch();
    let novCount = 0;
    let novBatches: admin.firestore.WriteBatch[] = [];
    novedadesSnap.docs.forEach(doc => {
      novBatch.delete(doc.ref);
      novCount++;
      if (novCount >= BATCH_LIMIT) {
        novBatches.push(novBatch);
        novBatch = db.batch();
        novCount = 0;
      }
    });
    if (novCount > 0) novBatches.push(novBatch);
    for (const b of novBatches) await b.commit();
    deletedNovedades = novedadesSnap.size;

    res.json({ ok: true, deletedTurnos, deletedNovedades, deletedTurnoIds });
  });

// =========================================================
// setEmployeePortalPassword
// Permite al admin establecer una contraseña específica para el
// portal del empleado (crea el usuario Auth si no existe).
// Callable: { employeeId, password, actorName? }
// =========================================================
export const setEmployeePortalPassword = functions.https.onCall(async (data, context) => {
  const callerAuth = context.auth;
  if (!callerAuth) throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');

  const tokenRole = (callerAuth.token.role as string) || '';
  let hasAccess = ADMIN_ROLES.some(r => r.toLowerCase() === tokenRole.toLowerCase());
  if (!hasAccess) {
    try {
      const sysDoc = await admin.firestore().collection('system_users').doc(callerAuth.uid).get();
      if (sysDoc.exists) {
        const fsRole = (sysDoc.data()?.role as string) || '';
        hasAccess = ADMIN_ROLES.some(r => r.toLowerCase() === fsRole.toLowerCase());
      }
    } catch (_) {}
  }
  if (!hasAccess) throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');

  const { employeeId, password, actorName } = data as { employeeId: string; password: string; actorName?: string };
  if (!employeeId) throw new functions.https.HttpsError('invalid-argument', 'employeeId requerido.');
  if (!password || password.length < 6) throw new functions.https.HttpsError('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.');

  const db = admin.firestore();

  const empDoc = await db.collection('empleados').doc(employeeId).get();
  if (!empDoc.exists) throw new functions.https.HttpsError('not-found', 'Empleado no encontrado.');
  const emp = empDoc.data()!;
  const email = (emp.email || emp.correo || '').toString().trim().toLowerCase();
  if (!email) throw new functions.https.HttpsError('failed-precondition', 'El empleado no tiene email registrado.');

  const empName: string = (emp.name || ((emp.firstName || '') + ' ' + (emp.lastName || '')).trim() || email);
  const empresaId: string = (emp.empresaId || '').toString();

  let uid: string;
  let alreadyExisted = false;
  try {
    const existing = await admin.auth().getUserByEmail(email);
    uid = existing.uid;
    alreadyExisted = true;
    await admin.auth().updateUser(uid, { password });
  } catch (e: any) {
    if (e.code === 'auth/user-not-found') {
      const newUser = await admin.auth().createUser({ email, password, displayName: empName });
      await admin.auth().setCustomUserClaims(newUser.uid, { role: 'employee', type: 'employee' });
      uid = newUser.uid;
    } else {
      throw e;
    }
  }

  await db.collection('empleados').doc(employeeId).update({
    'portalInvite.sent': true,
    'portalInvite.passwordSetAt': admin.firestore.FieldValue.serverTimestamp(),
    'portalInvite.passwordSetBy': actorName || (callerAuth.token.email as string) || callerAuth.uid,
  });

  const actor: string = actorName || (callerAuth.token.name as string) || (callerAuth.token.email as string) || 'Admin';
  await db.collection('audit_logs').add({
    action: 'PORTAL_PASSWORD_SET',
    module: 'RRHH',
    actorName: actor,
    actorUid: callerAuth.uid,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    employeeId,
    employeeName: empName,
    empresaId,
    details: 'Contraseña de portal establecida para ' + empName + ' (' + email + '). Usuario ' + (alreadyExisted ? 'existente actualizado' : 'nuevo creado') + '.',
  });

  return { success: true, email, alreadyExisted, uid };
});
