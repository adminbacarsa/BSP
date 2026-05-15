"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const dotenv = require("dotenv");
if (process.env.FUNCTIONS_EMULATOR === 'true') {
    const base = path.resolve(__dirname, '..');
    dotenv.config({ path: path.join(base, '.env') });
    dotenv.config({ path: path.join(base, '.env.local') });
}
//# sourceMappingURL=bootstrap-env.js.map