'use client';

import { formatRupiah, type Refund, type RefundStage } from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import { useState } from 'react';
import type { PaymentInput } from '@/app/(staf)/keuangan/pembayaran/use-payment-state';
import { REKENING } from '@/lib/demo/fixtures/rs';
import {
  formatWhen,
  nextRefundStage,
  REFUND_FLOW,
  REFUND_REASON_LABEL,
  REFUND_STAGE_LABEL,
  REFUND_STAGE_TONE,
  refundDraftErrors,
} from '@/lib/btn';
import { refundJournal } from '@/lib/keuangan-jurnal';
import { JurnalPasangan } from '@/components/keuangan/jurnal-pasangan';
import { type RefundDraft, RefundForm } from './refund-form';

const STEPS = ['Diajukan', 'Supervisor kasir', 'Manajer keuangan', 'Transfer BTN', 'Dana kembali'];
/** Entri riwayat yang menandai selesainya tiap langkah (jam di bilah tahapan, mockup). */
const STEP_LOG: readonly RegExp[] = [
  /^Diajukan/,
  /supervisor kasir/i,
  /manajer keuangan/i,
  /^Instruksi transfer/,
  /^Dana diterima/,
];
const ACTION: Partial<Record<RefundStage, { label: string; note: string }>> = {
  draf: { label: 'Ajukan refund', note: 'Nominal, alasan, dan keterangan wajib diisi sebelum diajukan.' },
  'menunggu-supervisor': {
    label: 'Setujui sebagai supervisor kasir',
    note: 'penyetuju tingkat 1. Periksa alasan dan nominal terhadap transaksi asal.',
  },
  'menunggu-manajer': {
    label: 'Setujui sebagai manajer keuangan',
    note: 'Simulasi peran: manajer keuangan · penyetuju tingkat 2. Setelah disetujui, instruksi transfer dikirim via TPDI ke BTN.',
  },
  'diproses-btn': {
    label: 'Simulasikan dana diterima pasien',
    note: 'Menunggu konfirmasi BTN bahwa transfer ke rekening pasien berhasil (webhook refund.completed).',
  },
};


