import Constants from 'expo-constants';
import * as Linking from 'expo-linking';

export function buildMobilePreviewDeepLink(empDocId: string): string {
  const trimmed = empDocId.trim();
  const customBase = process.env.EXPO_PUBLIC_MOBILE_PREVIEW_LINK_BASE?.trim();
  if (customBase) {
    const separator = customBase.includes('?') ? '&' : '?';
    return `${customBase}${separator}emp=${encodeURIComponent(trimmed)}`;
  }

  const schemeRaw = Constants.expoConfig?.scheme;
  const scheme = Array.isArray(schemeRaw) ? schemeRaw[0] : schemeRaw ?? 'cosp-guardia';

  return Linking.createURL('/preview', {
    queryParams: { emp: trimmed },
    scheme,
  });
}

export function parsePreviewEmpFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = Linking.parse(url);
    const emp = parsed.queryParams?.emp;
    if (typeof emp === 'string' && emp.trim()) return emp.trim();
    if (Array.isArray(emp) && typeof emp[0] === 'string' && emp[0].trim()) return emp[0].trim();
    const preview = parsed.queryParams?.preview;
    if (typeof preview === 'string' && preview.trim()) return preview.trim();
    if (Array.isArray(preview) && typeof preview[0] === 'string' && preview[0].trim()) return preview[0].trim();
  } catch {
    /* ignore malformed urls */
  }
  return null;
}
