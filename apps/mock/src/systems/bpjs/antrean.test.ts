import {
  ANTREAN_ENDPOINTS,
  antreanListTaskResponseSchema,
  antreanRefDokterResponseSchema,
  antreanRefPoliResponseSchema,
  HFIS_ENDPOINTS,
  hfisJadwalDokterResponseSchema,
} from '@simrs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { antreanAdd, createHarness, type Harness, KARTU, RABU, TEST_NOW, TODAY } from './test-kit';

let h: Harness;

beforeEach(() => {
  h = createHarness();
});

afterEach(async () => {
  await h.app.close();
});

const add = (body: object) => h.antrean(ANTREAN_ENDPOINTS.add, null, undefined, body);
/** Waktu task = 07.30 WIB + `menit` (jam mock 08.00 WIB; lebih dari 5 menit ke depan ditolak). */
const AWAL = TEST_NOW.getTime() - 30 * 60_000;
const task = (kodebooking: string, taskid: number, menit: number) =>
  h.antrean(ANTREAN_ENDPOINTS.updateWaktu, null, undefined, {
    kodebooking,
    taskid,
    waktu: AWAL + menit * 60_000,
  });
const batal = (kodebooking: string) =>
  h.antrean(ANTREAN_ENDPOINTS.batal, null, undefined, { kodebooking, keterangan: 'Pasien membatalkan' });
const hfisOverride = (payload: object) =>
  h.app.inject({ method: 'POST', url: '/_panel/api/bpjs/hfis', payload });

describe('tambah antrean', () => {
  it('JKN sah diterima (metadata 200 tanpa response); kode booking ganda ditolak', async () => {
    const res = await h.raw('antrean', ANTREAN_ENDPOINTS.add, { body: antreanAdd() });
    expect(res.json()).toEqual({ metadata: { code: 200, message: 'Ok' } });
    expect(h.state.bpjs.antrean.get('2610050117')?.status).toBe('aktif');
    expect(await add(antreanAdd())).toMatchObject({
      ok: false,
      code: '201',
      rejection: 'BPJS_ANTREAN_GANDA',
    });
  });

  it('validasi isian: JKN wajib kartu + referensi, sisa ≤ kuota, format jam praktik', async () => {
    expect(await add(antreanAdd({ nomorkartu: '' }))).toMatchObject({ rejection: 'BPJS_VALIDASI' });
    expect(await add(antreanAdd({ nomorreferensi: '' }))).toMatchObject({ rejection: 'BPJS_VALIDASI' });
    expect(await add(antreanAdd({ sisakuotajkn: 30 }))).toMatchObject({ rejection: 'BPJS_VALIDASI' });
    expect(await add(antreanAdd({ jampraktek: '08.00-12.00' }))).toMatchObject({
      rejection: 'BPJS_VALIDASI',
    });
    const nonJkn = antreanAdd({
      kodebooking: 'NJ-1',
      jenispasien: 'NON JKN',
      nomorkartu: '',
      nomorreferensi: '',
    });
    expect((await add(nonJkn)).ok).toBe(true);
  });

  it('poli, dokter, jadwal HFIS, tanggal, peserta, dan rujukan dicek', async () => {
    expect(await add(antreanAdd({ kodepoli: 'XYZ' }))).toMatchObject({
      rejection: 'BPJS_POLI_TIDAK_DITEMUKAN',
    });
    expect(await add(antreanAdd({ kodedokter: 99003 }))).toMatchObject({
      rejection: 'BPJS_DOKTER_TIDAK_DITEMUKAN',
    });
    expect(await add(antreanAdd({ jampraktek: '13:00-16:00' }))).toMatchObject({
      rejection: 'BPJS_JADWAL_TIDAK_DITEMUKAN',
    });
    // Jumat: dr. Andini tidak praktik.
    expect(await add(antreanAdd({ tanggalperiksa: '2026-10-09' }))).toMatchObject({
      rejection: 'BPJS_JADWAL_TIDAK_DITEMUKAN',
    });
    expect(await add(antreanAdd({ tanggalperiksa: '2026-10-02' }))).toMatchObject({
      rejection: 'BPJS_TANGGAL_TIDAK_VALID',
    });
    expect(await add(antreanAdd({ nomorkartu: KARTU.tidakAktif }))).toMatchObject({
      rejection: 'BPJS_PESERTA_TIDAK_AKTIF',
    });
    expect(await add(antreanAdd({ nomorkartu: KARTU.tidakAda }))).toMatchObject({
      rejection: 'BPJS_PESERTA_TIDAK_DITEMUKAN',
    });
    expect(await add(antreanAdd({ nomorreferensi: '9999P00112345678199' }))).toMatchObject({
      rejection: 'BPJS_RUJUKAN_KEDALUWARSA',
    });
    expect(h.state.bpjs.antrean.size).toBe(0);
  });

  it('dokter libur di HFIS ditolak; kuota HFIS penuh ditolak dan batal melepas kuota', async () => {
    await hfisOverride({ kodedokter: 99001, tanggal: TODAY, libur: true });
    expect(await add(antreanAdd())).toMatchObject({ rejection: 'BPJS_JADWAL_LIBUR' });
    await hfisOverride({ kodedokter: 99001, tanggal: TODAY, libur: false, kapasitaspasien: 1 });
    expect((await add(antreanAdd({ kodebooking: 'K-1' }))).ok).toBe(true);
    expect(await add(antreanAdd({ kodebooking: 'K-2' }))).toMatchObject({ rejection: 'BPJS_KUOTA_PENUH' });
    expect((await batal('K-1')).ok).toBe(true);
    expect((await add(antreanAdd({ kodebooking: 'K-2' }))).ok).toBe(true);
  });
});

