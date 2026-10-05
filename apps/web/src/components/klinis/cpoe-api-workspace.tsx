'use client';

import type {
  CpoeOrderKind,
  OrderCatalogItem,
  OrderEvaluation,
  OrderGroup,
  OrderSetView,
} from '@simrs/shared';
import { Chip, cx } from '@simrs/ui';
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
  submitInput,
} from '@/lib/cpoe-api';
import { CpoeApiDraftRow } from './cpoe-api-draft-row';
import { CpoeApiOrders } from './cpoe-api-orders';

const KINDS: readonly CpoeOrderKind[] = ['lab', 'radiologi', 'obat', 'tindakan', 'kontrol'];

/** Kunci acak lokal (baris draf) dan Idempotency-Key kiriman. */
const uid = () => crypto.randomUUID();

function CatalogSearch({ disabled, onAdd }: { disabled: boolean; onAdd: (item: DraftItem) => void }) {
  const id = useId();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<CpoeOrderKind | ''>('');
  const [items, setItems] = useState<OrderCatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setItems([]);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await searchCatalogAction({ q: term, kind: kind || null });
      if (n !== seq.current) return;
      if (!r.ok) return setError(r.message);
      setError(null);
      setItems(r.items);
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind]);
  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line bg-white p-3.5 shadow-card">
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
        className="min-h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
      />
      <label className="flex flex-col gap-1 text-caption font-semibold text-ink-700" htmlFor={`${id}-jenis`}>
        Jenis
        <select
          id={`${id}-jenis`}
          value={kind}
          disabled={disabled}
          onChange={(e) => setKind(e.target.value as CpoeOrderKind | '')}
          className="min-h-11 rounded-control border border-line-strong bg-white px-2.5 font-[inherit] text-small"
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
      {items.length > 0 && (
        <ul aria-label="Hasil katalog" className="m-0 flex list-none flex-col gap-1.5 p-0">
          {items.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 text-small">
                <span className="font-semibold">{c.name}</span>
                <span className="block text-caption text-ink-500">
                  {KIND_TITLE[c.kind]}
                  {c.code ? ` · ${c.code.system} ${c.code.code}` : ' · kode belum dipetakan'}
                  {c.highAlert ? ' · kewaspadaan tinggi' : ''}
                </span>
              </span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Tambah ${c.name}`}
                onClick={() => onAdd({ id: c.id, kind: c.kind, name: c.name, highAlert: c.highAlert })}
                className="min-h-11 shrink-0 cursor-pointer rounded-control border border-brand-800 bg-white px-3 font-[inherit] text-small font-semibold text-brand-700 disabled:opacity-60"
              >
                Tambah
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * CPOE mode api (layar W2, mockup `CPOE.dc.html`): katalog RS + order set, daftar order yang disusun dengan pratinjau
 * CDS SERVER sambil mengisi, gerbang keselamatan untuk temuan blok (hapus, atau override beralasan yang ikut tercatat),
 * kirim dengan Idempotency-Key (dipakai ulang selama daftar tidak berubah), lalu order kunjungan + status, batal
 * beralasan, tinjauan DPJP, dan status TTE resep. Tanpa nominal (tarif menunggu U01).
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

  // Pratinjau CDS server setiap kali daftar berubah (ditunda sebentar saat mengetik).
  useEffect(() => {
    if (lines.length === 0) {
      setEvaluation(null);
      setEvaluating(false);
      return;
    }
    const n = ++evalSeq.current;
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
      const meds = r.group.medicationRequests.length;
      setSent(
        `${r.group.serviceRequests.length + meds} order terkirim${
          r.group.needsReview ? ' · menunggu tinjauan DPJP' : ''
        }${r.group.prescription ? ' · resep dikirim untuk TTE' : ''}.`,
      );
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
        <aside aria-label="Katalog dan order set" className="flex min-w-0 flex-col gap-4">
          {!editable && (
            <p
              role="note"
              className="m-0 rounded-card border border-line bg-subtle px-3.5 py-3 text-small text-ink-700"
            >
              {active
                ? 'Peran Anda hanya membaca order kunjungan ini.'
                : 'Kunjungan tidak sedang berjalan; order baru tidak bisa dibuat.'}
            </p>
          )}
          <CatalogSearch disabled={!editable || pending} onAdd={(i) => add([i], null)} />
          <section
            aria-label="Order set institusi"
            className="flex flex-col gap-2 rounded-card border border-line bg-white p-3.5 shadow-card"
          >
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
                className="flex min-h-11 cursor-pointer flex-col items-start rounded-control border border-line-strong bg-white px-3 py-2 text-left font-[inherit] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="text-small font-semibold">{s.name}</span>
                <span className="text-caption text-ink-500">{s.items.length} item</span>
              </button>
            ))}
          </section>
        </aside>

        <section aria-label="Order baru" className="flex min-w-0 flex-col gap-3.5">
          {lines.length === 0 ? (
            <p className="m-0 rounded-card border border-dashed border-line-strong bg-white p-4 text-small text-ink-500">
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
                  className="overflow-hidden rounded-card border border-line bg-white shadow-card"
                >
                  <h2 className="m-0 border-b border-line bg-subtle px-4 py-2.5 text-caption font-bold tracking-[0.06em] text-ink-700 uppercase">
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
          {lines.length > 0 && (
            <div className="flex flex-col gap-2 rounded-card border border-line bg-white p-3.5 shadow-card">
              <span className={cx('text-small', blocker ? 'text-ink-700' : 'font-semibold text-success')}>
                {blocker ?? 'Pemeriksaan CDS selesai. Order siap dikirim (TTE resep oleh dokter berwenang).'}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onSend}
                  disabled={Boolean(blocker) || pending || !editable}
                  className="min-h-11 cursor-pointer rounded-control border border-brand-800 bg-brand-700 px-4 font-[inherit] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? 'Mengirim…' : `Kirim ${lines.length} order`}
                </button>
                {orderSetId && <Chip tone="info">Dari order set</Chip>}
              </span>
              {error && (
                <span role="alert" className="text-small text-danger">
                  {error}
                </span>
              )}
            </div>
          )}
          {sent && lines.length > 0 && (
            <p role="status" className="m-0 text-small text-success">
              {sent}
            </p>
          )}
        </section>
      </div>

      <section aria-label="Order kunjungan ini" className="flex flex-col gap-2.5">
        <h2 className="m-0 text-[17px] font-semibold">Order kunjungan ini</h2>
        {sent && lines.length === 0 && (
          <p role="status" className="m-0 text-small font-semibold text-success">
            {sent}
          </p>
        )}
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
