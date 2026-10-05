import {
  createPrismaClient,
  generateScheduleSessions,
  seedFrontOffice,
  seedHospitalStructure,
  withTenant,
} from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { isoDateJakarta } from '@simrs/shared';
import { inTenant, TENANTS } from './accounts';

/**
 * F01 · Data jadwal E2E di RSFA uji: struktur RS + front office seed (poli PD/JT/SR/PR, dokter fiktif dengan kode HFIS
 * 99001–99006, templat mingguan) lalu sesi 30 hari, seperti `pnpm db:seed` + job `scheduling.generate-sessions`.
 * Idempoten (aman dipanggil banyak spesifikasi sekaligus).
 */
export async function ensureRsfaSchedule(): Promise<void> {
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    // Worker Playwright paralel bisa menyemai bersamaan: upsert yang kalah balapan (unik) cukup diulang.
    for (let attempt = 1; ; attempt++) {
      try {
        await withTenant(owner, TENANTS.RSFA, (tx) => seedHospitalStructure(tx, TENANTS.RSFA), {
          maxWaitMs: 20_000,
        });
        await seedFrontOffice(owner, TENANTS.RSFA);
        break;
      } catch (err) {
        if (attempt >= 3) throw err;
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
  } finally {
    await owner.$disconnect();
  }
  await inTenant(TENANTS.RSFA, (tx) =>
    generateScheduleSessions(tx, TENANTS.RSFA, { from: isoDateJakarta(new Date()), days: 30 }),
  );
}

/** Kuota sesi praktik dokter (awalan nama) pada tanggal itu. */
export function sessionQuota(namePrefix: string, date: string) {
  return inTenant(TENANTS.RSFA, (tx) =>
    tx.scheduleSession.findFirstOrThrow({
      where: {
        practitioner: { name: { startsWith: namePrefix } },
        sessionDate: new Date(`${date}T00:00:00.000Z`),
      },
      select: { id: true, quotaJkn: true, quotaNonJkn: true, bookedJkn: true },
    }),
  );
}

/** Pesan outbox `bpjs.hfis.update` RSFA yang dibuat sejak waktu ini. */
export function hfisUpdateMessages(since: Date) {
  return inTenant(TENANTS.RSFA, (tx) =>
    tx.outboxMessage.findMany({
      where: { operation: 'bpjs.hfis.update', createdAt: { gte: since } },
      select: { status: true, payload: true },
    }),
  );
}