/** Tab Refund: persetujuan 2 tingkat (pembuat ≠ penyetuju), dana didebit dari rekening operasional BTN. */
export function RefundTab({
  refunds,
  busy,
  record,
}: {
  /** Refund setelah aksi tersimpan (tahap, isian pengajuan, riwayat beserta pengguna sesi). */
  refunds: readonly Refund[];
  busy: boolean;
  record: (input: PaymentInput) => Promise<boolean>;
}) {
  const [sel, setSel] = useState(refunds[0]?.id ?? '');
  const first = refunds.find((r) => r.stage === 'draf');
  const [draft, setDraft] = useState<RefundDraft>({ amount: first?.amount ?? '', reason: '', note: '' });
  const [tried, setTried] = useState(false);
  const view = (r: Refund) => r;
  const picked = refunds.find((r) => r.id === sel) ?? refunds[0];
  if (!picked) return null;
  const f = view(picked);
  const stage = f.stage;
  const idx = REFUND_FLOW.indexOf(stage);
  const isDraft = stage === 'draf';
  const amount = isDraft ? (draft.amount ? BigInt(draft.amount) : 0n) : BigInt(f.amount);
  const errors = refundDraftErrors(f, amount, draft.reason, draft.note);
  const log = f.log;
  const act = ACTION[stage];
  const stepAt = STEPS.map((_, i) => log.find((g) => STEP_LOG[i]?.test(g.text))?.at ?? null);
  const reasonLabel = f.reason
    ? REFUND_REASON_LABEL[f.reason]
    : draft.reason
      ? REFUND_REASON_LABEL[draft.reason as keyof typeof REFUND_REASON_LABEL]
      : '';

  const advance = async () => {
    if (!nextRefundStage(stage)) return;
    if (isDraft) {
      setTried(true);
      if (errors.amount || errors.reason || errors.note) return;
      await record({
        kind: 'refund-ajukan',
        refundId: f.id,
        amount: draft.amount,
        reason: draft.reason as NonNullable<Refund['reason']>,
        note: draft.note.trim(),
      });
      return;
    }
    await record({ kind: 'refund-setujui', refundId: f.id, stage });
  };

  return (
    <div className="flex flex-wrap items-start gap-4">
      <section
        aria-label="Daftar refund"
        className="flex min-w-0 flex-[1_1_300px] flex-col gap-1 rounded-card border border-line bg-white p-3 lg:max-w-[400px]"
      >
        <span className="flex flex-col px-1 pb-1">
          <span className="font-semibold">Pengajuan refund</span>
          <span className="text-caption text-ink-500">
            Persetujuan 2 tingkat: supervisor kasir lalu manajer keuangan
          </span>
        </span>
        {refunds.map((raw) => {
          const r = view(raw);
          const st = r.stage;
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={r.id === f.id}
              onClick={() => setSel(r.id)}
              className={cx(
                'flex min-h-12 w-full cursor-pointer flex-col gap-1 rounded-control border-0 px-2 py-2 text-left font-[inherit]',
                r.id === f.id ? 'bg-brand-50 shadow-[inset_3px_0_0_var(--color-brand-600)]' : 'bg-white',
              )}
            >
              <span className="flex w-full justify-between gap-2">
                <span className="font-semibold">{r.patient.name}</span>
                <span className="font-mono">{formatRupiah(BigInt(r.amount))}</span>
              </span>
              <span className="flex w-full flex-wrap justify-between gap-2 text-caption text-ink-500">
                <span>
                  <span className="font-mono">{r.number}</span> · {r.channel === 'VA' ? 'VA BTN' : r.channel}
                </span>
                <Chip tone={REFUND_STAGE_TONE[st]}>{REFUND_STAGE_LABEL[st]}</Chip>
              </span>
            </button>
          );
        })}
      </section>
      <section
        aria-label="Detail refund"
        aria-live="polite"
        className="flex min-w-0 flex-[999_1_420px] flex-col gap-3 rounded-card border border-line bg-white p-4"
      >
        <span className="flex flex-wrap items-start justify-between gap-2">
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">
              {f.number} · {f.patient.name}
            </span>
            <span className="text-small text-ink-700">{f.context}</span>
          </span>
          <Chip tone={REFUND_STAGE_TONE[stage]}>{REFUND_STAGE_LABEL[stage]}</Chip>
        </span>
        <ol aria-label="Tahapan refund" className="m-0 grid list-none grid-cols-5 gap-1.5 p-0">
          {STEPS.map((l, i) => {
            const done = stage === 'dana-kembali' || i < idx;
            const cur = !done && i === idx;
            return (
              <li
                key={l}
                aria-current={cur ? 'step' : undefined}
                className="flex flex-col gap-1 text-caption"
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'h-1.5 rounded-full',
                    done ? 'bg-brand-600' : cur ? 'bg-kunyit-300' : 'bg-line',
                  )}
                />
                <span
                  className={cx(
                    done
                      ? 'font-semibold text-brand-700'
                      : cur
                        ? 'font-semibold text-warning'
                        : 'text-ink-500',
                  )}
                >
                  {done ? '✓ ' : cur ? '→ ' : ''}
                  {l}
                </span>
                <span className="font-mono text-ink-500">
                  {done ? (stepAt[i] ? formatWhen(stepAt[i] ?? '') : '') : cur ? 'berikutnya' : ''}
                </span>
              </li>
            );
          })}
        </ol>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-small">
          <dt className="text-ink-500">Transaksi asal</dt>
          <dd className="m-0 break-words font-mono">{f.transactionRef}</dd>
          <dt className="text-ink-500">Nominal refund</dt>
          <dd className="m-0 font-mono">{formatRupiah(amount)}</dd>
          <dt className="text-ink-500">Sumber dana</dt>
          <dd className="m-0">BTN {REKENING.operasional} · rekening operasional RS</dd>
          <dt className="text-ink-500">Tujuan</dt>
          <dd className="m-0">{f.destination}</dd>
        </dl>
        {isDraft ? (
          <RefundForm refund={f} draft={draft} errors={errors} tried={tried} onChange={setDraft} />
        ) : (
          <div className="flex flex-col gap-0.5 rounded-control bg-subtle p-3 text-small">
            <span className="font-semibold">Alasan: {reasonLabel}</span>
            <span className="text-ink-700">{f.reasonNote}</span>
          </div>
        )}
        {act && (
          <span className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={busy} onClick={advance}>
              {act.label}
            </Button>
            <span className="min-w-0 flex-1 text-caption text-ink-700">
              {act.note} · tercatat atas nama pengguna sesi; pengaju dan penyetuju harus orang berbeda
            </span>
          </span>
        )}
        {stage === 'dana-kembali' && (
          <div
            role="status"
            className="rounded-control border border-zamrud-200 bg-zamrud-50 px-3 py-2 text-small text-success"
          >
            Dana {formatRupiah(amount)} sudah kembali ke {f.destination}. Status transaksi asal diperbarui dan
            jurnal refund terbentuk otomatis.
          </div>
        )}
        {!isDraft && amount > 0n && (
          <JurnalPasangan
            jurnal={refundJournal(f.number, amount)}
            status={stage === 'dana-kembali' ? 'terposting saat dana kembali' : 'diposting saat dana kembali'}
          />
        )}
        <div className="flex flex-col gap-1 border-t border-line pt-2.5">
          <span className="text-small font-semibold">Riwayat</span>
          {log.map((g, i) => (
            <span key={`${g.at}-${i}`} className="flex gap-2.5 text-caption">
              <span className="w-[86px] flex-none font-mono text-ink-500">{formatWhen(g.at)}</span>
              <span className="text-ink-700">{g.text}</span>
            </span>
          ))}
          <span className="text-caption text-ink-500">
            Pembuat ≠ penyetuju (id pengguna sesi): pengaju, penyetuju tingkat 1, dan penyetuju tingkat 2
            harus orang berbeda (Superadmin demo bisa bertindak sebagai posisi lain). Dana refund didebit dari
            rekening operasional BTN {REKENING.operasional} dan dikirim ke rekening pasien; TPDI hanya
            meneruskan instruksi.
          </span>
        </div>
      </section>
    </div>
  );
}
