import { z } from 'zod';
import { type BpjsEndpoint, bpjsDateSchema, bpjsNikSchema } from './common';

/**
 * I03 → F02/F04 · Antrean RS: tambah antrean (booking), waktu task ID, batal, daftar task, referensi.
 * Path relatif terhadap `BPJS_SERVICE_PREFIX.antrean`. Hanya `getListTask`, `refPoli`, `refDokter` (dan jadwal
 * dokter, lihat `hfis.ts`) yang punya `response` terenkripsi; operasi tulis hanya menjawab `metadata`.
 */
export const ANTREAN_ENDPOINTS = {
  /** Daftarkan booking ke BPJS → `metadata` saja. */
  add: { method: 'POST', path: '/antrean/add' },
  /** Kirim waktu task ID → `metadata` saja. */
  updateWaktu: { method: 'POST', path: '/antrean/updatewaktu' },
  /** Batalkan antrean → `metadata` saja. */
  batal: { method: 'POST', path: '/antrean/batal' },
  /** Task yang sudah tercatat untuk satu kode booking → `antreanListTaskResponseSchema`. */
  getListTask: { method: 'POST', path: '/antrean/getlisttask' },
  /** Referensi poli Antrean → `antreanRefPoliResponseSchema`. */
  refPoli: { method: 'GET', path: '/ref/poli' },
  /** Referensi dokter Antrean (kode HFIS) → `antreanRefDokterResponseSchema`. */
  refDokter: { method: 'GET', path: '/ref/dokter' },
} as const satisfies Record<string, BpjsEndpoint>;

// ---------------------------------------------------------------------------------------------------------------
// Tambah antrean
// ---------------------------------------------------------------------------------------------------------------

export const ANTREAN_JENIS_PASIEN = ['JKN', 'NON JKN'] as const;

/** 1 rujukan FKTP, 2 rujukan internal, 3 kontrol, 4 rujukan antar-RS. */
export const ANTREAN_JENIS_KUNJUNGAN = {
  rujukanFktp: 1,
  rujukanInternal: 2,
  kontrol: 3,
  rujukanAntarRs: 4,
} as const;

/** `jampraktek` Antrean: `HH:mm-HH:mm` (tanpa spasi, beda dengan `jadwal` HFIS `HH:mm - HH:mm`). */
export const ANTREAN_JAM_PRAKTEK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

const count = z.number().int().min(0);

export const antreanAddRequestSchema = z
  .object({
    kodebooking: z.string().min(1).max(32),
    jenispasien: z.enum(ANTREAN_JENIS_PASIEN),
    /** 13 digit untuk JKN, kosong untuk non-JKN. */
    nomorkartu: z.string().regex(/^(\d{13})?$/, 'nomorkartu harus 13 digit atau kosong'),
    nik: bpjsNikSchema,
    nohp: z.string().regex(/^\+?\d{8,15}$/, 'nohp tidak valid'),
    kodepoli: z.string().min(1).max(10),
    namapoli: z.string().min(1),
    pasienbaru: z.literal([0, 1]),
    norm: z.string().min(1).max(20),
    tanggalperiksa: bpjsDateSchema,
    /** Kode dokter HFIS (angka). */
    kodedokter: z.number().int().positive(),
    namadokter: z.string().min(1),
    jampraktek: z.string().regex(ANTREAN_JAM_PRAKTEK_PATTERN, 'jampraktek harus HH:mm-HH:mm'),
    jeniskunjungan: z.literal([1, 2, 3, 4]),
    /** No. rujukan / surat kontrol (wajib untuk JKN), kosong untuk non-JKN. */
    nomorreferensi: z.string().max(40),
    nomorantrean: z.string().min(1).max(10),
    angkaantrean: z.number().int().positive(),
    /** Perkiraan dilayani, milidetik epoch. */
    estimasidilayani: z.number().int().positive(),
    sisakuotajkn: count,
    kuotajkn: count,
    sisakuotanonjkn: count,
    kuotanonjkn: count,
    keterangan: z.string().max(200),
  })
  .superRefine((b, ctx) => {
    if (b.jenispasien === 'JKN' && b.nomorkartu === '') {
      ctx.addIssue({ code: 'custom', path: ['nomorkartu'], message: 'nomorkartu wajib untuk pasien JKN' });
    }
    if (b.jenispasien === 'JKN' && b.nomorreferensi === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['nomorreferensi'],
        message: 'nomorreferensi wajib untuk pasien JKN',
      });
    }
    if (b.sisakuotajkn > b.kuotajkn) {
      ctx.addIssue({ code: 'custom', path: ['sisakuotajkn'], message: 'sisakuotajkn melebihi kuotajkn' });
    }
    if (b.sisakuotanonjkn > b.kuotanonjkn) {
      ctx.addIssue({
        code: 'custom',
        path: ['sisakuotanonjkn'],
        message: 'sisakuotanonjkn melebihi kuotanonjkn',
      });
    }
  });
export type AntreanAddRequest = z.infer<typeof antreanAddRequestSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Task ID
// ---------------------------------------------------------------------------------------------------------------

export const ANTREAN_TASK_IDS = [1, 2, 3, 4, 5, 6, 7, 99] as const;
export type AntreanTaskId = (typeof ANTREAN_TASK_IDS)[number];
/** Task 99 = batal / tidak hadir. */
export const ANTREAN_TASK_BATAL = 99;

