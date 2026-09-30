/**
 * Preview SuperAdmin de un eventual. No habilita a otros roles:
 * un eventual solo ve su bolsa; un admin/operador no puede pasar bolsaCuil ni asEmployeeId.
 */

function normRole(role: unknown): string {
  return String(role ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
}

export function isEventualPreviewSuperAdmin(role: unknown, type?: unknown): boolean {
  const ok = (v: string) => v === 'SUPERADMIN' || v === 'SUPER_ADMIN' || v === 'SP';
  return ok(normRole(role)) || ok(normRole(type));
}

/**
 * Dueño de la bolsa gana siempre (aunque mande otro CUIL).
 * SuperAdmin sin bolsa propia puede pedir `bolsaCuil` (preview). El resto, no.
 */
export function resolveBolsaCuilForListar(input: {
  isSuperAdmin: boolean;
  ownBolsaCuil: string | null;
  requestedBolsaCuil: string | null;
}): { bolsaCuil: string; preview: boolean } | null {
  const own = String(input.ownBolsaCuil || '').trim();
  if (own) return { bolsaCuil: own, preview: false };
  const requested = String(input.requestedBolsaCuil || '').trim();
  if (input.isSuperAdmin && requested) return { bolsaCuil: requested, preview: true };
  return null;
}

/** Responder una convocatoria ajena solo si SuperAdmin y el asEmployeeId es el candidato. */
export function canRespondCoberturaAsPreview(input: {
  isSuperAdmin: boolean;
  asEmployeeId: string | null;
  candidateEmployeeId: string | null;
}): boolean {
  const asId = String(input.asEmployeeId || '').trim();
  const candidate = String(input.candidateEmployeeId || '').trim();
  return input.isSuperAdmin && !!asId && asId === candidate;
}

/**
 * Fichada en preview: con asEmployeeId el SuperAdmin solo ficha el turno de ESE legajo.
 * Sin asEmployeeId se mantiene el comportamiento actual (cualquier turno).
 * Otro rol: asEmployeeId se ignora.
 */
export function resolvePreviewCheckIn(input: {
  isSuperAdmin: boolean;
  asEmployeeId: string | null;
  shiftEmployeeId: string;
}): { scoped: true; empId: string } | { scoped: false } | { deny: true } {
  const asId = String(input.asEmployeeId || '').trim();
  if (!input.isSuperAdmin || !asId) return { scoped: false };
  if (String(input.shiftEmployeeId || '') !== asId) return { deny: true };
  return { scoped: true, empId: asId };
}
