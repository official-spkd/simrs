'use client';

import { formatJam, formatRupiah, formatTanggalWaktu } from '@simrs/shared';
import { Button, Chip, cx, KpiCard, Tabs } from '@simrs/ui';
import { useId, useState } from 'react';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { formatRupiahRingkas } from '@/lib/keuangan';
import {
  type DrafJurnal,
  labelPeriode,
  periodeOf,
  PERIODE_TERTUTUP,
  ringkasJurnal,
} from '@/lib/keuangan-jurnal';
import {
  candidateFits,
  closeJournal,
  closeProblems,
  countTotal,
  exceptionJournal,
  expectedCash,
  type Laci,
  matchJournal,
  type MutasiBank,
  mutationLocked,
  PECAHAN,
  PENGECUALIAN_NOTE_MIN,
  reconSummary,
  reverseJournal,
  SELISIH_SUPERVISOR,
} from '@/lib/keuangan-kasbank';
import type { CashBankBoard } from '@/lib/server/data/keuangan-lanjut';
import { AlasanForm } from './alasan-form';
import { JurnalPasangan } from './jurnal-pasangan';

const signed = (v: bigint) => (v < 0n ? `−${formatRupiah(-v)}` : `+${formatRupiah(v)}`);
const num = (v: bigint) => v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * U09 · Kas dan bank: laci kasir (buka, hitung fisik per pecahan, selisih beralasan, setoran dengan jurnal) dan
 * mutasi BTN (padanan dasar dengan jurnal, pengecualian bercatatan, lepas padanan dengan jurnal balik). Mutasi
 * periode tertutup terkunci. Simulasi lokal.
 */
