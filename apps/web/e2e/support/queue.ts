import { type createPrismaClient, QUEUE_NUMBER_MAX, withTenant } from '@simrs/db';

type Prisma = ReturnType<typeof createPrismaClient>;

/** Sisa nomor antrean per layanan per hari yang dianggap aman untuk satu putaran E2E. */
const MIN_HEADROOM = 150;

/**
 * Fixture antrean E2E (ADR-0109). Nomor tiket berasal dari urutan P08 `number_sequences` (`queue_<id layanan>` per
 * tanggal), dan fixture spesifikasi selalu memakai `allocateQueueNumber` (tidak pernah menulis `seq` sendiri). Sebelum
 * suite berjalan, urutan hari ini dan besok disamakan dengan nomor tiket terbesar yang sudah ada di DB slot ini: tiket
 * tanpa baris urutan (mis. DB slot yang dipakai ulang atau dipulihkan) tidak lagi membuat API memberi nomor yang
 * sudah terpakai (409). Urutan yang tertinggal hanya dinaikkan, tidak pernah diturunkan. Layanan yang sisa nomornya
 * tinggal sedikit dilaporkan agar operator slot tahu sebelum suite gagal 409 `QUEUE_FULL`.
 */
export async function reconcileQueueSequences(prisma: Prisma, tenantId: string): Promise<void> {
  const low = await withTenant(prisma, tenantId, async (tx) => {
    await tx.$executeRaw`
      INSERT INTO number_sequences (tenant_id, kind, period, last_value, updated_at)
      SELECT t.tenant_id, 'queue_' || replace(t.service_id::text, '-', ''), to_char(t.service_date, 'YYMMDD'),
             max(t.seq), now()
      FROM queue_tickets t
      WHERE t.tenant_id = ${tenantId}::uuid
        AND t.service_date >= (now() AT TIME ZONE 'Asia/Jakarta')::date
      GROUP BY t.tenant_id, t.service_id, t.service_date
      ON CONFLICT (tenant_id, kind, period)
      DO UPDATE SET last_value = GREATEST(number_sequences.last_value, EXCLUDED.last_value), updated_at = now()`;
    return tx.$queryRaw<Array<{ kind: string; period: string; last_value: bigint }>>`
      SELECT kind, period, last_value FROM number_sequences
      WHERE tenant_id = ${tenantId}::uuid AND kind LIKE 'queue\\_%'
        AND period = to_char((now() AT TIME ZONE 'Asia/Jakarta')::date, 'YYMMDD')
        AND last_value > ${QUEUE_NUMBER_MAX - MIN_HEADROOM}`;
  });
  for (const r of low) {
    console.warn(
      `[e2e] Nomor antrean ${r.kind} (${r.period}) di DB slot ini sudah ${r.last_value}/${QUEUE_NUMBER_MAX}; ` +
        'spesifikasi antrean bisa gagal 409 QUEUE_FULL hari ini. Pakai DB slot baru atau jalankan besok.',
    );
  }
}
