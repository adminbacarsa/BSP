import './bootstrap-env';
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { runBackup } from './backup/backup.service';
import { runRestore, RestoreMode } from './backup/restore.service';
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

// Inicialización de Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

let nestApp: INestApplicationContext;

async function getService<T>(service: new (...args: any[]) => T): Promise<T> {
  if (!nestApp) {
    nestApp = await createNestApp();
  }
  return nestApp.get<T>(service); 
}

// Roles Administrativos
const ADMIN_ROLES = ['admin', 'superadmin', 'SuperAdmin', 'Scheduler', 'HR_Manager', 'Manager', 'Operator', 'Supervisor'];
const ALLOWED_ROLES: EmployeeRole[] = ['admin', 'employee'];


// =========================================================
// 1. GESTIÓN DE USUARIOS (AUTH)
// =========================================================
export const createUser = functions.https.onCall(async (data, context) => {
  const callerAuth = context.auth;
  if (!callerAuth || !ADMIN_ROLES.includes(callerAuth.token.role as string)) {
    throw new functions.https.HttpsError('permission-denied', 'Acceso denegado. Rol insuficiente.');
  }

  try {
    const authService = await getService(AuthService);
    const { email, password, name, role: receivedRole, clientId, dni, fileNumber, address } = data;
    
    if (!ALLOWED_ROLES.includes(receivedRole as EmployeeRole)) {
       throw new functions.https.HttpsError('invalid-argument', 'Rol inválido.');
    }

    const validRole = receivedRole as EmployeeRole;

    const newEmployee = await authService.createEmployeeProfile(
        email, 
        password, 
        validRole, 
        name,
        { clientId: clientId || '', dni, fileNumber, address }
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
            message: `Replicado: ${result.created} turnos. (Omitidos: ${result.skipped} días)` 
        };
      default:
        throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${action}`);
    }
  } catch (error: any) {
    const err = error as Error;
    console.error(`[SHIFT_ERROR] Action ${action} failed:`, err.message);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', err.message);
  }
});

// =========================================================
// 4. AUDITORÍA (GEOFENCING & MANUAL OVERRIDE)
// =========================================================
export const auditShift = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Requiere autenticación.');

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
// 5. GESTIÓN DE DATOS BÁSICOS
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
      default: throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${action}`);
    }
  } catch (error: any) {
    const err = error as Error;
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('[DATA_MANAGEMENT_FATAL]', err.message);
    throw new functions.https.HttpsError('internal', err.message);
  }
});

// =========================================================
// 6. GESTIÓN DE JERARQUÍA COMERCIAL
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
      
      default: throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${action}`);
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

      // 🛑 NUEVO: IMPORTACIÓN MASIVA
      case 'IMPORT_EMPLOYEES':
        if (!payload.rows || !Array.isArray(payload.rows)) {
             throw new functions.https.HttpsError('invalid-argument', 'Formato de archivo inválido. Se espera un array "rows".');
        }
        const importResult = await employeeService.importEmployees(payload.rows, callerAuth.uid);
        return { success: true, data: importResult };
        
      default: throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${action}`);
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
        throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${action}`);
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
    throw new functions.https.HttpsError('unauthenticated', 'Requiere autenticación.');
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
        throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${action}`);
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
        default: throw new functions.https.HttpsError('invalid-argument', 'Acción inválida');
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
                
            default: throw new functions.https.HttpsError('invalid-argument', `Acción desconocida: ${action}`);
        }
    } catch (error: any) {
        console.error(`[AGREEMENT_ERROR] Action ${action} failed:`, error.message);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

// =========================================================
// 12. DIAGNÓSTICO DE SISTEMA (HEALTH CHECK)
// =========================================================
export const checkSystemHealth = functions.https.onCall(async (data, context) => {
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
// 12b. ASISTENTE VIRTUAL (Gemini vía Functions)
// Secret Manager: `firebase functions:secrets:set GEMINI_API_KEY` y redeploy.
// Emulador: sigue valiendo `apps/functions/.env` (bootstrap-env.ts).
// =========================================================
export const chatPlatformAssistant = functions
  .runWith({ secrets: ['GEMINI_API_KEY'] })
  .https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debés estar logueado.');
  }
  try {
    return await runPlatformAssistant(context.auth.uid, data as AssistantChatPayload);
  } catch (e: any) {
    if (e instanceof functions.https.HttpsError) throw e;
    console.error('[chatPlatformAssistant]', e?.message, e?.stack);
    throw new functions.https.HttpsError('internal', e?.message ?? 'Error asistente');
  }
});




