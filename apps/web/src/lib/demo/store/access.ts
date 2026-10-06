/**
 * Siapa yang boleh "Mulai ulang data demo" per RS (ADR-0085): posisi admin SIM RS dan manajemen, atau Superadmin
 * demo (apa pun posisi yang sedang dibawakannya). Hanya tampilan dan Server Action mode presentasi.
 */
export const RESET_ROLES: readonly string[] = ['admin_tenant', 'manajemen'];

export function canResetDemoData(s: {
  role: { code: string } | null;
  demoAllAccess?: { baseRole: { code: string } | null } | undefined;
}): boolean {
  if (s.demoAllAccess) return true;
  return !!s.role && RESET_ROLES.includes(s.role.code);
}
