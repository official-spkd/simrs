'use server';

import { formatJam } from '@simrs/shared';
import { z } from 'zod';
import { wib } from '@/lib/demo/fixtures/rawat-inap';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { certificateNo, DEATH_CAUSES } from '@/lib/klinis-igd-toko';
import { supersededIds } from '@/lib/rawat-inap';
import { hasReason } from '@/lib/rme';
import { cancelBlocker, closeBlocker, DISPOSITION_LABEL, tteRetryBlocker } from '@/lib/rme-kelengkapan';
import { kelengkapanView } from '@/lib/server/data/klinis/kelengkapan';
import {
  attestingDoctor,
  commitCpptSign,
  committed,
  klinisSession,
  REKAM_DENIED,
  rekamFail,
  type RekamActionResult,
} from '@/lib/server/data/klinis/rekam';
import { rmeChartById } from '@/lib/server/data/klinis/rme';
import { commitEvent } from '@/lib/server/demo/state';
import type { SessionView } from '@/lib/session-view';

/**
 * K13 · Server Action kelengkapan rekam medis + tutup kunjungan (mode presentasi, ADR-0023/0085). Daftar periksa
 * dan dokumen dihitung server dari rekam yang sama dengan layar asal; perbaikan inline (co-sign residen, kirim ulang
 * TTE) dan tutup kunjungan hanya DPJP (posisi dokter dari sesi). Disposisi meninggal mengikuti usulan K-1 (menunggu
 * konfirmasi pemilik produk): DPJP pasien ini, surat keterangan kematian ber-TTE dengan jam + sebab ICD-10 dari seed.
 */

const revSchema = z.int().min(0);
const encInput = z.string().min(1).max(60);
const DPJP_ONLY = 'Diselesaikan DPJP (posisi dokter).';

async function load(encounterId: string) {
  const view = await rmeChartById(encounterId);
  if (!view) return null;
  return { ...view, kel: await kelengkapanView(view.chart, view.state) };
}

/** DPJP pasien ini (posisi dokter yang membawakan DPJP kunjungan): relasi dokter–pasien untuk K-1. */
function isDpjpOf(s: SessionView, dpjp: string): boolean {
  return s.role?.code === 'dokter' && attestingDoctor(s) === dpjp;
}

/** Co-sign CPPT residen yang menunggu (dicatat sebagai co-sign CPPT yang sama dengan layar CPPT/Rawat inap). */
export async function cosignPendingAction(
  raw: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string }> {
  const s = await klinisSession('kelengkapan');
  if (!s) return REKAM_DENIED;
  const p = z.strictObject({ encounterId: encInput }).safeParse(raw);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Permintaan co-sign tidak valid.');
  const v = await load(p.data.encounterId);
  const d = v?.chart.inpatient;
  if (!v || !d) return rekamFail('Tidak ada CPPT residen pada kunjungan ini.');
  const old = supersededIds(d.cppt);
  const pending = d.cppt.find((e) => !old.has(e.id) && e.cosignRequired && !e.cosignedBy);
  if (!pending) return rekamFail('Tidak ada CPPT residen yang menunggu co-sign.');
  const res = await commitCpptSign(
    s,
    { encounterId: p.data.encounterId, entries: d.cppt, dpjp: v.chart.dpjp },
    pending.id,
    'cosign',
    r.data,
  );
  return res.ok && res.at ? { ...res, message: `CPPT residen di-co-sign DPJP · ${formatJam(res.at)}.` } : res;
}

const docInput = z.strictObject({ encounterId: encInput, docId: z.string().min(1).max(120) });

export async function retryTteAction(raw: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('kelengkapan');
  if (!s) return REKAM_DENIED;
  if (s.role?.code !== 'dokter') return rekamFail(DPJP_ONLY);
  const p = docInput.safeParse(raw);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Dokumen tidak valid.');
  const v = await load(p.data.encounterId);
  const doc = v?.kel.docs.find((d) => d.id === p.data.docId);
  if (!v || !doc) return rekamFail('Dokumen tidak ditemukan.');
  const blocked = tteRetryBlocker(doc);
  if (blocked) return rekamFail(blocked);
  const at = wib(demoNow());
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'kelengkapan.dokumen',
      encounterId: p.data.encounterId,
      docId: doc.id,
      change: 'tte-ulang',
      reason: null,
      at,
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `${doc.title} ber-TTE · ${formatJam(at)} (kirim ulang berhasil).`,
  });
}

export async function cancelDocumentAction(raw: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('kelengkapan');
  if (!s) return REKAM_DENIED;
  const p = docInput.extend({ reason: z.string().max(500) }).safeParse(raw);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Pembatalan tidak valid.');
  if (!hasReason(p.data.reason)) return rekamFail('Alasan pembatalan minimal 10 karakter.');
  const v = await load(p.data.encounterId);
  const doc = v?.kel.docs.find((d) => d.id === p.data.docId);
  if (!v || !doc) return rekamFail('Dokumen tidak ditemukan.');
  const blocked = cancelBlocker(doc);
  if (blocked) return rekamFail(blocked);
  const at = wib(demoNow());
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'kelengkapan.dokumen',
      encounterId: p.data.encounterId,
      docId: doc.id,
      change: 'batal',
      reason: p.data.reason.trim(),
      at,
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `${doc.title} dibatalkan · ${formatJam(at)}; dokumen tetap tersimpan.`,
  });
}