/** Arti task ID (docs/06 §2). */
export const ANTREAN_TASK_LABEL: Record<AntreanTaskId, string> = {
  1: 'mulai waktu tunggu admisi',
  2: 'mulai waktu layan admisi',
  3: 'mulai waktu tunggu poli',
  4: 'mulai waktu layan poli',
  5: 'mulai waktu tunggu farmasi',
  6: 'mulai waktu layan farmasi',
  7: 'obat selesai dibuat',
  99: 'tidak hadir/batal',
};

export const ANTREAN_JENIS_RESEP = ['Tidak ada', 'Racikan', 'Non racikan'] as const;

export const antreanUpdateWaktuRequestSchema = z.object({
  kodebooking: z.string().min(1).max(32),
  taskid: z.literal(ANTREAN_TASK_IDS),
  /** Milidetik epoch. */
  waktu: z.number().int().min(1_000_000_000_000),
  /** Opsional, dipakai saat task 5 (mulai tunggu farmasi). */
  jenisresep: z.enum(ANTREAN_JENIS_RESEP).optional(),
});
export type AntreanUpdateWaktuRequest = z.infer<typeof antreanUpdateWaktuRequestSchema>;

/**
 * Task berikutnya yang boleh dikirim (tanpa 99) setelah task yang sudah tercatat. Awal: 1 (alur admisi) atau
 * langsung 3 (pasien lama/booking tanpa admisi); selanjutnya tepat satu langkah: 1→2→3→4→5→6→7.
 */
export function antreanNextTaskIds(recorded: readonly number[]): number[] {
  const done = recorded.filter((t) => t !== ANTREAN_TASK_BATAL);
  if (done.length === 0) return [1, 3];
  const last = Math.max(...done);
  return last < 7 ? [last + 1] : [];
}

export type AntreanTaskRejection =
  | 'BPJS_ANTREAN_SUDAH_BATAL'
  | 'BPJS_TASK_GANDA'
  | 'BPJS_ANTREAN_SUDAH_DILAYANI'
  | 'BPJS_TASK_TIDAK_BERURUTAN'
  | 'BPJS_TASK_WAKTU_MUNDUR';

/**
 * Aturan urutan task ID seperti yang ditegakkan mock (dan dipakai worker untuk memutuskan menunda): batal
 * menutup antrean, task tidak boleh ganda, 99 hanya sebelum pasien dilayani poli (task 4), task lain harus
 * berurutan, dan waktunya tidak boleh mundur dari task terakhir. `null` = boleh dikirim.
 */
export function checkAntreanTask(
  recorded: ReadonlyArray<{ taskid: number; waktu: number }>,
  next: { taskid: number; waktu: number },
): AntreanTaskRejection | null {
  const ids = recorded.map((t) => t.taskid);
  if (ids.includes(ANTREAN_TASK_BATAL)) return 'BPJS_ANTREAN_SUDAH_BATAL';
  if (ids.includes(next.taskid)) return 'BPJS_TASK_GANDA';
  if (next.taskid === ANTREAN_TASK_BATAL) {
    if (ids.some((t) => t >= 4)) return 'BPJS_ANTREAN_SUDAH_DILAYANI';
  } else if (!antreanNextTaskIds(ids).includes(next.taskid)) {
    return 'BPJS_TASK_TIDAK_BERURUTAN';
  }
  const lastWaktu = recorded.reduce((max, t) => Math.max(max, t.waktu), 0);
  return next.waktu < lastWaktu ? 'BPJS_TASK_WAKTU_MUNDUR' : null;
}

export const antreanBatalRequestSchema = z.object({
  kodebooking: z.string().min(1).max(32),
  keterangan: z.string().min(1).max(200),
});
export type AntreanBatalRequest = z.infer<typeof antreanBatalRequestSchema>;

export const antreanGetListTaskRequestSchema = z.object({ kodebooking: z.string().min(1).max(32) });
export type AntreanGetListTaskRequest = z.infer<typeof antreanGetListTaskRequestSchema>;

/** Waktu daftar task: `DD-MM-YYYY HH:mm:ss WIB`. */
export const ANTREAN_WAKTU_PATTERN = /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2} WIB$/;

export const antreanTaskSchema = z.object({
  kodebooking: z.string(),
  taskid: z.number().int(),
  taskname: z.string(),
  /** Waktu task yang dikirim RS. */
  waktu: z.string().regex(ANTREAN_WAKTU_PATTERN),
  /** Waktu diterima server BPJS. */
  wakturs: z.string().regex(ANTREAN_WAKTU_PATTERN),
});
export type AntreanTask = z.infer<typeof antreanTaskSchema>;
export const antreanListTaskResponseSchema = z.array(antreanTaskSchema);

/** Milidetik epoch → `DD-MM-YYYY HH:mm:ss WIB` (UTC+7, tanpa DST). */
export function formatAntreanWaktu(ms: number): string {
  const d = new Date(ms + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} WIB`
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Referensi Antrean
// ---------------------------------------------------------------------------------------------------------------

export const antreanRefPoliSchema = z.object({
  kdpoli: z.string(),
  nmpoli: z.string(),
  kdsubspesialis: z.string(),
  nmsubspesialis: z.string(),
});
export const antreanRefPoliResponseSchema = z.array(antreanRefPoliSchema);
export type AntreanRefPoli = z.infer<typeof antreanRefPoliSchema>;

export const antreanRefDokterSchema = z.object({ kodedokter: z.number().int(), namadokter: z.string() });
export const antreanRefDokterResponseSchema = z.array(antreanRefDokterSchema);
export type AntreanRefDokter = z.infer<typeof antreanRefDokterSchema>;
