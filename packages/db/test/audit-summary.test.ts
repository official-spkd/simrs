/**
 * P04 · Ringkasan harian temuan anomali (ADR-0072): hasil gabungan ringkasan + agregasi langsung hari ini SAMA
 * dengan agregasi langsung atas seluruh jendela; job idempoten; parameter berubah → kembali ke agregasi langsung;
 * isolasi tenant; append-only. Entri bertanggal lampau dibuat dengan menggeser `occurred_at` sebagai superuser
 * (tenant uji sendiri; rantai hash tenant itu memang rusak, tidak dipakai di sini).
 */
import { isoDateJakarta, newId } from '@simrs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditAnomalyBuckets,
  createPrismaClient,
  pendingAuditSummaryDays,
  type PrismaClient,
  readAuditAnomalySettings,
  summarizeAuditDay,
  wibDayRange,
  withTenant,
} from '../src/index';
import { asTestSuperuser, testDbUrls } from '../src/testing';

let app: PrismaClient;
let owner: PrismaClient;

beforeAll(() => {
  app = createPrismaClient({ connectionString: testDbUrls().app, max: 4 });
  owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 2 });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

const DAY = 86_400_000;
const dayAgo = (n: number) => isoDateJakarta(new Date(Date.now() - n * DAY));
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+07:00`);

async function freshTenant(settings: Record<string, unknown> = {}): Promise<string> {
  const id = newId();
  await withTenant(owner, id, async (tx) => {
    await tx.tenant.create({
      data: { id, code: `SUM${id.slice(-8).toUpperCase()}`, name: 'RS Fiktif Uji Ringkasan' },
    });
    for (const [key, value] of Object.entries(settings)) {
      await tx.tenantSetting.create({ data: { tenantId: id, key, value: value as never } });
    }
  });
  return id;
}

interface Ev {
  at?: Date;
  user: string | null;
  role: string | null;
  action: string;
  patientId?: string;
}

/** Sisipkan entri lewat role aplikasi (trigger mengisi seq/hash), lalu geser waktunya sebagai superuser. */
async function insertEvents(tenantId: string, events: Ev[]): Promise<void> {
  const ids = events.map(() => newId());
  await withTenant(app, tenantId, async (tx) => {
    for (const [i, e] of events.entries()) {
      await tx.auditEvent.create({
        data: {
          id: ids[i] as string,
          tenantId,
          actorUserId: e.user,
          actorRole: e.role,
          patientId: e.patientId ?? null,
          resourceType: e.patientId ? 'patient' : 'session',
          action: e.action,
          outcome: e.action === 'login_failed' || e.action === 'access_denied' ? 'denied' : 'success',
        },
      });
    }
  });
  await asTestSuperuser(async (tx) => {
    for (const [i, e] of events.entries()) {
      if (e.at)
        await tx.$executeRaw`UPDATE audit_events SET occurred_at = ${e.at} WHERE id = ${ids[i]}::uuid`;
    }
  });
}

const settingsOf = (T: string) => withTenant(app, T, (tx) => readAuditAnomalySettings(tx));

async function summarizeAll(T: string, lookbackDays = 8): Promise<string[]> {
  const settings = await settingsOf(T);
  const days = await withTenant(app, T, (tx) =>
    pendingAuditSummaryDays(tx, settings, { now: new Date(), lookbackDays, settleMs: 0 }),
  );
  for (const d of days) await withTenant(app, T, (tx) => summarizeAuditDay(tx, T, d, settings));
  return days;
}

async function buckets(T: string, days: number, useSummaries: boolean) {
  const settings = await settingsOf(T);
  const since = new Date(wibDayRange(isoDateJakarta()).from.getTime() - (days - 1) * DAY);
  return withTenant(app, T, (tx) => auditAnomalyBuckets(tx, { since, settings, useSummaries }));
}

/** Data uji: semua jenis temuan di beberapa hari lampau + hari ini; beberapa di bawah ambang. */
async function seedScenario(T: string) {
  const [u1, u2, u3, u4, u5] = Array.from({ length: 5 }, () => newId());
  const p = () => newId();
  const d1 = dayAgo(1);
  const d2 = dayAgo(2);
  const d3 = dayAgo(3);
  const d4 = dayAgo(4);
  await insertEvents(T, [
    // Gagal masuk: 3× (d2), 1× (d3, di bawah ambang minimum → tidak disimpan), nama tak dikenal 2× (d1).
    { at: at(d2, '08:01'), user: u1 as string, role: 'kasir', action: 'login_failed' },
    { at: at(d2, '08:02'), user: u1 as string, role: 'kasir', action: 'login_failed' },
    { at: at(d2, '08:03'), user: u1 as string, role: 'kasir', action: 'login_failed' },
    { at: at(d3, '09:00'), user: u1 as string, role: 'kasir', action: 'login_failed' },
    { at: at(d1, '10:00'), user: null, role: null, action: 'login_failed' },
    { at: at(d1, '10:05'), user: null, role: null, action: 'login_failed' },
    // Akses ditolak 2× (d4).
    { at: at(d4, '11:00'), user: u2 as string, role: 'perawat', action: 'access_denied' },
    { at: at(d4, '11:10'), user: u2 as string, role: 'perawat', action: 'access_denied' },
    // Malam: kasir 2 pasien (d2 23.00), perawat jaga (dikecualikan), dini hari (d1 01.30) tercatat di d1.
    { at: at(d2, '23:00'), user: u3 as string, role: 'kasir', action: 'read', patientId: p() },
    { at: at(d2, '23:20'), user: u3 as string, role: 'kasir', action: 'search', patientId: p() },
    { at: at(d2, '23:30'), user: u4 as string, role: 'perawat', action: 'read', patientId: p() },
    { at: at(d1, '01:30'), user: u3 as string, role: 'kasir', action: 'print', patientId: p() },
    // Volume: 3 pasien berbeda dibuka (d1) + pencarian (tidak dihitung) + pasien yang sama dibuka dua kali.
    ...(() => {
      const same = p();
      return [
        { at: at(d1, '13:00'), user: u5 as string, role: 'admisi', action: 'read', patientId: same },
        { at: at(d1, '13:01'), user: u5 as string, role: 'admisi', action: 'read', patientId: same },
        { at: at(d1, '13:02'), user: u5 as string, role: 'admisi', action: 'read', patientId: p() },
        { at: at(d1, '13:03'), user: u5 as string, role: 'admisi', action: 'export', patientId: p() },
        { at: at(d1, '13:04'), user: u5 as string, role: 'admisi', action: 'search', patientId: p() },
      ];
    })(),
  ]);
  // Hari ini (waktu server sebenarnya): selalu dihitung langsung. Peran jaga (dokter) agar hasil tidak bergantung
  // pada jam tes dijalankan (malam atau siang).
  await insertEvents(T, [
    { user: u1 as string, role: 'kasir', action: 'login_failed' },
    { user: u1 as string, role: 'kasir', action: 'login_failed' },
    { user: u5 as string, role: 'dokter', action: 'read', patientId: p() },
    { user: u5 as string, role: 'dokter', action: 'read', patientId: p() },
  ]);
  return { u1: u1 as string, u3: u3 as string, u5: u5 as string, d1, d2, d3 };
}

const LOW_THRESHOLDS = { 'audit.burst_threshold': 2, 'audit.volume_threshold': 2 };

describe('ringkasan harian temuan anomali', () => {
  it('ringkasan + agregasi langsung hari ini = agregasi langsung seluruh jendela', async () => {
    const T = await freshTenant(LOW_THRESHOLDS);
    const s = await seedScenario(T);
    const live = await buckets(T, 7, false);
    expect(live.summarizedDays).toBe(0);
    // Pastikan skenario benar-benar menghasilkan temuan di setiap jenis (bukan membandingkan dua daftar kosong).
    expect(live.buckets.login_failed.map((b) => [b.userId, b.day, b.n])).toEqual([
      [s.u1, isoDateJakarta(), 2],
      [null, s.d1, 2],
      [s.u1, s.d2, 3],
    ]);
    expect(live.buckets.night.map((b) => [b.userId, b.day, b.n])).toEqual([
      [s.u3, s.d1, 1],
      [s.u3, s.d2, 2],
    ]);
    expect(live.buckets.volume.map((b) => [b.userId, b.day, b.n])).toEqual([
      [s.u5, isoDateJakarta(), 2],
      [s.u5, s.d1, 3],
    ]);
    expect(live.buckets.access_denied).toHaveLength(1);

    const days = await summarizeAll(T);
    expect(days).toHaveLength(7);
    expect(days).not.toContain(isoDateJakarta());
    const hybrid = await buckets(T, 7, true);
    expect(hybrid.summarizedDays).toBe(6);
    expect(hybrid.buckets).toEqual(live.buckets);
    // Jendela lain (1, 3, 30 hari) juga sama.
    for (const n of [1, 3, 30]) {
      expect((await buckets(T, n, true)).buckets).toEqual((await buckets(T, n, false)).buckets);
    }

    // Hitungan di bawah ambang minimum tidak disimpan; isi ringkasan tanpa PHI (tanpa id pasien).
    const items = await withTenant(app, T, (tx) =>
      tx.auditDailySummaryItem.findMany({ include: { summary: { select: { day: true } } } }),
    );
    expect(items.some((i) => i.kind === 'login_failed' && i.summary.day.toISOString().startsWith(s.d3))).toBe(
      false,
    );
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(
      ['actorRole', 'actorUserId', 'id', 'kind', 'lastAt', 'n', 'summary', 'summaryId', 'tenantId'].sort(),
    );
  });

  it('job idempoten: dijalankan ulang tidak menggandakan; tidak meringkas hari ini atau hari yang belum mengendap', async () => {
    const T = await freshTenant(LOW_THRESHOLDS);
    await seedScenario(T);
    const first = await summarizeAll(T, 3);
    expect(first).toEqual([dayAgo(2), dayAgo(1)]);
    expect(await summarizeAll(T, 3)).toEqual([]);
    const settings = await settingsOf(T);
    expect(await withTenant(app, T, (tx) => summarizeAuditDay(tx, T, dayAgo(1), settings))).toEqual({
      created: false,
      items: 0,
    });
    expect(await withTenant(app, T, (tx) => tx.auditDailySummary.count())).toBe(2);
    // Tenant tanpa ringkasan, 1 menit setelah 00.00 WIB: kemarin baru berakhir < settleMs → belum diringkas.
    const B = await freshTenant();
    const justAfterMidnight = new Date(wibDayRange(isoDateJakarta()).from.getTime() + 60_000);
    const pending = await withTenant(app, B, async (tx) =>
      pendingAuditSummaryDays(tx, await readAuditAnomalySettings(tx), {
        now: justAfterMidnight,
        lookbackDays: 3,
        settleMs: 10 * 60_000,
      }),
    );
    expect(pending).toEqual([dayAgo(2)]);
  });

  it('jam malam diubah → ringkasan lama tidak dipakai (agregasi langsung, tetap sama), lalu dihitung ulang', async () => {
    const T = await freshTenant(LOW_THRESHOLDS);
    await seedScenario(T);
    await summarizeAll(T);
    await withTenant(owner, T, (tx) =>
      tx.tenantSetting.create({
        data: { tenantId: T, key: 'audit.night_hours', value: { start: '23:10', end: '02:00' } },
      }),
    );
    const live = await buckets(T, 7, false);
    const hybrid = await buckets(T, 7, true);
    expect(hybrid.summarizedDays).toBe(0);
    expect(hybrid.buckets).toEqual(live.buckets);
    expect(live.buckets.night.map((b) => b.n)).toEqual([1, 1]);

    expect(await summarizeAll(T)).toHaveLength(7);
    const again = await buckets(T, 7, true);
    expect(again.summarizedDays).toBe(6);
    expect(again.buckets).toEqual(live.buckets);
    // Ringkasan lama tetap ada (append-only), ringkasan baru berkunci parameter lain.
    expect(await withTenant(app, T, (tx) => tx.auditDailySummary.count())).toBe(14);
  });

  it('isolasi tenant dan append-only', async () => {
    const A = await freshTenant(LOW_THRESHOLDS);
    const B = await freshTenant(LOW_THRESHOLDS);
    await seedScenario(A);
    await summarizeAll(A);
    expect(await withTenant(app, B, (tx) => tx.auditDailySummary.count())).toBe(0);
    expect(await withTenant(app, B, (tx) => tx.auditDailySummaryItem.count())).toBe(0);
    expect((await buckets(B, 7, true)).summarizedDays).toBe(0);
    await expect(
      withTenant(app, A, (tx) => tx.$executeRaw`UPDATE audit_daily_summary_items SET n = 1`),
    ).rejects.toThrow();
    await expect(
      withTenant(app, A, (tx) => tx.$executeRaw`DELETE FROM audit_daily_summaries`),
    ).rejects.toThrow();
    await expect(
      withTenant(
        owner,
        A,
        (tx) => tx.$executeRaw`DELETE FROM audit_daily_summary_items WHERE tenant_id = ${A}::uuid`,
      ),
    ).rejects.toThrow(/APPEND_ONLY/);
  });
});
