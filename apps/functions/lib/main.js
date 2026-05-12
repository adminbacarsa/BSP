"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNestApp = createNestApp;
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
async function createNestApp() {
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule, { logger: false });
    await app.init();
    return app;
}
//# sourceMappingURL=main.js.map