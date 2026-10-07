import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { CONSENT_INFORMATION_ITEMS, newId } from '@simrs/shared';
import { type Account, createAccount, createPatient, inTenant, loginAs, TENANTS } from './support/accounts';
import { createStaff, createWard } from './support/inpatient';
import { stagingOf } from './support/staging';

/**
 * Rantai lintas layar IGD → rawat inap mode api (jaring regresi agen BUG, diperluas menjadi E2E penutup fase 3 §3.9):
 * pendaftaran IGD → triase (turun level wajib alasan) → dokter jaga "Ambil pasien" → keputusan rawat inap → alokasi bed
 * → admisi + gelang (DPJP = akun uji) → rekam Rawat inap (W4): CPPT DPJP, TTV + EWS perawat → CPOE resep injeksi →
 * eMAR terkunci sampai gelang dipindai, lalu dosis tercatat → tablet persetujuan: pasien paham + tanda tangan, saksi
 * petugas, edukasi tindakan paham, TTE dokter → Resume: himpun, isian DPJP, rekonsiliasi, 12 butir, TTE → pulang lewat
 * `DischargeGate` di papan tempat tidur (bed kotor) → staging SATUSEHAT `held` + `billable_events` kedua kunjungan.
 * Semua layar dijaga tanpa galat konsol/halaman dan tanpa respons 5xx. Data fiktif.
 */

const contexts: BrowserContext[] = [];
const errors: string[] = [];

async function as(browser: Browser, acc: Account, path: string): Promise<Page> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !`${m.text()} ${m.location().url}`.includes('favicon')) {
      errors.push(`${acc.displayName}: ${m.text()} @ ${m.location().url}`);
    }
  });
  page.on('pageerror', (e) => errors.push(`${acc.displayName}: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500)
      errors.push(`${acc.displayName}: ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  await loginAs(page, acc, path);
  return page;
}

/** Akun dengan penugasan di unit `unitCode` RSFA. */
async function staffIn(role: string, unitCode: string, displayName: string): Promise<Account> {
  const acc = await createAccount({ roles: [], displayName });
  await inTenant(TENANTS.RSFA, async (tx) => {
    const r = await tx.role.findFirstOrThrow({ where: { code: role } });
    const unit = await tx.unit.findFirstOrThrow({ where: { code: unitCode } });
    await tx.staffAssignment.create({
      data: { id: newId(), tenantId: TENANTS.RSFA, userId: acc.id, roleId: r.id, unitId: unit.id },
    });
  });
  return acc;
}

test.afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.close();
  expect(errors.splice(0)).toEqual([]);
});

