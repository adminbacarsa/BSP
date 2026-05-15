import * as path from 'path';
import * as dotenv from 'dotenv';

if (process.env.FUNCTIONS_EMULATOR === 'true') {
  const base = path.resolve(__dirname, '..');
  dotenv.config({ path: path.join(base, '.env') });
  dotenv.config({ path: path.join(base, '.env.local') });
}
