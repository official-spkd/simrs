'use client';

import { formatJam } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import Link from 'next/link';
import { useId, useState } from 'react';
import {
  cancelDocumentAction,
  closeVisitAction,
  cosignPendingAction,
  deathCertificateAction,
  retryTteAction,
  uploadScanAction,
} from '@/app/(staf)/klinis/kelengkapan/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import { DEATH_CAUSES } from '@/lib/klinis-igd-toko';
import { formatTglJam } from '@/lib/rawat-inap';
import { hasReason } from '@/lib/rme';
import {
  cancelBlocker,
  type CheckItem,
  closeBlocker,
  completeness,
  DISPOSITION_LABEL,
  type Disposition,
  DOC_STATUS_META,
  type PatientDocument,
  tteRetryBlocker,
} from '@/lib/rme-kelengkapan';
import { Feedback, type FeedbackMsg, ReasonField } from './feedback';

const CARD =
  'flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5';
const INPUT = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]';
const UPLOAD_KINDS = [
  'Pindaian surat rujukan',
  'Hasil pemeriksaan luar RS',
  'Surat keterangan',
  'Dokumen identitas penjamin',
];

/**
 * K13 · Dokumen pasien (kirim ulang TTE gagal, batal beralasan, unggah pindaian) dan daftar periksa kelengkapan DPJP
 * sebelum tutup kunjungan: tombol tutup nonaktif dengan alasannya sampai semua butir terpenuhi dan disposisi dipilih;
 * setelah ditutup rekam terkunci. Daftar periksa dihitung server dari rekam layar asal (asesmen, CPPT, diagnosis,
 * edukasi, resume, persetujuan) di toko demo; semua aksi tersimpan atas nama pengguna sesi. Disposisi meninggal
 * mengikuti usulan K-1 (menunggu konfirmasi pemilik produk).
 */
