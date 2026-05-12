"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulingModule = void 0;
const common_1 = require("@nestjs/common");
const scheduling_service_1 = require("./scheduling.service");
const shift_overlap_service_1 = require("./shift-overlap.service");
const workload_service_1 = require("./workload.service");
const audit_service_1 = require("./audit.service");
const geofencing_service_1 = require("./geofencing.service");
const pattern_service_1 = require("./pattern.service");
const data_management_module_1 = require("../data-management/data-management.module");
let SchedulingModule = class SchedulingModule {
};
exports.SchedulingModule = SchedulingModule;
exports.SchedulingModule = SchedulingModule = __decorate([
    (0, common_1.Module)({
        imports: [
            (0, common_1.forwardRef)(() => data_management_module_1.DataManagementModule)
        ],
        providers: [
            scheduling_service_1.SchedulingService,
            shift_overlap_service_1.ShiftOverlapService,
            workload_service_1.WorkloadService,
            audit_service_1.AuditService,
            geofencing_service_1.GeofencingService,
            pattern_service_1.PatternService
        ],
        exports: [
            scheduling_service_1.SchedulingService,
            workload_service_1.WorkloadService,
            audit_service_1.AuditService,
            pattern_service_1.PatternService
        ],
    })
], SchedulingModule);
//# sourceMappingURL=scheduling.module.js.map