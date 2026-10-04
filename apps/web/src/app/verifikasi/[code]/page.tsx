import { formatTanggalWaktu, VERIFY_CODE_PATTERN } from '@simrs/shared';
import { cx } from '@simrs/ui';
import type { Metadata } from 'next';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';

export const metadata: Metadata = { title: 'Verifikasi tanda tangan', robots: { index: false } };

const verificationSchema = z.object({
  valid: z.boolean(),
  status: z.enum(['pending', 'signed']),
  hospital: z.string(),
  documentKind: z.string(),
  documentSha256: z.string(),
  documentVoided: z.boolean(),
  signer: z.string(),
  signedAt: z.string().nullable(),
  certificate: z.string().nullable(),
});
type Verification = z.infer<typeof verificationSchema>;

/**
 * P08 · Halaman verifikasi QR dokumen bertanda tangan elektronik. Publik (tanpa login) dan tanpa PHI: hanya RS,
 * jenis dokumen, penanda tangan, waktu, sertifikat, dan hash isi dokumen. Judul dokumen dan identitas pasien
 * tidak pernah ditampilkan.
 */
export default async function VerifikasiPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let result: Verification | null = null;
  let unavailable = false;
  if (VERIFY_CODE_PATTERN.test(code)) {
    try {
      result = await api(`/api/v1/verification/signatures/${code}`, {
        auth: false,
        schema: verificationSchema,
      });
    } catch (err) {
      if (!(err instanceof ApiError && (err.status === 404 || err.status === 400))) unavailable = true;
    }
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-canvas bg-[radial-gradient(circle_at_1px_1px,rgba(20,33,43,0.06)_1px,rgba(20,33,43,0)_1.5px)] bg-[length:22px_22px] px-4 py-8 text-body text-ink-900 sm:py-14">
      <div className="flex w-full max-w-[560px] flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-[12px] bg-brand-600 text-white">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="font-bold">SIM RS</span>
            <span className="text-small text-ink-500">Verifikasi tanda tangan elektronik dokumen</span>
          </div>
        </div>

        {result ? (
          <Result r={result} />
        ) : (
          <section
            aria-labelledby="hasil-judul"
            className="flex flex-col gap-2 rounded-card border border-danger-border bg-card px-5 py-5"
          >
            <h1 id="hasil-judul" className="m-0 text-h2 font-bold text-danger">
              {unavailable ? 'Layanan verifikasi sedang tidak tersedia' : 'Kode verifikasi tidak dikenal'}
            </h1>
            <p className="m-0 text-small text-ink-700">
              {unavailable
                ? 'Coba lagi beberapa saat lagi.'
                : 'Pastikan Anda memindai QR pada dokumen asli. Dokumen dengan kode yang tidak dikenal tidak dapat dipastikan keasliannya.'}
            </p>
          </section>
        )}

        <p className="m-0 text-caption text-ink-500">
          Halaman ini hanya menampilkan data penanda tangan dan sidik digital (hash) dokumen, tanpa data
          pasien. Cocokkan hash dengan berkas yang Anda terima bila perlu.
        </p>
      </div>
    </main>
  );
}

function Result({ r }: { r: Verification }) {
  const tone = r.documentVoided || !r.valid ? (r.status === 'pending' ? 'warning' : 'danger') : 'success';
  const title = r.documentVoided
    ? 'Dokumen sudah dibatalkan'
    : r.status === 'pending'
      ? 'Tanda tangan sedang diproses'
      : r.valid
        ? 'Tanda tangan elektronik sah'
        : 'Tanda tangan tidak valid';
  return (
    <section
      aria-labelledby="hasil-judul"
      className={cx(
        'flex flex-col gap-4 rounded-card border bg-card px-5 py-5',
        tone === 'success' && 'border-success-border',
        tone === 'warning' && 'border-warning-border',
        tone === 'danger' && 'border-danger-border',
      )}
    >
      <div className="flex flex-col gap-1">
        <h1
          id="hasil-judul"
          className={cx(
            'm-0 text-h2 font-bold',
            tone === 'success' && 'text-success',
            tone === 'warning' && 'text-warning',
            tone === 'danger' && 'text-danger',
          )}
        >
          {title}
        </h1>
        <span className="text-small text-ink-700">
          {r.documentKind} · {r.hospital}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-1 gap-3 text-small sm:grid-cols-2">
        <Item label="Penanda tangan">{r.signer}</Item>
        <Item label="Waktu tanda tangan">
          {r.signedAt ? formatTanggalWaktu(r.signedAt) : 'Belum selesai'}
        </Item>
        <Item label="Sertifikat" wide>
          {r.certificate ?? '—'}
        </Item>
        <Item label="Sidik digital dokumen (SHA-256)" wide mono>
          {r.documentSha256}
        </Item>
      </dl>
    </section>
  );
}

function Item({
  label,
  children,
  wide,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={cx('flex flex-col gap-0.5', wide && 'sm:col-span-2')}>
      <dt className="text-caption text-ink-500">{label}</dt>
      <dd className={cx('m-0 font-semibold break-all', mono && 'font-mono text-caption font-normal')}>
        {children}
      </dd>
    </div>
  );
}
