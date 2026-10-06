'use client';

import { type AccountingBoard, formatJam, formatRupiah, formatTanggal } from '@simrs/shared';
import { Button } from '@simrs/ui';
import { type ReactNode, useId, useState } from 'react';
import { type AkuntansiActionInput, akuntansiAction } from '@/app/(staf)/keuangan/akuntansi/actions';
import { GatedButton } from '@/components/gated-button';
import { useStoreAction } from '@/lib/demo/store/client';
import { AgingCard } from './aging-card';
import { BankReconCard } from './bank-recon-card';
import { JournalTable } from './journal-table';
import { PeriodClose } from './period-close';

/** Tanda tangan aksi tersimpan (pengguna sesi + jam demo). */
export interface SignedView {
  by: string;
  at: string;
}

/** Keadaan pemetaan jurnal yang perlu akun lawan (dari toko domain `akuntansi`). */
export interface MappingView {
  journalId: string;
  number: string;
  description: string;
  /** Nominal baris tanpa akun lawan. */
  amount: string;
  mapped: (SignedView & { code: string; name: string; mine: boolean }) | null;
  approved: SignedView | null;
}

/**
 * U04/U07/U09 · Ruang kerja Akuntansi (mockup Akuntansi): jurnal otomatis (termasuk jurnal dari Kasir dan layar
 * keuangan lain), pemetaan akun + persetujuan penyetuju kedua (pembuat ≠ penyetuju), rekonsiliasi bank, ekspor, dan
 * tutup periode (mengunci jurnal). Semua tindakan tersimpan di toko demo (domain `akuntansi`) atas nama pengguna sesi.
 */
