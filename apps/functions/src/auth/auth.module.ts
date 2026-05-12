import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * @module AuthModule
 * @description Módulo encargado de la creación de usuarios, asignación de roles (Custom Claims)
 * y gestión de perfiles en la colección 'empleados'.
 */
@Module({
  imports: [],
  providers: [AuthService],
  exports: [AuthService], // Exportamos el servicio para que otros módulos lo utilicen.
})
export class AuthModule {}



