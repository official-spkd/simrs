'use client';

import { formatRupiah, formatTanggalWaktu, sumRupiah } from '@simrs/shared';
import { Button, Chip, type ChipTone, cx, KpiCard, Tabs } from '@simrs/ui';
import { useState } from 'react';
import { type HutangActionInput, hutangAction } from '@/app/(staf)/keuangan/hutang/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import { formatRupiahRingkas } from '@/lib/keuangan';
import {
  approvalJournal,
  approveProblem,
  dueGroup,
  type FakturPemasok,
  invoiceLocked,
  paymentJournal,
  requiredLevels,
  scheduleProblem,
  STATUS_FAKTUR_LABEL,
  type StatusFaktur,
  TEMPO_LABEL,
  threeWay,
  verifyProblem,
} from '@/lib/keuangan-hutang';
import { PERIODE_TERTUTUP, tanggalPendek } from '@/lib/keuangan-jurnal';
import type { HutangState } from '@/lib/keuangan-hutang-toko';
import type { PayablesBoard } from '@/lib/server/data/keuangan-lanjut';
import { AlasanForm } from './alasan-form';
import { JurnalPasangan } from './jurnal-pasangan';

const STATUS_TONE: Record<StatusFaktur, ChipTone> = {
  draf: 'warning',
  diverifikasi: 'info',
  disetujui: 'brand',
  terjadwal: 'info',
  dibayar: 'success',
};

/**
 * U10 · Hutang usaha: faktur pemasok dari penerimaan (cocok 3 arah), verifikasi akuntan, persetujuan berjenjang
 * menurut nilai, jatuh tempo, dan batch pembayaran dengan jurnal. Faktur yang dibayar di periode tertutup terkunci.
 * Tersimpan di toko demo (domain `hutang`, ADR-0085) atas nama pengguna sesi; faktur baru datang dari penerimaan
 * barang Logistik.
 */
