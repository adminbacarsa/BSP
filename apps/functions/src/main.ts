import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { INestApplicationContext } from '@nestjs/common';

/**
 * @async
 * @function createNestApp
 * @description Inicializa la aplicación NestJS y retorna el Módulo de Referencia.
 * @returns {Promise<INestApplicationContext>} El contexto de aplicación.
 */
export async function createNestApp(): Promise<INestApplicationContext> {
  // Usamos createApplicationContext para obtener el contexto de DI sin listener HTTP
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  
  await app.init();
  return app;
}



