import { type Browser, expect, type Page, test } from '@playwright/test';
import { newId } from '@simrs/shared';
import { type Account, createAccount, createPatient, inTenant, loginAs, TENANTS } from './support/accounts';

/**
 * W3 · Layar IGD + Tempat tidur mode api (rencana fase 3 §W3, ADR-0104). Alur IGD → rawat inap di tiga jendela:
 * petugas pendaftaran IGD mendaftarkan pasien (jendela 1), perawat IGD melihatnya muncul tanpa muat ulang lalu
 * mentriase dengan saran server (turun level wajib alasan) (jendela 2), keputusan rawat inap (permintaan bed) tampil
 * di papan tempat tidur tanpa muat ulang (jendela 3), alokasi bed → admisi (gelang terbit) → pasien tampil di papan bed
 * dan hilang dari papan IGD; lalu pulang dan bed dibersihkan agar run berikutnya punya bed siap. Data fiktif.
 */

/** Akun dengan penugasan di unit IGD RSFA (petugas pendaftaran IGD / perawat IGD). */
async function igdAccount(role: string, displayName: string): Promise<Account> {
  const acc = await createAccount({ roles: [], displayName });
  await inTenant(TENANTS.RSFA, async (tx) => {
    const r = await tx.role.findFirstOrThrow({ where: { code: role } });
    const unit = await tx.unit.findFirstOrThrow({ where: { code: 'IGD' } });
    await tx.staffAssignment.create({
      data: { id: newId(), tenantId: TENANTS.RSFA, userId: acc.id, roleId: r.id, unitId: unit.id },
    });
  });
  return acc;
}

/** Resume medis final ber-TTE untuk pasien di bed `bedCode` (syarat `DischargeGate`; alurnya diuji layar Resume). */
async function seedSignedResume(bedCode: string, doctorUserId: string): Promise<void> {
  const tenantId = TENANTS.RSFA;
  await inTenant(tenantId, async (tx) => {
    const loc = await tx.location.findFirstOrThrow({ where: { code: bedCode } });
    const st = await tx.bedStatus.findFirstOrThrow({ where: { locationId: loc.id } });
    const encounterId = st.encounterId as string;
    const enc = await tx.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    const id = newId();
    await tx.dischargeSummary.create({
      data: {
        id,
        tenantId,
        patientId: enc.patientId,
        encounterId,
        rootId: id,
        occurredAt: new Date(),
        authorUserId: doctorUserId,
        authorRole: 'dokter',
        kind: 'rawat_inap',
        sections: {},
        disposition: 'pulang',
        dischargeCondition: 'Membaik',
      },
    });
    const docId = newId();
    await tx.document.create({
      data: {
        id: docId,
        tenantId,
        patientId: enc.patientId,
        kind: 'resume',
        title: 'Resume medis pulang',
        fileName: 'resume.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
        storageKey: `${tenantId}/2026/10/${docId}`,
        sourceType: 'discharge_summaries',
        sourceId: id,
      },
    });
    await tx.documentSignature.create({
      data: {
        id: newId(),
        tenantId,
        documentId: docId,
        signerUserId: doctorUserId,
        documentSha256: 'a'.repeat(64),
        verifyCode: `sv1.${tenantId}.${'A'.repeat(11)}${newId().replace(/-/g, '')}`,
      },
    });
  });
}

/** Galat konsol/halaman per jendela (syarat kualitas: layar mode api tanpa galat konsol). */
const consoleErrors: string[] = [];