export function AccountingWorkspace({
  board,
  rev,
  mapping,
  matched,
  close,
  closed,
  lastExport,
  heading,
  banner,
  kpis,
}: {
  board: AccountingBoard;
  /** Revisi domain `akuntansi`. */
  rev: number;
  mapping: MappingView | null;
  /** Rekening yang mutasinya sudah dipadankan (id → tanda tangan). */
  matched: Record<string, SignedView>;
  /** Syarat tutup periode dihitung server dari toko. */
  close: { ready: boolean; reason: string; pendingApproval: string[] };
  closed: SignedView | null;
  lastExport: SignedView | null;
  /** Judul halaman; periode, Ekspor, dan Tutup periode tampil sebaris di kanannya (mockup Akuntansi). */
  heading: ReactNode;
  banner?: ReactNode;
  kpis: ReactNode;
}) {
  const id = useId();
  const [mapOpen, setMapOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { run, pending } = useStoreAction(rev);
  const act = (input: AkuntansiActionInput) =>
    run(
      (r) => akuntansiAction({ ...input, rev: r }),
      (res) => setMessage(res.message),
    );

  const locked = !!closed;
  const prev = board.previousPeriod;
  const unmatched = board.bankRecon.filter((b) => b.unmatched.length > 0 && !matched[b.id]);
  const matchedAt = Object.fromEntries(
    Object.entries(matched).map(([k, v]) => [k, `${formatJam(v.at)} oleh ${v.by}`]),
  );
  const toMap = mapping && !mapping.mapped ? mapping : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        {heading}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] text-ink-700">
            {closed ? (
              <>
                Periode {board.period.label}:{' '}
                <span className="font-semibold text-success">
                  ditutup {formatJam(closed.at)} oleh {closed.by}
                </span>
              </>
            ) : (
              <>
                Periode {prev.label}:{' '}
                <span className="font-semibold text-success">
                  ditutup {prev.closedAt ? formatTanggal(prev.closedAt) : '—'}
                </span>{' '}
                · periode {board.period.label} terbuka
              </>
            )}
          </span>
          <span className="flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => act({ type: 'ekspor', rev: 0 })}>
              Ekspor laporan
            </Button>
            {!closed && (
              <PeriodClose
                periodLabel={board.period.label}
                prereqs={[
                  {
                    ok: !toMap,
                    text: toMap
                      ? `${toMap.number} belum dipetakan ke akun lawan`
                      : `Semua jurnal terpetakan${mapping ? ` (${mapping.number} sudah dipetakan)` : ''}`,
                  },
                  {
                    ok: close.pendingApproval.length === 0,
                    text: close.pendingApproval.length
                      ? `${close.pendingApproval.join(', ')} menunggu penyetuju kedua (usulan K-2: tutup periode diblokir; menunggu konfirmasi pemilik produk)`
                      : 'Tidak ada jurnal menunggu penyetuju kedua',
                  },
                  {
                    ok: unmatched.length === 0,
                    text: unmatched.length
                      ? `Rekonsiliasi ${unmatched
                          .map((b) => `${b.label} ${b.account} masih ${b.unmatched.length} selisih`)
                          .join('; ')}`
                      : 'Rekonsiliasi bank cocok di semua rekening',
                  },
                ]}
                ready={close.ready}
                reason={close.reason}
                pending={pending}
                onConfirm={() => act({ type: 'tutup-periode', periodId: board.period.id, rev: 0 })}
              />
            )}
          </span>
        </div>
      </header>
      {banner}
      {closed && (
        <div
          role="status"
          className="flex gap-2.5 rounded-card border border-zamrud-200 bg-zamrud-50 px-4 py-3 text-[13px]"
        >
          <span aria-hidden="true" className="font-bold text-success">
            ✓
          </span>
          <span className="text-ink-700">
            <span className="font-semibold text-success">
              Periode {board.period.label} ditutup {formatJam(closed.at)}.
            </span>{' '}
            Jurnal dikunci oleh {closed.by}; pemetaan, persetujuan, pemadanan, dan transaksi baru bertanggal
            periode ini ditolak.
          </span>
        </div>
      )}
      {kpis}
      <div className="flex flex-wrap items-start gap-4">
        <JournalTable
          journals={board.journals}
          journalCount={board.journalCount}
          footer={
            mapping &&
            (mapping.mapped ? (
              <div
                role="status"
                className="flex flex-wrap items-center gap-2.5 border-t border-zamrud-200 bg-zamrud-50 px-4 py-3 text-[13px]"
              >
                <span aria-hidden="true" className="font-bold text-success">
                  ✓
                </span>
                <span className="min-w-[240px] flex-1 text-ink-700">
                  {mapping.number} dipetakan ke <span className="font-semibold">{mapping.mapped.name}</span>{' '}
                  oleh {mapping.mapped.by} · {formatJam(mapping.mapped.at)} ·{' '}
                  {mapping.approved
                    ? `disetujui ${mapping.approved.by} ${formatJam(mapping.approved.at)} dan terposting.`
                    : 'siap diposting setelah disetujui penyetuju kedua.'}
                </span>
                {!mapping.approved && (
                  <GatedButton
                    variant="primary"
                    enabled={!mapping.mapped.mine && !locked && !pending}
                    reason={
                      mapping.mapped.mine
                        ? 'Pemisahan tugas: Anda pembuat pemetaan; penyetuju kedua harus pengguna lain (mis. Superadmin demo bertindak sebagai Akuntan).'
                        : null
                    }
                    reasonClassName="max-w-[320px]"
                    onClick={() => act({ type: 'setujui', journalId: mapping.journalId, rev: 0 })}
                  >
                    Setujui dan posting
                  </GatedButton>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5 border-t border-warning-border bg-[linear-gradient(100deg,rgba(138,75,0,0.08),var(--color-kunyit-50)_60%)] px-4 py-3">
                <span className="min-w-[240px] flex-1 text-[13px] text-ink-700">
                  <span className="font-bold text-warning">! </span>
                  {mapping.number}: {mapping.description} {formatRupiah(BigInt(mapping.amount))} belum punya
                  akun lawan. Pemetaan akun diperlukan sebelum jurnal diposting.
                </span>
                {!mapOpen ? (
                  <Button
                    aria-expanded={false}
                    aria-controls={`${id}-peta`}
                    disabled={locked}
                    onClick={() => setMapOpen(true)}
                    className="border-brand-700 font-semibold text-brand-700"
                  >
                    Petakan akun
                  </Button>
                ) : (
                  <span id={`${id}-peta`} className="flex flex-wrap items-center gap-2">
                    <label htmlFor={`${id}-akun`} className="text-[12.5px] font-semibold text-warning-strong">
                      Akun lawan (kredit)
                    </label>
                    <select
                      id={`${id}-akun`}
                      value=""
                      disabled={locked || pending}
                      onChange={(e) => {
                        const opt = board.mappingOptions.find((o) => o.code === e.target.value);
                        if (opt) {
                          act({
                            type: 'petakan',
                            journalId: mapping.journalId,
                            accountCode: opt.code,
                            rev: 0,
                          });
                        }
                      }}
                      className="h-11 max-w-[320px] rounded-control border border-brand-700 bg-white px-2 font-[inherit] text-[13px]"
                    >
                      <option value="">Pilih akun…</option>
                      {board.mappingOptions.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.code} · {o.name}
                        </option>
                      ))}
                    </select>
                    <Button aria-expanded onClick={() => setMapOpen(false)}>
                      Batal
                    </Button>
                  </span>
                )}
              </div>
            ))
          }
        />
        <aside
          aria-label="Piutang dan bank"
          className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 xl:max-w-[400px]"
        >
          <AgingCard rows={board.aging} />
          <BankReconCard
            accounts={board.bankRecon}
            matchedAt={matchedAt}
            locked={locked}
            pending={pending}
            onMatch={(acc) => act({ type: 'padankan', accountId: acc, rev: 0 })}
          />
          <section
            aria-label="Kontrol"
            className="flex flex-col gap-1.5 rounded-card border border-line bg-white p-4 text-[13px] text-ink-700"
          >
            <span className="font-semibold text-ink-900">Kontrol</span>
            <span>• Jurnal terposting tidak bisa diedit, hanya dibalik</span>
            <span>• Pemisahan tugas: pembuat ≠ penyetuju (dari pengguna sesi)</span>
            <span>• Periode tertutup dikunci; buka ulang butuh direktur keuangan</span>
            {lastExport && (
              <span>
                • Ekspor terakhir {formatJam(lastExport.at)} oleh {lastExport.by}
              </span>
            )}
          </section>
        </aside>
      </div>
      {message && (
        <span role="status" className="text-caption text-ink-700">
          {message}
        </span>
      )}
    </div>
  );
}
