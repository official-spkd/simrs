'use client';

import { formatRupiah } from '@simrs/shared';
import { cx, RadioSegmented } from '@simrs/ui';
import { useState } from 'react';
import { tanggalPendek } from '@/lib/keuangan-jurnal';
import {
  type AturanNaikKelas,
  type ItemTarif,
  KELAS_TARIF,
  type KelasTarif,
  packageView,
  type PaketTarif,
} from '@/lib/keuangan-tarif';

/**
 * Paket tindakan dan operasi: isi paket dengan tarif satuan kelas terpilih, Σ item vs harga paket (hemat), dan
 * ketentuan di luar paket. Di sampingnya aturan selisih naik kelas JKN berversi (dipakai Kasir dan Piutang).
 */
export function TarifPaket({
  packages,
  items,
  rules,
  today,
}: {
  packages: readonly PaketTarif[];
  items: readonly ItemTarif[];
  rules: readonly AturanNaikKelas[];
  today: string;
}) {
  const [sel, setSel] = useState(packages[0]?.id ?? '');
  const [kelas, setKelas] = useState<KelasTarif>('k2');
  const pkg = packages.find((p) => p.id === sel) ?? packages[0];
  if (!pkg) return <p className="m-0 text-small text-ink-500">Belum ada paket tarif.</p>;
  const v = packageView(pkg, items, kelas, today);
  return (
    <div className="flex flex-wrap items-start gap-4">
      <nav
        aria-label="Daftar paket"
        className="flex min-w-0 flex-[1_1_240px] flex-col gap-2 xl:max-w-[300px]"
      >
        {packages.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-current={p.id === pkg.id ? 'true' : undefined}
            onClick={() => setSel(p.id)}
            className={cx(
              'flex min-h-11 cursor-pointer flex-col rounded-control border px-3 py-2 text-left font-[inherit]',
              p.id === pkg.id ? 'border-brand-600 bg-brand-50' : 'border-line bg-white',
            )}
          >
            <span className="font-semibold text-ink-900">{p.name}</span>
            <span className="text-caption text-ink-500">
              {p.code} · {p.maxLos ? `maks. ${p.maxLos} malam` : 'tanpa rawat inap'}
            </span>
          </button>
        ))}
      </nav>
      <section
        aria-label="Isi paket"
        className="flex min-w-0 flex-[999_1_420px] flex-col gap-3 rounded-card border border-line bg-white p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex flex-col">
            <span className="font-semibold">{pkg.name}</span>
            <span className="text-caption text-ink-500">
              {pkg.code} · berlaku sejak {tanggalPendek(pkg.validFrom)}
            </span>
          </span>
          <RadioSegmented
            label="Kelas paket"
            items={KELAS_TARIF.map((k) => ({ id: k.id, label: k.label }))}
            value={kelas}
            onChange={(k) => setKelas(k as KelasTarif)}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-caption text-ink-500">
                <th scope="col" className="py-1 font-semibold">
                  Item
                </th>
                <th scope="col" className="py-1 text-right font-semibold">
                  Jml
                </th>
                <th scope="col" className="py-1 text-right font-semibold">
                  Tarif satuan
                </th>
                <th scope="col" className="py-1 text-right font-semibold">
                  Jumlah
                </th>
              </tr>
            </thead>
            <tbody>
              {v.lines.map((l) => (
                <tr key={l.itemCode} className="border-t border-line">
                  <td className="py-1 pr-2">
                    <span className="font-mono text-caption text-ink-500">{l.itemCode}</span> {l.name}
                  </td>
                  <td className="py-1 text-right font-mono">{l.qty}</td>
                  <td className="py-1 text-right font-mono">{formatRupiah(l.unit)}</td>
                  <td className="py-1 text-right font-mono">{formatRupiah(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong">
                <th scope="row" colSpan={3} className="py-1 text-left font-semibold">
                  Jumlah bila ditagih per item
                </th>
                <td className="py-1 text-right font-mono font-semibold" data-itemized={v.itemized.toString()}>
                  {formatRupiah(v.itemized)}
                </td>
              </tr>
              <tr>
                <th scope="row" colSpan={3} className="py-1 text-left font-semibold text-brand-700">
                  Harga paket
                </th>
                <td
                  className="py-1 text-right font-mono font-bold text-brand-700"
                  data-package-price={v.price.toString()}
                >
                  {formatRupiah(v.price)}
                </td>
              </tr>
              <tr>
                <th scope="row" colSpan={3} className="py-1 text-left font-normal text-success">
                  Pasien hemat
                </th>
                <td className="py-1 text-right font-mono text-success">
                  {formatRupiah(v.saving)} ({v.savingLabel})
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex flex-col gap-1 text-small">
          <span className="font-semibold">Di luar paket (ditagih per item)</span>
          <ul className="m-0 flex flex-col gap-0.5 pl-5 text-ink-700">
            {pkg.exclusions.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      </section>
      <section
        aria-label="Aturan selisih naik kelas"
        className="flex min-w-0 flex-[1_1_280px] flex-col gap-2 rounded-card border border-line bg-white p-4 xl:max-w-[360px]"
      >
        <span className="font-semibold">Aturan selisih naik kelas JKN</span>
        <span className="text-caption text-ink-500">
          Berversi; dipakai Kasir dan Piutang (angka simulasi)
        </span>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-col border-t border-line pt-2 text-small">
              <span className="font-semibold">{r.label}</span>
              <span className="text-ink-700">{r.rule}</span>
              <span className="text-caption text-ink-500">
                {r.version} · berlaku {tanggalPendek(r.validFrom)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