export function KelengkapanWorkspace({
  encounterId,
  role,
  user,
  dpjp,
  isDpjp,
  docs,
  items,
  closed,
  rev,
  routes,
}: {
  encounterId: string;
  role: string | null;
  user: string;
  /** DPJP pasien ini (untuk keterangan gerbang K-1). */
  dpjp: string;
  /** Posisi aktif membawakan DPJP pasien ini (relasi dokter–pasien, K-1). */
  isDpjp: boolean;
  docs: readonly PatientDocument[];
  items: readonly CheckItem[];
  /** Kunjungan sudah ditutup (server). */
  closed: { disposition: Disposition; by: string; at: string } | null;
  /** Revisi toko `rekam-medis`. */
  rev: number;
  /** Rute layar perbaikan (id layar → rute) yang terbuka untuk posisi ini. */
  routes: Readonly<Record<string, string | null>>;
}) {
  const id = useId();
  const { run, pending } = useStoreAction(rev);
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const [cancel, setCancel] = useState<{ id: string; reason: string; tried: boolean } | null>(null);
  const [upload, setUpload] = useState({ kind: '', note: '' });
  const [disposition, setDisposition] = useState<Disposition | ''>('');
  const [death, setDeath] = useState({ hm: '', cause: '', signed: false });
  const prog = completeness(items);
  const block = closeBlocker(items, { role, disposition, documents: docs });
  const isDoctor = role === 'dokter';
  const say = (res: { ok: boolean; message: string }) => setMsg({ ok: res.ok, text: res.message });
  const retryBlock = (docId: string) => {
    const doc = docs.find((d) => d.id === docId);
    return doc ? tteRetryBlocker(doc) : 'Dokumen tidak ditemukan.';
  };
  const hasDeathCertificate = docs.some(
    (d) => d.title === 'Surat keterangan kematian' && d.status === 'final-tte',
  );
  const k1Block =
    disposition === 'meninggal' && !isDpjp
      ? `Disposisi meninggal hanya oleh DPJP pasien ini (${dpjp}).`
      : null;

  return (
    <div className="flex flex-col gap-4">
      <Feedback msg={msg} />
      {closed && (
        <p
          role="status"
          className="m-0 rounded-control border border-zamrud-200 bg-alert-success px-3.5 py-2.5 font-semibold text-success"
        >
          Kunjungan ditutup · {formatJam(closed.at)} · {DISPOSITION_LABEL[closed.disposition]}. Rekam medis
          terkunci; perubahan berikutnya lewat addendum.
        </p>
      )}
      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Kelengkapan rekam medis" className={cx(CARD, 'flex-[1_1_440px]')}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 text-body font-semibold">Kelengkapan sebelum tutup kunjungan</h2>
            <Chip tone={prog.done === prog.total ? 'success' : 'warning'}>
              {prog.done} dari {prog.total} terpenuhi · {prog.percent}%
            </Chip>
          </div>
          <ul aria-label="Daftar periksa" className="m-0 flex list-none flex-col gap-2 p-0">
            {items.map((it) => {
              const fix = it.fix;
              const route = fix?.kind === 'layar' ? routes[fix.screen] : null;
              return (
                <li
                  key={it.id}
                  className={cx(
                    'flex flex-col gap-1 rounded-control border px-3 py-2',
                    it.done ? 'border-line' : 'border-warning-border',
                  )}
                >
                  <span className={cx('text-small font-semibold', it.done ? 'text-success' : 'text-warning')}>
                    {it.done ? '✓' : '✗'} {it.label}
                  </span>
                  <span className="text-caption text-ink-700">{it.detail}</span>
                  {!it.done && !closed && fix && (
                    <span className="flex flex-wrap items-center gap-2">
                      {fix.kind === 'cosign' && (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={!isDoctor || pending}
                          onClick={() => run((r) => cosignPendingAction({ encounterId }, r), say)}
                        >
                          Co-sign sekarang
                        </Button>
                      )}
                      {fix.kind === 'tte-ulang' && (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={!isDoctor || retryBlock(fix.documentId) !== null || pending}
                          title={retryBlock(fix.documentId) ?? undefined}
                          onClick={() =>
                            run((r) => retryTteAction({ encounterId, docId: fix.documentId }, r), say)
                          }
                        >
                          Kirim ulang TTE
                        </Button>
                      )}
                      {fix.kind === 'layar' && route && (
                        <Link
                          href={fix.suffix ? `${route}${fix.suffix}` : `${route}?pasien=${encounterId}`}
                          className="text-small font-semibold text-brand-700"
                        >
                          Lengkapi di layar asal
                        </Link>
                      )}
                      {!isDoctor && fix.kind !== 'layar' && (
                        <span className="text-caption text-ink-500">Diselesaikan DPJP (posisi dokter).</span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {!closed && (
            <div className="flex flex-col gap-2 rounded-control bg-subtle p-3">
              <label htmlFor={`${id}-disp`} className="text-small font-semibold">
                Disposisi
              </label>
              <select
                id={`${id}-disp`}
                value={disposition}
                onChange={(e) => setDisposition(e.target.value as Disposition | '')}
                className={INPUT}
              >
                <option value="">Pilih disposisi…</option>
                {(Object.keys(DISPOSITION_LABEL) as Disposition[]).map((d) => (
                  <option key={d} value={d}>
                    {DISPOSITION_LABEL[d]}
                  </option>
                ))}
              </select>
              {disposition === 'meninggal' && !hasDeathCertificate && (
                <form
                  aria-label="Surat keterangan kematian"
                  className="flex flex-col gap-2 rounded-control border border-koral-200 bg-alert-critical p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(
                      (r) =>
                        deathCertificateAction(
                          {
                            encounterId,
                            diedAt: death.hm,
                            causeCode: death.cause,
                            certificateSigned: death.signed,
                          },
                          r,
                        ),
                      say,
                    );
                  }}
                >
                  <span className="text-caption text-ink-700">
                    Aturan K-1 (usulan, menunggu konfirmasi pemilik produk): hanya DPJP pasien ini ({dpjp});
                    jam kematian, sebab kematian ICD-10, dan surat keterangan kematian ber-TTE.
                  </span>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`${id}-jam`} className="text-small font-semibold">
                        Jam kematian (HH.MM)
                      </label>
                      <input
                        id={`${id}-jam`}
                        value={death.hm}
                        maxLength={5}
                        inputMode="numeric"
                        onChange={(e) => setDeath((d) => ({ ...d, hm: e.target.value }))}
                        className={cx(INPUT, 'font-mono')}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`${id}-sebab`} className="text-small font-semibold">
                        Sebab kematian (ICD-10)
                      </label>
                      <select
                        id={`${id}-sebab`}
                        value={death.cause}
                        onChange={(e) => setDeath((d) => ({ ...d, cause: e.target.value }))}
                        className={INPUT}
                      >
                        <option value="">Pilih…</option>
                        {DEATH_CAUSES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code} · {c.display}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <label className="flex min-h-11 items-center gap-2 text-small">
                    <input
                      type="checkbox"
                      checked={death.signed}
                      onChange={(e) => setDeath((d) => ({ ...d, signed: e.target.checked }))}
                      className="size-[18px] accent-brand-600"
                    />
                    Tanda tangani surat keterangan kematian (TTE {user})
                  </label>
                  <Button
                    type="submit"
                    variant="danger"
                    className="self-start"
                    disabled={!isDpjp || pending || !death.hm || !death.cause || !death.signed}
                  >
                    Terbitkan surat keterangan kematian
                  </Button>
                </form>
              )}
              <Button
                variant="primary"
                className="self-start"
                disabled={!!block || !!k1Block || pending}
                aria-describedby={`${id}-gate`}
                onClick={() =>
                  disposition && run((r) => closeVisitAction({ encounterId, disposition }, r), say)
                }
              >
                Tutup kunjungan
              </Button>
              <p
                id={`${id}-gate`}
                role="status"
                className={cx(
                  'm-0 text-small font-semibold',
                  block || k1Block ? 'text-warning' : 'text-success',
                )}
              >
                {block ?? k1Block ?? 'Semua syarat terpenuhi; kunjungan siap ditutup.'}
              </p>
            </div>
          )}
        </section>

        <section aria-label="Dokumen pasien" className={cx(CARD, 'flex-[1_1_440px]')}>
          <h2 className="m-0 text-body font-semibold">Dokumen pasien kunjungan ini</h2>
          <ul aria-label="Daftar dokumen" className="m-0 flex list-none flex-col gap-2 p-0">
            {docs.map((d) => {
              const meta = DOC_STATUS_META[d.status];
              const cb = cancelBlocker(d);
              return (
                <li key={d.id} className="flex flex-col gap-1 rounded-control border border-line px-3 py-2">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={cx(
                        'font-semibold',
                        d.status === 'dibatalkan' && 'text-ink-500 line-through',
                      )}
                    >
                      {d.title}
                    </span>
                    <Chip tone={meta.tone}>{meta.label}</Chip>
                  </span>
                  <span className="text-caption text-ink-700">
                    {d.kind} · {d.by} · {formatTglJam(d.at)}
                    {d.note ? ` · ${d.note}` : ''}
                  </span>
                  {!closed && (
                    <span className="flex flex-wrap gap-2">
                      {d.status === 'tte-gagal' && (
                        <Button
                          size="sm"
                          disabled={!isDoctor || pending}
                          onClick={() => run((r) => retryTteAction({ encounterId, docId: d.id }, r), say)}
                        >
                          Kirim ulang TTE
                        </Button>
                      )}
                      {!cb && cancel?.id !== d.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Batalkan ${d.title}`}
                          onClick={() => setCancel({ id: d.id, reason: '', tried: false })}
                        >
                          Batalkan
                        </Button>
                      )}
                    </span>
                  )}
                  {cancel?.id === d.id && (
                    <form
                      aria-label="Batalkan dokumen"
                      className="flex flex-col gap-2 rounded-control border border-kunyit-200 bg-alert-warning p-2.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!hasReason(cancel.reason)) return setCancel({ ...cancel, tried: true });
                        run(
                          (r) => cancelDocumentAction({ encounterId, docId: d.id, reason: cancel.reason }, r),
                          (res) => {
                            say(res);
                            if (res.ok) setCancel(null);
                          },
                        );
                      }}
                    >
                      <ReasonField
                        label="Alasan pembatalan"
                        value={cancel.reason}
                        onChange={(reason) => setCancel({ ...cancel, reason })}
                        showError={cancel.tried}
                        hint="Dokumen tidak dihapus: tetap tampil berstatus dibatalkan dan tercatat di jejak audit."
                      />
                      <span className="flex gap-2">
                        <Button type="submit" variant="danger" disabled={pending}>
                          Batalkan dokumen
                        </Button>
                        <Button onClick={() => setCancel(null)}>Kembali</Button>
                      </span>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
          {!closed && (
            <form
              aria-label="Unggah pindaian"
              className="flex flex-wrap items-end gap-2 rounded-control bg-subtle p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!upload.kind) return;
                run(
                  (r) => uploadScanAction({ encounterId, ...upload }, r),
                  (res) => {
                    say(res);
                    if (res.ok) setUpload({ kind: '', note: '' });
                  },
                );
              }}
            >
              <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
                <label htmlFor={`${id}-jenis`} className="text-small font-semibold">
                  Jenis pindaian
                </label>
                <select
                  id={`${id}-jenis`}
                  value={upload.kind}
                  onChange={(e) => setUpload({ ...upload, kind: e.target.value })}
                  className={INPUT}
                >
                  <option value="">Pilih jenis…</option>
                  {UPLOAD_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
                <label htmlFor={`${id}-ket`} className="text-small font-semibold">
                  Keterangan
                </label>
                <input
                  id={`${id}-ket`}
                  value={upload.note}
                  maxLength={60}
                  onChange={(e) => setUpload({ ...upload, note: e.target.value })}
                  className={INPUT}
                />
              </div>
              <Button type="submit" disabled={!upload.kind || pending}>
                Unggah (simulasi)
              </Button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
