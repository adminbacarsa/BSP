import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { DataManagementModule } from './data-management/data-management.module';

@Module({
  imports: [
    AuthModule,
    SchedulingModule, // Este módulo ahora exporta PatternService correctamente
    DataManagementModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}



