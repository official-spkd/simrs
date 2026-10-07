'use client';

import type {
  CpoeOrderKind,
  OrderCatalogItem,
  OrderEvaluation,
  OrderGroup,
  OrderSetView,
} from '@simrs/shared';
import { Button, Chip, cx } from '@simrs/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  evaluateOrdersAction,
  searchCatalogAction,
  submitOrdersAction,
} from '@/app/(staf)/klinis/order/actions';
import {
  type DraftItem,
  type DraftLine,
  draftFingerprint,
  evaluateInput,
  KIND_TITLE,
  newDraftLine,
  sendBlocker,
  sentSummary,
  submitInput,
} from '@/lib/cpoe-api';
import { useRefreshWhilePending } from '@/lib/use-refresh-while-pending';
import { CpoeApiDraftRow } from './cpoe-api-draft-row';
import { CpoeApiOrders } from './cpoe-api-orders';

const KINDS: readonly CpoeOrderKind[] = ['lab', 'radiologi', 'obat', 'tindakan', 'kontrol'];

/** Kartu Pelangi Klinis (sama dengan kartu layar CPOE mode presentasi). */
const CARD = 'rounded-card border border-white/95 bg-white/90 shadow-card';
const FIELD =
  'min-h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] disabled:cursor-not-allowed disabled:bg-muted';

/** Kunci acak lokal (baris draf) dan Idempotency-Key kiriman. */
const uid = () => crypto.randomUUID();

