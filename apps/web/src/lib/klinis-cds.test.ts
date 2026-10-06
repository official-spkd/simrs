import { formatRupiah } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { catalogItem, CPOE_CATALOG } from './demo/fixtures/klinis';
import {
  type CdsPatient,
  costEstimate,
  evaluateCds,
  evaluateOrders,
  type OrderLine,
  preSendChecks,
  sendGate,
  cdsFixes,
  cpoeSendView,
  SCENARIO_ORDER_NOTE,
  shortDrugName,
} from './klinis-cds';

const endang: CdsPatient = {
  allergies: ['Amoksisilin'],
  activeMeds: [{ name: 'Metformin 500 mg · 2×1', substance: 'metformin', catalogId: 'metformin-500' }],
  flags: [],
  egfr: 84,
  payer: 'BPJS',
};
const darmawan: CdsPatient = {
  allergies: ['Ibuprofen'],
  activeMeds: [],
  flags: [],
  egfr: null,
  payer: 'Asuransi',
};
const hartono: CdsPatient = {
  allergies: [],
  activeMeds: [
    { name: 'Amlodipin 5 mg', substance: 'amlodipin', catalogId: 'amlodipin-5' },
    { name: 'Omeprazol 20 mg', substance: 'omeprazol', catalogId: 'omeprazol-20' },
  ],
  flags: ['ckd'],
  egfr: null,
  payer: 'BPJS',
};

const lineOf = (
  id: string,
  override: string | null = null,
  status: OrderLine['status'] = 'draf',
): OrderLine => ({
  lineId: id,
  item: catalogItem(id),
  status,
  override,
});

describe('CDS alergi', () => {
  it('zat yang sama dengan alergi pasien diblokir', () => {
    const f = evaluateCds(catalogItem('amoksisilin-500'), endang);
    expect(f.level).toBe('block');
    expect(f.rule).toBe('alergi');
    expect(f.message).toMatch(/alergi amoksisilin/);
  });

  it('golongan sama (AINS) diblokir; reaksi silang sefalosporin gen. 1 blok, gen. 3 peringatan', () => {
    expect(evaluateCds(catalogItem('asam-mefenamat-500'), darmawan)).toMatchObject({
      level: 'block',
      rule: 'alergi',
    });
    expect(evaluateCds(catalogItem('sefadroksil-500'), endang)).toMatchObject({
      level: 'block',
      rule: 'alergi-silang',
    });
    expect(evaluateCds(catalogItem('seftriakson-2g'), endang)).toMatchObject({
      level: 'warn',
      rule: 'alergi-silang',
    });
  });

  it('alternatif non-beta-laktam aman, parasetamol aman untuk alergi ibuprofen', () => {
    expect(evaluateCds(catalogItem('azitromisin-500'), endang).level).toBe('info');
    expect(evaluateCds(catalogItem('klindamisin-300'), endang).level).toBe('info');
    expect(evaluateCds(catalogItem('parasetamol-500'), darmawan).level).toBe('info');
  });
});

