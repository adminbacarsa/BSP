/** Portal guardia (Expo web) servido en el mismo origen que web2 — /app */
export const EMPLOYEE_APP_BASE = '/app';

function withTrailingSlash(path: string): string {
  if (!path.endsWith('/')) return `${path}/`;
  return path;
}

/** URL del portal guardia web (Firebase Hosting + dev en public/app). */
export function employeeAppPath(subpath = '', search = ''): string {
  const clean = subpath.replace(/^\/+/, '').replace(/\/+$/, '');
  let path = clean ? `${EMPLOYEE_APP_BASE}/${clean}/` : withTrailingSlash(EMPLOYEE_APP_BASE);
  if (search) {
    const q = search.startsWith('?') ? search : `?${search}`;
    path = `${path.replace(/\/$/, '')}${q}`;
  }
  return path;
}

/** Convierte rutas legacy /empleado/* → /app/* conservando query string. */
export function mapLegacyEmpleadoToApp(asPath: string): string {
  const [pathname, search = ''] = asPath.split('?');
  const params = new URLSearchParams(search);
  const normalized = pathname.replace(/\/+$/, '') || '/empleado/dashboard';

  if (normalized === '/empleado/dashboard' || normalized === '/empleado') {
    const preview = params.get('preview');
    const picker = params.get('picker');
    const notif = params.get('notif');
    if (preview) {
      params.delete('preview');
      const rest = params.toString();
      const q = new URLSearchParams({ emp: preview });
      if (notif) q.set('notif', notif);
      if (rest) rest.split('&').forEach((p) => {
        const [k, v] = p.split('=');
        if (k && k !== 'preview' && k !== 'picker') q.set(k, v ?? '');
      });
      return employeeAppPath('preview', q.toString());
    }
    if (picker === '1') {
      params.delete('picker');
      const rest = params.toString();
      return employeeAppPath('preview', rest);
    }
    return employeeAppPath('', params.toString());
  }

  if (normalized === '/empleado/activar' || normalized.startsWith('/empleado/activar/')) {
    return employeeAppPath('activar', params.toString());
  }

  if (normalized === '/empleado/app-preview') {
    const empId = params.get('emp') || params.get('preview');
    if (empId) {
      return employeeAppPath('preview', `emp=${encodeURIComponent(empId)}`);
    }
    return employeeAppPath('preview', params.toString());
  }

  const suffix = normalized.replace(/^\/empleado\/?/, '');
  return employeeAppPath(suffix, params.toString());
}

/** Destino por defecto para push / FCM web. */
export const EMPLOYEE_APP_HOME = employeeAppPath('');
