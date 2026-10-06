import { type BpjsEligibility, PAYERS, type Payer, type Referral } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import { referralExpired, referralMeta } from '@/lib/front-office';

const PAYER_LABEL: Record<Payer, string> = {
  BPJS: 'BPJS Kesehatan',
  Umum: 'Umum (bayar sendiri)',
  Asuransi: 'Asuransi swasta',
};

/** F06 · Penjamin: pilih BPJS/Umum/Asuransi, cek kepesertaan VClaim, pilih rujukan aktif (kedaluwarsa terkunci). */
export function RegPayer({
  payer,
  payerLocked,
  payerNote,
  eligibility,
  checked,
  checkDisabled,
  checking,
  referrals,
  referralId,
  referralLocked,
  today,
  onPayer,
  onCheck,
  onReferral,
}: {
  payer: Payer;
  payerLocked: boolean;
  /** Alasan penjamin dikunci (mis. pasien skenario booking JKN). */
  payerNote: string;
  eligibility: BpjsEligibility | null;
  checked: boolean;
  checkDisabled: boolean;
  checking: boolean;
  referrals: Referral[];
  referralId: string | null;
  referralLocked: boolean;
  today: string;
  onPayer: (p: Payer) => void;
  onCheck: () => void;
  onReferral: (id: string) => void;
}) {
  const bpjs = payer === 'BPJS';
  return (
    <div className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-h2 font-semibold">Penjamin: {PAYER_LABEL[payer]}</h2>
        <div
          role="group"
          aria-label="Pilih penjamin"
          className="flex gap-1 rounded-control bg-ink-900/6 p-[3px]"
        >
          {PAYERS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === payer}
              disabled={payerLocked}
              onClick={() => onPayer(p)}
              className={cx(
                'h-11 cursor-pointer rounded-[9px] border-0 px-3.5 font-[inherit] text-small disabled:cursor-not-allowed disabled:opacity-60',
                p === payer
                  ? 'bg-white font-semibold text-ink-900 shadow-tab'
                  : 'bg-transparent text-ink-700 hover:bg-white/60',
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      {payerNote && <span className="text-caption text-ink-500">{payerNote}</span>}
      {!bpjs && (
        <div className="flex flex-col gap-1 rounded-[12px] bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-batu-50))] p-3">
          <span className="font-semibold">
            {payer === 'Umum' ? 'Pasien umum · tanpa SEP' : 'Asuransi swasta · tanpa SEP'}
          </span>
          <span className="text-small text-ink-700">
            {payer === 'Umum'
              ? 'Tarif sesuai kelas layanan, dibayar di kasir setelah pemeriksaan. Lanjut pilih poli dan dokter.'
              : 'Kartu dan limit asuransi diverifikasi kasir. Lanjut pilih poli dan dokter.'}
          </span>
        </div>
      )}
      {bpjs && checked && eligibility && (
        <dl
          aria-label="Hasil cek kepesertaan"
          className="m-0 grid grid-cols-2 gap-2 rounded-[12px] border border-success-border bg-alert-success p-3 sm:grid-cols-4"
        >
          {[
            { k: 'Status peserta', v: eligibility.status === 'aktif' ? 'AKTIF' : 'TIDAK AKTIF' },
            { k: 'No. kartu', v: eligibility.cardMasked },
            { k: 'Hak kelas', v: `${eligibility.kelas} · ${eligibility.segment}` },
            { k: 'FKTP', v: eligibility.fktp },
          ].map((x) => (
            <div key={x.k} className="flex flex-col">
              <dt className="text-caption text-ink-500">{x.k}</dt>
              <dd className={cx('m-0 text-small font-semibold', x.k === 'Status peserta' && 'text-success')}>
                {x.v}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {bpjs && !checked && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-batu-50))] p-3">
          <span className="flex flex-col">
            <span className="text-caption text-ink-500">Status peserta</span>
            <span className="text-small font-semibold">
              {checkDisabled ? 'Menunggu data pasien' : 'Belum dicek ke VClaim'}
            </span>
          </span>
          <Button variant="primary" disabled={checkDisabled || checking} onClick={onCheck}>
            {checking ? 'Memeriksa VClaim…' : 'Cek kepesertaan'}
          </Button>
        </div>
      )}
      {bpjs && (
        <div className="flex flex-col gap-2">
          <span className="text-small font-semibold text-ink-700">Pilih rujukan aktif</span>
          {referrals.length === 0 && (
            <span className="text-small text-ink-500">Tidak ada rujukan tercatat.</span>
          )}
          {referrals.map((r) => {
            const expired = referralExpired(r, today);
            const sel = r.id === referralId;
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={sel}
                disabled={expired || referralLocked}
                onClick={() => onReferral(r.id)}
                className={cx(
                  'flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-control px-3 py-2 text-left font-[inherit] disabled:cursor-not-allowed',
                  sel
                    ? 'border-2 border-brand-600 bg-selected'
                    : 'border border-line bg-white hover:bg-brand-50/60',
                  expired && 'bg-subtle',
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className={cx('text-small font-semibold', expired ? 'text-ink-500' : 'text-ink-900')}>
                    {r.title}
                  </span>
                  <span className="text-caption text-ink-500">{referralMeta(r, today)}</span>
                </span>
                <Chip tone={expired ? 'danger' : sel ? 'brand' : 'neutral'}>
                  {expired ? 'Kedaluwarsa' : sel ? 'Dipakai' : 'Aktif'}
                </Chip>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
