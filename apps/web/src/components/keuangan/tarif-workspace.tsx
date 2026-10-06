'use client';

import type { ChargeCategory } from '@simrs/shared';
import { Chip, cx, FilterChip, KpiCard, RadioSegmented, Tabs } from '@simrs/ui';
import { useState } from 'react';
import { type TarifActionInput, tarifAction } from '@/app/(staf)/keuangan/tarif/actions';
import { useStoreAction } from '@/lib/demo/store/client';
import { CATEGORY_LABEL } from '@/lib/keuangan';
import { tanggalPendek } from '@/lib/keuangan-jurnal';
import {
  activeVersion,
  type HargaKelas,
  KELAS_TARIF,
  payerPrice,
  scheduledVersion,
  type UsulanTarif,
} from '@/lib/keuangan-tarif';
import type { TarifState } from '@/lib/keuangan-tarif-toko';
import type { TariffBoard } from '@/lib/server/data/keuangan-lanjut';
import { TarifDetail } from './tarif-detail';
import { TarifPaket } from './tarif-paket';
import { TarifUsulan } from './tarif-usulan';

const num = (v: bigint) => v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * U01 · Ruang kerja Tarif dan paket (tanpa mockup; gaya layar Akuntansi): daftar tarif per kelas dan penjamin,
 * rincian komponen dan riwayat versi, usulan perubahan → persetujuan (pembuat ≠ penyetuju, tidak retroaktif),
 * dan paket. Usulan dan keputusan tersimpan di toko demo (domain `tarif`, ADR-0085) atas nama pengguna sesi.
 */
