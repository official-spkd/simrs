'use client';

import { formatTanggal } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { useState } from 'react';
import { STALE_TEXT } from '@/components/backoffice/use-toko';
import type { StoredBooking } from '@/lib/aplikasi-pasien-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import { useStoreAction } from '@/lib/demo/store/client';
import type { BookableSlot } from '@/lib/server/data/manajemen';
import { bookSlotAction, patientAppAction } from './actions';

const BTN =
  'min-h-11 cursor-pointer rounded-[12px] px-3 font-[inherit] text-[13px] font-semibold disabled:cursor-not-allowed';

/**
 * I07 · Daftar berobat (booking online): pilih jadwal praktik dari Jadwal dokter (kuota JKN tersisa, bukan cuti);
 * booking tersimpan dengan kode `BK-…` (domain `aplikasi-pasien`) dan bisa dibatalkan. Dokter yang kemudian dicatat
 * cuti di Jadwal dokter menandai booking itu dan mengirim notifikasi.
 */
export function BookingPanel({
  slots,
  bookings,
  rev,
}: {
  slots: readonly BookableSlot[];
  bookings: readonly StoredBooking[];
  rev: number;
}) {
  const { run, pending } = useStoreAction(rev);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const active = bookings.filter((b) => !b.cancelled);
  const booked = new Set(active.map((b) => b.slotId));
  const shown = slots.filter((s) => !booked.has(s.slotId)).slice(0, 4);
  const done = (r: { ok: boolean; message: string; stale?: boolean }, text?: string) =>
    setNotice({ ok: r.ok, text: r.stale ? STALE_TEXT : r.ok && text ? text : r.message });

  return (
    <section aria-label="Booking jadwal" className="flex flex-col gap-2.5">
      {notice && (
        <p
          role="status"
          className={cx(
            'm-0 rounded-[12px] px-3 py-2 text-[13px] font-medium',
            notice.ok ? 'bg-zamrud-50 text-success' : 'bg-warning-bg text-warning',
          )}
        >
          {notice.text}
        </p>
      )}
      {active.length > 0 && (
        <ul aria-label="Booking saya" className="m-0 flex list-none flex-col gap-2 p-0">
          {active.map((b) => (
            <li
              key={b.code}
              className="flex flex-col gap-1 rounded-[14px] border border-white/95 bg-white/90 shadow-card p-3"
            >
              <span className="font-mono text-[15px] font-semibold">{b.code}</span>
              <span className="text-[13px] text-ink-700">
                {b.poliName} · {b.doctorName} · {formatTanggal(b.date)} {b.start}
              </span>
              {b.onLeave && (
                <span className="text-[12.5px] font-semibold text-danger">
                  Dokter cuti pada jadwal ini: batalkan dan pilih jadwal lain.
                </span>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    (r) =>
                      patientAppAction({
                        event: { type: 'booking.dibatalkan', code: b.code, jam: demoStamp().jam },
                        rev: r,
                      }),
                    (res) => done(res, `Booking ${b.code} dibatalkan.`),
                  )
                }
                className={cx(BTN, 'self-start border border-line-strong bg-white text-danger')}
              >
                Batalkan booking<span className="sr-only"> {b.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="text-[13px] font-semibold">Pilih jadwal praktik (kuota JKN tersisa)</span>
      <ul aria-label="Jadwal tersedia" className="m-0 flex list-none flex-col gap-2 p-0">
        {shown.map((s) => (
          <li
            key={s.slotId}
            className="flex items-center justify-between gap-2 rounded-[14px] border border-white/95 bg-white/90 shadow-card p-3"
          >
            <span className="flex min-w-0 flex-col text-[13px]">
              <span className="font-semibold">
                {s.poliName} · {formatTanggal(s.date)} {s.start}
              </span>
              <span className="text-ink-500">
                {s.doctorName} · sisa {s.left}
              </span>
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  (r) => bookSlotAction({ slotId: s.slotId, jam: demoStamp().jam, rev: r }),
                  (res) => done(res),
                )
              }
              className={cx(
                BTN,
                'shrink-0 border border-transparent bg-btn-primary text-white shadow-button',
              )}
            >
              Pesan
              <span className="sr-only">
                {' '}
                {s.poliName} {s.date} {s.start}
              </span>
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="text-[13px] text-ink-500">Tidak ada jadwal tersedia minggu ini.</li>
        )}
      </ul>
    </section>
  );
}
