import { createPortalFirebase, validateFirebaseConfig } from '@cosp/portal-core';
import type { PortalFirebase } from '@cosp/portal-core';
import { getPortalCoreConfig } from './portalConfig';

let portalFirebase: PortalFirebase | null = null;

export function getPortalFirebase(): PortalFirebase {
  if (!portalFirebase) {
    const config = getPortalCoreConfig();
    portalFirebase = createPortalFirebase(config);
  }
  return portalFirebase;
}

export function getFirebaseHealth(): {
  configured: boolean;
  missing: string[];
  emulator: boolean;
  emulatorConnected: boolean;
  projectId: string;
} {
  const config = getPortalCoreConfig();
  const validation = validateFirebaseConfig(config);
  const fb = getPortalFirebase();

  return {
    configured: validation.ok,
    missing: validation.missing,
    emulator: config.useEmulator,
    emulatorConnected: fb.isEmulatorConnected(),
    projectId: config.firebase.projectId || '(sin projectId)',
  };
}
