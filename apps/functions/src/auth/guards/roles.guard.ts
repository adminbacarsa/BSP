// apps/functions/src/auth/guards/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IEmployee } from '../../common/interfaces/employee.interface'; // 🛑 RUTA FINAL: Retrocede 2 niveles
import 'reflect-metadata'; 

// ... (resto del código permanece igual)

// 1. Decorador para definir los roles requeridos
export const ROLES_KEY = 'roles';
export const Roles = (...roles: IEmployee['role'][]) => 
  (target: any, key?: any, descriptor?: any) => {
    // Uso corregido de Reflect (Solución TS2339)
    Reflect.defineMetadata(ROLES_KEY, roles, descriptor.value || target);
  };


@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<IEmployee['role'][]>(
      ROLES_KEY,
      context.getHandler(),
    );

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userRole = request.context?.auth?.token?.role;

    if (!userRole) {
        return false;
    }

    return requiredRoles.some((role) => role === userRole);
  }
}



