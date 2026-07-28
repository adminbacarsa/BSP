export * from '@cosp/portal-types';
export { createPortalFirebase, validateFirebaseConfig } from './firebase/createPortalFirebase';
export type { PortalFirebase } from './firebase/createPortalFirebase';
export { createPortalCallables } from './callables';
export type { PortalCallables } from './callables';
export { PORTAL_CALLABLES } from './callables/names';
export type { PortalCallableName } from './callables/names';
export { resolveEmpDocId } from './empleado/resolveEmpDocId';
export { toDate, formatDateAr, formatTimeAr } from './utils/dates';
