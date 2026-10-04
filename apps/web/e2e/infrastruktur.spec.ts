import { expect, test } from '@playwright/test';
import { mockEchoCount, setMockScenario } from './support/mock';
import { enqueueTestPing, outboxView } from './support/outbox';

/**
 * Stack E2E (potongan 1d fase 2): worker outbox mengirim ke mock E2E, dan gangguan mock (gagal/timeout) membuat pesan
 * dijadwalkan ulang lalu terkirim setelah mock normal. Sistem `eklaim` dipakai karena belum dipakai tes lain;
 * skenario mock berlaku global, jadi berkas ini berurutan dan hanya di proyek desktop (`testIgnore` proyek tablet).
 */
test.describe('infrastruktur E2E · outbox → worker → mock', () => {
  test.describe.configure({ mode: 'serial' });
  test.afterEach(() => setMockScenario('eklaim', 'normal'));

  test('worker mengirim pesan outbox ke mock E2E', async () => {
    const ping = await enqueueTestPing('eklaim');
    await expect
      .poll(() => outboxView(ping.id), { timeout: 20_000 })
      .toMatchObject({ status: 'sent', attempts: 1 });
    expect(await mockEchoCount(ping.idempotencyKey)).toBe(1);
  });

  for (const [mode, error] of [
    ['gagal', 'HTTP 503'],
    ['timeout', 'timeout'],
  ] as const) {
    test(`mock ${mode}: pesan dijadwalkan ulang, lalu terkirim setelah mock normal`, async () => {
      await setMockScenario('eklaim', mode);
      const ping = await enqueueTestPing('eklaim');
      await expect
        .poll(() => outboxView(ping.id), { timeout: 20_000 })
        .toMatchObject({ status: 'failed', lastError: error });
      await setMockScenario('eklaim', 'normal');
      await expect.poll(() => outboxView(ping.id), { timeout: 20_000 }).toMatchObject({ status: 'sent' });
      // Minimal sekali (permintaan yang tertahan skenario timeout bisa tetap sampai belakangan: itulah gunanya kunci
      // idempotensi).
      expect(await mockEchoCount(ping.idempotencyKey)).toBeGreaterThanOrEqual(1);
    });
  }
});
