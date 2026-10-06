'use client';

import { formatJam } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone, cx, FilterChip, Tabs } from '@simrs/ui';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  decideGoLiveAction,
  reopenGoLiveAction,
  setGoLiveItemAction,
} from '@/app/(staf)/sistem/go-live/actions';
import { announceDemoChange } from '@/components/demo-sync';
import { type ConfirmRequest, ConfirmDialog, Panel, TableWrap, TD, TH } from '@/components/platform/parts';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  canDecide,
  type ChecklistArea,
  CLASS_LABEL,
  type Decision,
  type EpClass,
  type EpStatus,
  epGroup,
  GROUP_LABEL,
  type ItemState,
  matrixSummary,
  type MrmikEp,
  openCritical,
  STATUS_LABEL,
} from '@/lib/golive';
import { DECIDER_ONLY, type GoLiveStoreState } from '@/lib/golive-toko';
import { KpiTile } from '../manajemen/kpi-tile';

const STATUS_TONE: Record<EpStatus, ChipTone> = {
  terpenuhi: 'success',
  sebagian: 'warning',
  belum: 'danger',
  'ranah-rs': 'info',
};

function Matrix({ eps }: { eps: MrmikEp[] }) {
  const [kelas, setKelas] = useState<EpClass | 'semua'>('semua');
  const [status, setStatus] = useState<EpStatus | 'semua'>('semua');
  const sum = matrixSummary(eps);
  const shown = eps.filter(
    (e) => (kelas === 'semua' || e.kelas === kelas) && (status === 'semua' || e.status === status),
  );
  return (
    <div className="flex flex-col gap-3">
      <div role="region" aria-label="Ringkasan MRMIK" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiTile
          index={0}
          label="Elemen penilaian"
          value={String(sum.total)}
          detail={`${sum.kunci} kunci · ${sum.pendukung} pendukung · ${sum.tataKelola} tata kelola`}
        />
        <KpiTile
          index={1}
          label="EP sistem terpenuhi"
          value={`${sum.persenSistem}%`}
          hint={`${sum.terpenuhi} terpenuhi · ${sum.sebagian} sebagian`}
          tone={sum.persenSistem >= 80 ? 'success' : 'warning'}
        />
        <KpiTile
          index={2}
          label="EP kunci terbuka"
          value={String(sum.kunciTerbuka)}
          hint="belum terpenuhi penuh"
          tone={sum.kunciTerbuka > 0 ? 'warning' : 'success'}
        />
        <KpiTile
          index={3}
          label="Belum ada bukti"
          value={String(sum.belum)}
          detail="masuk rencana fase berikut"
          tone="danger"
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <span role="group" aria-label="Saring klasifikasi" className="flex flex-wrap gap-2">
          {(['semua', 'kunci', 'pendukung', 'tata-kelola'] as const).map((k) => (
            <FilterChip key={k} selected={kelas === k} onClick={() => setKelas(k)}>
              {k === 'semua' ? 'Semua kelas' : CLASS_LABEL[k]}
            </FilterChip>
          ))}
        </span>
        <span role="group" aria-label="Saring status" className="flex flex-wrap gap-2">
          {(['semua', 'terpenuhi', 'sebagian', 'belum', 'ranah-rs'] as const).map((k) => (
            <FilterChip key={k} selected={status === k} onClick={() => setStatus(k)}>
              {k === 'semua' ? 'Semua status' : STATUS_LABEL[k]}
            </FilterChip>
          ))}
        </span>
      </div>
      <p className="m-0 text-small text-ink-500" aria-live="polite">
        {shown.length} dari {eps.length} EP · isi demo untuk presentasi; audit sebenarnya lewat perintah cek
        MRMIK.
      </p>
      <TableWrap label="Matriks 51 EP MRMIK">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr>
              {['No', 'EP', 'Inti elemen penilaian', 'Kelas', 'Status', 'Bukti'].map((h) => (
                <th key={h} scope="col" className={TH}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.ep}>
                <td className={cx(TD, 'font-mono')}>{e.no}</td>
                <td className={cx(TD, 'whitespace-nowrap font-mono')}>
                  {e.ep}
                  <span className="block font-sans text-caption text-ink-500">
                    {GROUP_LABEL[epGroup(e.ep)]}
                  </span>
                </td>
                <td className={TD}>{e.inti}</td>
                <td className={TD}>{CLASS_LABEL[e.kelas]}</td>
                <td className={TD}>
                  <Chip tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Chip>
                </td>
                <td className={TD}>
                  {e.bukti}
                  {e.route && (
                    <Link
                      href={e.route}
                      className="ml-1 inline-flex min-h-11 items-center text-brand-600 underline"
                    >
                      Buka layar<span className="sr-only"> bukti {e.ep}</span>
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}

function Checklist({
  areas,
  owners,
  director,
  store,
  canDecideRole,
  userName,
}: {
  areas: ChecklistArea[];
  owners: readonly string[];
  director: string;
  store: GoLiveStoreState;
  canDecideRole: boolean;
  userName: string;
}) {
  // Centang/pemilik tampil seketika (optimistis) lalu disimpan berurutan; hapus timpaan setelah server menyusul.
  const [overlay, setOverlay] = useState<ItemState>({});
  const [itemError, setItemError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const router = useRouter();
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Simpan berurutan (centang beruntun lalu keputusan tidak saling mendahului). */
  const enqueue = (send: () => Promise<{ ok: boolean; message: string }>, onFail?: () => void) => {
    setInFlight((n) => n + 1);
    queue.current = queue.current.then(async () => {
      try {
        const r = await send();
        if (r.ok) announceDemoChange();
        else {
          setItemError(r.message);
          onFail?.();
          router.refresh();
        }
      } finally {
        setInFlight((n) => n - 1);
      }
    });
  };
  useEffect(() => {
    setOverlay((cur) => {
      const left = Object.entries(cur).filter(
        ([id, v]) => store.items[id]?.done !== v.done || store.items[id]?.owner !== v.owner,
      );
      return left.length === Object.keys(cur).length ? cur : Object.fromEntries(left);
    });
  }, [store.items]);
  const state: ItemState = { ...store.items, ...overlay };
  const setItem = (id: string, next: { done: boolean; owner: string }) => {
    setItemError(null);
    setOverlay((cur) => ({ ...cur, [id]: next }));
    const jam = formatJam(demoNow());
    enqueue(
      () => setGoLiveItemAction({ id, done: next.done, owner: next.owner, jam }),
      () =>
        setOverlay((cur) => {
          const copy = { ...cur };
          delete copy[id];
          return copy;
        }),
    );
  };
  const decision: (Decision & { by: string }) | null = store.decision;
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const open = openCritical(areas, state);
  const all = areas.flatMap((a) => a.items);
  const done = all.filter((i) => state[i.id]?.done).length;
  const roleCheck = canDecideRole ? null : { ok: false as const, reason: DECIDER_ONLY };
  const go = roleCheck ?? canDecide('go', note, areas, state);
  const nogo = roleCheck ?? canDecide('nogo', note, areas, state);
  const decide = (kind: 'go' | 'nogo') => {
    setItemError(null);
    const input = { kind, note: note.trim(), jam: formatJam(demoNow()) };
    enqueue(() => decideGoLiveAction(input));
  };

  const request: ConfirmRequest | null = confirming
    ? {
        title: 'Putuskan GO go-live?',
        body: (
          <>
            Pilot dimulai sesuai rencana; hypercare dan jadwal jaga TI aktif. Keputusan tercatat atas nama{' '}
            {userName} ({director}).
          </>
        ),
        confirmLabel: 'Ya, putuskan GO',
      }
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div role="region" aria-label="Ringkasan ceklis" className="grid grid-cols-2 gap-3.5 xl:grid-cols-3">
        <KpiTile index={6} label="Item selesai" value={`${done}/${all.length}`} detail="semua area" />
        <KpiTile
          index={4}
          label="Kritis terbuka"
          value={String(open.length)}
          hint={open.length ? 'mengunci keputusan GO' : 'siap diputuskan'}
          tone={open.length ? 'danger' : 'success'}
        />
        <KpiTile
          index={5}
          label="Keputusan"
          value={decision ? (decision.kind === 'go' ? 'GO' : 'NO-GO') : 'Belum'}
          detail={decision ? `diputuskan ${decision.at}` : 'oleh direktur'}
        />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-3">
        {areas.map((a) => (
          <Panel
            key={a.area}
            title={a.area}
            sub={`${a.items.filter((i) => state[i.id]?.done).length}/${a.items.length} selesai`}
          >
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {a.items.map((i) => {
                const st = state[i.id] ?? { done: false, owner: '' };
                return (
                  <li
                    key={i.id}
                    className="flex flex-col gap-1 border-b border-line-soft py-1.5 last:border-0"
                  >
                    <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-small">
                      <input
                        type="checkbox"
                        className="mt-1 size-5 flex-none accent-brand-600"
                        checked={st.done}
                        disabled={!!decision}
                        onChange={(e) => setItem(i.id, { ...st, done: e.target.checked })}
                      />
                      <span className="flex flex-wrap items-center gap-1.5">
                        {i.text}
                        {i.critical && <Chip tone="danger">kritis</Chip>}
                        {st.done && !st.owner && <Chip tone="warning">belum ada pemilik</Chip>}
                      </span>
                    </label>
                    <label className="flex items-center gap-2 pl-7 text-caption text-ink-500">
                      Pemilik
                      <select
                        value={st.owner}
                        disabled={!!decision}
                        onChange={(e) => setItem(i.id, { ...st, owner: e.target.value })}
                        className="h-11 min-w-0 flex-1 rounded-control border border-line-strong bg-white px-2 font-[inherit] text-small text-ink-900"
                        aria-label={`Pemilik: ${i.text}`}
                      >
                        <option value="">Pilih pemilik…</option>
                        {owners.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))}
      </div>
      <Panel
        title="Keputusan go / no-go"
        sub={`${director} · disaksikan komite mutu dan Kepala IT`}
        tone={decision ? (decision.kind === 'go' ? 'success' : 'warning') : undefined}
      >
        {decision ? (
          <>
            <Alert
              level={decision.kind === 'go' ? 'success' : 'warning'}
              title={`Keputusan ${decision.kind === 'go' ? 'GO' : 'NO-GO'} · ${decision.at}`}
            >
              {decision.note} — {decision.by} ({director})
            </Alert>
            <span className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                disabled={!canDecideRole}
                onClick={() => {
                  const input = { jam: formatJam(demoNow()) };
                  enqueue(() => reopenGoLiveAction(input));
                }}
              >
                Buka kembali keputusan
              </Button>
              {!canDecideRole && <span className="text-caption text-ink-500">{DECIDER_ONLY}</span>}
            </span>
          </>
        ) : (
          <>
            {open.length > 0 ? (
              <Alert level="warning" title={`${open.length} item kritis belum selesai atau belum berpemilik`}>
                {open.map((i) => i.text).join(' · ')}
              </Alert>
            ) : (
              <Alert level="success" title="Semua item kritis selesai dan berpemilik">
                Keputusan GO bisa diambil.
              </Alert>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-small font-semibold text-ink-700">
                Catatan keputusan (wajib, tercatat)
              </span>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="mis. pilot mulai Senin 12 Okt di rawat jalan dan IGD, hypercare 2 minggu"
                className="rounded-control border border-line-strong p-2.5 font-[inherit]"
              />
            </label>
            <span className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={!go.ok}
                aria-describedby={!go.ok ? 'golive-alasan' : undefined}
                onClick={() => setConfirming(true)}
              >
                Putuskan GO
              </Button>
              <Button variant="danger" disabled={!nogo.ok} onClick={() => decide('nogo')}>
                Tunda (NO-GO)
              </Button>
              {!go.ok && (
                <span id="golive-alasan" className="text-caption font-medium text-warning">
                  {go.reason}
                </span>
              )}
            </span>
            {inFlight > 0 && (
              <span role="status" className="text-caption text-ink-500">
                Menyimpan ceklis…
              </span>
            )}
            {itemError && (
              <Alert level="warning" title="Tidak tersimpan">
                {itemError}
              </Alert>
            )}
          </>
        )}
      </Panel>
      <ConfirmDialog request={request} onClose={() => setConfirming(false)} onConfirm={() => decide('go')} />
    </div>
  );
}

/** Fase 10 · Kesiapan go-live: matriks 51 EP MRMIK + ceklis runbook berpemilik + keputusan go/no-go terkunci. */
export function GoLiveBoard({
  eps,
  areas,
  owners,
  director,
  state,
  canDecideRole,
  userName,
}: {
  eps: MrmikEp[];
  areas: ChecklistArea[];
  owners: readonly string[];
  director: string;
  state: GoLiveStoreState;
  /** Posisi aktif = Manajemen (direksi): boleh memutuskan go/no-go (gerbang ulang di toko). */
  canDecideRole: boolean;
  userName: string;
}) {
  const [tab, setTab] = useState('ceklis');
  return (
    <Tabs
      label="Kesiapan go-live"
      value={tab}
      onChange={setTab}
      keepMounted
      items={[
        {
          id: 'ceklis',
          label: 'Ceklis & keputusan',
          content: (
            <Checklist
              areas={areas}
              owners={owners}
              director={director}
              store={state}
              canDecideRole={canDecideRole}
              userName={userName}
            />
          ),
        },
        { id: 'mrmik', label: 'Matriks 51 EP MRMIK', content: <Matrix eps={eps} /> },
      ]}
    />
  );
}