describe('waktu task ID', () => {
  beforeEach(async () => {
    expect((await add(antreanAdd())).ok).toBe(true);
  });

  it('1 → 2 → 3 berurutan diterima dan tercatat di getlisttask (terenkripsi, format WIB)', async () => {
    for (const [id, m] of [
      [1, 0],
      [2, 5],
      [3, 12],
    ] as const) {
      expect(await task('2610050117', id, m)).toEqual({ ok: true, data: undefined });
    }
    const list = await h.antrean(ANTREAN_ENDPOINTS.getListTask, antreanListTaskResponseSchema, undefined, {
      kodebooking: '2610050117',
    });
    if (!list.ok) throw new Error(list.message);
    expect(list.data.map((t) => t.taskid)).toEqual([1, 2, 3]);
    expect(list.data[0]).toMatchObject({
      taskname: 'mulai waktu tunggu admisi',
      waktu: '05-10-2026 07:30:00 WIB',
    });
    expect(list.data[2]?.waktu).toBe('05-10-2026 07:42:00 WIB');
    expect(list.data[2]?.wakturs).toBe('05-10-2026 08:00:00 WIB');
  });

  it('menolak lompat urutan, task ganda, waktu mundur, dan waktu masa depan; pasien lama boleh mulai di 3', async () => {
    expect(await task('2610050117', 2, 0)).toMatchObject({ rejection: 'BPJS_TASK_TIDAK_BERURUTAN' });
    expect((await task('2610050117', 1, 0)).ok).toBe(true);
    const lompat = await task('2610050117', 3, 5);
    expect(lompat).toMatchObject({ ok: false, code: '201', rejection: 'BPJS_TASK_TIDAK_BERURUTAN' });
    expect(!lompat.ok && lompat.message).toContain('berikutnya: 2');
    expect(await task('2610050117', 1, 1)).toMatchObject({ rejection: 'BPJS_TASK_GANDA' });
    expect(await task('2610050117', 2, -5)).toMatchObject({ rejection: 'BPJS_TASK_WAKTU_MUNDUR' });
    expect(await task('2610050117', 2, 40)).toMatchObject({ rejection: 'BPJS_TANGGAL_TIDAK_VALID' });
    expect(await task('2610050117', 8, 1)).toMatchObject({ rejection: 'BPJS_VALIDASI' });
    expect(await task('TIDAK-ADA', 1, 1)).toMatchObject({ rejection: 'BPJS_ANTREAN_TIDAK_DITEMUKAN' });

    expect((await add(antreanAdd({ kodebooking: 'LAMA-1' }))).ok).toBe(true);
    expect((await task('LAMA-1', 3, 0)).ok).toBe(true);
    expect((await task('LAMA-1', 4, 10)).ok).toBe(true);
  });

  it('99 sebelum dilayani poli menutup antrean; setelah task 4 tidak bisa dibatalkan', async () => {
    expect((await task('2610050117', 1, 0)).ok).toBe(true);
    expect((await task('2610050117', 99, 3)).ok).toBe(true);
    expect(h.state.bpjs.antrean.get('2610050117')?.status).toBe('batal');
    expect(await task('2610050117', 2, 4)).toMatchObject({ rejection: 'BPJS_ANTREAN_SUDAH_BATAL' });

    expect((await add(antreanAdd({ kodebooking: 'B-2' }))).ok).toBe(true);
    for (const [id, m] of [
      [3, 0],
      [4, 10],
    ] as const) {
      expect((await task('B-2', id, m)).ok).toBe(true);
    }
    expect(await task('B-2', 99, 12)).toMatchObject({ rejection: 'BPJS_ANTREAN_SUDAH_DILAYANI' });
    expect(await batal('B-2')).toMatchObject({ rejection: 'BPJS_ANTREAN_SUDAH_DILAYANI' });
  });
});