export function HutangWorkspace({
  board,
  store,
  rev,
  today,
  viewer,
}: {
  board: PayablesBoard;
  /** Faktur, batch, dan saldo bank mitra setelah aksi tersimpan (domain `hutang`). */
  store: HutangState;
  rev: number;
  today: string;
  viewer: { id: string; name: string; role: string | null };
}) {
  const [tab, setTab] = useState('faktur');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const { invoices: list, batch, balance } = store;
  const { run } = useStoreAction(rev);
  const act = (input: HutangActionInput, done?: () => void) =>
    run(
      (r) => hutangAction({ ...input, rev: r }),
      (res) => {
        setFlash({ text: res.message, ok: res.ok });
        if (res.ok) done?.();
      },
    );
  const open = list.filter((f) => f.status !== 'dibayar');
  const overdue = open.filter((f) => dueGroup(f.dueDate, today) === 'lewat');
  const waiting = list.filter((f) => f.status === 'diverifikasi' || f.status === 'draf');
  const approved = list.filter((f) => f.status === 'disetujui');
  const selected = approved.filter((f) => picked.has(f.id));
  const sProblem = batch ? 'Selesaikan batch yang terbuka dulu.' : scheduleProblem(selected, balance);

  return (
    <div className="flex flex-col gap-4">
      <div role="region" aria-label="Indikator hutang" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiCard
          label="Jatuh tempo ≤ 7 hari"
          value={formatRupiahRingkas(board.summary.due7dAll)}
          detail={`${board.summary.suppliersDue} pemasok · sama dengan Akuntansi`}
          tone="warning"
          tinted
        />
        <KpiCard
          label="Lewat jatuh tempo (contoh)"
          value={overdue.length}
          hint={overdue.length ? formatRupiah(sumRupiah(overdue.map((f) => f.invoiceAmount))) : 'tidak ada'}
          tone={overdue.length ? 'danger' : 'success'}
          tinted
        />
        <KpiCard
          label="Menunggu verifikasi/persetujuan"
          value={waiting.length}
          detail="faktur dari penerimaan"
          tinted
        />
        <KpiCard
          label="Saldo bank mitra"
          value={formatRupiahRingkas(balance)}
          detail="rekening pembayaran pemasok"
          tinted
        />
      </div>
      {flash && (
        <div
          role="status"
          className={cx(
            'rounded-control border px-3 py-2 text-small',
            flash.ok
              ? 'border-zamrud-200 bg-alert-success text-success'
              : 'border-danger-border bg-alert-critical text-danger',
          )}
        >
          {flash.ok ? '✓ ' : ''}
          {flash.text}
        </div>
      )}
      <Tabs
        label="Hutang usaha"
        variant="pil"
        value={tab}
        onChange={setTab}
        items={[
          {
            id: 'faktur',
            label: 'Faktur pemasok',
            badge: waiting.length ? String(waiting.length) : undefined,
            content: (
              <ul aria-label="Faktur pemasok" className="m-0 flex list-none flex-col gap-3 p-0 pt-3">
                {list.map((f) => (
                  <FakturCard key={f.id} f={f} today={today} viewer={viewer} act={act} />
                ))}
              </ul>
            ),
          },
          {
            id: 'jadwal',
            label: 'Jadwal bayar',
            content: (
              <div className="flex flex-wrap items-start gap-4 pt-3">
                <section
                  aria-label="Faktur siap dibayar"
                  className="flex min-w-0 flex-[999_1_460px] flex-col overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                    <span className="font-semibold">Faktur disetujui · urut jatuh tempo</span>
                    <span className="flex flex-col items-end gap-1">
                      <Button
                        variant="primary"
                        disabled={!!sProblem}
                        aria-describedby={sProblem ? 'jadwal-gate' : undefined}
                        onClick={() =>
                          act({ type: 'batch', invoiceIds: selected.map((x) => x.id), rev: 0 }, () =>
                            setPicked(new Set()),
                          )
                        }
                      >
                        Buat batch pembayaran
                      </Button>
                      {sProblem && (
                        <span id="jadwal-gate" className="text-caption font-medium text-warning">
                          {sProblem}
                        </span>
                      )}
                    </span>
                  </div>
                  <ul className="m-0 flex list-none flex-col p-0">
                    {[...approved]
                      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                      .map((f) => {
                        const g = dueGroup(f.dueDate, today);
                        return (
                          <li
                            key={f.id}
                            className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2"
                          >
                            <input
                              type="checkbox"
                              id={`bayar-${f.id}`}
                              checked={picked.has(f.id)}
                              onChange={() =>
                                setPicked((cur) => {
                                  const n = new Set(cur);
                                  if (n.has(f.id)) n.delete(f.id);
                                  else n.add(f.id);
                                  return n;
                                })
                              }
                              className="size-5"
                            />
                            <label
                              htmlFor={`bayar-${f.id}`}
                              className="flex min-w-0 flex-[1_1_220px] flex-col"
                            >
                              <span className="font-semibold">
                                {f.supplier} · <span className="font-mono text-caption">{f.invoiceNo}</span>
                              </span>
                              <span className="text-caption text-ink-500">
                                jatuh tempo {tanggalPendek(f.dueDate)} · {TEMPO_LABEL[g]}
                              </span>
                            </label>
                            <span className="font-mono font-semibold">{formatRupiah(f.invoiceAmount)}</span>
                          </li>
                        );
                      })}
                    {approved.length === 0 && (
                      <li className="px-4 py-6 text-center text-small text-ink-500">
                        Tidak ada faktur disetujui yang belum dijadwalkan.
                      </li>
                    )}
                  </ul>
                </section>
                <aside
                  aria-label="Batch pembayaran"
                  className="flex min-w-0 flex-[1_1_340px] flex-col gap-3 xl:max-w-[460px]"
                >
                  {batch ? (
                    <section className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4">
                      <span className="font-semibold">
                        <span className="font-mono">{batch.number}</span> · {batch.ids.length} faktur ·{' '}
                        {formatRupiah(batch.total)}
                      </span>
                      <JurnalPasangan
                        jurnal={paymentJournal(batch.number, batch.total)}
                        status="diposting saat dibayar"
                      />
                      <Button
                        variant="primary"
                        disabled={viewer.role !== 'akuntan'}
                        aria-describedby={viewer.role !== 'akuntan' ? 'bayar-gate' : undefined}
                        onClick={() => act({ type: 'bayar', rev: 0 })}
                      >
                        Posting pembayaran
                      </Button>
                      {viewer.role !== 'akuntan' && (
                        <span id="bayar-gate" className="text-caption font-medium text-warning">
                          Pembayaran diposting posisi akuntan (transfer H2H bank mitra).
                        </span>
                      )}
                    </section>
                  ) : (
                    <p className="m-0 rounded-card border border-white/95 bg-white/90 shadow-card p-4 text-small text-ink-500">
                      Belum ada batch pembayaran terbuka. Centang faktur disetujui lalu buat batch.
                    </p>
                  )}
                </aside>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

function FakturCard({
  f,
  today,
  viewer,
  act,
}: {
  f: FakturPemasok;
  today: string;
  viewer: { id: string; name: string; role: string | null };
  act: (input: HutangActionInput) => void;
}) {
  const [accepting, setAccepting] = useState(false);
  const m = threeWay(f);
  const g = dueGroup(f.dueDate, today);
  const vp = verifyProblem(f, viewer);
  const ap = approveProblem(f, viewer);
  const need = requiredLevels(f);
  const locked = invoiceLocked(f, PERIODE_TERTUTUP);
  const rows: Array<[string, string, bigint]> = [
    ['PO', f.poNumber, f.poAmount],
    ['Penerimaan', f.grnNumber, f.grnAmount],
    ['Faktur', f.invoiceNo, f.invoiceAmount],
  ];
  return (
    <li
      aria-label={`Faktur ${f.invoiceNo}`}
      className="flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">
            {f.supplier} · {f.title}
          </span>
          <span className="text-caption text-ink-500">
            diterima {formatTanggalWaktu(f.receivedAt)} · faktur {tanggalPendek(f.invoiceDate)} · jatuh tempo{' '}
            {tanggalPendek(f.dueDate)}
          </span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          {f.status !== 'dibayar' && (
            <Chip tone={g === 'lewat' ? 'danger' : g === 'minggu-ini' ? 'warning' : 'neutral'}>
              {TEMPO_LABEL[g]}
            </Chip>
          )}
          <Chip tone={STATUS_TONE[f.status]}>{STATUS_FAKTUR_LABEL[f.status]}</Chip>
        </span>
      </div>
      <dl className="m-0 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {rows.map(([k, ref, v]) => (
          <div key={k} className="flex flex-col rounded-control border border-line px-3 py-2">
            <dt className="text-caption text-ink-500">
              {k} · <span className="font-mono">{ref}</span>
            </dt>
            <dd className="m-0 font-mono font-semibold">{formatRupiah(v)}</dd>
          </div>
        ))}
      </dl>
      <span className={cx('text-small font-semibold', m.ok ? 'text-success' : 'text-warning')}>
        {m.ok ? '✓ ' : '! '}
        {m.text}
        {!m.ok && m.variance !== 0n && ` (${formatRupiah(m.variance < 0n ? -m.variance : m.variance)})`}
        {f.varianceNote && ` · diterima: “${f.varianceNote}”`}
      </span>

      {f.status === 'draf' &&
        !m.ok &&
        !f.varianceNote &&
        !m.overPo &&
        (accepting ? (
          <AlasanForm
            label="Alasan menerima selisih harga (wajib)"
            submitLabel="Terima selisih"
            onCancel={() => setAccepting(false)}
            onSubmit={(r) => {
              setAccepting(false);
              act({ type: 'selisih', invoiceId: f.id, reason: r, rev: 0 });
            }}
          />
        ) : (
          <span className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => act({ type: 'nota-kredit', invoiceId: f.id, rev: 0 })}>
              Minta nota kredit (simulasikan diterima)
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAccepting(true)}>
              Terima selisih dengan alasan…
            </Button>
          </span>
        ))}

      <span className="text-caption text-ink-500">
        Persetujuan: {need} tingkat
        {need === 2 ? ' (di atas Rp 50 juta: manajer keuangan lalu direktur)' : ' (manajer keuangan)'}
        {f.verifiedBy ? ` · diverifikasi ${f.verifiedBy}` : ''}
        {f.approvals.map((a) => ` · tingkat ${a.level} ${a.by} ${formatTanggalWaktu(a.at)}`).join('')}
      </span>

      {f.status === 'draf' && (
        <span className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={!!vp}
            onClick={() => act({ type: 'verifikasi', invoiceId: f.id, rev: 0 })}
          >
            Verifikasi faktur
          </Button>
          {vp && <span className="text-caption font-medium text-warning">{vp}</span>}
        </span>
      )}
      {f.status === 'diverifikasi' && (
        <>
          <JurnalPasangan jurnal={approvalJournal(f)} status="diposting saat semua tingkat menyetujui" />
          <span className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={!!ap}
              onClick={() => act({ type: 'setujui', invoiceId: f.id, rev: 0 })}
            >
              Setujui tingkat {f.approvals.length + 1}
            </Button>
            {ap && <span className="text-caption font-medium text-warning">{ap}</span>}
          </span>
        </>
      )}
      {(f.status === 'disetujui' || f.status === 'terjadwal') && (
        <JurnalPasangan jurnal={approvalJournal(f)} status="terposting" />
      )}
      {f.status === 'dibayar' && (
        <span className="text-small text-ink-700">
          Dibayar {f.paidAt ? formatTanggalWaktu(f.paidAt) : ''} · {f.paymentBatch}
          {locked && (
            <span className="font-medium text-ink-500">
              {' '}
              · Terkunci: periode ditutup; koreksi lewat nota debit di periode berjalan
            </span>
          )}
        </span>
      )}
    </li>
  );
}
