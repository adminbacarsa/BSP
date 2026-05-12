import { Module, forwardRef } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { ShiftOverlapService } from './shift-overlap.service';
import { WorkloadService } from './workload.service'; // 🛑 Correcto: Importa la clase
import { AuditService } from './audit.service';
import { GeofencingService } from './geofencing.service';
import { PatternService } from './pattern.service';
import { DataManagementModule } from '../data-management/data-management.module';

@Module({
  imports: [
    forwardRef(() => DataManagementModule)
  ],
  providers: [
    SchedulingService,
    ShiftOverlapService,
    WorkloadService,
    AuditService,
    GeofencingService,
    PatternService 
  ],
  exports: [
    SchedulingService,
    WorkloadService, // 🛑 CORRECTO: Exportado para que AbsenceService lo pueda inyectar
    AuditService,
    PatternService 
  ],
})
export class SchedulingModule {}



