import { Injectable, InternalServerErrorException, ConflictException, NotFoundException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { ISystemUser, SystemRole } from '../common/interfaces/system-user.interface';

const COLL_SYSTEM_USERS = 'system_users';

@Injectable()
export class SystemUserService {

  // Inicialización diferida
  private getAuth = () => admin.app().auth();
  private getDb = () => admin.app().firestore();

  /**
   * Crea un nuevo usuario administrativo.
   */
  async createSystemUser(data: { email: string, password: string, displayName: string, role: SystemRole }): Promise<ISystemUser> {
    const auth = this.getAuth();
    const db = this.getDb();

    // 1. Crear en Auth
    const userRecord = await auth.createUser({
      email: data.email,
      password: data.password,
      displayName: data.displayName,
      emailVerified: true,
    }).catch(error => {
      if (error.code === 'auth/email-already-exists') throw new ConflictException('El email ya está registrado.');
      throw new InternalServerErrorException('Error al crear usuario en Auth.');
    });

    // 2. Asignar Claims (Rol)
    // Nota: Agregamos un claim 'type: admin' para diferenciarlo de empleados
    await auth.setCustomUserClaims(userRecord.uid, { role: data.role, type: 'system_user' });

    // 3. Crear Perfil en Firestore
    const newUser: ISystemUser = {
      uid: userRecord.uid,
      email: data.email,
      displayName: data.displayName,
      role: data.role,
      status: 'Active',
      createdAt: admin.firestore.Timestamp.now()
    };

    await db.collection(COLL_SYSTEM_USERS).doc(userRecord.uid).set(newUser);
    
    return newUser;
  }

  /**
   * Obtener todos los administradores.
   */
  async findAll(): Promise<ISystemUser[]> {
    const snapshot = await this.getDb().collection(COLL_SYSTEM_USERS).get();
    return snapshot.docs.map(doc => doc.data() as ISystemUser);
  }

  /**
   * Actualizar datos (Rol o Estado).
   */
  async updateSystemUser(uid: string, data: Partial<ISystemUser>): Promise<void> {
    const auth = this.getAuth();
    const db = this.getDb();

    // Si cambia el rol, actualizar Auth
    if (data.role) {
        await auth.setCustomUserClaims(uid, { role: data.role, type: 'system_user' });
    }

    // Si se desactiva, deshabilitar en Auth
    if (data.status) {
        await auth.updateUser(uid, { disabled: data.status === 'Inactive' });
    }

    // Actualizar Firestore
    const safeData = { ...data };
    delete (safeData as any).uid;
    delete (safeData as any).email; // No cambiamos email por aquí
    
    await db.collection(COLL_SYSTEM_USERS).doc(uid).update(safeData);
  }

  /**
   * Eliminar administrador.
   */
  async deleteSystemUser(uid: string): Promise<void> {
    await this.getAuth().deleteUser(uid);
    await this.getDb().collection(COLL_SYSTEM_USERS).doc(uid).delete();
  }
}