export function KasBankWorkspace({ board, viewer }: { board: CashBankBoard; viewer: string }) {
  const [tab, setTab] = useState('kas');
  const [drawers, setDrawers] = useState<readonly Laci[]>(board.drawers);
  const [mutations, setMutations] = useState<readonly MutasiBank[]>(board.mutations);
  const [journals, setJournals] = useState<Record<string, DrafJurnal>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [depositSeq, setDepositSeq] = useState(413);
  const rec = reconSummary(board.statement.balance, mutations);
  const open = drawers.filter((d) => d.status === 'buka');

  const closeDrawer = (d: Laci, physical: bigint, reason: string | null) => {
    const now = demoNow();
    const expected = expectedCash(d);
    const j = closeJournal(d.counter, physical, expected, d.float);
    const no = `STR-2610-${String(depositSeq).padStart(4, '0')}`;
    setDepositSeq((n) => n + 1);
    setDrawers((list) =>
      list.map((x) =>
        x.id === d.id
          ? { ...x, status: 'tutup', lastClose: { at: now.toISOString(), physical, expected, reason } }
          : x,
      ),
    );
    setJournals((m) => ({ ...m, [d.id]: j }));
    setFlash(
      `Laci ${d.counter} ditutup ${formatJam(now)} · setoran ${no} ${formatRupiah(physical - d.float)} ke ${board.statement.account} · ${ringkasJurnal(j)}`,
    );
  };
  const openDrawer = (d: Laci) => {
    const now = demoNow();
    setDrawers((list) =>
      list.map((x) =>
        x.id === d.id ? { ...x, status: 'buka', openedAt: now.toISOString(), transactions: [] } : x,
      ),
    );
    setFlash(
      `Laci ${d.counter} dibuka ${formatJam(now)} dengan modal ${formatRupiah(d.float)} (dihitung dua orang)`,
    );
  };
  const setMutation = (id: string, patch: Partial<MutasiBank>, j: DrafJurnal | null, msg: string) => {
    setMutations((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    setJournals((m) => {
      const next = { ...m };
      if (j) next[id] = j;
      else delete next[id];
      return next;
    });
    setFlash(msg);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="region"
        aria-label="Indikator kas dan bank"
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <KpiCard
          label="Laci terbuka"
          value={open.length}
          detail={open.map((d) => d.counter.split(' · ')[0]).join(', ') || '—'}
        />
        <KpiCard
          label="Kas di laci (seharusnya)"
          value={formatRupiah(open.reduce((s, d) => s + expectedCash(d), 0n))}
          detail="modal + tunai masuk − refund tunai"
        />
        <KpiCard
          label="Saldo rekening koran"
          value={formatRupiahRingkas(board.statement.balance)}
          detail={`${formatRupiah(board.statement.balance)} · sinkron H2H ${formatJam(board.statement.syncedAt)}`}
        />
        <KpiCard
          label="Mutasi belum dipadankan"
          value={rec.open}
          hint={rec.open ? `selisih buku ${signed(rec.openAmount)}` : 'rekening cocok'}
          tone={rec.open ? 'warning' : 'success'}
          tinted
        />
      </div>
      {flash && (
        <div
          role="status"
          className="rounded-control border border-[#B7DEC0] bg-[#EAF5EC] px-3 py-2 text-small text-success"
        >
          ✓ {flash} (simulasi, tidak disimpan)
        </div>
      )}
      <Tabs
        label="Kas dan bank"
        variant="pil"
        value={tab}
        onChange={setTab}
        keepMounted
        items={[
          {
            id: 'kas',
            label: 'Kas harian kasir',
            content: (
              <div className="flex flex-col gap-3 pt-3">
                {drawers.map((d) => (
                  <LaciCard
                    key={d.id}
                    d={d}
                    mine={d.cashier === viewer || d.id === board.drawers[0]?.id}
                    journal={journals[d.id] ?? null}
                    onClose={(p, r) => closeDrawer(d, p, r)}
                    onOpen={() => openDrawer(d)}
                  />
                ))}
              </div>
            ),
          },
          {
            id: 'bank',
            label: 'Mutasi bank',
            badge: rec.open ? String(rec.open) : undefined,
            content: (
              <div className="flex flex-col gap-3 pt-3">
                <p className="m-0 rounded-card border border-line bg-white px-4 py-3 text-small text-ink-700">
                  <span className="font-semibold">{board.statement.account}</span> · saldo rekening koran{' '}
                  <span className="font-mono">{formatRupiah(board.statement.balance)}</span> · saldo buku{' '}
                  <span className="font-mono" data-book-balance={rec.bookBalance.toString()}>
                    {formatRupiah(rec.bookBalance)}
                  </span>{' '}
                  ·{' '}
                  {rec.open
                    ? `${rec.open} mutasi belum dipadankan (${signed(rec.openAmount)})`
                    : '✓ cocok, tidak ada mutasi terbuka'}
                </p>
                <ul aria-label="Mutasi rekening" className="m-0 flex list-none flex-col gap-2 p-0">
                  {mutations.map((m) => (
                    <MutasiRow
                      key={m.id}
                      m={m}
                      journal={journals[m.id] ?? null}
                      onMatch={(c) => {
                        const j = matchJournal(m, c);
                        setMutation(
                          m.id,
                          { status: 'cocok', matchedTo: c.label },
                          j,
                          `${m.description} dipadankan ke ${c.label} · ${formatJam(demoNow())} · ${ringkasJurnal(j)}`,
                        );
                      }}
                      onException={(note) => {
                        const j = exceptionJournal(m);
                        setMutation(
                          m.id,
                          { status: 'pengecualian', note },
                          j,
                          `${m.description} dicatat sebagai pengecualian · ${formatJam(demoNow())} · ${ringkasJurnal(j)}`,
                        );
                      }}
                      onUnmatch={(reason) => {
                        const prev = journals[m.id];
                        const back = prev ? reverseJournal(prev, `Jurnal balik ${m.description}`) : null;
                        setMutation(
                          m.id,
                          { status: 'belum', matchedTo: null, note: null },
                          null,
                          `Padanan ${m.description} dilepas · ${formatJam(demoNow())} · alasan: ${reason}${back ? ` · jurnal balik ${ringkasJurnal(back)}` : ''}`,
                        );
                      }}
                    />
                  ))}
                </ul>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

function LaciCard({
  d,
  mine,
  journal,
  onClose,
  onOpen,
}: {
  d: Laci;
  mine: boolean;
  journal: DrafJurnal | null;
  onClose: (physical: bigint, reason: string | null) => void;
  onOpen: () => void;
}) {
  const id = useId();
  const [counting, setCounting] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [witness, setWitness] = useState(false);
  const expected = expectedCash(d);
  const physical = countTotal(counts);
  const diff = physical - expected;
  const problems = closeProblems(physical, expected, reason, witness, d.float);
  const abs = diff < 0n ? -diff : diff;
  const last = d.lastClose;
  return (
    <article
      aria-label={`Laci ${d.counter}`}
      className="flex flex-col gap-3 rounded-card border border-line bg-white p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex flex-col">
          <span className="font-semibold">{d.counter}</span>
          <span className="text-caption text-ink-500">
            {d.cashier} · modal laci {formatRupiah(d.float)}
            {d.openedAt ? ` · dibuka ${formatTanggalWaktu(d.openedAt)}` : ''}
          </span>
        </span>
        <Chip tone={d.status === 'buka' ? 'success' : 'neutral'}>
          {d.status === 'buka' ? 'Laci terbuka' : 'Laci tertutup'}
        </Chip>
      </div>
      {d.status === 'buka' && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <caption className="pb-1 text-left text-small font-semibold">Transaksi tunai shift ini</caption>
              <tbody>
                <tr className="border-t border-line">
                  <td className="py-1">Modal laci</td>
                  <td className="py-1 text-right font-mono">{formatRupiah(d.float)}</td>
                </tr>
                {d.transactions.map((t) => (
                  <tr key={t.id} className="border-t border-line">
                    <td className="py-1 pr-2">
                      <span className="font-mono text-caption text-ink-500">{formatJam(t.at)}</span> {t.label}
                    </td>
                    <td className={cx('py-1 text-right font-mono', t.amount < 0n && 'text-danger')}>
                      {signed(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong font-semibold">
                  <th scope="row" className="py-1 text-left">
                    Saldo seharusnya
                  </th>
                  <td className="py-1 text-right font-mono" data-expected={expected.toString()}>
                    {formatRupiah(expected)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {!mine ? (
            <span className="text-caption text-ink-500">Laci kasir lain; ditutup oleh pemegang laci.</span>
          ) : !counting ? (
            <span>
              <Button variant="primary" onClick={() => setCounting(true)}>
                Tutup laci…
              </Button>
            </span>
          ) : (
            <form
              aria-label={`Tutup laci ${d.counter}`}
              className="flex flex-col gap-3 rounded-control border border-brand-600 bg-[#F4FBFA] p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (problems.length === 0) onClose(physical, diff === 0n ? null : reason.trim());
              }}
            >
              <span className="text-small font-semibold">Hitung fisik per pecahan (lembar/keping)</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {PECAHAN.map((p) => (
                  <label
                    key={p.toString()}
                    className="flex flex-col gap-1 text-caption font-semibold text-ink-700"
                  >
                    Rp {num(p)}
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={counts[p.toString()] ?? ''}
                      onChange={(e) =>
                        setCounts((c) => ({ ...c, [p.toString()]: Number(e.target.value) || 0 }))
                      }
                      className="h-11 rounded-control border border-line-strong bg-white px-2 font-mono font-normal text-ink-900"
                    />
                  </label>
                ))}
              </div>
              <dl className="m-0 grid grid-cols-3 gap-2 text-small">
                <div className="flex flex-col">
                  <dt className="text-caption text-ink-500">Fisik</dt>
                  <dd className="m-0 font-mono font-semibold" data-physical={physical.toString()}>
                    {formatRupiah(physical)}
                  </dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-caption text-ink-500">Seharusnya</dt>
                  <dd className="m-0 font-mono font-semibold">{formatRupiah(expected)}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-caption text-ink-500">Selisih</dt>
                  <dd
                    className={cx(
                      'm-0 font-mono font-semibold',
                      diff === 0n ? 'text-success' : 'text-danger',
                    )}
                  >
                    {diff === 0n ? 'Rp 0 · cocok' : `${diff < 0n ? 'kurang' : 'lebih'} ${formatRupiah(abs)}`}
                  </dd>
                </div>
              </dl>
              {diff !== 0n && physical > 0n && (
                <>
                  <label htmlFor={`${id}-alasan`} className="text-small font-semibold text-ink-700">
                    Alasan selisih (wajib, dibaca supervisor dan auditor)
                  </label>
                  <textarea
                    id={`${id}-alasan`}
                    rows={2}
                    maxLength={300}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small"
                  />
                  {abs > SELISIH_SUPERVISOR && (
                    <label className="flex min-h-11 items-center gap-2 text-small">
                      <input
                        type="checkbox"
                        checked={witness}
                        onChange={(e) => setWitness(e.target.checked)}
                        className="size-5"
                      />
                      Supervisor kasir menyaksikan hitung ulang
                    </label>
                  )}
                </>
              )}
              {physical > 0n && (
                <JurnalPasangan
                  jurnal={closeJournal(d.counter, physical, expected, d.float)}
                  status="diposting saat laci ditutup"
                />
              )}
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span
                  id={`${id}-gate`}
                  className={cx(
                    'text-caption',
                    problems.length ? 'font-medium text-warning' : 'text-success',
                  )}
                >
                  {problems.length
                    ? `Belum bisa ditutup: ${problems.join('; ')}.`
                    : 'Siap ditutup; setoran dibuat otomatis.'}
                </span>
                <span className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => setCounting(false)}>
                    Batal
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={problems.length > 0}
                    aria-describedby={`${id}-gate`}
                  >
                    Tutup laci dan buat setoran
                  </Button>
                </span>
              </span>
            </form>
          )}
        </>
      )}
      {d.status === 'tutup' && last && (
        <span className="text-small text-ink-700">
          Ditutup {formatTanggalWaktu(last.at)} · fisik {formatRupiah(last.physical)} · seharusnya{' '}
          {formatRupiah(last.expected)}
          {last.physical !== last.expected
            ? ` · selisih ${formatRupiah(last.physical - last.expected)} · alasan: “${last.reason}”`
            : ' · cocok'}
        </span>
      )}
      {d.status === 'tutup' && journal && <JurnalPasangan jurnal={journal} status="terposting" />}
      {d.status === 'tutup' && !journal && (
        <span>
          <Button onClick={onOpen}>Buka laci dengan modal {formatRupiah(d.float)}</Button>
        </span>
      )}
    </article>
  );
}

function MutasiRow({
  m,
  journal,
  onMatch,
  onException,
  onUnmatch,
}: {
  m: MutasiBank;
  journal: DrafJurnal | null;
  onMatch: (c: MutasiBank['candidates'][number]) => void;
  onException: (note: string) => void;
  onUnmatch: (reason: string) => void;
}) {
  const [mode, setMode] = useState<'none' | 'exception' | 'unmatch'>('none');
  const locked = mutationLocked(m, PERIODE_TERTUTUP);
  const fits = m.candidates.filter((c) => candidateFits(m, c));
  return (
    <li
      aria-label={`Mutasi ${m.description}`}
      className={cx(
        'flex flex-col gap-2 rounded-card border bg-white p-3',
        m.status === 'belum' ? 'border-warning-border' : 'border-line',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="font-mono text-small font-semibold">{m.description}</span>
          <span className="text-caption text-ink-500">{formatTanggalWaktu(m.at)}</span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className={cx('font-mono font-semibold', m.amount < 0n && 'text-danger')}>
            {signed(m.amount)}
          </span>
          <Chip tone={m.status === 'cocok' ? 'success' : m.status === 'pengecualian' ? 'info' : 'warning'}>
            {m.status === 'cocok'
              ? 'Cocok'
              : m.status === 'pengecualian'
                ? 'Pengecualian'
                : 'Belum dipadankan'}
          </Chip>
        </span>
      </div>
      {m.matchedTo && <span className="text-caption text-ink-700">Dipadankan ke: {m.matchedTo}</span>}
      {m.note && <span className="text-caption text-ink-700">Catatan pengecualian: “{m.note}”</span>}
      {locked && (
        <span className="text-caption font-medium text-ink-500">
          Terkunci: periode {labelPeriode(periodeOf(m.at))} ditutup; koreksi lewat jurnal di periode berjalan.
        </span>
      )}
      {m.status === 'belum' && mode === 'none' && (
        <span className="flex flex-wrap gap-2">
          {fits.map((c) => (
            <Button key={c.id} size="sm" variant="primary" onClick={() => onMatch(c)}>
              Padankan ke {c.label}
            </Button>
          ))}
          <Button size="sm" onClick={() => setMode('exception')}>
            Tandai pengecualian…
          </Button>
        </span>
      )}
      {m.status === 'belum' && fits[0] && mode === 'none' && (
        <JurnalPasangan jurnal={matchJournal(m, fits[0])} status="usulan jurnal saat dipadankan" />
      )}
      {m.status === 'belum' && fits.length === 0 && mode === 'none' && (
        <span className="text-caption text-warning">
          Tidak ada dokumen dengan nominal ini; telusuri pengirim lalu catat sebagai pengecualian.
        </span>
      )}
      {mode === 'exception' && (
        <AlasanForm
          label="Catatan pengecualian (wajib)"
          submitLabel="Catat pengecualian"
          min={PENGECUALIAN_NOTE_MIN}
          placeholder="mis. Transfer tanpa berita; ditelusuri ke pasien lewat bank pengirim"
          onCancel={() => setMode('none')}
          onSubmit={(n) => {
            setMode('none');
            onException(n);
          }}
        />
      )}
      {journal && m.status !== 'belum' && <JurnalPasangan jurnal={journal} status="terposting" />}
      {journal && !locked && m.status !== 'belum' && mode === 'none' && (
        <span>
          <Button size="sm" variant="ghost" onClick={() => setMode('unmatch')}>
            Lepas padanan…
          </Button>
        </span>
      )}
      {mode === 'unmatch' && (
        <AlasanForm
          label="Alasan melepas padanan (wajib; jurnal balik dibentuk)"
          submitLabel="Lepas padanan"
          variant="danger"
          min={PENGECUALIAN_NOTE_MIN}
          onCancel={() => setMode('none')}
          onSubmit={(r) => {
            setMode('none');
            onUnmatch(r);
          }}
        />
      )}
    </li>
  );
}
