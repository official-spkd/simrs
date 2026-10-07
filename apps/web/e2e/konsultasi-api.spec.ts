import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { ensurePublishedForm } from '@simrs/db';
import { EDUCATION_FORM_SAMPLE, newId } from '@simrs/shared';
import { type Account, inTenant, loginAs, TENANTS } from './support/accounts';
import { admitPatient, createStaff, createWard } from './support/inpatient';

/**
 * K10 · K15 · P08 · Sambungan layar potongan 3.8 mode api (ADR-0059): tab "Dokumen & konsultasi" Rawat inap, layar
 * Konsultasi, dan layar Paket layanan. Alur wajib: dokter A (DPJP) mengirim konsul rawat bersama → konsultan B
 * menjawab dari kotak masuknya dan menerima rawat bersama → tim perawatan berubah (dan relasi akses ikut) → DPJP
 * mengunggah dokumen PDF lalu meminta TTE. Tiap tes punya bangsal fiktif sendiri. Data fiktif.
 */

const contexts: BrowserContext[] = [];
const consoleErrors: string[] = [];

async function as(browser: Browser, acc: Account, path: string): Promise<Page> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    // favicon.ico belum ada di seluruh aplikasi web (di luar layar ini).
    if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) {
      consoleErrors.push(`${acc.displayName}: ${m.text()} @ ${m.location().url}`);
    }
  });
  page.on('pageerror', (e) => consoleErrors.push(`${acc.displayName}: ${e.message}`));
  await loginAs(page, acc, path);
  await page.goto(path);
  return page;
}

test.afterEach(async () => {
  const errors = consoleErrors.splice(0);
  for (const ctx of contexts.splice(0)) await ctx.close();
  expect(errors).toEqual([]);
});

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

