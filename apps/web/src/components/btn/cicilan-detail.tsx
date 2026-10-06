'use client';

import { formatRupiah, type InstalmentApplication, type InstalmentStage } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import Link from 'next/link';
import { useId, useState } from 'react';
import { GatedButton } from '@/components/gated-button';
import { formatWhen } from '@/lib/btn';
import {
  canReject,
  INSTALMENT_FLOW,
  INSTALMENT_LABEL,
  INSTALMENT_TONE,
  monthlyInstalment,
  REJECT_REASON_MIN,
} from '@/lib/btn-pembiayaan';

const FLOW_TEXT: Record<InstalmentStage, [string, string]> = {
  diajukan: ['Diajukan', 'data pasien dan tagihan dikirim ke BTN dengan persetujuan pasien'],
  verifikasi: ['Verifikasi BTN', 'NIK, penghasilan, dan skor kredit oleh BTN'],
  disetujui: ['Disetujui BTN', 'limit dan tenor ditetapkan BTN'],
  akad: ['Akad digital (TTE)', 'pasien menandatangani akad secara elektronik'],
  // Keterangan "dicairkan" memuat nomor rekening RS, disisipkan saat render.
  dicairkan: ['Dicairkan ke RS', 'BTN mentransfer pelunasan ke rekening operasional RS'],
  ditolak: ['Ditolak BTN', ''],
};
const NEXT_LABEL: Partial<Record<InstalmentStage, string>> = {
  diajukan: 'Simulasi: teruskan ke verifikasi BTN',
  verifikasi: 'Simulasi: BTN menyetujui',
  disetujui: 'Simulasi: pasien tanda tangan akad (TTE)',
  akad: 'Simulasi: BTN mencairkan dana',
};

