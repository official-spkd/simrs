import { newId, SYSTEM_ROLES, type SystemRoleCode } from '@simrs/shared';
import {
  encryptField,
  type KeyRing,
  generateTemporaryPassword,
  generateTotpSecret,
  hashPassword,
} from '@simrs/shared/node';
import { ensureSystemRoles } from './authz';
import { type PrismaClient, withTenant } from './client';
import {
  PRESENTATION_ALL_ACCESS_LABEL,
  PRESENTATION_PERSONAS,
  PRESENTATION_USERNAME_PREFIX,
} from './seed-data';

export { PRESENTATION_ALL_ACCESS_LABEL, PRESENTATION_PERSONAS, PRESENTATION_USERNAME_PREFIX };

/** Kredensial satu akun presentasi (hanya untuk berkas lokal `.local/demo-accounts.json`). */
export interface PresentationCredential {
  username: string;
  password: string;
  /** Rahasia TOTP base32 (agar web bisa masuk otomatis dengan kode verifikasi yang sah). */
  totpSecret: string;
  displayName: string;
  role: string;
  roleName: string;
  unitName: string | null;
  /**
   * Posisi Superadmin demo (ADR-0023 keputusan 10): web di mode presentasi membuka semua layar untuk akun ini. Tanda
   * hanya ada di berkas lokal; di database akun ini akun biasa dengan satu penugasan `role`.
   */
  allAccess?: true;
}

/**
 * Buat atau perbarui akun presentasi (ADR-0023): satu akun per posisi, sandi acak 20 karakter, faktor TOTP baru yang
 * langsung terkonfirmasi, tanpa wajib ganti sandi, satu penugasan sesuai persona. Dipanggil sebagai pemilik tabel
 * (migrator) oleh CLI lokal dan penyiapan E2E; kredensial lama selalu diganti (tidak ada sandi bawaan yang tetap).
 */
export async function upsertPresentationAccounts(
  prisma: PrismaClient,
  tenantId: string,
  opts: ({ encKeyB64: string } | { encRing: KeyRing }) & { personas?: typeof PRESENTATION_PERSONAS },
): Promise<PresentationCredential[]> {
  const personas = opts.personas ?? PRESENTATION_PERSONAS;
  // argon2id lambat: hitung di luar transaksi.
  const prepared = await Promise.all(
    personas.map(async (p) => {
      const password = generateTemporaryPassword(20);
      return { p, password, passwordHash: await hashPassword(password), totpSecret: generateTotpSecret() };
    }),
  );
  const creds: PresentationCredential[] = [];
  await withTenant(
    prisma,
    tenantId,
    async (tx) => {
      const roles = await ensureSystemRoles(tx, tenantId, 'hospital');
      const units = new Map(
        (await tx.unit.findMany({ select: { id: true, code: true, name: true } })).map((u) => [u.code, u]),
      );
      const now = new Date();
      for (const { p, password, passwordHash, totpSecret } of prepared) {
        const roleId = roles.get(p.role);
        if (!roleId) throw new Error(`Peran ${p.role} tidak tersedia`);
        const unit = p.unitCode ? (units.get(p.unitCode) ?? null) : null;
        const username = `${PRESENTATION_USERNAME_PREFIX}${p.slug}`;
        const existing = await tx.user.findFirst({ where: { username }, select: { id: true } });
        const userId = existing?.id ?? newId();
        if (existing) {
          await tx.user.update({
            where: { id: userId },
            data: {
              displayName: p.displayName,
              status: 'active',
              mustChangePassword: false,
              failedLoginCount: 0,
              lockedUntil: null,
            },
          });
          await tx.userCredential.update({ where: { userId }, data: { passwordHash } });
        } else {
          await tx.user.create({
            data: { id: userId, tenantId, username, displayName: p.displayName, mustChangePassword: false },
          });
          await tx.userCredential.create({ data: { userId, tenantId, passwordHash } });
        }
        await tx.mfaFactor.updateMany({ where: { userId, disabledAt: null }, data: { disabledAt: now } });
        await tx.mfaFactor.create({
          data: {
            id: newId(),
            tenantId,
            userId,
            secretEnc: encryptField(totpSecret, {
              ...('encRing' in opts ? { ring: opts.encRing } : { keyB64: opts.encKeyB64 }),
              tenantId,
              purpose: 'mfa_secret',
            }),
            confirmedAt: now,
          },
        });
        // Tepat satu penugasan aktif sesuai persona. Penugasan lain diakhiri, mis. yang tanpa unit karena struktur
        // RS baru di-seed setelah akun dibuat: dua posisi membuat masuk cepat berhenti di langkah "Pilih posisi".
        const active = await tx.staffAssignment.findMany({
          where: { userId, OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
          select: { id: true, roleId: true, unitId: true, validFrom: true },
        });
        const isPersona = (a: (typeof active)[number]) =>
          a.roleId === roleId && a.unitId === (unit?.id ?? null);
        for (const a of active.filter((x) => !isPersona(x))) {
          await tx.staffAssignment.update({
            where: { id: a.id },
            // Belum mulai → rentang kosong (CHECK valid_until >= valid_from).
            data: {
              validUntil: a.validFrom > now ? a.validFrom : now,
              endReason: 'Akun presentasi: diganti penugasan sesuai persona',
            },
          });
        }
        if (!active.some(isPersona)) {
          await tx.staffAssignment.create({
            data: { id: newId(), tenantId, userId, roleId, unitId: unit?.id ?? null },
          });
        }
        await tx.auditEvent.create({
          data: {
            id: newId(),
            tenantId,
            resourceType: 'user',
            resourceId: userId,
            action: existing ? 'update' : 'create',
            details: {
              via: 'cli',
              presentasi: true,
              role: p.role,
              ...(p.allAccess ? { allAccess: true } : {}),
            },
          },
        });
        creds.push({
          username,
          password,
          totpSecret,
          displayName: p.displayName,
          role: p.role,
          roleName: p.allAccess
            ? PRESENTATION_ALL_ACCESS_LABEL
            : (SYSTEM_ROLES[p.role as SystemRoleCode] ?? p.role),
          unitName: unit?.name ?? null,
          ...(p.allAccess ? { allAccess: true as const } : {}),
        });
      }
    },
    { timeoutMs: 120_000 },
  );
  return creds;
}