test.describe('Konsultasi, tim perawatan, dan dokumen pasien mode api (3.8)', () => {
  test('dokter A kirim konsul → konsultan B menjawab dan menerima rawat bersama → tim berubah → dokumen diunggah lalu diminta TTE', async ({
    browser,
  }) => {
    const ward = await createWard();
    const tag = ward.unitName.split(' ').at(-1);
    const dpjp = await createStaff('dokter', ward.unitId, `dr. DPJP Konsul ${tag}, Sp.PD`);
    const konsultan = await createStaff('dokter', null, `dr. Konsultan Jantung ${tag}, Sp.JP`);
    const p = await admitPatient(ward, dpjp, `Tn. Konsul Rawat Bersama ${tag}`);
    const record = `/klinis/rawat-inap/${p.encounterId}?tab=dokumen`;

    // 1 · Dokter A mengirim konsul rawat bersama dari tab "Dokumen & konsultasi".
    const a = await as(browser, dpjp, record);
    await expect(a.getByRole('tab', { name: 'Dokumen & konsultasi', selected: true })).toBeVisible();
    await expect(a.getByRole('region', { name: 'Kelengkapan formulir' })).toContainText('Rawat inap');
    const team = a.getByRole('region', { name: 'Tim perawatan' });
    await expect(team).toContainText(dpjp.displayName);
    const send = a.getByRole('form', { name: 'Kirim konsul baru' });
    // Gerbang tertulis sebelum isian lengkap.
    await send.getByRole('button', { name: 'Kirim konsul' }).click();
    await expect(send.getByRole('alert')).toHaveText('Pilih dokter konsultan.');
    // Pemilih konsultan mencari di server (bukan memuat seluruh dokter RS): kata kunci khas tes ini.
    const picker = send.getByRole('group', { name: 'Dokter konsultan' });
    await picker.getByLabel('Cari nama dokter atau unit (minimal 2 huruf)').fill(`Jantung ${tag}`);
    await picker
      .getByRole('list', { name: 'Hasil pencarian dokter konsultan' })
      .getByRole('button', { name: new RegExp(konsultan.displayName.replace(/[.,]/g, '.')) })
      .click();
    await expect(picker).toContainText(`Dipilih: ${konsultan.displayName}`);
    await send.getByLabel('Jenis').selectOption({ label: 'Rawat bersama' });
    await send.getByLabel('Urgensi').selectOption({ label: 'Cito (≤ 1 jam)' });
    await send
      .getByLabel('Pertanyaan klinis')
      .fill('Mohon evaluasi fibrilasi atrium respons cepat dan rawat bersama');
    await send.getByRole('button', { name: 'Kirim konsul' }).click();
    await expect(
      a.getByRole('status').filter({ hasText: `Konsul terkirim ke ${konsultan.displayName}` }),
    ).toBeVisible();
    const mine = a.getByRole('region', { name: 'Konsul pasien ini' });
    await expect(mine).toContainText('Menunggu jawaban konsultan');
    // Pengirim tidak bisa menjawab konsulnya sendiri (alasan tertulis).
    await expect(mine.getByRole('button', { name: 'Jawab konsul' })).toBeDisabled();
    await expect(mine).toContainText('Pengirim konsul tidak menjawab konsulnya sendiri.');

    // 2 · Konsultan B menjawab dari kotak masuknya dan menerima rawat bersama.
    const b = await as(browser, konsultan, '/klinis/konsultasi');
    const inbox = b.getByRole('region', { name: 'Konsul masuk' });
    await expect(inbox).toContainText(p.patientName);
    await expect(inbox).toContainText('Cito');
    await inbox.getByRole('link', { name: `Buka konsul ${p.patientName}` }).click();
    await expect(b.getByLabel('Identitas pasien')).toContainText(p.mrn);
    await b
      .getByRole('region', { name: 'Konsul pasien ini' })
      .getByRole('button', { name: 'Jawab konsul' })
      .click();
    const form = b.getByRole('form', { name: 'Jawaban konsul' });
    await form.getByLabel('Temuan pemeriksaan').fill('EKG fibrilasi atrium, laju ventrikel 130 x/menit');
    await form.getByLabel('Kesimpulan / diagnosis konsultan').fill('Fibrilasi atrium respons cepat');
    await form
      .getByLabel('Rekomendasi tata laksana')
      .fill('Kendali laju dengan bisoprolol; antikoagulan setelah skor risiko');
    await form.getByLabel('Terima rawat bersama (saya ikut merawat)').check();
    await form.getByRole('button', { name: 'Tanda tangani jawaban' }).click();
    await expect(b.getByRole('status').filter({ hasText: 'DPJP rawat bersama' })).toBeVisible();
    const bTeam = b.getByRole('region', { name: 'Tim perawatan' });
    await expect(bTeam.getByRole('listitem').filter({ hasText: konsultan.displayName })).toContainText(
      'DPJP rawat bersama',
    );
    await expect(inbox).toContainText('Tidak ada konsul yang menunggu jawaban Anda.');

    // Relasi akses tim (rawat bersama, tanpa batas waktu) tercatat untuk konsultan.
    const rel = await inTenant(TENANTS.RSFA, (tx) =>
      tx.accessRelationship.findFirst({
        where: { userId: konsultan.id, patientId: p.patientId, kind: 'rawat_bersama', validUntil: null },
      }),
    );
    expect(rel).not.toBeNull();

    // 3 · Dokter A melihat jawaban + tim berubah, lalu mengunggah dokumen dan meminta TTE.
    await a.reload();
    await expect(mine).toContainText('Fibrilasi atrium respons cepat');
    await expect(mine).toContainText('Rawat bersama (konsultan ikut merawat)');
    await expect(team.getByRole('listitem').filter({ hasText: konsultan.displayName })).toContainText(
      'DPJP rawat bersama',
    );
    const docs = a.getByRole('region', { name: 'Dokumen pasien' });
    const upload = docs.getByRole('form', { name: 'Unggah dokumen' });
    await upload.getByLabel('Jenis').selectOption({ label: 'Surat' });
    await upload.getByLabel('Judul').fill('Surat jawaban konsul jantung');
    await upload
      .getByLabel('Berkas (PDF, PNG, JPEG · maks. 10 MB)')
      .setInputFiles({ name: 'jawaban-konsul.pdf', mimeType: 'application/pdf', buffer: PDF });
    await upload.getByRole('button', { name: 'Unggah' }).click();
    await expect(docs.getByRole('status')).toContainText('Dokumen "Surat jawaban konsul jantung" tersimpan.');
    const row = docs.getByRole('row').filter({ hasText: 'Surat jawaban konsul jantung' });
    await expect(row).toContainText('Belum ditandatangani');
    await row.getByRole('button', { name: 'Minta TTE' }).click();
    await expect(docs.getByRole('status')).toContainText('Permintaan TTE terkirim');
    await expect(row).toContainText(/TTE diproses|Ber-TTE/);
    await expect(row.getByRole('button', { name: 'Batalkan' })).toBeDisabled();
    const sig = await inTenant(TENANTS.RSFA, (tx) =>
      tx.documentSignature.count({
        where: {
          signerUserId: dpjp.id,
          document: { patientId: p.patientId, title: 'Surat jawaban konsul jantung' },
        },
      }),
    );
    expect(sig).toBe(1);
  });

  test('unggah dokumen lewat BFF: tanpa sesi 401, tanpa header asal 403, > 10 MB 413, bukan PDF/PNG/JPEG 415, sah 201', async ({
    browser,
    playwright,
  }) => {
    const ward = await createWard();
    const dpjp = await createStaff('dokter', ward.unitId, 'dr. DPJP Unggah E2E, Sp.PD');
    const p = await admitPatient(ward, dpjp, 'Tn. Unggah Dokumen Fiktif');
    const url = `/klinis/dokumen/unggah?patientId=${p.patientId}`;
    const headers = {
      'content-type': 'application/octet-stream',
      'x-simrs-upload': '1',
      'x-document-kind': 'lampiran',
      'x-document-title': encodeURIComponent('Foto luka fiktif'),
      'x-document-filename': 'luka.pdf',
    };
    // Tanpa sesi: ditolak sebelum body dibaca.
    const anon = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
    const unauth = await anon.post(url, { headers, data: PDF });
    expect(unauth.status()).toBe(401);
    await anon.dispose();

    const page = await as(browser, dpjp, `/klinis/rawat-inap/${p.encounterId}?tab=dokumen`);
    const req = page.request;
    expect(
      (await req.post(url, { headers: { ...headers, 'x-simrs-upload': '0' }, data: PDF })).status(),
    ).toBe(403);
    const big = await req.post(url, { headers, data: Buffer.alloc(10 * 1024 * 1024 + 1, 0x25) });
    expect(big.status()).toBe(413);
    expect((await big.json()).message).toBe('Berkas maksimal 10 MB.');
    const html = await req.post(url, { headers, data: Buffer.from('<html><script>x</script></html>') });
    expect(html.status()).toBe(415);
    const ok = await req.post(url, { headers, data: PDF });
    expect(ok.status()).toBe(201);
    expect((await ok.json()).message).toBe('Dokumen "Foto luka fiktif" tersimpan.');
    const stored = await inTenant(TENANTS.RSFA, (tx) =>
      tx.document.count({ where: { patientId: p.patientId, title: 'Foto luka fiktif' } }),
    );
    expect(stored).toBe(1);
  });

  test('paket layanan: dokter membaca paket per setting; petugas rekam medis menambah dan menonaktifkan butir', async ({
    browser,
  }) => {
    // Formulir terbit khusus tes ini (paket RS bersama tidak diubah tes lain).
    const tag = newId().replaceAll('-', '').slice(-8);
    const title = `Formulir Paket E2E ${tag}`;
    await inTenant(TENANTS.RSFA, (tx) =>
      ensurePublishedForm(tx, TENANTS.RSFA, { ...EDUCATION_FORM_SAMPLE, code: `e2e_paket_${tag}`, title }),
    );
    const doctor = await createStaff('dokter', null, 'dr. Pembaca Paket E2E');
    const rm = await createStaff('petugas_rm', null, 'Petugas RM Paket E2E');
    const d = await as(browser, doctor, '/klinis/paket-layanan?setting=igd');
    await expect(d.getByRole('heading', { level: 1, name: 'Paket formulir per setting' })).toBeVisible();
    const igd = d.getByRole('region', { name: 'Paket formulir IGD' });
    await expect(igd).toContainText('Wajib');
    await expect(igd).toContainText('peran Anda hanya membaca');
    await expect(igd.getByRole('button', { name: 'Simpan' })).toHaveCount(0);

    const r = await as(browser, rm, '/klinis/paket-layanan?setting=rawat_jalan');
    const rj = r.getByRole('region', { name: 'Paket formulir Rawat jalan' });
    const add = rj.getByRole('form', { name: 'Tambah formulir ke paket' });
    await add.getByLabel('Formulir terbit').selectOption({ label: title });
    await add.getByLabel('Wajib').uncheck();
    await add.getByRole('button', { name: 'Tambah ke paket' }).click();
    await expect(rj.getByRole('status')).toContainText(`${title}: opsional di paket.`);
    const row = rj.getByRole('row').filter({ hasText: title });
    await expect(row).toContainText('Opsional');
    await row.getByLabel('Aktif').uncheck();
    await row.getByRole('button', { name: 'Simpan' }).click();
    await expect(rj.getByRole('status')).toContainText(`${title}: nonaktif di paket.`);
    await expect(row).toContainText('Nonaktif');
  });
});
