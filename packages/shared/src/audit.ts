/** Aksi audit yang dikenal (P04). Tambahkan di sini, jangan mengarang string di modul. */
export const AUDIT_ACTIONS = [
  'read',
  'search',
  'create',
  'update',
  'deactivate',
  'print',
  'export',
  'verify',
  'login',
  'login_failed',
  'logout',
  'mfa_enrolled',
  'access_denied',
  'break_glass',
  'merge',
  'unmerge',
  'correct',
  'sign',
  'review',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OUTCOMES = ['success', 'denied'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
