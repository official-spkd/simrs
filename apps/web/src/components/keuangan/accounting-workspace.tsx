'use client';

import { type AccountingBoard, formatJam, formatTanggal, type JournalEntry } from '@simrs/shared';
import { Button } from '@simrs/ui';
import { type ReactNode, useId, useState, useTransition } from 'react';
import { type AkuntansiActionInput, akuntansiAction } from '@/app/(staf)/keuangan/akuntansi/actions';
import { closeReadiness } from '@/lib/keuangan-akuntansi';
import { AgingCard } from './aging-card';
import { BankReconCard } from './bank-recon-card';
import { JournalTable } from './journal-table';
import { PeriodClose } from './period-close';

/**
 * U04/U07/U09 · Ruang kerja Akuntansi (mockup Akuntansi): jurnal otomatis, pemetaan akun, rekonsiliasi bank, dan
 * tutup periode (mengunci jurnal). Semua tindakan lewat Server Action (simulasi, tidak disimpan).
 */
export function AccountingWorkspace({
  board,
  reconJournals,
  kpis,
}: {
  board: AccountingBoard;
  /** Jurnal yang terposting saat mutasi rekening dipadankan (id rekening → id jurnal). */
  reconJournals: Record<string, string[]>;
  kpis: ReactNode;
}) {
  const id = useId();
  const [mapped, setMapped] = useState<{ code: string; name: string; at: string } | null>(null);
  const [matchedAt, setMatchedAt] = useState<Record<string, string>>({});
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const act = (input: AkuntansiActionInput, done?: (at: string) => void) =>
    startTransition(async () => {
      const r = await akuntansiAction(input);
      setMessage(r.message);
      if (r.ok) done?.(r.at ?? formatJam(new Date()));
    });

  const posted = new Set(Object.entries(matchedAt).flatMap(([acc]) => reconJournals[acc] ?? []));
  const journals: JournalEntry[] = board.journals.map((j) => {
    if (j.status === 'perlu-pemetaan' && mapped) {
      return {
        ...j,
        status: 'menunggu-persetujuan',
        lines: j.lines.map((l) =>
          l.account ? l : { ...l, account: { code: mapped.code, name: mapped.name } },
        ),
      };
    }
    return posted.has(j.id) ? { ...j, status: 'terposting' } : j;
  });
  const toMap = journals.find((j) => j.lines.some((l) => !l.account));
  const mappingJournal = board.journals.find((j) => j.status === 'perlu-pemetaan');
  const unmatched = board.bankRecon.filter((b) => b.unmatched.length > 0 && !matchedAt[b.id]);
  const ready = closeReadiness({
    unmapped: toMap ? [toMap.number] : [],
    unmatchedAccounts: unmatched.map((b) => `BTN ${b.account}`),
  });
  const locked = !!closedAt;
  const prev = board.previousPeriod;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-white px-4 py-3">
        <span className="text-[13px] text-ink-700">
          {closedAt ? (
            <>
              Periode {board.period.label}:{' '}
              <span className="font-semibold text-success">ditutup hari ini {closedAt}</span>
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
          <Button disabled={pending} onClick={() => act({ type: 'ekspor' })}>
            Ekspor laporan
          </Button>
          {!closedAt && (
            <PeriodClose
              periodLabel={board.period.label}
              prereqs={[
                {
                  ok: !toMap,
                  text: toMap
                    ? `${toMap.number} belum dipetakan ke akun lawan`
                    : `Semua jurnal terpetakan${mappingJournal ? ` (${mappingJournal.number} sudah dipetakan)` : ''}`,
                },
                {
                  ok: unmatched.length === 0,
                  text: unmatched.length
                    ? `Rekonsiliasi ${unmatched.map((b) => `BTN ${b.account}`).join(', ')} masih ada selisih`
                    : 'Rekonsiliasi bank cocok di semua rekening',
                },
              ]}
              ready={ready.ready}
              reason={ready.reason}
              pending={pending}
              onConfirm={() =>
                act(
                  {
                    type: 'tutup-periode',
                    periodId: board.period.id,
                    unmapped: toMap ? 1 : 0,
                    unmatched: unmatched.length,
                  },
                  setClosedAt,
                )
              }
            />
          )}
        </span>
      </div>
      {closedAt && (
        <div
          role="status"
          className="flex gap-2.5 rounded-card border border-[#B7DEC0] bg-[#EAF5EC] px-4 py-3 text-[13px]"
        >
          <span aria-hidden="true" className="font-bold text-success">
            ✓
          </span>
          <span className="text-ink-700">
            <span className="font-semibold text-success">
              Periode {board.period.label} ditutup {closedAt}.
            </span>{' '}
            Jurnal dikunci; pemetaan dan pemadanan tidak bisa diubah lagi.
          </span>
        </div>
      )}
      {kpis}
      <div className="flex flex-wrap items-start gap-4">
        <JournalTable
          journals={journals}
          journalCount={board.journalCount}
          footer={
            mappingJournal &&
            (mapped ? (
              <div
                role="status"
                className="flex gap-2.5 border-t border-[#B7DEC0] bg-[#F2FAF4] px-4 py-3 text-[13px]"
              >
                <span aria-hidden="true" className="font-bold text-success">
                  ✓
                </span>
                <span className="text-ink-700">
                  {mappingJournal.number} dipetakan ke <span className="font-semibold">{mapped.name}</span> ·{' '}
                  {mapped.at} · siap diposting setelah disetujui penyetuju kedua.
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5 border-t border-warning-border bg-[linear-gradient(100deg,rgba(138,75,0,0.08),#FFFAF2_60%)] px-4 py-3">
                <span className="min-w-[240px] flex-1 text-[13px] text-ink-700">
                  <span className="font-bold text-warning">! </span>
                  {mappingJournal.number}: {mappingJournal.description} belum punya akun lawan. Pemetaan akun
                  diperlukan sebelum jurnal diposting.
                </span>
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
                      act({ type: 'petakan', journalId: mappingJournal.id, accountCode: opt.code }, (at) =>
                        setMapped({ ...opt, at }),
                      );
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
            onMatch={(acc) =>
              act({ type: 'padankan', accountId: acc }, (at) => setMatchedAt((m) => ({ ...m, [acc]: at })))
            }
          />
          <section
            aria-label="Kontrol"
            className="flex flex-col gap-1.5 rounded-card border border-line bg-white p-4 text-[13px] text-ink-700"
          >
            <span className="font-semibold text-ink-900">Kontrol</span>
            <span>• Jurnal terposting tidak bisa diedit, hanya dibalik</span>
            <span>• Pemisahan tugas: pembuat ≠ penyetuju</span>
            <span>• Periode tertutup dikunci; buka ulang butuh direktur keuangan</span>
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
