import { Injectable, InternalServerErrorException, ConflictException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { IEmployee } from '../common/interfaces/employee.interface';

const EMPLOYEES_COLLECTION = 'empleados';

@Injectable()
export class AuthService {

  // 🔑 Inicialización diferida (Lazy Loading)
  private getAuth = () => admin.app().auth();
  private getDb = () => admin.app().firestore();

  async createEmployeeProfile(
    email: string,
    password: string,
    role: IEmployee['role'],
    name: string,
    // 👇 Nuevo argumento: Datos extendidos del perfil
    profileData: { clientId: string, dni: string, fileNumber: string, address: string }
  ): Promise<IEmployee> {
    
    const authInstance = this.getAuth();

    // 1. Crear usuario en Auth
    const user = await authInstance.createUser({
      email,
      password,
      displayName: name,
      emailVerified: true,
    }).catch(error => {
      if (error.code === 'auth/email-already-exists') {
        throw new ConflictException('La dirección de correo ya está en uso.');
      }
      console.error('[AUTH_CREATE_ERROR]', error.message);
      throw new InternalServerErrorException('Error al crear usuario en Firebase Auth.');
    });

    const employeeUid = user.uid;

    // 2. Asignar Custom Claims (Rol)
    try {
      await authInstance.setCustomUserClaims(employeeUid, { role });
    } catch (error) {
      console.error(`[CLAIMS_ERROR] Failed to set claims.`, error);
      await authInstance.deleteUser(employeeUid); // Rollback
      throw new InternalServerErrorException('Error al asignar rol. Creación abortada.');
    }
    
    // 3. Crear Perfil en Firestore con los NUEVOS CAMPOS
    const employeeProfile: IEmployee = {
      uid: employeeUid,
      email: email,
      name: name,
      role: role,
      isAvailable: true,
      maxHoursPerMonth: 176,        // Valor estándar
      contractType: 'FullTime',     // Valor estándar
      // 👇 Mapeo de campos extendidos
      clientId: profileData.clientId,
      dni: profileData.dni,
      fileNumber: profileData.fileNumber,
      address: profileData.address
    };

    const dbInstance = this.getDb();
    
    try {
      await dbInstance.collection(EMPLOYEES_COLLECTION).doc(employeeUid).set(employeeProfile);
    } catch (error) {
      console.error(`[FIRESTORE_ERROR] Failed to create profile.`, error);
      await authInstance.deleteUser(employeeUid); // Rollback
      throw new InternalServerErrorException('Error al guardar perfil. Creación abortada.');
    }

    return employeeProfile;
  }
}



