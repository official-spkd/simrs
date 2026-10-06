import type { ScheduleDoctor } from '@simrs/shared';
import { Button } from '@simrs/ui';
import { useState } from 'react';
import { dayLong } from '@/lib/front-office';

const selectClass =
  'h-11 w-full rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small text-ink-900';

/**
 * F01 · "Catat cuti atau pengganti": pilih dokter dan hari praktiknya, opsional dokter pengganti dari poli yang
 * sama. Slot yang sudah cuti/tidak praktik tidak bisa dipilih. Hasilnya menjadi perbedaan HFIS sampai dikirim.
 */
export function LeaveForm({
  doctors,
  isPractice,
  busy,
  onSubmit,
  onCancel,
  withReason = false,
}: {
  doctors: ScheduleDoctor[];
  /** Slot masih praktik (belum dicatat cuti di layar ini). */
  isPractice: (slotId: string) => boolean;
  busy: boolean;
  onSubmit: (slotId: string, substituteId: string | null, reason: string) => void;
  onCancel: () => void;
  /** Mode api: alasan cuti wajib (≥ 5 karakter, tercatat di audit). */
  withReason?: boolean;
}) {
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? '');
  const doctor = doctors.find((d) => d.id === doctorId);
  const practice = (doctor?.slots ?? []).filter((s) => isPractice(s.id));
  const [slotId, setSlotId] = useState(practice[0]?.id ?? '');
  const [subId, setSubId] = useState('');
  const [reason, setReason] = useState('');
  const reasonOk = !withReason || reason.trim().length >= 5;
  const subs = doctors.filter((d) => d.poliCode === doctor?.poliCode && d.id !== doctorId);
  const validSlot = practice.some((s) => s.id === slotId);

  const pickDoctor = (id: string) => {
    setDoctorId(id);
    const first = doctors.find((d) => d.id === id)?.slots.find((s) => isPractice(s.id));
    setSlotId(first?.id ?? '');
    setSubId('');
  };

  return (
    <section
      aria-label="Catat cuti atau pengganti"
      className="flex flex-col gap-3 rounded-card border border-white/95 bg-card-header p-4 shadow-card"
    >
      <span className="font-semibold">Catat cuti atau pengganti</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
          Dokter
          <select value={doctorId} onChange={(e) => pickDoctor(e.target.value)} className={selectClass}>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
          Hari praktik
          <select value={slotId} onChange={(e) => setSlotId(e.target.value)} className={selectClass}>
            {practice.length === 0 && <option value="">Tidak ada slot praktik</option>}
            {practice.map((s) => (
              <option key={s.id} value={s.id}>
                {dayLong(s.date)} · {s.start}–{s.end}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
          Dokter pengganti
          <select value={subId} onChange={(e) => setSubId(e.target.value)} className={selectClass}>
            <option value="">Tanpa pengganti · pasien dijadwal ulang</option>
            {subs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {withReason && (
        <label className="flex flex-col gap-1 text-small font-semibold text-ink-700">
          Alasan cuti
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder="Mis. seminar nasional, sakit"
            className="h-11 w-full rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small text-ink-900"
          />
          <span className="text-caption font-normal text-ink-500">
            Minimal 5 karakter. Cuti per tanggal juga perlu dicatat di aplikasi HFIS.
          </span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={!validSlot || !reasonOk || busy}
          onClick={() => onSubmit(slotId, subId || null, reason.trim())}
        >
          Catat cuti
        </Button>
        <Button onClick={onCancel}>Batal</Button>
        {!validSlot && (
          <span className="text-caption text-ink-700">Dokter ini tidak punya slot praktik lagi.</span>
        )}
      </div>
    </section>
  );
}
