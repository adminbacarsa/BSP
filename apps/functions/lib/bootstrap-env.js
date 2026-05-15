"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const dotenv = require("dotenv");
if (process.env.FUNCTIONS_EMULATOR === 'true') {
    dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
}
//# sourceMappingURL=bootstrap-env.js.map