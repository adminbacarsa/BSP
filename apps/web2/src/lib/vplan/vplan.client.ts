/**
 * Cliente lab VPLAN — invoca callable vplanRun solo en emulador.
 * Sin wire en planificacion/index.tsx hasta sign-off (docs/VPLAN.md).
 */

import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import type { VplanRunRequest, VplanRunResponse } from './vplan.types';

const VPLAN_CALLABLE_TIMEOUT_MS = 125_000;

const vplanRunCallable = httpsCallable<VplanRunRequest, VplanRunResponse>(
  functions,
  'vplanRun',
  { timeout: VPLAN_CALLABLE_TIMEOUT_MS },
);

export async function runVplan(request: VplanRunRequest): Promise<VplanRunResponse> {
  try {
    const res = await vplanRunCallable(request);
    return res.data;
  } catch (e: unknown) {
    if (e instanceof FirebaseError) {
      throw new Error(e.message);
    }
    throw e;
  }
}
