'use client';

import { formatJam } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import Link from 'next/link';
import { useId, useState } from 'react';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { formatTglJam } from '@/lib/rawat-inap';
import { hasReason } from '@/lib/rme';
import {
  cancelBlocker,
  cancelDocument,
  retryTte,
  tteRetryBlocker,
  type CheckItem,
  closeBlocker,
  completeness,
  DISPOSITION_LABEL,
  type Disposition,
  DOC_STATUS_META,
  type PatientDocument,
} from '@/lib/rme-kelengkapan';
import { Feedback, type FeedbackMsg, ReasonField } from './feedback';

const CARD = 'flex min-w-0 flex-col gap-3 rounded-card border border-line bg-white px-4 py-3.5';
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
 * setelah ditutup rekam terkunci. Keadaan lokal (simulasi, tidak disimpan).
 */
export function KelengkapanWorkspace({
  encounterId,
  role,
  user,
  initialDocs,
  initialItems,
  routes,
}: {
  encounterId: string;
  role: string | null;
  user: string;
  initialDocs: readonly PatientDocument[];
  initialItems: readonly CheckItem[];
  /** Rute layar perbaikan (id layar → rute) yang terbuka untuk posisi ini. */
  routes: Readonly<Record<string, string | null>>;
}) {
  const id = useId();
  const [docs, setDocs] = useState<PatientDocument[]>([...initialDocs]);
  const [items, setItems] = useState<CheckItem[]>([...initialItems]);
  const [msg, setMsg] = useState<FeedbackMsg | null>(null);
  const [cancel, setCancel] = useState<{ id: string; reason: string; tried: boolean } | null>(null);
  const [upload, setUpload] = useState({ kind: '', note: '' });
  const [disposition, setDisposition] = useState<Disposition | ''>('');
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [seq, setSeq] = useState(1);
  const prog = completeness(items);
  const block = closeBlocker(items, { role, disposition, documents: docs });
  const isDpjp = role === 'dokter';
  const clock = () => demoNow().toISOString();
  const say = (text: string) => setMsg({ ok: true, text: `${text} (simulasi, tidak disimpan).` });
  const retryBlock = (docId: string) => {
    const doc = docs.find((d) => d.id === docId);
    return doc ? tteRetryBlocker(doc) : 'Dokumen tidak ditemukan.';
  };
  const resolve = (itemId: string, detail: string) =>
    setItems((cur) => cur.map((i) => (i.id === itemId ? { ...i, done: true, detail } : i)));

  const retryTteDoc = (docId: string) => {
    const at = clock();
    const doc = docs.find((d) => d.id === docId);
    if (!doc || tteRetryBlocker(doc)) return;
    setDocs((cur) => cur.map((d) => (d.id === docId ? retryTte(d, user, at) : d)));
    resolve(`tte-${docId}`, `TTE berhasil ${formatJam(at)}`);
    say(`${doc?.title ?? 'Dokumen'} ber-TTE · ${formatJam(at)} (kirim ulang berhasil)`);
  };

  return (
    <div className="flex flex-col gap-4">
      <Feedback msg={msg} />
      {closedAt && (
        <p
          role="status"
          className="m-0 rounded-control border border-success-border bg-success-bg px-3.5 py-2.5 font-semibold text-success"
        >
          Kunjungan ditutup · {formatJam(closedAt)} · {disposition ? DISPOSITION_LABEL[disposition] : ''}.
          Rekam medis terkunci; perubahan berikutnya lewat addendum.
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
                  {!it.done && !closedAt && fix && (
                    <span className="flex flex-wrap items-center gap-2">
                      {fix.kind === 'cosign' && (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={!isDpjp}
                          onClick={() => {
                            const at = clock();
                            resolve(it.id, `Co-sign DPJP ${formatJam(at)}`);
                            say(`CPPT residen di-co-sign DPJP · ${formatJam(at)}`);
                          }}
                        >
                          Co-sign sekarang
                        </Button>
                      )}
                      {fix.kind === 'tte-ulang' && (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={!isDpjp || retryBlock(fix.documentId) !== null}
                          title={retryBlock(fix.documentId) ?? undefined}
                          onClick={() => retryTteDoc(fix.documentId)}
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
                      {!isDpjp && fix.kind !== 'layar' && (
                        <span className="text-caption text-ink-500">Diselesaikan DPJP (posisi dokter).</span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {!closedAt && (
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
              <Button
                variant="primary"
                className="self-start"
                disabled={!!block}
                aria-describedby={`${id}-gate`}
                onClick={() => {
                  const at = clock();
                  setClosedAt(at);
                  say(`Kunjungan ditutup · ${formatJam(at)}`);
                }}
              >
                Tutup kunjungan
              </Button>
              <p
                id={`${id}-gate`}
                role="status"
                className={cx('m-0 text-small font-semibold', block ? 'text-warning' : 'text-success')}
              >
                {block ?? 'Semua syarat terpenuhi; kunjungan siap ditutup.'}
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
                  {!closedAt && (
                    <span className="flex flex-wrap gap-2">
                      {d.status === 'tte-gagal' && (
                        <Button size="sm" disabled={!isDpjp} onClick={() => retryTteDoc(d.id)}>
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
                      className="flex flex-col gap-2 rounded-control border border-warning-border p-2.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!hasReason(cancel.reason)) return setCancel({ ...cancel, tried: true });
                        const at = clock();
                        setDocs((cur) =>
                          cur.map((x) => (x.id === d.id ? cancelDocument(x, cancel.reason, user, at) : x)),
                        );
                        // Butir "TTE gagal" dokumen ini selesai sebagai dibatalkan (tidak bisa dihidupkan lagi).
                        if (d.status === 'tte-gagal')
                          resolve(`tte-${d.id}`, `Dokumen dibatalkan ${formatJam(at)}`);
                        setCancel(null);
                        say(`${d.title} dibatalkan · ${formatJam(at)}; dokumen tetap tersimpan`);
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
                        <Button type="submit" variant="danger">
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
          {!closedAt && (
            <form
              aria-label="Unggah pindaian"
              className="flex flex-wrap items-end gap-2 rounded-control bg-subtle p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!upload.kind) return;
                const at = clock();
                setDocs((cur) => [
                  ...cur,
                  {
                    id: `${encounterId}-dok-baru-${seq}`,
                    title: upload.note.trim() ? `${upload.kind}: ${upload.note.trim()}` : upload.kind,
                    kind: 'Pindaian',
                    status: 'terunggah',
                    by: user,
                    at,
                    note: null,
                  },
                ]);
                setSeq((n) => n + 1);
                setUpload({ kind: '', note: '' });
                say(`Pindaian terunggah · ${formatJam(at)}`);
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
                  onChange={(e) => setUpload({ ...upload, note: e.target.value })}
                  className={INPUT}
                />
              </div>
              <Button type="submit" disabled={!upload.kind}>
                Unggah (simulasi)
              </Button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
