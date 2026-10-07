import { expect, test } from '@playwright/test';
import { enrolledAnalyzerSchema, newId } from '@simrs/shared';
import { createAccount, inTenant, loginAs, TENANTS } from './support/accounts';
import { mockLis } from './support/mock';
import { E2E_API_PORT } from './support/slot';

/**
 * Fase 4 §4.1a · Analyzer lab sebagai prinsipal perangkat: admin mendaftarkan analyzer di layar Akses → Perangkat,
 * gateway (di sini: tes) menukar kode dengan token `dv1` + kunci HMAC lewat API, mock analyzer (4.1b) mengirim ORU^R01
 * bertanda tangan → ACK AA, kirim ganda tetap satu pesan masuk, tanda tangan salah → 401 tanpa menyimpan.
 * Mengubah kredensial mock (keadaan bersama): hanya proyek desktop.
 */
async function createUnit(): Promise<string> {
  const facilityId = newId();
  const id = newId();
  const suffix = id.slice(-6).toUpperCase();
  const name = `Lab E2E ${suffix}`;
  await inTenant(TENANTS.RSFA, async (tx) => {
    await tx.facility.create({
      data: { id: facilityId, tenantId: TENANTS.RSFA, code: `FL${suffix}`, name: 'Gedung Lab E2E' },
    });
    await tx.unit.create({
      data: { id, tenantId: TENANTS.RSFA, facilityId, code: `LB${suffix}`, name, kind: 'penunjang' },
    });
  });
  return name;
}

const inbound = (controlId: string) =>
  inTenant(TENANTS.RSFA, (tx) =>
    tx.inboundEvent.findMany({ where: { source: 'lis-hl7', idempotencyKey: controlId } }),
  );

test.describe('ingest analyzer lab (fase 4 §4.1a)', () => {
  test.afterEach(async () => {
    await mockLis.reset();
  });

  test('admin daftarkan analyzer → gateway terima token + kunci HMAC → ORU diterima sekali (ACK AA); tanda tangan salah ditolak', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const unitName = await createUnit();
    const admin = await createAccount({ roles: ['admin_tenant'], displayName: 'Andi Pratama' });
    await loginAs(page, admin, '/sistem/akses/perangkat');
    const deviceName = `Analyzer kimia ${unitName.slice(-6)}`;
    await page.getByLabel('Jenis').selectOption({ label: 'Analyzer laboratorium' });
    await page.getByLabel('Nama perangkat').fill(deviceName);
    await page.getByLabel('Unit').selectOption({ label: unitName });
    await page.getByRole('button', { name: 'Buat kode pendaftaran' }).click();
    const code = (await page.getByTestId('kode-pendaftaran').textContent()) ?? '';
    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    await expect(
      page.getByText('Masukkan kode ini di konfigurasi gateway analyzer', { exact: false }),
    ).toBeVisible();

    // Gateway analyzer menukar kode (bukan lewat peramban).
    const res = await fetch(`http://127.0.0.1:${E2E_API_PORT}/api/v1/devices/lis/enrol`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantCode: 'RSFA', code }),
    });
    expect(res.status).toBe(200);
    const enrolled = enrolledAnalyzerSchema.parse(await res.json());
    expect(enrolled.device.kind).toBe('lab_analyzer');
    await mockLis.configure(enrolled.token, enrolled.hmacKey);

    // Barcode acak di luar pola nomor lab: pesan ini tidak boleh tercocok ke spesimen spesifikasi lain.
    const barcode = `E2E${newId().slice(-8).toUpperCase()}`;
    const sent = await mockLis.send(barcode, 'elektrolit', { scenario: 'kritis', duplicate: true });
    expect(sent.deliveries.map((d) => [d.status, d.ack])).toEqual([
      [200, 'AA'],
      [200, 'AA'],
    ]);
    const rows = await inbound(sent.controlId);
    expect(rows).toHaveLength(1);
    // Status bisa sudah berubah (worker memproses async: barcode acak → berhenti); yang diuji di sini penyimpanan.
    expect(rows[0]).toMatchObject({ deviceId: enrolled.device.id });
    expect(rows[0]?.rawBody).toContain(`OBR|1||${barcode}`);

    const bad = await mockLis.send(`E2E${newId().slice(-8).toUpperCase()}`, 'dl', { badSignature: true });
    expect(bad.deliveries[0]).toMatchObject({ status: 401, ack: null });
    expect(await inbound(bad.controlId)).toHaveLength(0);

    // Layar admin: analyzer aktif setelah gateway mendaftar.
    await page.reload();
    const row = page.getByRole('row', { name: new RegExp(deviceName) });
    await expect(row.getByText('Aktif')).toBeVisible();
    await expect(row.getByText('Analyzer laboratorium')).toBeVisible();
  });
});
