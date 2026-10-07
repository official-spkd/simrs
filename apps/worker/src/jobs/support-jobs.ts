import { notifyStaff, readTenantSetting, type TenantTx } from '@simrs/db';
import { isoDateJakarta, newId } from '@simrs/shared';
import { recordDomainEvent } from '../infra/domain-events';
import type { PeriodicJob } from './periodic-job-types';

/**
 * Fase 4 §4.1a · Job P11 penunjang:
 * - `critical.escalation` (tiap menit): nilai kritis yang belum dilaporkan dieskalasi pada batas waktu (tingkat 1) dan
 *   batas + langkah (tingkat 2), sekali per tingkat (indeks unik + ON CONFLICT, aman bila job berjalan ganda);
 * - `stock.expiry` dan `stock.below-minimum` (harian 00.05 WIB): ringkasan per depo ke petugas depo.
 * Notifikasi tanpa PHI (tanpa nama pasien/nilai/analit), tautan ke layar berizin.
 */

/** Pengguna aktif berpenugasan aktif yang perannya memegang izin ini; `unitId` membatasi ke penugasan di unit itu. */
async function holders(
  tx: TenantTx,
  resource: string,
  action: string,
  now: Date,
  unitId: string | null,
): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT a.user_id::text AS id
    FROM staff_assignments a
    JOIN role_permissions rp ON rp.tenant_id = a.tenant_id AND rp.role_id = a.role_id
    JOIN users u ON u.tenant_id = a.tenant_id AND u.id = a.user_id AND u.status = 'active'
    WHERE rp.resource = ${resource} AND rp.action = ${action}
      AND a.valid_from <= ${now} AND (a.valid_until IS NULL OR a.valid_until > ${now})
      AND (${unitId}::uuid IS NULL OR a.unit_id = ${unitId}::uuid)
    ORDER BY 1`;
  return rows.map((r) => r.id);
}

/** Tingkat eskalasi yang sudah jatuh tempo: 1 = batas lapor, 2 = batas + langkah. */
export function dueEscalationLevels(elapsedMs: number, limitMinutes: number, stepMinutes: number): number[] {
  const levels: number[] = [];
  if (elapsedMs >= limitMinutes * 60_000) levels.push(1);
  if (elapsedMs >= (limitMinutes + stepMinutes) * 60_000) levels.push(2);
  return levels;
}

/**
 * Penerima per tingkat (rencana §4.3; "kepala unit/ruangan" belum dimodelkan di struktur RS, jadi dipakai yang ada):
 * - tingkat 1: DPJP utama + perawat penanggung jawab kunjungan (tim perawatan aktif) + petugas unit pelapor yang
 *   memegang `critical_result:report`,
 * - tingkat 2: pemegang `critical_result:review` (manajemen/komite mutu).
 */
async function escalationRecipients(
  tx: TenantTx,
  c: { encounterId: string; unitId: string },
  level: number,
  now: Date,
): Promise<string[]> {
  if (level >= 2) return holders(tx, 'critical_result', 'review', now, null);
  const team = await tx.encounterParticipant.findMany({
    where: { encounterId: c.encounterId, endedAt: null, role: { in: ['dpjp_utama', 'perawat_pj'] } },
    select: { userId: true },
  });
  const reporters = await holders(tx, 'critical_result', 'report', now, c.unitId);
  return [...new Set([...team.map((t) => t.userId), ...reporters])];
}

export const criticalEscalationJob: PeriodicJob = {
  schedule: { everyMs: 60_000 },
  module: 'S09',
  async run({ tenantId, now, tx }) {
    await tx(async (t) => {
      const step = await readTenantSetting(t, 'critical.escalation_step_minutes');
      const open = await t.criticalResult.findMany({
        where: { status: 'terbuka', raisedAt: { lte: now } },
        select: {
          id: true,
          source: true,
          encounterId: true,
          patientId: true,
          unitId: true,
          limitMinutes: true,
          raisedAt: true,
          escalations: { select: { level: true } },
        },
        orderBy: { raisedAt: 'asc' },
        take: 500,
      });
      for (const c of open) {
        const done = new Set(c.escalations.map((e) => e.level));
        for (const level of dueEscalationLevels(now.getTime() - c.raisedAt.getTime(), c.limitMinutes, step)) {
          if (done.has(level)) continue;
          const recipients = await escalationRecipients(t, c, level, now);
          const id = newId();
          // Sekali per tingkat walau job berjalan ganda di dua worker: indeks unik (nilai kritis, tingkat).
          const inserted = await t.$queryRaw<Array<{ id: string }>>`
            INSERT INTO critical_result_escalations (id, tenant_id, critical_result_id, level, notified_user_ids)
            VALUES (${id}::uuid, ${tenantId}::uuid, ${c.id}::uuid, ${level}, ${recipients}::uuid[])
            ON CONFLICT (tenant_id, critical_result_id, level) DO NOTHING
            RETURNING id::text AS id`;
          if (!inserted[0]) continue;
          const minutes = level === 1 ? c.limitMinutes : c.limitMinutes + step;
          await notifyStaff(
            t,
            tenantId,
            recipients,
            {
              kind: 'critical_result.escalated',
              title: level === 1 ? 'Nilai kritis belum dilaporkan' : 'Eskalasi nilai kritis (tingkat 2)',
              body: `Nilai kritis ${c.source === 'lab' ? 'laboratorium' : 'radiologi'} belum dilaporkan ke dokter setelah ${minutes} menit. Buka untuk menindaklanjuti.`,
              link: `/penunjang/hasil-kritis?id=${c.id}`,
            },
            ['in_app', 'whatsapp'],
          );
          await recordDomainEvent(
            t,
            tenantId,
            'critical_result.escalated',
            {
              criticalResultId: c.id,
              encounterId: c.encounterId,
              patientId: c.patientId,
              unitId: c.unitId,
              level,
            },
            { occurredAt: now },
          );
        }
      }
    });
  },
};

/** Awal hari WIB dari `now` (penanda "sudah diberi tahu hari ini"). */
function startOfDayWib(now: Date): Date {
  return new Date(`${isoDateJakarta(now)}T00:00:00+07:00`);
}

/**
 * Kirim ringkasan per depo sekali sehari: penerima yang sudah menerima notifikasi jenis + tautan yang sama sejak
 * 00.00 WIB dilewati (aman bila job terulang).
 */
async function notifyDepotOnce(
  t: TenantTx,
  tenantId: string,
  now: Date,
  depot: { id: string; name: string; unitId: string },
  input: { kind: string; title: string; body: string },
): Promise<number> {
  const link = `/penunjang/depo?lokasi=${depot.id}`;
  const recipients = await holders(t, 'stock', 'read', now, depot.unitId);
  if (recipients.length === 0) return 0;
  const already = await t.notification.findMany({
    where: {
      kind: input.kind,
      link,
      recipientUserId: { in: recipients },
      createdAt: { gte: startOfDayWib(now) },
    },
    select: { recipientUserId: true },
  });
  const skip = new Set(already.map((a) => a.recipientUserId));
  const sent = await notifyStaff(
    t,
    tenantId,
    recipients.filter((r) => !skip.has(r)),
    { ...input, link },
    ['in_app'],
  );
  return sent.length;
}

export const stockExpiryJob: PeriodicJob = {
  schedule: { dailyAt: '00:05' },
  module: 'S05',
  async run({ tenantId, now, tx }) {
    await tx(async (t) => {
      const days = await readTenantSetting(t, 'stock.expiry_warning_days');
      const today = isoDateJakarta(now);
      const rows = await t.$queryRaw<
        Array<{ id: string; name: string; unit_id: string; expired: number; near: number }>
      >`
        SELECT l.id::text AS id, l.name, l.unit_id::text AS unit_id,
               count(*) FILTER (WHERE b.expiry_date < ${today}::date)::int AS expired,
               count(*) FILTER (WHERE b.expiry_date >= ${today}::date
                 AND b.expiry_date <= ${today}::date + ${days}::int)::int AS near
        FROM stock_balances s
        JOIN stock_locations l ON l.tenant_id = s.tenant_id AND l.id = s.stock_location_id AND l.active
        JOIN stock_batches b ON b.tenant_id = s.tenant_id AND b.id = s.stock_batch_id
        WHERE s.quantity > 0
        GROUP BY l.id, l.name, l.unit_id
        HAVING count(*) FILTER (WHERE b.expiry_date <= ${today}::date + ${days}::int) > 0
        ORDER BY l.name`;
      for (const r of rows) {
        await notifyDepotOnce(
          t,
          tenantId,
          now,
          { id: r.id, name: r.name, unitId: r.unit_id },
          {
            kind: 'stock.expiry',
            title: 'Batch mendekati atau lewat kedaluwarsa',
            body: `${r.name}: ${r.near} batch kedaluwarsa dalam ${days} hari, ${r.expired} batch sudah kedaluwarsa (tidak bisa diserahkan).`,
          },
        );
      }
    });
  },
};

export const stockBelowMinimumJob: PeriodicJob = {
  schedule: { dailyAt: '00:05' },
  module: 'S05',
  async run({ tenantId, now, tx }) {
    await tx(async (t) => {
      const today = isoDateJakarta(now);
      // Stok yang bisa dipakai = saldo batch belum kedaluwarsa.
      const rows = await t.$queryRaw<Array<{ id: string; name: string; unit_id: string; below: number }>>`
        SELECT l.id::text AS id, l.name, l.unit_id::text AS unit_id, count(*)::int AS below
        FROM formulary_stock_profiles p
        JOIN stock_locations l ON l.tenant_id = p.tenant_id AND l.id = p.stock_location_id AND l.active
        LEFT JOIN LATERAL (
          SELECT coalesce(sum(s.quantity), 0) AS qty
          FROM stock_balances s
          JOIN stock_batches b ON b.tenant_id = s.tenant_id AND b.id = s.stock_batch_id
          WHERE s.tenant_id = p.tenant_id AND s.stock_location_id = p.stock_location_id AND s.drug_id = p.drug_id
            AND b.expiry_date >= ${today}::date
        ) q ON true
        WHERE p.min_quantity > 0 AND q.qty < p.min_quantity
        GROUP BY l.id, l.name, l.unit_id
        ORDER BY l.name`;
      for (const r of rows) {
        await notifyDepotOnce(
          t,
          tenantId,
          now,
          { id: r.id, name: r.name, unitId: r.unit_id },
          {
            kind: 'stock.below_minimum',
            title: 'Stok di bawah minimum',
            body: `${r.name}: ${r.below} item obat/BMHP di bawah stok minimum.`,
          },
        );
      }
    });
  },
};