describe('CDS interaksi, riwayat, dosis', () => {
  it('klopidogrel × omeprazol (obat rutin) diblokir; tidak lagi setelah PPI diganti pantoprazol', () => {
    expect(evaluateCds(catalogItem('klopidogrel-75'), hartono)).toMatchObject({
      level: 'block',
      rule: 'interaksi',
    });
    const switched: CdsPatient = {
      ...hartono,
      activeMeds: [{ name: 'Pantoprazol 40 mg', substance: 'pantoprazol', catalogId: 'pantoprazol-40' }],
    };
    expect(evaluateCds(catalogItem('klopidogrel-75'), switched).level).toBe('info');
  });

  it('interaksi juga terdeteksi terhadap order lain di daftar', () => {
    const lines = evaluateOrders(
      [lineOf('klopidogrel-75'), lineOf('omeprazol-20')],
      { ...hartono, activeMeds: [] },
      'dr. X',
    );
    expect(lines.map((l) => l.cds.level)).toEqual(['block', 'block']);
  });

  it('sulfonilurea pada riwayat hipoglikemia berat diblokir; tanpa riwayat hanya peringatan interaksi', () => {
    const suryo: CdsPatient = { ...endang, allergies: [], flags: ['hipoglikemia-berat'] };
    expect(evaluateCds(catalogItem('glimepirid-2'), suryo)).toMatchObject({
      level: 'block',
      rule: 'riwayat',
    });
    expect(evaluateCds(catalogItem('glimepirid-2'), { ...suryo, flags: [] })).toMatchObject({
      level: 'warn',
      rule: 'interaksi',
    });
  });

  it('dosis berubah dari obat rutin = peringatan; obat rutin yang sama = lanjutan', () => {
    const siti: CdsPatient = {
      allergies: [],
      activeMeds: [{ name: 'Amlodipin 5 mg · 1×1 pagi', substance: 'amlodipin', catalogId: 'amlodipin-5' }],
      flags: [],
      egfr: null,
      payer: 'BPJS',
    };
    expect(evaluateCds(catalogItem('amlodipin-10'), siti)).toMatchObject({ level: 'warn', rule: 'dosis' });
    expect(evaluateCds(catalogItem('amlodipin-5'), siti).message).toMatch(/^Lanjutan obat rutin/);
  });

  it('dosis ginjal dari KB contoh bersama: metformin diblokir bila eGFR < 30, aman bila eGFR cukup', () => {
    const ckd: CdsPatient = { ...darmawan, allergies: [], egfr: 25 };
    expect(evaluateCds(catalogItem('metformin-500'), ckd)).toMatchObject({ level: 'block', rule: 'ginjal' });
    expect(evaluateCds(catalogItem('metformin-500'), { ...ckd, egfr: 30 }).level).toBe('info');
    expect(evaluateCds(catalogItem('metformin-500'), { ...ckd, egfr: null }).level).toBe('info');
  });
});

describe('override, biaya, dan gerbang kirim', () => {
  it('override butuh alasan ≥ 10 karakter; baru setelah itu blok turun menjadi peringatan tercatat', () => {
    const short = evaluateOrders([lineOf('amoksisilin-500', 'alergi')], endang, 'dr. X')[0];
    expect(short?.blocked).toBe(true);
    const ok = evaluateOrders(
      [lineOf('amoksisilin-500', 'Ruam ringan 10 th lalu, uji kulit negatif')],
      endang,
      'dr. X',
    )[0];
    expect(ok).toMatchObject({ blocked: false, overridden: true });
    expect(ok?.cds.level).toBe('warn');
    expect(ok?.cds.message).toMatch(/^Override alergi oleh dr\. X · alasan: Ruam ringan/);
  });

  it('tombol kirim tertahan dengan alasan tertulis selama ada blok', () => {
    const lines = evaluateOrders([lineOf('darah-lengkap'), lineOf('amoksisilin-500')], endang, 'dr. X');
    const gate = sendGate(lines);
    expect(gate.count).toBe(2);
    expect(gate.reason).toMatch(/1 order diblokir CDS \(amoksisilin\)/);
    expect(preSendChecks(lines, 'dr. X', 'BPJS').some((c) => c.tone === 'block')).toBe(true);
    expect(sendGate(evaluateOrders([lineOf('darah-lengkap')], endang, 'dr. X')).reason).toBeNull();
    expect(
      sendGate(evaluateOrders([lineOf('darah-lengkap', null, 'terkirim')], endang, 'dr. X')).reason,
    ).toMatch(/Belum ada order baru/);
  });

  it('estimasi biaya: pasien umum membayar semua tarif, pasien BPJS hanya item di luar paket', () => {
    const lines = ['hba1c', 'vitamin-d', 'parasetamol-500'].map((id) => lineOf(id));
    const umum = costEstimate(lines, 'Umum');
    expect(umum).toEqual({ total: 185_000n + 385_000n + 10_000n, items: 3 });
    expect(formatRupiah(umum.total)).toBe('Rp 580.000');
    expect(costEstimate(lines, 'BPJS')).toEqual({ total: 385_000n, items: 1 });
    expect(evaluateCds(catalogItem('vitamin-d'), endang)).toMatchObject({ level: 'warn', rule: 'biaya' });
  });
});

