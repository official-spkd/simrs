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

  test('mock gagal: pesan dijadwalkan ulang, lalu terkirim sekali setelah mock normal', async () => {
    await setMockScenario('eklaim', 'gagal');
    const ping = await enqueueTestPing('eklaim');
    await expect
      .poll(() => outboxView(ping.id), { timeout: 20_000 })
      .toMatchObject({ status: 'failed', lastError: 'HTTP 503' });
    await setMockScenario('eklaim', 'normal');
    await expect.poll(() => outboxView(ping.id), { timeout: 20_000 }).toMatchObject({ status: 'sent' });
    // Mode gagal menolak sebelum diproses: target hanya menerima kiriman yang berhasil.
    expect(await mockEchoCount(ping.idempotencyKey)).toBe(1);
  });

  test('mock timeout: target sudah memproses, kiriman ulang tiba dengan kunci idempotensi yang sama', async () => {
    await setMockScenario('eklaim', 'timeout');
    const ping = await enqueueTestPing('eklaim');
    await expect
      .poll(() => outboxView(ping.id), { timeout: 20_000 })
      .toMatchObject({ status: 'failed', lastError: 'timeout' });
    await setMockScenario('eklaim', 'normal');
    await expect.poll(() => outboxView(ping.id), { timeout: 20_000 }).toMatchObject({ status: 'sent' });
    // Percobaan yang "timeout" sudah diproses mock, jadi kiriman ulang adalah duplikat: inilah alasan setiap
    // operasi outbox wajib idempoten di sisi target (mis. SEP: cek histori sebelum menerbitkan ulang).
    expect(await mockEchoCount(ping.idempotencyKey)).toBeGreaterThanOrEqual(2);
  });
});
