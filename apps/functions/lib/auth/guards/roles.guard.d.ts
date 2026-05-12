import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IEmployee } from '../../common/interfaces/employee.interface';
import 'reflect-metadata';
export declare const ROLES_KEY = "roles";
export declare const Roles: (...roles: IEmployee["role"][]) => (target: any, key?: any, descriptor?: any) => void;
export declare class RolesGuard implements CanActivate {
    private reflector;
    constructor(reflector: Reflector);
    canActivate(context: ExecutionContext): boolean;
}
