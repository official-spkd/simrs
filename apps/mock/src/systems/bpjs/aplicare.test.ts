import {
  APLICARE_ENDPOINTS,
  aplicareBedListResponseSchema,
  aplicareRefKelasResponseSchema,
} from '@simrs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './test-kit';

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(async () => {
  await h.app.close();
});

const PPK = '0301R001';
const ruang = (o: Record<string, unknown> = {}) => ({
  kodekelas: 'KL2',
  koderuang: 'MELATI',
  namaruang: 'Bangsal Melati',
  kapasitas: 60,
  tersedia: 10,
  tersediapria: 4,
  tersediawanita: 6,
  tersediapriawanita: 0,
  ...o,
});
const create = (body: object, kodeppk = PPK) =>
  h.aplicare(APLICARE_ENDPOINTS.bedCreate, null, { kodeppk }, body);
const update = (body: object) => h.aplicare(APLICARE_ENDPOINTS.bedUpdate, null, { kodeppk: PPK }, body);
const read = (start = 1, limit = 10) =>
  h.aplicare(APLICARE_ENDPOINTS.bedRead, aplicareBedListResponseSchema, { kodeppk: PPK, start, limit });

describe('Aplicare', () => {
  it('referensi kelas; respons polos dengan metadata.code 1; header bertanda tangan wajib', async () => {
    const kelas = await h.aplicare(APLICARE_ENDPOINTS.refKelas, aplicareRefKelasResponseSchema);
    expect(kelas.ok && kelas.data.list.map((k) => k.kodekelas)).toEqual([
      'VIP',
      'KL1',
      'KL2',
      'KL3',
      'ICU',
      'HCU',
      'ISO',
    ]);
    const raw = await h.raw('aplicare', APLICARE_ENDPOINTS.refKelas);
    expect(raw.json().metadata).toEqual({ code: 1, message: 'OK', totalitems: 7 });
    expect((await h.raw('aplicare', APLICARE_ENDPOINTS.refKelas, { headers: {} })).statusCode).toBe(401);
  });

  it('ruang didaftarkan, dibaca berhalaman, diperbarui (angka boleh string), lalu dihapus', async () => {
    expect(await read()).toEqual({ ok: true, data: { list: [] }, totalitems: 0 });
    expect(await create(ruang())).toEqual({ ok: true, data: undefined });
    expect(
      await create(
        ruang({
          kodekelas: 'ICU',
          koderuang: 'ICU',
          namaruang: 'ICU/ICCU',
          kapasitas: 12,
          tersedia: 1,
          tersediapria: 0,
          tersediawanita: 0,
          tersediapriawanita: 1,
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(await create(ruang())).toMatchObject({ ok: false, code: '0', rejection: 'BPJS_RUANG_GANDA' });

    const all = await read();
    if (!all.ok) throw new Error(all.message);
    expect(all.totalitems).toBe(2);
    expect(all.data.list[0]).toMatchObject({
      kodeppk: PPK,
      kodekelas: 'KL2',
      namakelas: 'KELAS II',
      tersedia: 10,
      lastupdate: '2026-10-05 08:00:00',
      rownumber: 1,
    });
    const page2 = await read(2, 1);
    expect(page2.ok && page2.data.list.map((b) => [b.koderuang, b.rownumber])).toEqual([['ICU', 2]]);

    h.setNow(new Date('2026-10-05T02:30:00Z'));
    expect(await update(ruang({ tersedia: '9', tersediapria: '3' }))).toMatchObject({ ok: true });
    const after = await read();
    expect(after.ok && after.data.list[0]).toMatchObject({
      tersedia: 9,
      tersediapria: 3,
      lastupdate: '2026-10-05 09:30:00',
    });

    const del = (body: object) => h.aplicare(APLICARE_ENDPOINTS.bedDelete, null, { kodeppk: PPK }, body);
    expect(await del({ kodekelas: 'ICU', koderuang: 'ICU' })).toMatchObject({ ok: true });
    expect(await del({ kodekelas: 'ICU', koderuang: 'ICU' })).toMatchObject({
      rejection: 'BPJS_RUANG_TIDAK_DITEMUKAN',
    });
    expect(await read()).toMatchObject({ ok: true, totalitems: 1 });
  });

  it('menolak kelas tak dikenal, ruang belum terdaftar, angka tak konsisten, PPK dan halaman tak sah', async () => {
    expect(await create(ruang({ kodekelas: 'XYZ' }))).toMatchObject({
      rejection: 'BPJS_KELAS_TIDAK_DITEMUKAN',
    });
    expect(await update(ruang())).toMatchObject({ rejection: 'BPJS_RUANG_TIDAK_DITEMUKAN' });
    expect(await create(ruang({ tersedia: 61 }))).toMatchObject({ rejection: 'BPJS_VALIDASI' });
    expect(await create(ruang({ tersediapriawanita: 1 }))).toMatchObject({ rejection: 'BPJS_VALIDASI' });
    expect(await create(ruang({ kapasitas: -1 }))).toMatchObject({ rejection: 'BPJS_VALIDASI' });
    expect(await create(ruang(), 'RS1')).toMatchObject({ rejection: 'BPJS_VALIDASI' });
    expect(await read(0, 10)).toMatchObject({ rejection: 'BPJS_VALIDASI' });
  });

  it('panel menampilkan ruang per PPK; reset BPJS mengosongkan', async () => {
    await create(ruang());
    await create(ruang({ koderuang: 'MAWAR', namaruang: 'Bangsal Mawar' }), '0301R002');
    const one = (await h.app.inject({ method: 'GET', url: `/_panel/api/bpjs/aplicare/${PPK}` })).json();
    expect(one.ruang.map((r: { koderuang: string }) => r.koderuang)).toEqual(['MELATI']);
    const summary = (await h.app.inject({ method: 'GET', url: '/_panel/api/bpjs' })).json();
    expect(summary.aplicare.map((a: { kodeppk: string }) => a.kodeppk)).toEqual([PPK, '0301R002']);
    await h.app.inject({ method: 'POST', url: '/_panel/api/reset', payload: { system: 'bpjs' } });
    expect(await read()).toMatchObject({ ok: true, totalitems: 0 });
  });
});
