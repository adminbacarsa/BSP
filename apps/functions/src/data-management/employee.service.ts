import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { IEmployee } from '../common/interfaces/employee.interface';
import { WorkloadService } from '../scheduling/workload.service';

const COLL_EMPLOYEES = 'empleados';

@Injectable()
export class EmployeeService {

  private getDb = () => admin.app().firestore();
  private getAuth = () => admin.app().auth();

  constructor(
      private readonly workloadService: WorkloadService, 
  ) {}

  async findAllEmployees(clientId?: string): Promise<IEmployee[]> {
    try {
      let query: admin.firestore.Query = this.getDb().collection(COLL_EMPLOYEES);
      if (clientId) {
        query = query.where('clientId', '==', clientId);
      }
      const snapshot = await query.get();
      return snapshot.docs.map(doc => doc.data() as IEmployee);
    } catch (error) {
      console.error('[GET_EMPLOYEES_ERROR]', error);
      throw new InternalServerErrorException('Error al obtener la lista de empleados.');
    }
  }

  async getEmployeeWorkload(uid: string, month: number, year: number): Promise<any> {
    const report = await this.workloadService.getWorkloadReport(uid, month, year);
    return report;
  }

  async updateEmployee(uid: string, data: Partial<IEmployee>): Promise<void> {
      const db = this.getDb();
      const auth = this.getAuth();
      const ref = db.collection(COLL_EMPLOYEES).doc(uid);
      const doc = await ref.get();
      if (!doc.exists) {
          throw new NotFoundException('Empleado no encontrado.');
      }

      const updateData: any = { ...data };
      if (updateData.payrollCycleStartDay !== undefined) updateData.payrollCycleStartDay = Number(updateData.payrollCycleStartDay);
      if (updateData.payrollCycleEndDay !== undefined) updateData.payrollCycleEndDay = Number(updateData.payrollCycleEndDay);

      delete updateData.uid;
      delete updateData.email;
      await ref.update(updateData);

      if (data.role) {
          try {
              await auth.setCustomUserClaims(uid, { role: data.role });
          } catch (e) {
              console.error(`Error actualizando claims para ${uid}`, e);
          }
      }
  }

  async deleteEmployee(uid: string): Promise<void> {
    try {
        try {
            await this.getAuth().deleteUser(uid);
        } catch (e: any) {
            if (e.code !== 'auth/user-not-found') throw e;
        }
        // Eliminar por uid field (doc ID puede diferir del Auth UID)
        const snap = await this.getDb().collection(COLL_EMPLOYEES).where('uid', '==', uid).get();
        const batch = this.getDb().batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        // Por compatibilidad también intenta por doc ID = uid
        batch.delete(this.getDb().collection(COLL_EMPLOYEES).doc(uid));
        await batch.commit();
    } catch (error) {
        console.error('[DELETE_EMPLOYEE_ERROR]', error);
        throw new InternalServerErrorException('Error al eliminar el empleado.');
    }
  }

  // 🛑 NUEVO: IMPORTACIÓN MASIVA
  async importEmployees(rows: any[], adminUid: string): Promise<{ success: number, errors: any[] }> {
      const db = this.getDb();
      const auth = this.getAuth();
      const errors = [];
      let successCount = 0;

      for (const row of rows) {
          try {
              if (!row.email || !row.dni || !row.name) {
                  throw new Error(`Faltan datos (email, dni, nombre) para: ${row.name || 'Fila desconocida'}`);
              }

              const email = row.email.trim().toLowerCase();
              // 🔑 La contraseña inicial es el DNI
              const password = row.dni.trim(); 
              
              let uid = '';
              
              // 1. Crear o Recuperar Usuario en Auth
              try {
                  const userRecord = await auth.createUser({
                      email,
                      password,
                      displayName: row.name,
                      emailVerified: true
                  });
                  uid = userRecord.uid;
              } catch (e: any) {
                  if (e.code === 'auth/email-already-exists') {
                      const existingUser = await auth.getUserByEmail(email);
                      uid = existingUser.uid;
                  } else {
                      throw e;
                  }
              }

              // 2. Asignar Rol
              await auth.setCustomUserClaims(uid, { role: 'employee' });

              // 3. Preparar Datos para Firestore
              const employeeData: any = {
                  uid,
                  name: row.name,
                  email: email,
                  dni: row.dni,
                  fileNumber: row.legajo || '',
                  address: row.direccion || '',
                  role: 'employee',
                  isAvailable: true,
                  
                  // Asignación de Reglas (con defaults)
                  laborAgreement: row.convenio || 'SUVICO',
                  contractType: row.modalidad || 'FullTime',
                  maxHoursPerMonth: Number(row.horas_mensuales) || 176,
                  
                  // Ciclo de Nómina
                  payrollCycleStartDay: Number(row.inicio_ciclo) || 1,
                  payrollCycleEndDay: 0, // 0 = fin de mes automático, o calcular si es necesario

                  createdAt: admin.firestore.Timestamp.now(),
                  importedBy: adminUid
              };

              // 4. Guardar Ficha (Merge para no borrar datos si ya existía)
              await db.collection(COLL_EMPLOYEES).doc(uid).set(employeeData, { merge: true });
              successCount++;

          } catch (error: any) {
              console.error(`Error importando ${row.email}:`, error.message);
              errors.push({ email: row.email, error: error.message });
          }
      }

      return { success: successCount, errors };
  }
}



