/** Portal guardia web (Expo) en el mismo origen que el panel. */
export const EMPLOYEE_PORTAL_HOME = '/app/';

export function employeePortalInboxLink(notifDocId?: string | null): string {
  if (!notifDocId) return EMPLOYEE_PORTAL_HOME;
  return `/app/?notif=${encodeURIComponent(notifDocId)}`;
}