describe('batal antrean', () => {
  it('batal sekali; ulang = sudah dibatalkan; kode tidak dikenal = tidak ditemukan', async () => {
    expect((await add(antreanAdd())).ok).toBe(true);
    expect(await batal('2610050117')).toEqual({ ok: true, data: undefined });
    expect(h.state.bpjs.antrean.get('2610050117')?.batal).toMatchObject({
      keterangan: 'Pasien membatalkan',
      lewat: 'batal',
    });
    expect(await batal('2610050117')).toMatchObject({ rejection: 'BPJS_ANTREAN_SUDAH_BATAL' });
    expect(await batal('TIDAK-ADA')).toMatchObject({ rejection: 'BPJS_ANTREAN_TIDAK_DITEMUKAN' });
    expect(
      await h.antrean(ANTREAN_ENDPOINTS.getListTask, antreanListTaskResponseSchema, undefined, {
        kodebooking: 'TIDAK-ADA',
      }),
    ).toMatchObject({ rejection: 'BPJS_ANTREAN_TIDAK_DITEMUKAN' });
  });
});

describe('jadwal dokter HFIS', () => {
  const jadwal = (kodepoli: string, tanggal: string) =>
    h.antrean(HFIS_ENDPOINTS.jadwalDokter, hfisJadwalDokterResponseSchema, { kodepoli, tanggal });

  it('perbedaan yang disemai: Rabu 7 Okt dr. Bagus (99003) masih praktik 09:00–12:00 di HFIS', async () => {
    const r = await jadwal('JAN', RABU);
    if (!r.ok) throw new Error(r.message);
    expect(r.data).toEqual([
      {
        kodedokter: 99003,
        namadokter: 'dr. Bagus Santoso, Sp.JP',
        kodepoli: 'JAN',
        namapoli: 'JANTUNG',
        kodesubspesialis: 'JAN',
        namasubspesialis: 'JANTUNG',
        hari: 3,
        namahari: 'RABU',
        jadwal: '09:00 - 12:00',
        kapasitaspasien: 20,
        libur: 0,
      },
    ]);
  });

  it('per poli dan hari; poli/tanggal salah dan hari tanpa jadwal ditolak', async () => {
    const jumat = await jadwal('INT', '2026-10-09');
    expect(jumat.ok && jumat.data.map((j) => [j.kodedokter, j.jadwal])).toEqual([[99002, '13:00 - 16:00']]);
    expect(await jadwal('XYZ', TODAY)).toMatchObject({ rejection: 'BPJS_POLI_TIDAK_DITEMUKAN' });
    expect(await jadwal('INT', '2026-10-11')).toMatchObject({ rejection: 'BPJS_JADWAL_TIDAK_DITEMUKAN' });
    expect(await jadwal('INT', '11-10-2026')).toMatchObject({ rejection: 'BPJS_VALIDASI' });
  });

  it('libur per tanggal dari aplikasi HFIS (panel) tampil sebagai libur 1 hanya di tanggal itu', async () => {
    await hfisOverride({ kodedokter: 99003, tanggal: RABU, libur: true });
    const rabu = await jadwal('JAN', RABU);
    expect(rabu.ok && rabu.data[0]?.libur).toBe(1);
    const rabuDepan = await jadwal('JAN', '2026-10-14');
    expect(rabuDepan.ok && rabuDepan.data[0]?.libur).toBe(0);
  });

  it('updatejadwaldokter mengganti templat mingguan; kapasitas lama dipertahankan; reset memulihkan', async () => {
    const update = (body: object) => h.antrean(HFIS_ENDPOINTS.updateJadwalDokter, null, undefined, body);
    const body = {
      kodepoli: 'JAN',
      kodesubspesialis: 'JAN',
      kodedokter: 99003,
      jadwal: [
        { hari: '1', buka: '09:00', tutup: '12:00' },
        { hari: '2', buka: '09:00', tutup: '12:00' },
        { hari: '4', buka: '10:00', tutup: '13:00' },
      ],
    };
    expect(await update(body)).toEqual({ ok: true, data: undefined });
    const rabu = await jadwal('JAN', RABU);
    expect(rabu).toMatchObject({ rejection: 'BPJS_JADWAL_TIDAK_DITEMUKAN' });
    const kamis = await jadwal('JAN', '2026-10-08');
    expect(kamis.ok && kamis.data.find((j) => j.kodedokter === 99003)).toMatchObject({
      jadwal: '10:00 - 13:00',
      kapasitaspasien: 20,
    });
    expect(h.state.bpjs.hfisUpdates[0]).toMatchObject({ kodedokter: 99003, kodepoli: 'JAN' });

    expect(await update({ ...body, kodedokter: 99001 })).toMatchObject({
      rejection: 'BPJS_DOKTER_TIDAK_DITEMUKAN',
    });
    expect(await update({ ...body, kodesubspesialis: 'INT' })).toMatchObject({
      rejection: 'BPJS_POLI_TIDAK_DITEMUKAN',
    });
    expect(await update({ ...body, jadwal: [{ hari: '1', buka: '12:00', tutup: '09:00' }] })).toMatchObject({
      rejection: 'BPJS_VALIDASI',
    });

    await h.app.inject({ method: 'POST', url: '/_panel/api/reset', payload: { system: 'bpjs' } });
    expect((await jadwal('JAN', RABU)).ok).toBe(true);
  });
});

describe('referensi Antrean', () => {
  it('poli dan dokter HFIS', async () => {
    const poli = await h.antrean(ANTREAN_ENDPOINTS.refPoli, antreanRefPoliResponseSchema);
    expect(poli.ok && poli.data.map((p) => p.kdpoli)).toEqual(['INT', 'JAN', 'SAR', 'PAR']);
    const dokter = await h.antrean(ANTREAN_ENDPOINTS.refDokter, antreanRefDokterResponseSchema);
    expect(dokter.ok && dokter.data.map((d) => d.kodedokter)).toEqual([
      99001, 99002, 99003, 99004, 99005, 99006,
    ]);
  });
});
