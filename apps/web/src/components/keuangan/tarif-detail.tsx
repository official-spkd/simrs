'use client';

import { formatRupiah, formatTanggal } from '@simrs/shared';
import { Button, Chip, cx, Field } from '@simrs/ui';
import { useId, useState } from 'react';
import { shiftDate } from '@/lib/demo/fixtures/waktu';
import { tanggalPendek } from '@/lib/keuangan-jurnal';
import {
  activeVersion,
  bigIncreases,
  changeLabel,
  componentSplit,
  type HargaKelas,
  type ItemTarif,
  KELAS_TARIF,
  type KelasTarif,
  KOMPONEN_TARIF,
  parseHarga,
  scheduledVersion,
  usulanProblems,
} from '@/lib/keuangan-tarif';

const num = (v: bigint) => v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Rincian satu item tarif: komponen per kelas (Σ komponen = tarif), riwayat versi, dan formulir usulan perubahan
 * (berlaku mulai setelah hari ini, berjenjang per kelas, alasan wajib). Usulan menunggu persetujuan manajemen.
 */
export function TarifDetail({
  item,
  today,
  pendingNumber,
  onPropose,
}: {
  item: ItemTarif;
  today: string;
  /** Nomor usulan yang masih menunggu untuk item ini (satu usulan aktif per item). */
  pendingNumber: string | null;
  onPropose: (draft: { validFrom: string; prices: HargaKelas; reason: string }) => void;
}) {
  const current = activeVersion(item, today);
  const scheduled = scheduledVersion(item, today);
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-label="Rincian tarif"
      className="flex min-w-0 flex-[1_1_340px] flex-col gap-3 rounded-card border border-line bg-white p-4 xl:max-w-[460px]"
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-caption text-ink-500">{item.code}</span>
        <h2 className="m-0 text-h2 font-semibold">{item.name}</h2>
        <span className="text-small text-ink-700">
          per {item.unit} · versi {current?.version ?? '—'} berlaku sejak{' '}
          {current ? tanggalPendek(current.validFrom) : '—'}
        </span>
        {scheduled && (
          <span className="pt-1">
            <Chip tone="info">
              Versi {scheduled.version} terjadwal berlaku {tanggalPendek(scheduled.validFrom)}
            </Chip>
          </span>
        )}
      </div>

      {current && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11.5px]">
            <caption className="pb-1.5 text-left text-small font-semibold">
              Komponen tarif (Rp) · tarif dasar
            </caption>
            <thead>
              <tr className="text-left text-caption text-ink-500">
                <th scope="col" className="py-1 font-semibold">
                  Komponen
                </th>
                {KELAS_TARIF.map((k) => (
                  <th key={k.id} scope="col" className="py-1 text-right font-semibold">
                    {k.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {KOMPONEN_TARIF.map((c, ci) => (
                <tr key={c.id} className="border-t border-line">
                  <th scope="row" className="py-1 text-left font-normal">
                    {c.label}
                  </th>
                  {KELAS_TARIF.map((k) => (
                    <td key={k.id} className="py-1 text-right font-mono">
                      {num(componentSplit(current.prices[k.id], item.composition)[ci]?.amount ?? 0n)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong font-semibold">
                <th scope="row" className="py-1 text-left">
                  Tarif (Σ komponen)
                </th>
                {KELAS_TARIF.map((k) => (
                  <td key={k.id} className="py-1 text-right font-mono">
                    {num(current.prices[k.id])}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-small font-semibold">Riwayat versi</span>
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
          {[...item.versions].reverse().map((v) => (
            <li
              key={v.version}
              className="flex flex-col rounded-control border border-line px-3 py-2 text-small"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Versi {v.version}</span>
                <Chip tone={v === current ? 'success' : v.validFrom > today ? 'info' : 'neutral'}>
                  {v === current ? 'Berlaku' : v.validFrom > today ? 'Terjadwal' : 'Berakhir'}
                </Chip>
              </span>
              <span className="text-ink-700">
                {tanggalPendek(v.validFrom)} – {v.validTo ? tanggalPendek(v.validTo) : 'seterusnya'} · Kelas 2{' '}
                {formatRupiah(v.prices.k2)}
              </span>
              <span className="text-caption text-ink-500">
                Disetujui {v.approvedBy} · {formatTanggal(v.approvedAt)} · {v.note}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {pendingNumber ? (
        <p className="m-0 rounded-control border border-[#C9D3EE] bg-[#F6F8FD] px-3 py-2 text-small text-ink-700">
          Usulan {pendingNumber} untuk item ini masih menunggu persetujuan; satu usulan aktif per item.
        </p>
      ) : open && current ? (
        <UsulanForm
          item={item}
          current={current.prices}
          today={today}
          onCancel={() => setOpen(false)}
          onSubmit={(d) => {
            onPropose(d);
            setOpen(false);
          }}
        />
      ) : (
        <Button
          variant="primary"
          disabled={!!scheduled}
          aria-describedby={scheduled ? 'tarif-terjadwal' : undefined}
          onClick={() => setOpen(true)}
        >
          Buat usulan perubahan
        </Button>
      )}
      {scheduled && !pendingNumber && (
        <span id="tarif-terjadwal" className="text-caption text-warning">
          Sudah ada versi terjadwal; usulan baru dibuat setelah versi itu berlaku.
        </span>
      )}
    </section>
  );
}

function UsulanForm({
  item,
  current,
  today,
  onCancel,
  onSubmit,
}: {
  item: ItemTarif;
  current: HargaKelas;
  today: string;
  onCancel: () => void;
  onSubmit: (d: { validFrom: string; prices: HargaKelas; reason: string }) => void;
}) {
  const id = useId();
  const [raw, setRaw] = useState<Record<KelasTarif, string>>({
    k3: num(current.k3),
    k2: num(current.k2),
    k1: num(current.k1),
    vip: num(current.vip),
  });
  const [validFrom, setValidFrom] = useState('2026-11-01');
  const [reason, setReason] = useState('');
  const prices: HargaKelas = {
    k3: parseHarga(raw.k3),
    k2: parseHarga(raw.k2),
    k1: parseHarga(raw.k1),
    vip: parseHarga(raw.vip),
  };
  const problems = usulanProblems(item, { validFrom, prices, reason }, today);
  const big = bigIncreases(current, prices);
  return (
    <form
      aria-label="Usulan perubahan tarif"
      className="flex flex-col gap-3 rounded-control border border-brand-600 bg-[#F4FBFA] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (problems.length === 0) onSubmit({ validFrom, prices, reason: reason.trim() });
      }}
    >
      <span className="font-semibold">Usulan perubahan · {item.name}</span>
      <div className="grid grid-cols-2 gap-2">
        {KELAS_TARIF.map((k) => (
          <Field
            key={k.id}
            label={`${k.label} (Rp)`}
            inputMode="numeric"
            value={raw[k.id]}
            onChange={(e) => setRaw((r) => ({ ...r, [k.id]: e.target.value }))}
            hint={changeLabel(current[k.id], prices[k.id])}
            hintTone="muted"
          />
        ))}
      </div>
      <Field
        label="Berlaku mulai"
        type="date"
        min={shiftDate(today, 1)}
        value={validFrom}
        onChange={(e) => setValidFrom(e.target.value)}
        hint="Tidak boleh hari ini atau tanggal lampau (tarif tidak retroaktif)"
        hintTone="muted"
      />
      <label htmlFor={`${id}-alasan`} className="text-small font-semibold text-ink-700">
        Alasan perubahan (wajib)
      </label>
      <textarea
        id={`${id}-alasan`}
        rows={2}
        maxLength={300}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="mis. Kontrak servis alat naik; hasil analisis unit cost Q3"
        className="rounded-control border border-line-strong bg-white px-3 py-2 font-[inherit] text-small"
      />
      {big.length > 0 && (
        <span role="note" className="text-caption font-medium text-warning">
          ! Kenaikan lebih dari 20% di {big.map((k) => KELAS_TARIF.find((x) => x.id === k)?.label).join(', ')}
          : lampirkan analisis biaya untuk penyetuju.
        </span>
      )}
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span
          id={`${id}-masalah`}
          className={cx('text-caption', problems.length ? 'font-medium text-warning' : 'text-success')}
        >
          {problems.length ? `Belum bisa diajukan: ${problems.join('; ')}.` : 'Siap diajukan ke penyetuju.'}
        </span>
        <span className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Batal
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={problems.length > 0}
            aria-describedby={`${id}-masalah`}
          >
            Ajukan usulan
          </Button>
        </span>
      </span>
    </form>
  );
}