describe('tindak lanjut gerbang CDS', () => {
  it('alergi amoksisilin: ganti klindamisin/azitromisin atau hapus; interaksi PPI: ganti pantoprazol', () => {
    const lines = evaluateOrders([lineOf('amoksisilin-500'), lineOf('darah-lengkap')], endang, 'dr. X');
    const blocked = lines[0];
    if (!blocked) throw new Error('baris tidak ada');
    expect(cdsFixes(blocked, lines, CPOE_CATALOG).map((f) => f.label)).toEqual([
      'Ganti klindamisin 300 mg',
      'Ganti azitromisin 500 mg',
      'Hapus amoksisilin',
    ]);
    const ppi = evaluateOrders(
      [lineOf('klopidogrel-75'), lineOf('omeprazol-20')],
      { ...hartono, activeMeds: [] },
      'dr. X',
    );
    const clop = ppi[0];
    if (!clop) throw new Error('baris tidak ada');
    expect(cdsFixes(clop, ppi, CPOE_CATALOG)[0]).toMatchObject({
      kind: 'swap',
      toId: 'pantoprazol-40',
      label: 'Ganti omeprazol ke pantoprazol 40 mg',
    });
    expect(shortDrugName('Asetosal 160 mg tablet kunyah')).toBe('asetosal 160 mg');
  });
});

describe('tombol kirim CPOE pasien skenario', () => {
  const open = { count: 2, reason: null };
  const blocked = { count: 2, reason: 'Belum bisa dikirim: 1 order diblokir CDS (glimepirid).' };

  it('kunjungan biasa: kirim draf bila tidak ada blok; setelah terkirim tombol mati', () => {
    const base = { scenarioOwned: false, sendTask: null, stepActive: false, sent: false };
    expect(cpoeSendView({ ...base, gate: open })).toEqual({
      label: 'Tanda tangani dan kirim 2 order',
      canSend: true,
      reason: null,
    });
    expect(cpoeSendView({ ...base, gate: blocked })).toMatchObject({
      canSend: false,
      reason: blocked.reason,
    });
    expect(cpoeSendView({ ...base, gate: open, sent: true })).toMatchObject({
      label: 'Order terkirim',
      canSend: false,
    });
    expect(cpoeSendView({ ...base, gate: open, sent: true, sentAt: '10.41' }).label).toBe(
      'Order terkirim · 10.41',
    );
  });

  it('pasien skenario dengan tugas kirim: hanya lewat tugas yang giliran DAN gerbang CDS sudah selesai', () => {
    const base = { scenarioOwned: true, stepActive: true, sent: false };
    const ready = { done: false, enabled: true };
    expect(cpoeSendView({ ...base, sendTask: ready, gate: open })).toEqual({
      label: 'Kirim resep (TTE)',
      canSend: true,
      reason: null,
    });
    // Gerbang CDS belum ditindaklanjuti: tidak bisa dikirim walau tugas sudah giliran.
    expect(cpoeSendView({ ...base, sendTask: ready, gate: blocked })).toMatchObject({
      canSend: false,
      reason: blocked.reason,
    });
    // Tugas belum giliran (rencana terapi/PRB belum selesai).
    expect(cpoeSendView({ ...base, sendTask: { done: false, enabled: false }, gate: open })).toMatchObject({
      canSend: false,
      reason: 'Belum bisa dikirim: selesaikan rencana terapi, gerbang CDS, dan PRB lebih dulu.',
    });
    expect(cpoeSendView({ ...base, sendTask: { done: true, enabled: false }, gate: open }).canSend).toBe(
      false,
    );
  });

  it('pasien skenario tanpa tugas kirim (order lewat tugas lain): tombol kirim asli mati dengan alasan', () => {
    const base = { scenarioOwned: true, sendTask: null, sent: false, gate: open };
    const active = cpoeSendView({ ...base, stepActive: true });
    expect(active).toMatchObject({ label: 'Kirim order (TTE)', canSend: false });
    expect(active.reason).toContain(SCENARIO_ORDER_NOTE);
    expect(active.reason).toContain('tugas langkah aktif');
    const idle = cpoeSendView({ ...base, stepActive: false });
    expect(idle.canSend).toBe(false);
    expect(idle.reason).toContain('Tidak ada langkah order yang aktif');
  });
});
