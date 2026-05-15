import * as path from 'path';
import * as dotenv from 'dotenv';

if (process.env.FUNCTIONS_EMULATOR === 'true') {
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
}