// --- FUNCIONES DE SISTEMA INYECTADAS POR SCRIPT ---

// 1. Crear Usuario de SISTEMA (Admin, RRHH, etc)
export const crearUsuarioSistema = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sin permisos.");
  
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
  } catch (error: any) {
    throw new functions.https.HttpsError("internal", error.message);
  }
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
    else throw new functions.https.HttpsError("invalid-argument", "Target inválido");

    await db.recursiveDelete(db.collection(path));
    return { success: true };
});


// --- OPERATIVA: FICHADAS MANUALES Y RRHH ---

// 0. Check-in desde el portal del empleado (GPS ya validado en cliente)
export const requestCheckIn = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sin permisos.');
    const { shiftId, coords, recordedAt } = data;
    const db = admin.firestore();

    const shiftRef = db.collection('turnos').doc(shiftId);
    const shiftDoc = await shiftRef.get();
    if (!shiftDoc.exists) throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');

    const shiftData = shiftDoc.data()!;

    // Verificar que el turno pertenece al empleado que hace la solicitud
    const empSnap = await db.collection('empleados').where('uid', '==', context.auth.uid).limit(1).get();
    if (empSnap.empty) throw new functions.https.HttpsError('not-found', 'Empleado no encontrado.');
    const empId = empSnap.docs[0].id;
    if (shiftData.employeeId !== empId) throw new functions.https.HttpsError('permission-denied', 'Turno no pertenece al empleado.');

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

    // Crear novedad para notificar al operador
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
    } catch (e) {
        console.warn('[requestCheckIn] No se pudo crear novedad:', (e as Error)?.message);
    }

    return { success: true };
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
            checkInOperator: context.auth.uid, // Quién validó la fichada
            operatorNotes: notes || ''
        });

        // Log de auditoría (opcional)
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
// 13. ENVÍO DE ACCESO AL PORTAL DE EMPLEADOS
// =========================================================
import * as nodemailer from 'nodemailer';

