'use client';

import { formatJam, formatRupiah } from '@simrs/shared';
import { Button, Chip, type ChipTone, cx, FilterChip, KpiCard } from '@simrs/ui';
import Link from 'next/link';
import { useState } from 'react';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  byEncounter,
  captureActions,
  captureReconciliation,
  type EventCapture,
  KOREKSI_REASON_MIN,
  resolveHold,
  SUMBER_LABEL,
  type SumberEvent,
  voidManualLine,
} from '@/lib/keuangan-charge';
import { AlasanForm } from './alasan-form';

type StatusFilter = 'semua' | 'tertahan' | 'dibalik' | 'manual';
const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'semua', label: 'Semua status' },
  { id: 'tertahan', label: 'Tertahan' },
  { id: 'dibalik', label: 'Pembalik' },
  { id: 'manual', label: 'Manual' },
];
const STATUS_VIEW: Record<EventCapture['status'], { label: string; tone: ChipTone }> = {
  tertagih: { label: 'Tertagih', tone: 'success' },
  tertahan: { label: 'Tertahan', tone: 'danger' },
  dibalik: { label: 'Dibalik', tone: 'neutral' },
};
const HOLD_LABEL = {
  'tarif-tidak-ada': 'Tarif tidak ada',
  'kelas-belum-ada': 'Kelas belum ditetapkan',
  'penjamin-berubah': 'Penjamin berubah',
} as const;

const signed = (v: bigint) => (v < 0n ? `−${formatRupiah(-v)}` : formatRupiah(v));

/**
 * U02 · Monitor charge capture: event klinis → baris tagihan bersumber; pengecualian ditangani (coba ulang setelah
 * tarif disetujui, minta admisi menetapkan kelas, reprice penjamin baru); koreksi baris klinis diminta ke unit asal,
 * hanya baris manual yang bisa dibatalkan kasir (alasan wajib). Simulasi lokal, tidak disimpan.
 */