export function TarifWorkspace({
  board,
  store,
  rev,
  today,
  viewer,
}: {
  board: TariffBoard;
  /** Item tarif dan usulan setelah aksi tersimpan (domain `tarif`). */
  store: TarifState;
  rev: number;
  today: string;
  viewer: { name: string; role: string | null };
}) {
  const { items, proposals } = store;
  const [tab, setTab] = useState('tarif');
  const [cat, setCat] = useState<ChargeCategory | 'semua'>('semua');
  const [q, setQ] = useState('');
  const [payer, setPayer] = useState<string>('umum');
  const [sel, setSel] = useState('AKM-KMR');
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const { run } = useStoreAction(rev);
  const act = (input: TarifActionInput) =>
    run(
      (r) => tarifAction({ ...input, rev: r }),
      (res) => setFlash({ text: res.message, ok: res.ok }),
    );

  const bp = board.payers.find((p) => p.id === payer) ?? board.payers[0];
  const cats = [...new Set(items.map((i) => i.category))];
  const needle = q.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (cat === 'semua' || i.category === cat) &&
      (!needle || i.name.toLowerCase().includes(needle) || i.code.toLowerCase().includes(needle)),
  );
  const item = items.find((i) => i.code === sel) ?? items[0];
  const pending = proposals.filter((p) => p.status === 'diajukan');
  const scheduled = items.filter((i) => scheduledVersion(i, today));
  const pendingFor = (code: string) => pending.find((p) => p.itemCode === code)?.number ?? null;

  const propose = (code: string, d: { validFrom: string; prices: HargaKelas; reason: string }) =>
    act({
      type: 'ajukan',
      itemCode: code,
      validFrom: d.validFrom,
      prices: {
        k3: d.prices.k3.toString(),
        k2: d.prices.k2.toString(),
        k1: d.prices.k1.toString(),
        vip: d.prices.vip.toString(),
      },
      reason: d.reason,
      rev: 0,
    });
  const decide = (u: UsulanTarif, approve: boolean, note?: string) =>
    act({ type: 'putuskan', proposalId: u.id, approve, note: approve ? null : (note ?? null), rev: 0 });

  const list = (
    <section
      aria-label="Daftar tarif"
      className="@container flex min-w-0 flex-[999_1_560px] flex-col overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
    >
      <div className="flex flex-col gap-2.5 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex min-w-0 flex-[1_1_220px] flex-col gap-1 text-small font-semibold text-ink-700">
            Cari item tarif
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="nama atau kode, mis. kamar, LAB-"
              className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] font-normal text-ink-900"
            />
          </label>
          <RadioSegmented
            label="Penjamin"
            items={board.payers.map((p) => ({ id: p.id, label: p.label }))}
            value={payer}
            onChange={setPayer}
          />
        </div>
        <div role="group" aria-label="Filter kategori" className="flex flex-wrap gap-1.5">
          <FilterChip selected={cat === 'semua'} onClick={() => setCat('semua')}>
            Semua
          </FilterChip>
          {cats.map((c) => (
            <FilterChip key={c} selected={cat === c} onClick={() => setCat(c)}>
              {CATEGORY_LABEL[c]}
            </FilterChip>
          ))}
        </div>
        {bp && <span className="text-caption text-ink-500">{bp.note}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-subtle text-left text-caption text-ink-500">
              <th scope="col" className="px-4 py-2 font-semibold">
                Item
              </th>
              {KELAS_TARIF.map((k) => (
                <th key={k.id} scope="col" className="py-2 pr-3 text-right font-semibold">
                  {k.label}
                </th>
              ))}
              <th scope="col" className="py-2 pr-4 font-semibold">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => {
              const v = activeVersion(i, today);
              const sch = scheduledVersion(i, today);
              const wait = pendingFor(i.code);
              const on = i.code === item?.code;
              return (
                <tr
                  key={i.code}
                  className={cx(
                    'border-t border-line',
                    on
                      ? 'bg-[linear-gradient(90deg,var(--color-brand-100),rgba(255,255,255,0.4))]'
                      : 'hover:bg-brand-50/60',
                  )}
                >
                  <td className="px-4 py-1.5">
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSel(i.code)}
                      className="flex min-h-11 cursor-pointer flex-col items-start border-0 bg-transparent p-0 text-left font-[inherit]"
                    >
                      <span className="font-semibold text-brand-700">{i.name}</span>
                      <span className="font-mono text-caption text-ink-500">
                        {i.code} · per {i.unit}
                      </span>
                    </button>
                  </td>
                  {KELAS_TARIF.map((k) => (
                    <td key={k.id} className="py-1.5 pr-3 text-right font-mono">
                      {v ? num(payerPrice(v.prices[k.id], bp?.bp ?? 0)) : '—'}
                    </td>
                  ))}
                  <td className="py-1.5 pr-4">
                    {sch ? (
                      <Chip tone="info">Terjadwal {tanggalPendek(sch.validFrom)}</Chip>
                    ) : wait ? (
                      <Chip tone="warning">Ada usulan</Chip>
                    ) : (
                      <Chip tone="success">Berlaku v{v?.version}</Chip>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="m-0 px-4 py-6 text-center text-small text-ink-500">
            Tidak ada item tarif yang cocok dengan pencarian “{q}”.
          </p>
        )}
      </div>
      <span className="border-t border-line px-4 py-2 text-caption text-ink-500">
        Menampilkan {shown.length} dari {board.itemTotal.toLocaleString('id-ID')} item tarif aktif · harga
        dalam rupiah, tarif {bp?.label.toLowerCase()}
      </span>
    </section>
  );

  return (
    <div className="flex flex-col gap-4">
      <div role="region" aria-label="Indikator tarif" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiCard
          label="Item tarif aktif"
          value={board.itemTotal.toLocaleString('id-ID')}
          detail="SK tarif 2026"
          tinted
        />
        <KpiCard label="Paket aktif" value={board.packages.length} detail="operasi dan persalinan" tinted />
        <KpiCard
          label="Usulan menunggu"
          value={pending.length}
          hint={pending.length ? 'perlu keputusan manajemen' : 'tidak ada'}
          tone={pending.length ? 'warning' : 'success'}
          tinted
        />
        <KpiCard
          label="Perubahan terjadwal"
          value={scheduled.length}
          detail={scheduled.length ? scheduled.map((i) => i.name).join(', ') : 'belum ada'}
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
        label="Tarif dan paket"
        variant="pil"
        value={tab}
        onChange={setTab}
        items={[
          {
            id: 'tarif',
            label: 'Tarif layanan',
            content: (
              <div className="flex flex-wrap items-start gap-4 pt-3">
                {list}
                {item && (
                  <TarifDetail
                    key={item.code}
                    item={item}
                    today={today}
                    pendingNumber={pendingFor(item.code)}
                    onPropose={(d) => propose(item.code, d)}
                  />
                )}
              </div>
            ),
          },
          {
            id: 'usulan',
            label: 'Usulan perubahan',
            badge: pending.length ? String(pending.length) : undefined,
            content: (
              <div className="flex flex-col gap-3 pt-3">
                <p className="m-0 text-small text-ink-700">
                  Alur: akuntan menyusun usulan → manajemen menyetujui (pembuat ≠ penyetuju) → versi baru
                  terjadwal pada tanggal berlaku; tarif tidak pernah berlaku surut. Tagihan yang sudah final
                  tidak berubah.
                </p>
                <TarifUsulan
                  proposals={proposals}
                  items={items}
                  today={today}
                  viewer={viewer}
                  onApprove={(u) => decide(u, true)}
                  onReject={(u, r) => decide(u, false, r)}
                />
              </div>
            ),
          },
          {
            id: 'paket',
            label: 'Paket',
            content: (
              <div className="pt-3">
                <TarifPaket
                  packages={board.packages}
                  items={items}
                  rules={board.upgradeRules}
                  today={today}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