function buildPortalEmailHtml(resetLink: string): string {
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

function buildPortalEmailText(resetLink: string): string {
  return `Bacar sa. Seguridad Privada te ha otorgado acceso al Portal de Empleados de COSP.

Hacé clic en el siguiente enlace para crear tu contraseña y acceder al portal:

${resetLink}

Una vez que crees tu contraseña, podrás ver tus turnos, novedades y más.

Si no esperabas este email, podés ignorarlo. El enlace caduca en 24 horas.

Saludos,
Equipo Operativo - Bacar sa. Seguridad Privada`;
}

export const createPortalAccess = functions.https.onCall(async (data, context) => {
  const callerAuth = context.auth;
  if (!callerAuth) {
    throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
  }

  // Check 1: token claim (rápido, sin Firestore)
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

  for (const empId of employeeIds) {
    try {
      const empDoc = await db.collection('empleados').doc(empId).get();
      if (!empDoc.exists) {
        results.push({ empId, email: '', success: false, error: 'Empleado no encontrado', alreadyExisted: false });
        continue;
      }

      const emp = empDoc.data()!;
      const email = (emp.email || emp.correo || '').toString().trim().toLowerCase();
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

      // Generar enlace de creación/reset de contraseña
      const resetLink = await admin.auth().generatePasswordResetLink(email, {
        url: 'https://comtroldata.web.app/empleado/dashboard',
      });

      // Enviar email — solo se marca como enviado si el envío fue exitoso
      await transporter.sendMail({
        from: `"Bacar sa. Seguridad Privada" <${gmailUser}>`,
        to: email,
        subject: 'Acceso al Portal de Empleados - COSP',
        html: buildPortalEmailHtml(resetLink),
        text: buildPortalEmailText(resetLink),
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

      // Marcar invitación SOLO después del envío exitoso
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

// NVR removido — las funciones que no se pueden borrar de GCP quedan huérfanas en la nube.

// =========================================================
// 14. ACCESO AL PORTAL DE CLIENTES
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

function buildClientPortalEmailText(resetLink: string, clientName: string): string {
  return `Bacar sa. Seguridad Privada te ha otorgado acceso al Portal de Clientes de COSP para gestionar el personal autorizado de ${clientName}.

Hacé clic en el siguiente enlace para crear tu contraseña y acceder al portal:

${resetLink}

Una vez que crees tu contraseña, podrás consultar los accesos del día y gestionar el personal autorizado de tus objetivos.

Si no esperabas este email, podés ignorarlo. El enlace caduca en 24 horas.

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

  const { clientId, clientName, nombre, email, objectiveIds } = data as {
    clientId: string;
    clientName: string;
    nombre: string;
    email: string;
    objectiveIds?: string[];
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

  // Crear o actualizar documento client_users
  const existingSnap = await db.collection('client_users').where('uid', '==', uid).get();

  const clientUserData: Record<string, any> = {
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
  } else {
    await db.collection('client_users').add({
      ...clientUserData,
      creadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return { success: true, alreadyExisted, email: normalizedEmail };
});

// =========================================================
// Notifications
// =========================================================
export { onNovedadCreated } from './notifications/onNovedadCreated';
export { onTurnoWrite } from './notifications/onTurnoWrite';

// =========================================================
// Payroll API (HTTP) — para sistemas de liquidación externos
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
  const body: string  = data?.body  || 'Notificación de prueba';
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
// Lógica:
//   A) Turno tiene relevo ya PRESENTE → cerrar (el handover no lo cerró, safety net)
//   B) Turno tiene relevo pero NO llegó → NO cerrar, crear novedad de AUSENCIA_RELEVO
//   C) Turno sin relevo programado → cerrar directamente al vencimiento
export const autoCompletarTurnos = functions
  .region('us-central1')
  .pubsub.schedule('every 5 minutes')
  .onRun(async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    const nowMs = now.toMillis();

    // Turnos PRESENT cuyo endTime pasó hace al menos 5 minutos
    const cutoff = admin.firestore.Timestamp.fromMillis(nowMs - 5 * 60 * 1000);
    // Ventana para buscar relevo: startTime dentro de ±2h del endTime del turno saliente
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

      // Nunca tocar retenciones ni interrupciones
      if (shift.isRetention === true) continue;
      if ((shift.status || '') === 'INTERRUPTED') continue;

      const endTimeMs: number = shift.endTime?.toMillis?.() ?? 0;
      if (!endTimeMs) continue;

      // Buscar turnos entrantes en el mismo objetivo + posición
      // cuyo startTime esté dentro de ±2h del endTime del turno saliente
      const windowStart = admin.firestore.Timestamp.fromMillis(endTimeMs - RELIEF_WINDOW_MS);
      const windowEnd   = admin.firestore.Timestamp.fromMillis(endTimeMs + RELIEF_WINDOW_MS);

      const relieveSnap = await db.collection('turnos')
        .where('objectiveId',  '==', shift.objectiveId)
        .where('positionName', '==', shift.positionName)
        .where('startTime', '>=', windowStart)
        .where('startTime', '<=', windowEnd)
        .get();

      // Filtrar el turno propio
      const relieveDocs = relieveSnap.docs.filter(d => d.id !== docSnap.id);

      const relievePresent = relieveDocs.find(d => {
        const s = d.data().status || '';
        return s === 'PRESENT' || s === 'COMPLETED';
      });
      // Solo contar como relevo pendiente un turno con empleado REAL asignado.
      // Las vacantes (employeeId === 'VACANTE' / isUnassigned) no son relevos válidos —
      // si se cuentan, el turno saliente nunca se cierra y queda como retenido indefinidamente.
      const relievePending = relieveDocs.find(d => {
        const data = d.data();
        if (!data.employeeId || data.employeeId === 'VACANTE') return false;
        if (data.isUnassigned === true) return false;
        const s = data.status || '';
        return s === 'PENDING' || s === 'PLAN' || s === '' || (!s);
      });

      if (relievePresent) {
        // CASO A: El relevo ya está presente — safety net, cerrar el turno saliente
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
        // CASO B: Hay relevo programado pero no llegó — crear novedad de alerta
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

      } else {
        // CASO C: Sin relevo — turno único, cerrar directamente
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

// =========================================================
// 16. DETECTAR AUSENCIAS (SCHEDULED - cada 5 minutos)
// =========================================================
// Fases:
//   ALERTA  (startTime + 15min): push al empleado "¿Estás en tu puesto?"
//   AUSENTE (startTime + 60min): marcar ABSENT + novedad operaciones
const SKIP_STATUSES = new Set(['PRESENT', 'ABSENT', 'COMPLETED', 'INTERRUPTED', 'CANCELLED']);
const SKIP_CODES    = new Set(['F', 'FF', 'V', 'L', 'A', 'E', 'AA', 'FP']);

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

    // Ventana: turnos que empezaron entre hace 8h y hace 30min (T+30 = ausencia automática)
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

      // Saltar si ya está resuelto o si es una vacante (vacantes tienen su propio flujo)
      if (shift.draft === true) continue;              // borrador no publicado
      if (SKIP_STATUSES.has(shift.status || '')) continue;
      if (shift.isPresent === true || shift.isCompleted === true) continue;
      if (shift.isUnassigned === true) continue;         // vacante → no es ausencia
      if (shift.isReportedToPlanning === true) continue; // ya gestionado
      if (SKIP_CODES.has((shift.code || '').toUpperCase())) continue;
      if (!shift.employeeId || shift.employeeId === 'VACANTE') continue;

      const startMs: number = shift.startTime?.toMillis?.() ?? 0;
      if (!startMs) continue;
      const elapsedMin = (nowMs - startMs) / 60000;

      // ── AUSENTE: T+30 sin marcar presente → ausencia automática AA ──
      if (elapsedMin >= 30) {
        // Evitar procesar dos veces
        if (shift.absenceDetectedAt) continue;
        // Guardia con aviso de llegada tarde: no marcar ausente automáticamente
        if (shift.lateArrivalAt) continue;

        // 1. Marcar ABSENT AA
        await docSnap.ref.update({
          status: 'ABSENT',
          isAbsent: true,
          absenceType: 'AA',
          absenceDetectedAt: now,
          absenceDetectedBy: 'SYSTEM_SCHEDULER',
        });

        // 2. Push al empleado (si tiene token)
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
          } catch (e) {
            console.warn(`[detectarAusencias] Push error para ${shift.employeeId}:`, e);
          }
        }

        // 3. Registro en colección 'ausencias' (el planificador la usa para mostrar badge AA)
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
          details: `Ausencia automática: ${shift.employeeName || ''} — ${shift.objectiveName || ''} (${Math.round(elapsedMin)} min)`,
          timestamp: now,
        });

        absents++;
      }
    }

    console.log(`[detectarAusencias] Alertas: ${alerts} | Marcados ausentes: ${absents}`);
    return null;
  });

// =========================================================
// 17. GESTIONAR VACANTES (SCHEDULED - cada 5 minutos)
// =========================================================
// Las vacantes son turnos SIN asignación (isUnassigned: true).
// NO son ausencias.
//
// Flujo:
//   T-3h: Devolver a Planificación (isReportedToPlanning + novedad VACANTE_A_PLANIFICACION)
//   T-1h: Si sigue sin asignar → Protocolo de Cobertura (novedad VACANTE_PROTOCOLO_COBERTURA)
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

// =========================================================
// BACKUP — Firestore → Google Drive
// =========================================================
export const triggerBackup = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (_data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida');
    const role = context.auth.token.role as string;
    const allowed = ['admin', 'superadmin', 'SuperAdmin'];
    if (!allowed.includes(role)) throw new functions.https.HttpsError('permission-denied', 'Solo administradores');

    const folderId = process.env.DRIVE_BACKUP_FOLDER_ID;
    if (!folderId) throw new functions.https.HttpsError('failed-precondition', 'Variable DRIVE_BACKUP_FOLDER_ID no configurada.');

    try {
      const result = await runBackup(folderId);
      return result;
    } catch (e: any) {
      const db = admin.firestore();
      await db.collection('system_backups').add({
        status: 'error',
        error: e?.message || 'Error desconocido',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      throw new functions.https.HttpsError('internal', e?.message || 'Error al ejecutar backup');
    }
  });

export const restoreBackup = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida');
    const role = context.auth.token.role as string;
    if (!['admin', 'superadmin', 'SuperAdmin'].includes(role)) {
      throw new functions.https.HttpsError('permission-denied', 'Solo administradores');
    }
    const { driveFileId, mode, jobId } = data as { driveFileId: string; mode: RestoreMode; jobId?: string };
    if (!driveFileId) throw new functions.https.HttpsError('invalid-argument', 'driveFileId requerido');
    if (!['merge', 'full'].includes(mode)) throw new functions.https.HttpsError('invalid-argument', 'mode debe ser merge o full');

    try {
      return await runRestore(driveFileId, mode, jobId);
    } catch (e: any) {
      throw new functions.https.HttpsError('internal', e?.message || 'Error al restaurar');
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
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('0 3 * * *')
  .timeZone('America/Argentina/Buenos_Aires')
  .onRun(async () => {
    const folderId = process.env.DRIVE_BACKUP_FOLDER_ID;
    if (!folderId) { console.warn('[scheduledBackup] DRIVE_BACKUP_FOLDER_ID no configurado'); return null; }
    try {
      const result = await runBackup(folderId);
      console.log(`[scheduledBackup] OK: ${result.fileName} — ${result.totalDocs} docs`);
    } catch (e) {
      console.error('[scheduledBackup] Error:', e);
    }
    return null;
  });

