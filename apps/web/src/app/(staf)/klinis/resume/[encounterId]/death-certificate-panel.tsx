'use client';

import { type DeathCertificate, formatTanggalWaktu } from '@simrs/shared';
import { Button, cx, Field } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { ICD10_OPTIONS } from '@/lib/klinis';
import { issueDeathCertificateAction } from './actions-api';

const TTE = { pending: 'TTE diminta', signed: 'TTE sah', failed: 'TTE gagal' } as const;

/** `datetime-local` (WIB) → ISO. */
function fromLocal(v: string): string {
  return new Date(`${v}:00+07:00`).toISOString();
}
function nowLocal(): string {
  return new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 16);
}

/**
 * K13 · Surat keterangan kematian (keputusan K-1, 7 Okt 2026) di layar Resume, tampil bila cara pulang "Meninggal":
 * jam kematian + sebab ICD-10 (kode dari data rujukan, diperiksa server) + TTE dokter. Syarat gerbang pulang
 * disposisi meninggal; petugas admisi tidak bisa menerbitkannya. TTE gagal → tanda tangan ulang beralasan.
 */
export function DeathCertificatePanel({
  encounterId,
  certificate,
  canSign,
  pdfBase,
}: {
  encounterId: string;
  certificate: DeathCertificate | null;
  /** Peran ber-`clinical.sign` (relasi dengan pasien diperiksa API). */
  canSign: boolean;
  pdfBase: string;
}) {
  const ids = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [diedAt, setDiedAt] = useState(nowLocal);
  const [cause, setCause] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const failed = certificate?.document?.signatureStatus === 'failed';

  const submit = (resign: boolean) =>
    start(async () => {
      const r = await issueDeathCertificateAction(
        encounterId,
        resign && certificate
          ? {
              diedAt: certificate.diedAt,
              causeCode: certificate.cause.code,
              note: certificate.note ?? '',
            }
          : { diedAt: fromLocal(diedAt), causeCode: cause.trim().toUpperCase(), note },
        resign && certificate ? { supersedesId: certificate.id, correctionReason: reason.trim() } : null,
      );
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });

  return (
    <section
      aria-labelledby={`${ids}-h`}
      className="flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 px-4 py-3 shadow-card"
    >
      <h2 id={`${ids}-h`} className="m-0 text-body font-semibold">
        Surat keterangan kematian
      </h2>
      {certificate ? (
        <div className="flex flex-col gap-1 text-small">
          <span>
            Meninggal {formatTanggalWaktu(certificate.diedAt)} WIB · sebab{' '}
            <span className="font-mono font-semibold">{certificate.cause.code}</span>{' '}
            {certificate.cause.display}
          </span>
          {certificate.note && <span className="text-ink-700">{certificate.note}</span>}
          <span className="text-caption text-ink-500">
            {certificate.author.nama} · versi {certificate.version} ·{' '}
            {certificate.document?.signatureStatus ? TTE[certificate.document.signatureStatus] : 'tanpa TTE'}
            {certificate.document && (
              <>
                {' · '}
                <a href={`${pdfBase}/${certificate.document.id}/unduh`} target="_blank" rel="noopener">
                  Buka PDF
                </a>
              </>
            )}
          </span>
          {failed && canSign && (
            <div className="flex flex-col gap-1.5 pt-1">
              <label htmlFor={`${ids}-alasan`} className="text-small font-semibold text-danger">
                TTE gagal · alasan tanda tangan ulang
              </label>
              <textarea
                id={`${ids}-alasan`}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="min-h-[56px] rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small"
              />
              <span>
                <Button
                  variant="primary"
                  disabled={pending || reason.trim().length < 10}
                  onClick={() => submit(true)}
                >
                  Tanda tangani ulang surat (TTE)
                </Button>
              </span>
            </div>
          )}
        </div>
      ) : canSign ? (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Field
            label="Jam kematian"
            type="datetime-local"
            value={diedAt}
            onChange={(e) => setDiedAt(e.target.value)}
          />
          <Field
            label="Sebab kematian (ICD-10)"
            value={cause}
            list={`${ids}-icd`}
            maxLength={8}
            placeholder="J18.9"
            onChange={(e) => setCause(e.target.value)}
          />
          <datalist id={`${ids}-icd`}>
            {ICD10_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </datalist>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor={`${ids}-ket`} className="text-small font-semibold">
              Keterangan (rangkaian sebab, opsional)
            </label>
            <textarea
              id={`${ids}-ket`}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-[56px] rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small"
            />
          </div>
          <span className="sm:col-span-2">
            <Button
              variant="primary"
              disabled={pending || !diedAt || !/^[A-Za-z]\d{2}(\.\d{1,2})?$/.test(cause.trim())}
              onClick={() => submit(false)}
            >
              Terbitkan surat kematian (TTE)
            </Button>
          </span>
        </div>
      ) : (
        <span className="text-small text-ink-500">
          Belum terbit. Surat keterangan kematian diterbitkan dokter yang merawat pasien.
        </span>
      )}
      {msg && (
        <span
          role={msg.ok ? 'status' : 'alert'}
          className={cx('text-caption font-semibold', msg.ok ? 'text-success' : 'text-danger')}
        >
          {msg.text}
        </span>
      )}
    </section>
  );
}