async function open(browser: Browser, acc: Account, path: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Sama dengan spesifikasi lain: favicon (aplikasi tanpa folder public) bukan galat layar.
  page.on('console', (m) => {
    if (m.type() === 'error' && !`${m.text()} ${m.location().url}`.includes('favicon')) {
      consoleErrors.push(`${path}: ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => consoleErrors.push(`${path}: ${e.message}`));
  await loginAs(page, acc, path);
  await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/')));
  return page;
}

/** Tunggu aliran SSE papan tersambung (penanda status di kepala layar). */
async function live(page: Page) {
  await expect(page.locator('[data-live-status="tersambung"]')).toBeVisible({ timeout: 15_000 });
}

test.describe('IGD → rawat inap (layar W3, mode api)', () => {
  test('daftar IGD → triase → keputusan rawat inap → alokasi → admisi; SSE memperbarui jendela lain', async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const suffix = newId().slice(-4).toUpperCase();
    const name = `Sulastri Igd Fiktif${suffix}`;
    const patient = await createPatient('RSFA', { name, sex: 'female', birthDate: '1979-04-02' });
    const admisi = await igdAccount('petugas_pendaftaran', 'Admisi IGD E2E Fiktif');
    const perawat = await igdAccount('perawat', 'Ns. IGD E2E Fiktif');
    const dokter = await createAccount({ roles: ['dokter'], displayName: 'dr. DPJP Resume E2E Fiktif' });

    const igd1 = await open(browser, admisi, '/klinis/igd');
    const igd2 = await open(browser, perawat, '/klinis/igd');
    const bed = await open(browser, admisi, '/klinis/tempat-tidur');
    await Promise.all([live(igd1), live(igd2), live(bed)]);

    // 1 · Pendaftaran IGD (jendela 1): cari rekam medis, ambulans, penjamin umum.
    await igd1.getByRole('button', { name: '+ Daftarkan pasien IGD' }).click();
    const form = igd1.getByRole('region', { name: 'Pendaftaran pasien IGD' });
    await form.getByLabel('No. RM, NIK, No. BPJS, atau nama').fill(patient.mrn);
    await form.getByRole('button', { name: 'Cari pasien' }).click();
    await form.getByRole('radio', { name: new RegExp(name) }).check();
    await form.getByLabel('Cara datang').selectOption('ambulans');
    await form.getByRole('button', { name: 'Daftarkan ke IGD' }).click();
    await expect(igd1.getByText(/Pasien terdaftar di IGD \(IGD-/)).toBeVisible();

    // 2 · Jendela 2 (perawat IGD) melihat pasien baru TANPA muat ulang, lalu triase dengan saran server.
    const row2 = igd2.getByRole('button', { name: new RegExp(name) });
    await expect(row2).toBeVisible({ timeout: 15_000 });
    await row2.click();
    const panel2 = igd2.getByRole('complementary', { name: 'Pasien IGD terpilih' });
    await panel2.getByLabel(/TD sistolik/).fill('86');
    await panel2.getByLabel(/TD diastolik/).fill('58');
    await panel2.getByLabel(/^Nadi/).fill('112');
    await panel2.getByLabel(/^SpO2/).fill('96');
    await expect(panel2.getByText(/Saran sistem \(server\): triase 2/)).toBeVisible();
    // Turun ke level 3: simpan nonaktif sampai alasan ≥ 10 karakter diisi.
    await panel2.getByRole('radio', { name: /^Level 3/ }).check({ force: true });
    const save = panel2.getByRole('button', { name: 'Simpan triase 3' });
    await expect(save).toBeDisabled();
    await panel2
      .getByLabel(/Alasan memilih level lebih rendah/)
      .fill('Hipotensi membaik setelah posisi berbaring');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(panel2.getByText('Triase 3 tersimpan.')).toBeVisible();

    // Jendela 2 (klinis) menampilkan level triase; jendela 1 (loket pendaftaran, papan administratif ADR-0109) tidak
    // menerima isi triase sama sekali.
    await expect(row2).toContainText('3 · Urgen', { timeout: 15_000 });
    const row1 = igd1.getByRole('button', { name: new RegExp(name) });
    await expect(row1).toContainText('Triase klinis');
    await expect(row1).not.toContainText('Urgen');

    // 2b · Dokter jaga IGD "Ambil pasien" → penanggung jawab tampil di papan jendela 1 tanpa muat ulang.
    const jaga = await igdAccount('dokter', 'dr. Jaga IGD E2E Fiktif');
    const igd3 = await open(browser, jaga, '/klinis/igd');
    await live(igd3);
    await igd3.getByRole('button', { name: new RegExp(name) }).click();
    const panel3 = igd3.getByRole('complementary', { name: 'Pasien IGD terpilih' });
    await panel3.getByRole('button', { name: 'Ambil pasien' }).click();
    await expect(panel3.getByText('Anda penanggung jawab IGD pasien ini.')).toBeVisible();
    await expect(row1).toContainText('dr. Jaga IGD E2E Fiktif', { timeout: 15_000 });

    // 3 · Keputusan rawat inap (jendela 1, petugas IGD berizin bed): minta bed kelas 1.
    await row1.click();
    const panel1 = igd1.getByRole('complementary', { name: 'Pasien IGD terpilih' });
    await panel1.getByLabel('Kelas rawat').selectOption('kelas_1');
    await panel1.getByLabel('Kebutuhan ruang').fill('Penyakit dalam · pantau EWS');
    await panel1.getByRole('button', { name: 'Putuskan rawat inap · minta bed' }).click();
    await expect(panel1.getByText(/Permintaan bed menunggu alokasi/)).toBeVisible();

    // 4 · Papan tempat tidur (jendela 3) menerima permintaan tanpa muat ulang → alokasi → admisi.
    const initials = 'S. I. F.';
    const req = bed.getByRole('listitem', { name: `Permintaan ${initials}` }).filter({
      hasText: 'Penyakit dalam · pantau EWS',
    });
    await expect(req).toBeVisible({ timeout: 15_000 });
    const choice = req.getByLabel('Alokasikan ke bed siap');
    const firstBed = await choice.locator('option').nth(1).getAttribute('value');
    expect(firstBed).toBeTruthy();
    await choice.selectOption(firstBed as string);
    await req.getByRole('button', { name: 'Alokasikan' }).click();
    await expect(req.getByText('(dipesan)')).toBeVisible();
    // IGD (jendela 2) melihat alokasi tanpa muat ulang.
    await expect(igd2.getByText(/dialokasikan · menunggu admisi/)).toBeVisible({ timeout: 15_000 });

    await req.getByLabel('DPJP rawat inap').selectOption({ index: 1 });
    await req.getByRole('checkbox', { name: 'Persetujuan umum sudah ditandatangani' }).check();
    await req.getByRole('button', { name: 'Admisi · terbitkan gelang' }).click();
    const done = bed.getByRole('region', { name: 'Permintaan bed' }).getByText(/Admisi selesai di (\S+)\./);
    await expect(done).toBeVisible();
    const bedCode = /di (\S+)\./.exec((await done.textContent()) ?? '')?.[1] ?? '';
    expect(bedCode).toMatch(/^[A-Z]{3}-\d{3}-[A-Z]$/);

    // 5 · Pasien tampil di papan bed (inisial), hilang dari papan IGD di kedua jendela IGD.
    const tile = bed.getByRole('button', { name: new RegExp(`^${bedCode} · Terisi · ${initials}`) });
    await expect(tile).toBeVisible({ timeout: 15_000 });
    await expect(igd1.getByRole('button', { name: new RegExp(name) })).toHaveCount(0, { timeout: 15_000 });
    await expect(igd2.getByRole('button', { name: new RegExp(name) })).toHaveCount(0, { timeout: 15_000 });

    // Gelang: halaman cetak memuat kode aktif.
    await tile.click();
    const bedPanel = bed.getByRole('region', { name: `Bed ${bedCode}` });
    await bedPanel.getByRole('link', { name: 'Gelang identitas pasien' }).click();
    const sheet = bed.getByRole('article', { name: 'Gelang identitas pasien' });
    await expect(sheet).toContainText(name);
    // ADR-0109: kode gelang tidak termuat saat halaman dibuka; keluar lewat aksi cetak (diaudit `print`).
    await expect(sheet.getByLabel('Kode gelang')).toHaveCount(0);
    await bed.evaluate(() => {
      window.print = () => undefined;
    });
    await bed.getByRole('button', { name: 'Cetak gelang' }).click();
    await expect(sheet.getByLabel('Kode gelang')).toHaveText(/^GL[A-Z2-9]{10}$/);
    await bed.goBack();

    // 6 · Pulang lewat `DischargeGate` (3.6): tanpa resume final syaratnya tampil beralasan; resume final ber-TTE
    // ditanam (alur resume diuji layar Resume) → pulang → bed kotor → siap, agar run berikutnya punya bed siap.
    await bed.getByRole('button', { name: new RegExp(`^${bedCode} · `) }).click();
    const p = bed.getByRole('region', { name: `Bed ${bedCode}` });
    await p.getByRole('button', { name: 'Pulangkan pasien' }).click();
    await expect(p.getByText('Pasien belum bisa dipulangkan. Lengkapi dulu:')).toBeVisible();
    await expect(p.getByRole('list', { name: 'Syarat yang belum terpenuhi' })).toContainText(
      'Resume medis final dengan TTE DPJP belum ada',
    );
    await seedSignedResume(bedCode, dokter.id);
    await p.getByRole('button', { name: 'Pulangkan pasien' }).click();
    await expect(bed.getByRole('button', { name: new RegExp(`^${bedCode} · Kotor`) })).toBeVisible();
    // Bed masih terpilih: panelnya menampilkan status baru (kotor) beserta transisi manualnya.
    await bed
      .getByRole('region', { name: `Bed ${bedCode}` })
      .getByRole('button', { name: 'Tandai siap' })
      .click();
    await expect(bed.getByRole('button', { name: new RegExp(`^${bedCode} · Siap`) })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test('pasien tanpa identitas terdaftar dari papan IGD; perawat bangsal tidak membuka papan IGD', async ({
    browser,
  }) => {
    const admisi = await igdAccount('petugas_pendaftaran', 'Admisi IGD E2E Fiktif');
    const page = await open(browser, admisi, '/klinis/igd');
    await live(page);
    await page.getByRole('button', { name: '+ Daftarkan pasien IGD' }).click();
    const form = page.getByRole('region', { name: 'Pendaftaran pasien IGD' });
    await form.getByRole('radio', { name: 'Pasien tanpa identitas' }).check();
    await form.getByLabel('Jenis kelamin').selectOption('male');
    await form.getByLabel(/Perkiraan umur/).fill('35');
    const ciri = `Kaus hijau, tato jangkar ${newId().slice(-5)}`;
    await form.getByLabel(/Ciri-ciri/).fill(ciri);
    await form.getByRole('button', { name: 'Daftarkan ke IGD' }).click();
    await expect(page.getByText(/Pasien terdaftar di IGD \(IGD-/)).toBeVisible();
    const panel = page.getByRole('complementary', { name: 'Pasien IGD terpilih' });
    await expect(panel.getByRole('heading', { name: 'Tn. X' })).toBeVisible();
    await expect(panel).toContainText('identitas menyusul');

    // Perawat bangsal (clinical.read berlingkup unit Melati) membuka IGD: pesan jelas, bukan galat.
    const nurse = await createAccount({ roles: ['perawat'], unitName: 'Bangsal E2E IGD Fiktif' });
    const other = await open(browser, nurse, '/klinis/igd');
    await expect(other.getByText('Papan IGD hanya untuk petugas yang ditugaskan di IGD')).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