function CatalogSearch({ disabled, onAdd }: { disabled: boolean; onAdd: (item: DraftItem) => void }) {
  const id = useId();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<CpoeOrderKind | ''>('');
  const [items, setItems] = useState<OrderCatalogItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    const n = ++seq.current;
    if (term.length < 2) {
      setItems([]);
      setSearched(false);
      return;
    }
    const t = setTimeout(async () => {
      const r = await searchCatalogAction({ q: term, kind: kind || null });
      if (n !== seq.current) return;
      setSearched(true);
      if (!r.ok) return setError(r.message);
      setError(null);
      setItems(r.items);
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind]);
  return (
    <section aria-label="Katalog order" className={cx(CARD, 'flex flex-col gap-2.5 p-3.5')}>
      <label htmlFor={id} className="text-small font-semibold">
        Cari pemeriksaan, obat, tindakan
      </label>
      <input
        id={id}
        type="search"
        value={q}
        autoComplete="off"
        disabled={disabled}
        placeholder="Ketik minimal 2 huruf"
        onChange={(e) => setQ(e.target.value)}
        className={FIELD}
      />
      <label className="flex flex-col gap-1 text-caption font-semibold text-ink-700" htmlFor={`${id}-jenis`}>
        Jenis
        <select
          id={`${id}-jenis`}
          value={kind}
          disabled={disabled}
          onChange={(e) => setKind(e.target.value as CpoeOrderKind | '')}
          className={cx(FIELD, 'px-2.5 text-small')}
        >
          <option value="">Semua jenis</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_TITLE[k]}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <span role="alert" className="text-small text-danger">
          {error}
        </span>
      )}
      {searched && !error && items.length === 0 && (
        <span role="status" className="text-caption text-ink-500">
          Tidak ada item katalog untuk “{q.trim()}”.
        </span>
      )}
      {items.length > 0 && (
        <ul aria-label="Hasil katalog" className="m-0 flex list-none flex-col gap-1.5 p-0">
          {items.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 border-b border-line-soft pb-1.5 last:border-b-0"
            >
              <span className="min-w-0 text-small">
                <span className="font-semibold">{c.name}</span>
                <span className="block text-caption text-ink-500">
                  {KIND_TITLE[c.kind]}
                  {c.code ? ` · ${c.code.system} ${c.code.code}` : ' · kode belum dipetakan'}
                  {c.highAlert ? ' · kewaspadaan tinggi' : ''}
                </span>
              </span>
              <Button
                size="sm"
                disabled={disabled}
                aria-label={`Tambah ${c.name}`}
                onClick={() => onAdd({ id: c.id, kind: c.kind, name: c.name, highAlert: c.highAlert })}
                className="shrink-0 text-small"
              >
                Tambah
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * CPOE mode api (layar W2, mockup `CPOE.dc.html`): katalog RS + order set | daftar order yang disusun dengan pratinjau
 * CDS SERVER sambil mengisi, gerbang keselamatan untuk temuan blok (hapus, atau override beralasan yang ikut tercatat)
 * | pemeriksaan sebelum kirim + kirim dengan Idempotency-Key (dipakai ulang selama daftar tidak berubah); di bawahnya
 * order kunjungan + status, batal beralasan, tinjauan DPJP atas order residen, dan status TTE resep. Tanpa nominal
 * (tarif menunggu U01).
 */
export function CpoeApiWorkspace({
  encounterId,
  orderSets,
  groups,
  canWrite,
  canCancel,
  canReview,
  active,
}: {
  encounterId: string;
  orderSets: readonly OrderSetView[];
  groups: readonly OrderGroup[];
  canWrite: boolean;
  canCancel: boolean;
  canReview: boolean;
  /** Kunjungan sedang berjalan (order baru hanya untuk kunjungan aktif). */
  active: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [orderSetId, setOrderSetId] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<OrderEvaluation | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const keyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const evalSeq = useRef(0);
  const editable = canWrite && active;
  useRefreshWhilePending(groups.some((g) => g.prescription?.signatureStatus === 'pending'));

  // Pratinjau CDS server setiap kali daftar berubah (ditunda sebentar saat mengetik).
  useEffect(() => {
    const n = ++evalSeq.current;
    if (lines.length === 0) {
      setEvaluation(null);
      setEvaluating(false);
      return;
    }
    setEvaluating(true);
    const t = setTimeout(async () => {
      const r = await evaluateOrdersAction(evaluateInput(encounterId, lines, orderSetId));
      if (n !== evalSeq.current) return;
      setEvaluating(false);
      if (!r.ok) return setError(r.message);
      setError(null);
      setEvaluation(r.evaluation);
    }, 350);
    return () => clearTimeout(t);
  }, [lines, orderSetId, encounterId]);

  const add = (items: readonly DraftItem[], setId: string | null) => {
    setSent(null);
    setLines((prev) => {
      const have = new Set(prev.map((l) => l.item.id));
      return [...prev, ...items.filter((i) => !have.has(i.id)).map((i) => newDraftLine(i, uid()))];
    });
    if (setId) setOrderSetId(setId);
  };
  const update = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) =>
    setLines((prev) => {
      const next = prev.filter((l) => l.key !== key);
      if (next.length === 0) setOrderSetId(null);
      return next;
    });

  const blocker = sendBlocker(lines, evaluation, evaluating);
  const onSend = () => {
    const input = submitInput(encounterId, lines, orderSetId);
    if (!input || blocker) return;
    const fingerprint = draftFingerprint(lines, orderSetId);
    if (keyRef.current?.fingerprint !== fingerprint) keyRef.current = { fingerprint, key: uid() };
    const key = keyRef.current.key;
    start(async () => {
      setError(null);
      const r = await submitOrdersAction(input, key);
      if (!r.ok) {
        if (r.evaluation) setEvaluation(r.evaluation);
        return setError(r.message);
      }
      keyRef.current = null;
      setLines([]);
      setOrderSetId(null);
      setSent(sentSummary(r.group));
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)] min-[1400px]:grid-cols-[minmax(240px,280px)_minmax(0,1fr)_minmax(260px,300px)]">
        <aside aria-label="Katalog dan order set" className="flex min-w-0 flex-col gap-4">
          {!editable && (
            <p
              role="note"
              className="m-0 rounded-card border border-brand-200 bg-[linear-gradient(135deg,var(--color-brand-50),var(--color-brand-100))] px-3.5 py-3 text-small font-semibold text-brand-800"
            >
              {!active
                ? 'Kunjungan tidak sedang berjalan; order baru tidak bisa dibuat.'
                : 'Peran Anda hanya membaca order kunjungan ini.'}
            </p>
          )}
          <CatalogSearch disabled={!editable || pending} onAdd={(i) => add([i], null)} />
          <section aria-label="Order set institusi" className={cx(CARD, 'flex flex-col gap-2 p-3.5')}>
            <h2 className="m-0 text-small font-semibold">Order set</h2>
            {orderSets.length === 0 && (
              <p className="m-0 text-caption text-ink-500">Belum ada order set RS.</p>
            )}
            {orderSets.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={!editable || pending}
                onClick={() =>
                  add(
                    s.items.filter((i) => i.active).map((i) => ({ id: i.id, kind: i.kind, name: i.name })),
                    s.id,
                  )
                }
                className="flex min-h-11 cursor-pointer flex-col items-start rounded-control border border-line-strong bg-white px-3 py-2 text-left font-[inherit] hover:bg-brand-50/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="text-small font-semibold">{s.name}</span>
                <span className="text-caption text-ink-500">{s.items.length} item</span>
              </button>
            ))}
          </section>
        </aside>

        <section aria-label="Order baru" className="flex min-w-0 flex-col gap-3.5">
          {lines.length === 0 ? (
            <p className="m-0 rounded-card border border-dashed border-line-strong bg-white/80 p-4 text-small text-ink-500">
              Belum ada order baru. Cari item katalog atau terapkan order set di kiri.
            </p>
          ) : (
            KINDS.map((k) => {
              const rows = lines.filter((l) => l.item.kind === k);
              if (rows.length === 0) return null;
              return (
                <section
                  key={k}
                  aria-label={`Order ${KIND_TITLE[k].toLowerCase()}`}
                  className={cx(CARD, 'overflow-hidden')}
                >
                  <h2 className="m-0 border-b border-line bg-card-header px-4 py-2.5 text-caption font-bold tracking-[0.06em] text-ink-700 uppercase">
                    {KIND_TITLE[k]}
                  </h2>
                  <ul className="m-0 list-none p-0">
                    {rows.map((l) => {
                      const index = lines.indexOf(l);
                      const ev =
                        evaluation && evaluation.lines.length === lines.length && !evaluating
                          ? (evaluation.lines[index] ?? null)
                          : null;
                      return (
                        <CpoeApiDraftRow
                          key={l.key}
                          line={l}
                          evaluation={ev}
                          disabled={pending}
                          onChange={(patch) => update(l.key, patch)}
                          onRemove={() => remove(l.key)}
                        />
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </section>

        <aside
          aria-label="Ringkasan order"
          className="flex min-w-0 flex-col gap-3.5 lg:col-span-2 min-[1400px]:col-span-1"
        >
          <section className={cx(CARD, 'flex flex-col gap-2.5 px-4 py-3.5')}>
            <h2 className="m-0 text-body font-semibold">Pemeriksaan sebelum kirim</h2>
            <p
              className={cx(
                'm-0 flex items-start gap-2 text-small',
                blocker ? 'text-ink-700' : 'font-semibold text-success',
              )}
            >
              <span aria-hidden="true" className={cx('font-bold', blocker ? 'text-warning' : 'text-success')}>
                {blocker ? '!' : '✓'}
              </span>
              <span>
                <span className="sr-only">{blocker ? 'Tertahan: ' : 'Lolos: '}</span>
                {blocker ?? 'Pemeriksaan CDS selesai. Order siap dikirim (TTE resep oleh dokter berwenang).'}
              </span>
            </p>
            {orderSetId && (
              <span>
                <Chip tone="info">Dari order set</Chip>
              </span>
            )}
            <p className="m-0 text-caption text-ink-500">
              Tarif tampil setelah master tarif RS tersambung. Order residen menunggu tinjauan DPJP sebelum
              resep ditandatangani.
            </p>
          </section>
          <Button variant="primary" onClick={onSend} disabled={Boolean(blocker) || pending || !editable}>
            {pending ? 'Mengirim…' : lines.length > 0 ? `Kirim ${lines.length} order` : 'Kirim order'}
          </Button>
          {error && (
            <p
              role="alert"
              className="m-0 rounded-control border border-koral-200 bg-alert-critical px-3 py-2 text-small text-danger"
            >
              {error}
            </p>
          )}
          {sent && (
            <p
              role="status"
              className="m-0 rounded-card border border-zamrud-200 bg-alert-success px-4 py-3 text-small font-semibold text-success"
            >
              {sent}
            </p>
          )}
        </aside>
      </div>

      <section aria-label="Order kunjungan ini" className="flex flex-col gap-2.5">
        <h2 className="m-0 text-[17px] font-semibold">Order kunjungan ini</h2>
        <CpoeApiOrders
          encounterId={encounterId}
          groups={groups}
          canCancel={canCancel}
          canReview={canReview}
        />
      </section>
    </div>
  );
}