test('rantai IGD → rawat inap (api): triase → admisi + gelang → CPPT/TTV/eMAR → persetujuan → resume TTE → pulang', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'cukup di proyek desktop (bangsal + akun dibuat per tes)');
  test.setTimeout(420_000);
  const suffix = newId().slice(-4).toUpperCase();
  const ward = await createWard();
  const dpjp = await createStaff('dokter', ward.unitId, `dr. DPJP Rantai ${suffix}, Sp.PD`);
  const nurse = await createStaff('perawat', ward.unitId, `Ns. Rantai ${suffix}`);
  const admisi = await staffIn('petugas_pendaftaran', 'IGD', `Admisi IGD Rantai ${suffix}`);
  const igdNurse = await staffIn('perawat', 'IGD', `Ns. IGD Rantai ${suffix}`);
  const jaga = await staffIn('dokter', 'IGD', `dr. Jaga Rantai ${suffix}`);
  // DPJP rawat inap = praktisi yang terikat akun uji (dipilih saat admisi → masuk tim perawatan).
  const practitionerName = `dr. DPJP Rantai ${suffix}`;
  await inTenant(TENANTS.RSFA, (tx) =>
    tx.practitioner.create({
      data: { id: newId(), tenantId: TENANTS.RSFA, name: practitionerName, userId: dpjp.id },
    }),
  );
  const patientName = `Tn. Rantai Ranap ${suffix} Fiktif`;
  const patient = await createPatient('RSFA', { name: patientName, sex: 'male', birthDate: '1961-05-17' });
  const need = `Penyakit dalam rantai ${suffix}`;

  // 1) Pendaftaran IGD (admisi IGD): cari rekam medis, ambulans, penjamin umum.
  const igd = await as(browser, admisi, '/klinis/igd');
  await igd.getByRole('button', { name: '+ Daftarkan pasien IGD' }).click();
  const form = igd.getByRole('region', { name: 'Pendaftaran pasien IGD' });
  await form.getByLabel('No. RM, NIK, No. BPJS, atau nama').fill(patient.mrn);
  await form.getByRole('button', { name: 'Cari pasien' }).click();
  await form.getByRole('radio', { name: new RegExp(patientName) }).check();
  await form.getByLabel('Cara datang').selectOption('ambulans');
  await form.getByRole('button', { name: 'Daftarkan ke IGD' }).click();
  await expect(igd.getByText(/Pasien terdaftar di IGD \(IGD-/)).toBeVisible();

  // 2) Perawat IGD: triase dengan saran server; turun level wajib alasan.
  const tri = await as(browser, igdNurse, '/klinis/igd');
  await tri.getByRole('button', { name: new RegExp(patientName) }).click();
  const tp = tri.getByRole('complementary', { name: 'Pasien IGD terpilih' });
  await tp.getByLabel(/TD sistolik/).fill('86');
  await tp.getByLabel(/TD diastolik/).fill('58');
  await tp.getByLabel(/^Nadi/).fill('112');
  await tp.getByLabel(/^SpO2/).fill('96');
  await expect(tp.getByText(/Saran sistem \(server\): triase 2/)).toBeVisible();
  await tp.getByRole('radio', { name: /^Level 3/ }).check({ force: true });
  const saveTriage = tp.getByRole('button', { name: 'Simpan triase 3' });
  await expect(saveTriage).toBeDisabled();
  await tp.getByLabel(/Alasan memilih level lebih rendah/).fill('Hipotensi membaik setelah posisi berbaring');
  await saveTriage.click();
  await expect(tp.getByText('Triase 3 tersimpan.')).toBeVisible();

  // 3) Dokter jaga IGD mengambil pasien.
  const igdDoc = await as(browser, jaga, '/klinis/igd');
  await igdDoc.getByRole('button', { name: new RegExp(patientName) }).click();
  const jp = igdDoc.getByRole('complementary', { name: 'Pasien IGD terpilih' });
  await jp.getByRole('button', { name: 'Ambil pasien' }).click();
  await expect(jp.getByText('Anda penanggung jawab IGD pasien ini.')).toBeVisible();

  // 4) Keputusan rawat inap (admisi IGD) → papan tempat tidur: alokasi ke bed bangsal uji → admisi + gelang.
  await igd.reload();
  await igd.getByRole('button', { name: new RegExp(patientName) }).click();
  const ap = igd.getByRole('complementary', { name: 'Pasien IGD terpilih' });
  await ap.getByLabel('Kelas rawat').selectOption('kelas_1');
  await ap.getByLabel('Kebutuhan ruang').fill(need);
  await ap.getByRole('button', { name: 'Putuskan rawat inap · minta bed' }).click();
  await expect(ap.getByText(/Permintaan bed menunggu alokasi/)).toBeVisible();

  const bed = await as(browser, admisi, '/klinis/tempat-tidur');
  const req = bed.getByRole('listitem').filter({ hasText: need });
  await expect(req).toBeVisible({ timeout: 15_000 });
  await req.getByLabel('Alokasikan ke bed siap').selectOption(ward.bedId);
  await req.getByRole('button', { name: 'Alokasikan' }).click();
  await expect(req.getByText('(dipesan)')).toBeVisible();
  await req.getByLabel('DPJP rawat inap').selectOption({ label: practitionerName });
  await req.getByRole('checkbox', { name: 'Persetujuan umum sudah ditandatangani' }).check();
  await req.getByRole('button', { name: 'Admisi · terbitkan gelang' }).click();
  await expect(
    bed.getByRole('region', { name: 'Permintaan bed' }).getByText(`Admisi selesai di ${ward.bedCode}.`),
  ).toBeVisible();
  const ids = await inTenant(TENANTS.RSFA, async (tx) => {
    const imp = await tx.encounter.findFirstOrThrow({
      where: { patientId: patient.id, encounterClass: 'IMP' },
      select: { id: true, sourceEncounterId: true },
    });
    const band = await tx.patientWristband.findFirstOrThrow({
      where: { encounterId: imp.id, voidedAt: null },
      select: { code: true },
    });
    return { imp: imp.id, igd: imp.sourceEncounterId as string, wristband: band.code };
  });
  expect(ids.igd).toMatch(/^[0-9a-f-]{36}$/);

  // 5) DPJP: rekam Rawat inap → CPPT (SOAP) final → tautan cepat ke CPOE → resep injeksi stat.
  const doc = await as(browser, dpjp, '/klinis/rawat-inap');
  await doc.getByRole('link', { name: new RegExp(patientName) }).click();
  await expect(doc.getByLabel('Identitas pasien')).toContainText(patient.mrn);
  const cppt = doc.getByRole('region', { name: 'CPPT terintegrasi' });
  await cppt.getByRole('button', { name: '+ Tulis CPPT (SOAP)' }).click();
  const note = doc.getByRole('form', { name: 'Tulis CPPT baru' });
  await note.getByLabel('S · Subjektif').fill('Demam 4 hari, batuk berdahak, sesak napas');
  await note.getByLabel('O · Objektif').fill('Ronki basah paru kanan bawah, SpO2 94%');
  await note.getByLabel('A · Asesmen').fill('Pneumonia komunitas');
  await note.getByLabel('P · Rencana').fill('Seftriakson IV, oksigen nasal, foto toraks');
  await note.getByRole('button', { name: 'Simpan dan tanda tangani' }).click();
  await expect(cppt.getByRole('listitem').filter({ hasText: 'Demam 4 hari' })).toBeVisible();
  const quick = doc.getByRole('navigation', { name: 'Tautan cepat pasien' });
  await expect(quick.getByRole('link', { name: /^Persetujuan tindakan/ })).toHaveAttribute(
    'href',
    `/tablet/persetujuan?kunjungan=${ids.imp}`,
  );
  await quick.getByRole('link', { name: 'Order & resep (CPOE)' }).click();
  await expect(doc).toHaveURL(new RegExp(`/klinis/order/${ids.imp}$`));
  await doc.getByLabel('Cari pemeriksaan, obat, tindakan').fill('seftriakson');
  await doc.getByRole('button', { name: 'Tambah Seftriakson 2 g injeksi' }).click();
  await doc.getByRole('textbox', { name: /^Dosis/ }).fill('2 g');
  await doc.getByRole('combobox', { name: /^Aturan pakai/ }).selectOption('stat');
  // Keselamatan resep: sediaan injeksi tidak diberi rute bawaan "oral"; kirim tertahan sampai rute dipilih.
  const route = doc.getByRole('combobox', { name: /^Rute/ });
  await expect(route).toHaveValue('');
  const send = doc.getByRole('button', { name: 'Kirim 1 order' });
  await expect(send).toBeDisabled();
  await route.selectOption('intravena');
  await send.click();
  await expect(doc.getByRole('status').filter({ hasText: '1 order terkirim' })).toBeVisible();
  const request = await inTenant(TENANTS.RSFA, (tx) =>
    tx.medicationRequest.findFirstOrThrow({
      where: { encounterId: ids.imp },
      select: { id: true, route: true, frequency: true },
    }),
  );
  expect(request).toMatchObject({ route: 'intravena', frequency: 'stat' });

  // 6) Perawat bangsal: TTV + EWS, lalu eMAR terkunci sampai gelang cocok → dosis tercatat.
  const ns = await as(browser, nurse, '/klinis/rawat-inap');
  await ns.getByRole('link', { name: new RegExp(patientName) }).click();
  await expect(ns.getByLabel('Identitas pasien')).toContainText(patient.mrn);
  await ns.getByRole('tab', { name: 'Observasi & EWS' }).click();
  const obs = ns.getByRole('form', { name: 'Catat observasi' });
  await obs.getByLabel('Suhu (°C)').fill('38,6');
  await obs.getByLabel('Nadi (x/mnt)').fill('108');
  await obs.getByLabel('Napas (x/mnt)').fill('24');
  await obs.getByLabel('TD sistolik (mmHg)').fill('104');
  await obs.getByLabel('TD diastolik (mmHg)').fill('66');
  await obs.getByLabel('SpO2 (%)').fill('94');
  await obs.getByLabel('Kesadaran (ACVPU)').selectOption('A');
  await expect(obs.getByText(/Pratinjau EWS \d+/)).toBeVisible();
  await obs.getByRole('button', { name: 'Simpan observasi' }).click();
  await expect(ns.getByRole('table', { name: 'Observasi tanda vital dan skor EWS' })).toContainText('38,6');

  await ns.getByRole('tab', { name: 'eMAR' }).click();
  const emar = ns.getByRole('region', { name: 'eMAR' });
  await expect(emar.getByText('Pemberian obat terkunci sampai gelang pasien cocok')).toBeVisible();
  const slots = emar.getByRole('button', { name: /^Seftriakson 2 g injeksi/ });
  await expect(slots.first()).toBeDisabled();
  await emar.getByLabel('Kode gelang pasien').fill(ids.wristband);
  await emar.getByRole('button', { name: 'Pindai gelang', exact: true }).click();
  await expect(emar.getByText(/Pasien benar · gelang terpindai/)).toBeVisible();
  await slots.first().click();
  const dose = emar.getByRole('region', { name: /Seftriakson 2 g injeksi · / });
  await dose.getByLabel('Kode label obat (pindai label dari farmasi)').fill(request.id);
  await dose.getByRole('button', { name: 'Catat pemberian' }).click();
  await expect(emar.getByRole('status').filter({ hasText: 'diberikan tercatat' })).toBeVisible();

  // 7) Tablet persetujuan (sesi staf): draf → pasien paham + tanda tangan → saksi petugas (perawat) → edukasi
  // tindakan paham → TTE dokter.
  await doc.goto(`/tablet/persetujuan?kunjungan=${ids.imp}`);
  const procedure = 'Pemasangan kateter vena sentral';
  const draftForm = doc.getByRole('region', { name: 'Draf persetujuan baru' });
  await draftForm.getByLabel('Tindakan yang akan dilakukan').fill(procedure);
  for (const [k, item] of CONSENT_INFORMATION_ITEMS.entries()) {
    await draftForm
      .getByLabel(`${k + 1}. ${item.label}`)
      .fill(`${item.label} untuk ${procedure} (uji fiktif).`);
  }
  await draftForm.getByRole('button', { name: 'Simpan draf dan buka di tablet' }).click();
  await expect(doc).toHaveURL(/\/tablet\/persetujuan\/[0-9a-f-]{36}$/);
  const draftUrl = doc.url();
  const next = (name: string) => doc.getByRole('button', { name, exact: true });
  for (const item of CONSENT_INFORMATION_ITEMS) {
    await doc.getByRole('checkbox', { name: `Saya memahami: ${item.label}` }).check();
  }
  await next('Lanjut ke tanda tangan').click();
  const pad = doc.getByRole('img', { name: 'Tanda tangan pasien' });
  const box = await pad.boundingBox();
  if (!box) throw new Error('Bantalan tanda tangan tidak tampil');
  await doc.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
  await doc.mouse.down();
  for (const [x, y] of [
    [0.35, 0.3],
    [0.5, 0.7],
    [0.65, 0.35],
    [0.8, 0.6],
  ] as const) {
    await doc.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 8 });
  }
  await doc.mouse.up();
  await expect(doc.getByText(`${patientName} · goresan`)).toBeVisible();
  await next('Lanjut ke saksi').click();
  await doc.getByRole('button', { name: 'Simpan tanda tangan' }).click();
  await expect(doc.getByRole('status').filter({ hasText: 'Tanda tangan tersimpan' })).toBeVisible();

  await ns.goto(new URL(draftUrl).pathname);
  await ns.getByRole('button', { name: `Saya (${nurse.displayName}) hadir sebagai saksi petugas` }).click();
  await expect(ns.getByText('Saksi petugas tercatat', { exact: true })).toBeVisible();

  await doc.reload();
  await doc.getByRole('link', { name: 'Isi edukasi tindakan' }).click();
  const edu = doc.getByRole('form', { name: 'Catat edukasi' });
  await edu
    .getByRole('checkbox', { name: 'Tindakan yang direncanakan: manfaat, risiko, alternatif' })
    .check();
  await edu.getByRole('radio', { name: 'Pasien dan keluarga' }).check();
  await edu.getByRole('radio', { name: 'Memahami, bisa mengulang' }).check();
  await edu.getByRole('button', { name: 'Simpan edukasi' }).click();
  const eduStatus = doc.getByRole('region', { name: 'Status edukasi tindakan' });
  await expect(eduStatus).toContainText('Terverifikasi paham');
  await eduStatus.getByRole('link', { name: 'Kembali ke tablet persetujuan' }).click();
  await expect(doc).toHaveURL(draftUrl);
  await next('Tanda tangani (TTE)').click();
  await expect(doc.getByRole('status').filter({ hasText: 'Dokumen final' })).toBeVisible();

  // 8) Resume medis: himpun dari sumber → isian DPJP → rekonsiliasi → 12 butir → TTE (terkunci).
  await doc.goto(`/klinis/resume/${ids.imp}`);
  await doc.getByRole('button', { name: 'Himpun resume' }).click();
  await expect(doc.getByText(/Draf resume dihimpun/)).toBeVisible();
  await expect(
    doc.getByRole('article', { name: 'Alasan masuk dan anamnesis singkat' }).getByText(/Demam 4 hari/),
  ).toBeVisible();
  await expect(doc.getByRole('article', { name: 'Terapi selama dirawat' })).toContainText('1× diberikan');
  await doc.getByRole('combobox', { name: 'Cara pulang' }).selectOption('pulang');
  await doc.getByRole('textbox', { name: 'Kondisi pulang' }).fill('Membaik');
  await doc
    .getByRole('textbox', { name: 'Catatan penunjang (mis. "tidak ada pemeriksaan penunjang")' })
    .fill('Foto toraks belum keluar saat pulang');
  await doc
    .getByRole('textbox', { name: 'Catatan pemeriksaan fisik pulang' })
    .fill('Ronki berkurang, afebris');
  await doc
    .getByRole('textbox', { name: 'Edukasi pasien dan keluarga' })
    .fill('Minum obat tuntas, tanda bahaya');
  await doc
    .getByRole('textbox', { name: 'Instruksi pulang dan tanda bahaya' })
    .fill('Kembali bila demam ≥ 38,5 °C atau sesak');
  await doc.getByRole('textbox', { name: 'Tindak lanjut / jadwal kontrol' }).fill('Kontrol poli 7 hari');
  await doc.getByRole('button', { name: 'Simpan draf resume' }).click();
  await expect(doc.getByText('Draf resume tersimpan.')).toBeVisible();
  await doc.getByRole('button', { name: 'Konfirmasi DPJP' }).click();
  await expect(doc.getByText('Rekonsiliasi obat pulang dikonfirmasi.')).toBeVisible();
  await expect(doc.getByRole('progressbar', { name: 'Kelengkapan resume' })).toHaveAttribute(
    'aria-valuenow',
    '12',
  );
  await doc.getByRole('button', { name: 'Tanda tangani resume (TTE)' }).click();
  await expect(doc.getByText(/Resume final · versi 1/)).toBeVisible();

  // 9) Pulang lewat DischargeGate di papan tempat tidur (admisi) → bed kotor.
  await bed.reload();
  await bed.getByRole('button', { name: new RegExp(`^${ward.bedCode} · Terisi`) }).click();
  await bed
    .getByRole('region', { name: `Bed ${ward.bedCode}` })
    .getByRole('button', { name: 'Pulangkan pasien' })
    .click();
  await expect(bed.getByRole('button', { name: new RegExp(`^${ward.bedCode} · Kotor`) })).toBeVisible();
  const finished = await inTenant(TENANTS.RSFA, (tx) =>
    tx.encounter.findMany({
      where: { id: { in: [ids.igd, ids.imp] } },
      select: { encounterClass: true, status: true, disposition: true },
      orderBy: { encounterClass: 'asc' },
    }),
  );
  expect(finished).toEqual([
    { encounterClass: 'EMER', status: 'finished', disposition: 'rawat_inap' },
    { encounterClass: 'IMP', status: 'finished', disposition: 'pulang' },
  ]);

  // 10) Staging lintas fase (ADR-0032) kedua kunjungan: SATUSEHAT `held` saja, biaya tanpa harga.
  const staging = await stagingOf([ids.igd, ids.imp]);
  expect(staging.notHeld).toEqual([]);
  expect(staging.held).toEqual(
    expect.arrayContaining([
      'composition',
      'encounter',
      'medicationadministration',
      'medicationrequest',
      'observation',
    ]),
  );
  expect(staging.billable).toEqual(expect.arrayContaining(['admisi', 'igd', 'obat', 'pulang', 'visite']));
});
