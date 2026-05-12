import { Module, forwardRef } from '@nestjs/common';
import { DataManagementService } from './data-management.service';
import { ClientService } from './client.service';
import { EmployeeService } from './employee.service';
import { SystemUserService } from './system-user.service';
import { AbsenceService } from './absence.service';
import { LaborAgreementService } from './labor-agreement.service'; // 🛑 NUEVO SERVICIO
// Importamos el módulo de agendamiento
import { SchedulingModule } from '../scheduling/scheduling.module';

@Module({
  imports: [
    // Usamos forwardRef para romper el ciclo con Scheduling
    forwardRef(() => SchedulingModule)
  ],
  providers: [
    DataManagementService,
    ClientService,
    EmployeeService,
    SystemUserService,
    AbsenceService,
    LaborAgreementService // 🛑 REGISTRADO
  ],
  exports: [
    DataManagementService,
    ClientService,
    EmployeeService,
    SystemUserService,
    AbsenceService,
    LaborAgreementService // 🛑 EXPORTADO
  ],
})
export class DataManagementModule {}



