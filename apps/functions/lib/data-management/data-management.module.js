"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataManagementModule = void 0;
const common_1 = require("@nestjs/common");
const data_management_service_1 = require("./data-management.service");
const client_service_1 = require("./client.service");
const employee_service_1 = require("./employee.service");
const system_user_service_1 = require("./system-user.service");
const absence_service_1 = require("./absence.service");
const labor_agreement_service_1 = require("./labor-agreement.service");
const scheduling_module_1 = require("../scheduling/scheduling.module");
let DataManagementModule = class DataManagementModule {
};
exports.DataManagementModule = DataManagementModule;
exports.DataManagementModule = DataManagementModule = __decorate([
    (0, common_1.Module)({
        imports: [
            (0, common_1.forwardRef)(() => scheduling_module_1.SchedulingModule)
        ],
        providers: [
            data_management_service_1.DataManagementService,
            client_service_1.ClientService,
            employee_service_1.EmployeeService,
            system_user_service_1.SystemUserService,
            absence_service_1.AbsenceService,
            labor_agreement_service_1.LaborAgreementService
        ],
        exports: [
            data_management_service_1.DataManagementService,
            client_service_1.ClientService,
            employee_service_1.EmployeeService,
            system_user_service_1.SystemUserService,
            absence_service_1.AbsenceService,
            labor_agreement_service_1.LaborAgreementService
        ],
    })
], DataManagementModule);
//# sourceMappingURL=data-management.module.js.map