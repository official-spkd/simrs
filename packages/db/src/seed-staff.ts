import { newId } from '@simrs/shared';
import { encryptField } from '@simrs/shared/node';
import { knownDbError, type PrismaClient, withTenant } from './client';
import { SEED_STAFF, SEED_STAFF_VALID_FROM, type SeedStaffMember, seedStaffPhone } from './seed-data';

export interface SeedStaffResult {
  /** Akun staf yang baru dibuat. */
  created: number;
  /** Akun yang sudah ada (NIP sudah dipakai di RS ini): tidak disentuh sama sekali. */
  existing: number;
}

/**
 * Fase 1 potongan 10d · Staf fiktif per RS (`SEED_STAFF`) beserta penugasannya (peran × unit, berlaku sejak
 * `SEED_STAFF_VALID_FROM`) dan no. HP terenkripsi (`staff_phone`).
 *
 * TANPA kata sandi bawaan: tidak ada baris `user_credentials` dan tidak ada faktor MFA, sehingga login ditolak
 * seperti akun tak dikenal. Staf baru bisa masuk setelah admin SIM RS memberi sandi sementara ("Reset kata sandi" di
 * layar Akses, sekali tampil), lalu login pertama mewajibkan daftar MFA dan ganti sandi, sama dengan undangan biasa.
 *
 * Idempoten dengan kunci alami NIP (= nama pengguna, unik per RS): akun yang sudah ada dilewati utuh, jadi
 * perubahan admin (nonaktif, reset, penugasan diakhiri) tidak pernah ditimpa seed. Satu transaksi per staf
 * (akun + penugasan + jejak audit `create` atomik); dua seed yang berjalan bersamaan tidak menggandakan akun.
 * Dipanggil sebagai pemilik tabel (simrs_migrator) lewat `withTenant` karena FORCE RLS; 16 peran bawaan
 * (`ensureSystemRoles`) dan struktur RS (`seedHospitalStructure`) harus sudah ada.
 */
export async function seedStaff(
  prisma: PrismaClient,
  tenantId: string,
  opts: { encKeyB64: string; staff?: readonly SeedStaffMember[] },
): Promise<SeedStaffResult> {
  const staff = opts.staff ?? SEED_STAFF;
  const validFrom = new Date(SEED_STAFF_VALID_FROM);
  const { roles, units } = await withTenant(prisma, tenantId, async (tx) => ({
    roles: new Map((await tx.role.findMany({ select: { id: true, code: true } })).map((r) => [r.code, r.id])),
    units: new Map((await tx.unit.findMany({ select: { id: true, code: true } })).map((u) => [u.code, u.id])),
  }));
  // Periksa semua rujukan sebelum menulis apa pun: peran/struktur RS yang belum di-seed gagal di awal, bukan
  // setengah jalan. Peran tidak dibuat di sini (`ensureSystemRoles` tidak aman dijalankan bersamaan untuk RS baru).
  const positionsOf = (s: SeedStaffMember) =>
    s.positions.map(([role, unitCode]) => {
      const roleId = roles.get(role);
      if (!roleId) throw new Error(`Peran ${role} belum ada (jalankan ensureSystemRoles lebih dulu)`);
      const unitId = unitCode === null ? null : units.get(unitCode);
      if (unitId === undefined)
        throw new Error(`Unit seed ${unitCode} belum ada (seed struktur RS lebih dulu)`);
      return { role, roleId, unitId };
    });
  const plan = staff.map((s) => ({ s, positions: positionsOf(s) }));

  const result: SeedStaffResult = { created: 0, existing: 0 };
  for (const { s, positions } of plan) {
    const phoneEnc = encryptField(seedStaffPhone(s), {
      keyB64: opts.encKeyB64,
      tenantId,
      purpose: 'staff_phone',
    });
    try {
      const created = await withTenant(prisma, tenantId, async (tx) => {
        if (await tx.user.findFirst({ where: { username: s.nip }, select: { id: true } })) return false;
        const userId = newId();
        await tx.user.create({
          data: {
            id: userId,
            tenantId,
            username: s.nip,
            displayName: s.displayName,
            phoneEnc,
            status: 'active',
            mustChangePassword: true,
          },
        });
        await tx.staffAssignment.createMany({
          data: positions.map((p) => ({
            id: newId(),
            tenantId,
            userId,
            roleId: p.roleId,
            unitId: p.unitId,
            validFrom,
          })),
        });
        await tx.auditEvent.create({
          data: {
            id: newId(),
            tenantId,
            resourceType: 'user',
            resourceId: userId,
            action: 'create',
            details: { via: 'seed', roles: positions.map((p) => p.role) },
          },
        });
        return true;
      });
      if (created) result.created++;
      else result.existing++;
    } catch (err) {
      // Seed lain membuat NIP yang sama bersamaan (unik per RS): akun itu sudah ada, bukan galat.
      if (knownDbError(err)?.code !== 'P2002') throw err;
      result.existing++;
    }
  }
  return result;
}