/** Detail pengajuan cicilan: fakta, timeline Diajukan → … → Dicairkan, aksi simulasi, dan penolakan beralasan. */
export function CicilanDetail({
  app,
  marginPercent,
  account,
  busy,
  onNext,
  onReject,
}: {
  app: InstalmentApplication;
  marginPercent: number;
  account: string;
  busy: boolean;
  onNext: () => void;
  onReject: (reason: string) => Promise<boolean>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const amount = BigInt(app.amount);
  const at = (st: InstalmentStage) => app.history.find((h) => h.stage === st)?.at ?? null;
  const level = INSTALMENT_FLOW.indexOf(app.stage);
  const len = reason.trim().length;
  const short = len < REJECT_REASON_MIN;
  const facts: Array<[string, string, boolean]> = [
    ['Nilai pembiayaan', formatRupiah(amount), true],
    ['Tenor', `${app.tenorMonths} bulan`, false],
    [
      'Estimasi angsuran (simulasi)',
      `${formatRupiah(monthlyInstalment(amount, app.tenorMonths, marginPercent))}/bln`,
      true,
    ],
    ['Sumber pengajuan', app.source, false],
    ['Tagihan RS', app.invoiceNo, true],
    ['Margin', `${marginPercent}% p.a. flat (simulasi, produk BTN)`, false],
  ];
  const timeline =
    app.stage === 'ditolak'
      ? app.history.map((h) => ({ st: h.stage, done: true, next: false }))
      : INSTALMENT_FLOW.map((st, i) => ({ st, done: i <= level, next: i === level + 1 }));
  return (
    <section
      aria-label="Detail pengajuan"
      className="flex min-w-0 flex-[999_1_420px] flex-col gap-3 rounded-card border border-line bg-white p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">
            {app.patient.name} · <span className="font-mono">{app.patient.rm}</span>
          </span>
          <span className="text-small text-ink-700">{app.service}</span>
          <span className="text-caption text-ink-500">
            {app.applicant} · <span className="font-mono">{app.reference}</span>
          </span>
        </span>
        <Chip tone={INSTALMENT_TONE[app.stage]}>{INSTALMENT_LABEL[app.stage]}</Chip>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">
        {facts.map(([k, v, mono]) => (
          <div key={k} className="flex min-w-0 flex-col">
            <dt className="text-caption text-ink-500">{k}</dt>
            <dd className={cx('m-0 break-words text-small', mono && 'font-mono')}>{v}</dd>
          </div>
        ))}
      </dl>
      {app.note && (
        <span className="rounded-control bg-[#F8FAFB] p-2.5 text-small text-ink-700">{app.note}</span>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-small font-semibold">Timeline status</span>
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {timeline.map(({ st, done, next }) => {
            const rejected = st === 'ditolak';
            return (
              <li key={st} className="flex items-start gap-2.5 text-small">
                <span
                  aria-hidden="true"
                  className={cx(
                    'mt-0.5 flex size-6 flex-none items-center justify-center rounded-full border text-caption font-bold',
                    rejected
                      ? 'border-danger bg-danger text-white'
                      : done
                        ? 'border-success bg-success text-white'
                        : next
                          ? 'border-[#9DB7E8] bg-[#E8EEF9] text-info'
                          : 'border-line-strong bg-white text-ink-500',
                  )}
                >
                  {rejected ? '✕' : done ? '✓' : INSTALMENT_FLOW.indexOf(st) + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cx('font-medium', rejected && 'text-danger', !done && !next && 'text-ink-500')}
                  >
                    {FLOW_TEXT[st][0]}
                    <span className="sr-only">
                      {done ? ' (selesai)' : next ? ' (berikutnya)' : ' (belum)'}
                    </span>
                  </span>
                  <span className="text-caption text-ink-500">
                    {rejected
                      ? app.rejectReason
                      : st === 'dicairkan'
                        ? `BTN mentransfer pelunasan ke ${account}`
                        : FLOW_TEXT[st][1]}
                  </span>
                </span>
                <span className="font-mono text-caption text-ink-500">
                  {done && at(st) ? formatWhen(at(st) ?? '') : next ? 'menunggu' : ''}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      {app.stage === 'dicairkan' && (
        <div
          role="status"
          className="rounded-control border border-[#B7DEC0] bg-[#EAF5EC] px-3 py-2 text-small text-success"
        >
          ✓ BTN mencairkan {formatRupiah(amount)} ke rekening operasional {account}
          {at('dicairkan') ? ` (${formatWhen(at('dicairkan') ?? '')})` : ''}. Tagihan {app.invoiceNo} lunas;
          angsuran berikutnya dibayar pasien langsung ke BTN.
        </div>
      )}
      {app.stage === 'ditolak' && (
        <div
          role="status"
          className="rounded-control border border-danger-border bg-danger-bg px-3 py-2 text-small text-danger"
        >
          ✕ Ditolak BTN: {app.rejectReason}. Tagihan {app.invoiceNo} tetap terbuka; tawarkan kanal bayar lain
          (VA, QRIS, EDC).
        </div>
      )}
      {app.scenario ? (
        <span className="text-caption text-ink-500">
          Pengajuan pasien skenario: tahapnya mengikuti langkah Kasir di Simulasi (ajukan → setuju → cair).
        </span>
      ) : (
        NEXT_LABEL[app.stage] && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                // Tahap maju: form penolakan ditutup dan dikosongkan (mockup).
                setOpen(false);
                setReason('');
                setTried(false);
                onNext();
              }}
            >
              {NEXT_LABEL[app.stage]}
            </Button>
            {canReject(app) && (
              <Button
                aria-expanded={open}
                disabled={busy}
                onClick={() => {
                  setOpen((o) => !o);
                  setTried(false);
                }}
                className="border-danger-border text-danger"
              >
                Tolak
              </Button>
            )}
          </div>
        )
      )}
      {open && canReject(app) && !app.scenario && (
        <form
          className="flex flex-col gap-1.5 rounded-control border border-danger-border bg-[#FFFBFA] p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setTried(true);
            if (short) return;
            if (await onReject(reason)) {
              setOpen(false);
              setReason('');
              setTried(false);
            }
          }}
        >
          <label htmlFor={`${id}-tolak`} className="text-small font-semibold">
            Alasan penolakan dari BTN (wajib)
          </label>
          <textarea
            id={`${id}-tolak`}
            rows={2}
            maxLength={300}
            value={reason}
            aria-invalid={tried && short}
            aria-describedby={`${id}-tolak-msg`}
            onChange={(e) => setReason(e.target.value)}
            placeholder="mis. Data penghasilan tidak dapat diverifikasi"
            className={cx(
              'rounded-control border bg-white px-3 py-2 font-[inherit]',
              tried && short ? 'border-danger' : 'border-line-strong',
            )}
          />
          <span
            id={`${id}-tolak-msg`}
            className={cx('text-caption', tried && short ? 'font-semibold text-danger' : 'text-ink-500')}
          >
            {tried && short
              ? `Alasan wajib diisi, minimal ${REJECT_REASON_MIN} karakter.`
              : short
                ? `Minimal ${REJECT_REASON_MIN} karakter (${len}/${REJECT_REASON_MIN}).`
                : 'Alasan tercatat di jejak audit dan dikirim ke pasien.'}
          </span>
          <span className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setOpen(false);
                setReason('');
                setTried(false);
              }}
            >
              Batal
            </Button>
            <GatedButton
              type="submit"
              variant="danger"
              enabled={!short && !busy}
              onBlocked={() => setTried(true)}
            >
              Konfirmasi tolak
            </GatedButton>
          </span>
        </form>
      )}
      <div className="flex gap-2.5 rounded-control border border-[#C9D3EE] bg-[#F6F8FD] px-3 py-2.5 text-[12.5px] text-ink-700">
        <span aria-hidden="true" className="font-bold text-info">
          i
        </span>
        <span>
          Angsuran dibayar pasien <b>langsung ke BTN</b>, bukan ke RS. RS menerima pelunasan penuh ke rekening
          operasional {account} saat pencairan, dan tidak menanggung risiko gagal bayar kecuali diatur lain di
          perjanjian. Keputusan kredit sepenuhnya oleh BTN.
        </span>
      </div>
      <Link href="/keuangan/pembayaran" className="self-start text-small font-semibold text-brand-700">
        Lihat penerimaan di Pembayaran via BTN
      </Link>
    </section>
  );
}