export async function uploadScanAction(raw: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('kelengkapan');
  if (!s) return REKAM_DENIED;
  const p = z
    .strictObject({ encounterId: encInput, kind: z.string().min(1).max(40), note: z.string().max(60) })
    .safeParse(raw);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Unggahan tidak valid.');
  if (!(await rmeChartById(p.data.encounterId))) return rekamFail('Kunjungan tidak dikenal.');
  const at = wib(demoNow());
  const note = p.data.note.trim();
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'kelengkapan.unggah',
      encounterId: p.data.encounterId,
      title: note ? `${p.data.kind}: ${note}` : p.data.kind,
      kind: 'Pindaian',
      at,
    },
    { rev: r.data, session: s },
  );
  return committed(c, { ok: true, message: `Pindaian terunggah · ${formatJam(at)}.` });
}

const deathInput = z.strictObject({
  encounterId: encInput,
  diedAt: z.string().regex(/^([01]\d|2[0-3])\.[0-5]\d$/, 'Jam kematian HH.MM.'),
  causeCode: z.string().min(1).max(10),
  certificateSigned: z.literal(true),
});

/** Surat keterangan kematian ber-TTE (K-1): hanya DPJP pasien ini; jam kematian + sebab ICD-10 dari seed. */
export async function deathCertificateAction(raw: unknown, rev: unknown): Promise<RekamActionResult> {
  const s = await klinisSession('kelengkapan');
  if (!s) return REKAM_DENIED;
  const p = deathInput.safeParse(raw);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) {
    return rekamFail(
      p.error?.issues.some((i) => i.path[0] === 'certificateSigned')
        ? 'Surat keterangan kematian wajib ditandatangani (TTE).'
        : (p.error?.issues[0]?.message ?? 'Surat keterangan kematian tidak valid.'),
    );
  }
  const v = await load(p.data.encounterId);
  if (!v) return rekamFail('Kunjungan tidak dikenal.');
  if (!isDpjpOf(s, v.chart.dpjp)) {
    return rekamFail(`Hanya DPJP pasien ini (${v.chart.dpjp}) yang menyatakan meninggal.`);
  }
  const cause = DEATH_CAUSES.find((c) => c.code === p.data.causeCode);
  if (!cause) return rekamFail('Pilih sebab kematian ICD-10 dari daftar.');
  const now = demoNow();
  const diedAt = `${wib(now).slice(0, 10)}T${p.data.diedAt.replace('.', ':')}:00+07:00`;
  if (Date.parse(diedAt) > now.getTime()) return rekamFail('Jam kematian tidak boleh di masa depan.');
  const no = certificateNo(s.tenant.code, Object.keys(v.state.deaths).length + 101);
  const c = await commitEvent(
    'rekam-medis',
    {
      type: 'kelengkapan.kematian',
      encounterId: p.data.encounterId,
      diedAt,
      causeCode: cause.code,
      causeLabel: cause.display,
      certificateNo: no,
      at: wib(now),
    },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `Surat keterangan kematian ${no} ber-TTE · ${cause.code} ${cause.display}.`,
  });
}

const closeInput = z.strictObject({
  encounterId: encInput,
  disposition: z.enum(['pulang', 'rujuk', 'aps', 'meninggal']),
});

/** Tutup kunjungan: DPJP, semua butir lengkap, disposisi + dokumen wajibnya; rekam terkunci sesudahnya. */
export async function closeVisitAction(
  raw: unknown,
  rev: unknown,
): Promise<RekamActionResult & { at?: string }> {
  const s = await klinisSession('kelengkapan');
  if (!s) return REKAM_DENIED;
  const p = closeInput.safeParse(raw);
  const r = revSchema.safeParse(rev);
  if (!p.success || !r.success) return rekamFail('Pilih disposisi pasien.');
  const v = await load(p.data.encounterId);
  if (!v) return rekamFail('Kunjungan tidak dikenal.');
  if (v.kel.closed) return rekamFail('Kunjungan sudah ditutup.');
  const blocked = closeBlocker(v.kel.items, {
    role: s.role?.code ?? null,
    disposition: p.data.disposition,
    documents: v.kel.docs,
  });
  if (blocked) return rekamFail(blocked);
  if (p.data.disposition === 'meninggal' && !isDpjpOf(s, v.chart.dpjp)) {
    return rekamFail(`Disposisi meninggal hanya oleh DPJP pasien ini (${v.chart.dpjp}).`);
  }
  const at = wib(demoNow());
  const c = await commitEvent(
    'rekam-medis',
    { type: 'kunjungan.ditutup', encounterId: p.data.encounterId, disposition: p.data.disposition, at },
    { rev: r.data, session: s },
  );
  return committed(c, {
    ok: true,
    message: `Kunjungan ditutup · ${formatJam(at)} · ${DISPOSITION_LABEL[p.data.disposition]}.`,
    at,
  });
}
