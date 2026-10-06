'use server';

import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { eduBlocker, professionOf } from '@/lib/rme-edukasi';
import {
  committed,
  klinisSession,
  REKAM_DENIED,
  rekamFail,
  type RekamActionResult,
} from '@/lib/server/data/klinis/rekam';
import { rmeChartById } from '@/lib/server/data/klinis/rme';
import { commitEvent } from '@/lib/server/demo/state';

/**
 * K11 · Simpan catatan edukasi (mode presentasi, ADR-0023/0085): PPA dari sesi (dokter, residen, perawat, bidan),
 * gerbang isian sama dengan layar (materi, metode, teach-back bila paham, jadwal ulang bila belum, tanda tangan
 * penerima = nama penerima, atestasi edukator) diperiksa ulang di server. Catatan final immutable, tersimpan di toko
 * `rekam-medis`; Kelengkapan dan kesiapan persetujuan tindakan membaca catatan yang sama.
 */

const EDUCATORS = ['dokter', 'dokter_residen', 'perawat', 'bidan'];

const input = z.strictObject({
  encounterId: z.string().min(1).max(60),
  topics: z
    .array(z.enum(['penyakit', 'obat', 'insulin', 'diet', 'jatuh', 'nyeri', 'tindakan', 'pulang', 'infeksi']))
    .max(9),
  methods: z.array(z.enum(['lisan', 'demonstrasi', 'leaflet', 'video'])).max(4),
  recipient: z.enum(['pasien', 'keluarga', 'pasien-keluarga']),
  recipientName: z.string().max(80),
  understanding: z.enum(['paham', 'perlu-diulang', 'tidak-paham', '']),
  teachBack: z.string().max(1000),
  repeatAt: z.string().max(40),
  signature: z.string().max(80),
  attested: z.boolean(),
});

export async function saveEducationAction(
  raw: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string }> {
  const s = await klinisSession('edukasi');
  if (!s) return REKAM_DENIED;
  if (!EDUCATORS.includes(s.role?.code ?? ''))
    return rekamFail('Edukasi dicatat oleh PPA (dokter, perawat, bidan).');
  const p = input.safeParse(raw);
  const r = z.int().min(0).safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Catatan edukasi tidak valid.');
  const d = p.data;
  const blocked = eduBlocker(d);
  if (blocked || !d.understanding) return rekamFail(blocked ?? 'Catat hasil verifikasi pemahaman.');
  const repeatAt = d.understanding === 'paham' ? null : d.repeatAt;
  if (repeatAt !== null && !z.iso.datetime({ offset: true }).safeParse(repeatAt).success) {
    return rekamFail('Jadwal edukasi ulang tidak valid.');
  }
  if (!(await rmeChartById(d.encounterId))) return rekamFail('Kunjungan tidak dikenal.');
  const at = wib(demoNow());
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'edukasi.dicatat',
      encounterId: d.encounterId,
      record: {
        id: `${d.encounterId}-edukasi-r${r.data}`,
        topics: d.topics,
        methods: d.methods,
        educator: s.user.displayName,
        profession: professionOf(s.role?.code ?? null),
        recipient: d.recipient,
        recipientName: d.recipientName.trim(),
        understanding: d.understanding,
        teachBack: d.teachBack.trim(),
        repeatAt,
        signature: d.signature.trim(),
        at,
      },
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message:
      d.understanding === 'paham'
        ? `Edukasi final · ${formatJam(at)} · ${d.topics.length} materi terverifikasi paham.`
        : `Edukasi tercatat · ${formatJam(at)} · edukasi ulang dijadwalkan ${repeatAt ? formatJam(repeatAt) : ''}.`,
    at,
  });
}
