import * as path from 'path';
import * as dotenv from 'dotenv';

const inEmulator =
  process.env.FUNCTIONS_EMULATOR === 'true' ||
  Boolean(process.env.FIREBASE_EMULATOR_HUB) ||
  Boolean(process.env.FIRESTORE_EMULATOR_HOST);

if (inEmulator) {
  const base = path.resolve(__dirname, '..');
  dotenv.config({ path: path.join(base, '.env') });
  dotenv.config({ path: path.join(base, '.env.local') });
}