export function ChargeWorkspace({
  initial,
  eventTotal,
  viewer,
}: {
  initial: readonly EventCapture[];
  eventTotal: number;
  viewer: string;
}) {
  const [events, setEvents] = useState<readonly EventCapture[]>(initial);
  const [src, setSrc] = useState<SumberEvent | 'semua'>('semua');
  const [st, setSt] = useState<StatusFilter>('semua');
  const [open, setOpen] = useState<{ id: string; kind: 'koreksi' | 'batal' } | null>(null);
  const [requested, setRequested] = useState<Record<string, string>>({});
  const [kelasSet, setKelasSet] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);

  const rec = captureReconciliation(events);
  const enc = byEncounter(events);
  const sources = [...new Set(initial.map((e) => e.source))];
  const shown = events.filter(
    (e) =>
      (src === 'semua' || e.source === src) &&
      (st === 'semua' ||
        (st === 'manual' ? !!e.manual : st === 'dibalik' ? e.status === 'dibalik' : e.status === st)),
  );
  const replace = (id: string, next: EventCapture[]) =>
    setEvents((list) => list.flatMap((e) => (e.id === id ? next : [e])));

  const retry = (e: EventCapture) => {
    const [done] = resolveHold(e);
    if (!done?.line) return;
    replace(e.id, [done]);
    setFlash(
      `${done.line.name} ${signed(done.line.amount)} masuk tagihan ${e.patient.name} · ${formatJam(demoNow())}`,
    );
  };
  const request = (e: EventCapture, text: string) => {
    const t = formatJam(demoNow());
    setRequested((r) => ({ ...r, [e.id]: t }));
    setFlash(`${text} · ${t}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="region"
        aria-label="Indikator charge capture"
        className="grid grid-cols-2 gap-3.5 xl:grid-cols-4"
      >
        <KpiCard
          label="Event bisa-tagih hari ini"
          value={eventTotal.toLocaleString('id-ID')}
          detail={`${events.length} terbaru tampil di monitor`}
        />
        <KpiCard
          label="Tertahan"
          value={rec.held}
          hint={rec.held ? 'perlu tindak lanjut' : 'tidak ada'}
          tone={rec.held ? 'danger' : 'success'}
          tinted
        />
        <KpiCard label="Baris pembalik" value={rec.reversed} detail="batal order, retur obat, batal manual" />
        <KpiCard
          label="Kunjungan menahan finalisasi"
          value={enc.filter((k) => k.held > 0).length}
          hint="kasir tidak bisa memfinalkan tagihan"
          tone={enc.some((k) => k.held > 0) ? 'warning' : 'success'}
          tinted
        />
      </div>

      <p
        role="status"
        className={cx(
          'm-0 rounded-control border px-3 py-2 text-small',
          rec.unexplained === 0
            ? 'border-[#B7DEC0] bg-[#F2FAF4] text-ink-700'
            : 'border-danger-border bg-danger-bg',
        )}
      >
        <span className="font-semibold">Rekonsiliasi capture:</span> {rec.total} event = {rec.billed} tertagih
        + {rec.held} tertahan + {rec.reversed} pembalik ·{' '}
        {rec.unexplained === 0
          ? '✓ tidak ada event tanpa baris atau alasan'
          : `${rec.unexplained} tanpa penjelasan`}
      </p>
      {flash && (
        <div
          role="status"
          className="rounded-control border border-[#B7DEC0] bg-[#EAF5EC] px-3 py-2 text-small text-success"
        >
          ✓ {flash} (simulasi, tidak disimpan)
        </div>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <section
          aria-label="Aliran event klinis"
          className="flex min-w-0 flex-[999_1_560px] flex-col overflow-hidden rounded-card border border-line bg-white"
        >
          <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
            <span className="flex flex-col">
              <span className="font-semibold">Aliran event klinis → baris tagihan</span>
              <span className="text-[12.5px] text-ink-500">
                Harga dari tarif berlaku pada kelas dan penjamin saat layanan; tanpa tarif → tertahan, bukan
                diabaikan
              </span>
            </span>
            <div role="group" aria-label="Filter sumber" className="flex flex-wrap gap-1.5">
              <FilterChip selected={src === 'semua'} onClick={() => setSrc('semua')}>
                Semua sumber
              </FilterChip>
              {sources.map((s) => (
                <FilterChip key={s} selected={src === s} onClick={() => setSrc(s)}>
                  {SUMBER_LABEL[s]}
                </FilterChip>
              ))}
            </div>
            <div role="group" aria-label="Filter status" className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <FilterChip key={f.id} selected={st === f.id} onClick={() => setSt(f.id)}>
                  {f.label}
                </FilterChip>
              ))}
            </div>
          </div>
          <ul aria-label="Event" className="m-0 flex list-none flex-col p-0">
            {shown.map((e) => {
              const acts = captureActions(e);
              const kelasOk = !!kelasSet[e.id];
              const canRetry = acts.retry === null || (e.hold?.kind === 'kelas-belum-ada' && kelasOk);
              const sv = STATUS_VIEW[e.status];
              const isOpen = open?.id === e.id;
              return (
                <li
                  key={e.id}
                  aria-label={`${formatJam(e.at)} ${e.patient.name} ${e.description}`}
                  className={cx(
                    'flex flex-col gap-2 border-b border-line px-4 py-3',
                    e.status === 'tertahan' && 'bg-[#FFFBFA]',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="flex min-w-0 flex-[1_1_300px] flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 text-caption text-ink-500">
                        <span className="font-mono font-semibold text-ink-700">{formatJam(e.at)}</span>
                        <Chip tone="info">dari {SUMBER_LABEL[e.source]}</Chip>
                        <span className="font-mono">{e.event}</span>
                      </span>
                      <span className="font-semibold">
                        {e.patient.name}{' '}
                        <span className="font-mono text-caption font-normal text-ink-500">
                          {e.patient.rm}
                        </span>
                      </span>
                      <span className="text-caption text-ink-500">
                        {e.patient.place} · {e.patient.payer}
                      </span>
                      <span className="text-small text-ink-700">{e.description}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1 text-right">
                      <Chip tone={sv.tone}>
                        {e.status === 'tertahan' && e.hold
                          ? `${sv.label}: ${HOLD_LABEL[e.hold.kind]}`
                          : sv.label}
                      </Chip>
                      {e.manual && <Chip tone="warning">Manual · {e.manual.by}</Chip>}
                      {e.line && (
                        <span className="text-small">
                          <span className="font-mono text-caption text-ink-500">{e.line.itemCode}</span>{' '}
                          {e.line.qty} × {formatRupiah(e.line.unitPrice)} ={' '}
                          <span
                            className={cx('font-mono font-semibold', e.line.amount < 0n && 'text-danger')}
                            data-line-amount={e.line.amount.toString()}
                          >
                            {signed(e.line.amount)}
                          </span>
                        </span>
                      )}
                    </span>
                  </div>

                  {e.manual && (
                    <span className="text-caption text-ink-500">Alasan manual: “{e.manual.reason}”</span>
                  )}

                  {e.status === 'tertahan' && e.hold && (
                    <div className="flex flex-col gap-2 rounded-control border border-danger-border bg-white p-3">
                      <span className="text-small text-ink-700">
                        <span className="font-semibold text-danger">Tertahan · </span>
                        {e.hold.reason}
                      </span>
                      {e.hold.reprice && (
                        <table className="w-full border-collapse text-[12.5px]">
                          <caption className="pb-1 text-left text-caption text-ink-500">
                            Baris terbuka yang dibalik dan dibuat ulang
                          </caption>
                          <tbody>
                            {e.hold.reprice.map((p) => (
                              <tr key={p.before.itemCode} className="border-t border-line">
                                <td className="py-1 pr-2">{p.before.name}</td>
                                <td className="py-1 text-right font-mono">{formatRupiah(p.before.amount)}</td>
                                <td className="py-1 text-center" aria-label="menjadi">
                                  →
                                </td>
                                <td className="py-1 text-right font-mono">{formatRupiah(p.after.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {e.hold.tariffApprovedAt && (
                        <span className="text-caption text-success">
                          ✓ Tarif {e.hold.resolution?.itemCode} disetujui {formatJam(e.hold.tariffApprovedAt)}
                          ; event bisa dicoba ulang.
                        </span>
                      )}
                      {kelasOk && (
                        <span className="text-caption text-success">
                          ✓ Admisi menetapkan Kelas 2 · {kelasSet[e.id]}; event bisa dicoba ulang.
                        </span>
                      )}
                      <span className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={!canRetry}
                          aria-describedby={canRetry ? undefined : `${e.id}-gate`}
                          onClick={() => retry(e)}
                        >
                          {e.hold.kind === 'penjamin-berubah'
                            ? 'Reprice baris terbuka'
                            : 'Coba ulang capture'}
                        </Button>
                        {e.hold.kind === 'tarif-tidak-ada' && !e.hold.tariffApprovedAt && (
                          <>
                            <Button
                              size="sm"
                              disabled={!!requested[e.id]}
                              onClick={() =>
                                request(
                                  e,
                                  `Permintaan tarif ${e.hold?.resolution?.name ?? ''} dikirim ke pengelola tarif`,
                                )
                              }
                            >
                              {requested[e.id]
                                ? `Tarif diminta ${requested[e.id]}`
                                : 'Minta tarif ke pengelola tarif'}
                            </Button>
                            <Link href="/keuangan/tarif" className="text-small font-semibold">
                              Buka Tarif & paket
                            </Link>
                          </>
                        )}
                        {e.hold.kind === 'kelas-belum-ada' &&
                          !kelasOk &&
                          (requested[e.id] ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setKelasSet((k) => ({ ...k, [e.id]: formatJam(demoNow()) }))}
                            >
                              Simulasikan admisi menetapkan kelas
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() =>
                                request(e, `Permintaan penetapan kelas ${e.patient.name} dikirim ke admisi`)
                              }
                            >
                              Minta admisi menetapkan kelas
                            </Button>
                          ))}
                        {!canRetry && acts.retry && (
                          <span id={`${e.id}-gate`} className="text-caption font-medium text-warning">
                            {requested[e.id] && e.hold.kind === 'kelas-belum-ada'
                              ? `Menunggu admisi · diminta ${requested[e.id]}`
                              : acts.retry}
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {e.status === 'tertagih' && (
                    <span className="flex flex-wrap items-center gap-2">
                      {acts.correction === null && !isOpen && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!!requested[e.id]}
                          onClick={() => setOpen({ id: e.id, kind: 'koreksi' })}
                        >
                          {requested[e.id]
                            ? `Koreksi diminta ${requested[e.id]}`
                            : 'Minta koreksi ke unit asal…'}
                        </Button>
                      )}
                      {acts.voidManual === null && !isOpen && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setOpen({ id: e.id, kind: 'batal' })}
                        >
                          Batalkan baris manual…
                        </Button>
                      )}
                    </span>
                  )}
                  {isOpen && open.kind === 'koreksi' && (
                    <AlasanForm
                      label={`Alasan koreksi untuk ${SUMBER_LABEL[e.source]} (wajib)`}
                      submitLabel="Kirim permintaan koreksi"
                      min={KOREKSI_REASON_MIN}
                      placeholder="mis. Kuantitas di eMAR 2, tetapi pasien hanya menerima 1"
                      onCancel={() => setOpen(null)}
                      onSubmit={() => {
                        setOpen(null);
                        request(
                          e,
                          `Permintaan koreksi dikirim ke ${SUMBER_LABEL[e.source]}; baris tetap sampai unit asal membalik`,
                        );
                      }}
                    />
                  )}
                  {isOpen && open.kind === 'batal' && (
                    <AlasanForm
                      label="Alasan pembatalan baris manual (wajib)"
                      submitLabel="Batalkan baris"
                      variant="danger"
                      min={KOREKSI_REASON_MIN}
                      placeholder="mis. Kursi roda milik keluarga, bukan sewa RS"
                      onCancel={() => setOpen(null)}
                      onSubmit={(reason) => {
                        const now = demoNow();
                        setOpen(null);
                        replace(e.id, voidManualLine(e, now.toISOString(), viewer, reason));
                        setFlash(
                          `Baris manual ${e.line?.name ?? ''} dibatalkan dengan baris pembalik · ${formatJam(now)}`,
                        );
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {shown.length === 0 && (
            <p className="m-0 px-4 py-6 text-center text-small text-ink-500">
              Tidak ada event untuk filter ini.
            </p>
          )}
        </section>

        <aside
          aria-label="Kelengkapan per kunjungan"
          className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 xl:max-w-[380px]"
        >
          <section className="flex flex-col gap-2 rounded-card border border-line bg-white p-4">
            <span className="font-semibold">Kelengkapan tagihan per kunjungan</span>
            <span className="text-caption text-ink-500">
              Finalisasi di Kasir ditahan selama ada event tertahan
            </span>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {enc.map((k) => (
                <li key={k.key} className="flex flex-col gap-0.5 border-t border-line pt-2 text-small">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{k.patient.name}</span>
                    <Chip tone={k.held ? 'danger' : 'success'}>
                      {k.held ? `Finalisasi ditahan (${k.held})` : 'Lengkap'}
                    </Chip>
                  </span>
                  <span className="text-caption text-ink-500">
                    {k.patient.place} · {k.events} event · baris hari ini {signed(k.net)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-1.5 rounded-card border border-line bg-white p-4 text-[13px] text-ink-700">
            <span className="font-semibold text-ink-900">Aturan koreksi</span>
            <span>
              • Baris klinis dikoreksi di unit asal (order, eMAR, LIS, farmasi), lalu baris pembalik otomatis
            </span>
            <span>• Kasir hanya membatalkan baris manual, dengan alasan tertulis</span>
            <span>• Tidak ada baris yang dihapus; pembalik menjaga jejak audit</span>
          </section>
        </aside>
      </div>
    </div>
  );
}
