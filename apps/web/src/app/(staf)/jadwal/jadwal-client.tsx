'use client';

import { formatJam, type ScheduleDoctor, type ScheduleSlot, type WeeklySchedule } from '@simrs/shared';
import { Alert, Button, cx } from '@simrs/ui';
import { useMemo, useState } from 'react';
import { HfisPanel, LeaveImpact } from '@/components/front-office/hfis-panel';
import { LeaveForm } from '@/components/front-office/leave-form';
import { ScheduleGrid, type ScheduleGridRow, ScheduleLegend } from '@/components/front-office/schedule-grid';
import { SlotDetail, type SlotDetailView } from '@/components/front-office/slot-detail';
import { useStoreAction } from '@/lib/demo/store/client';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { adjustQuota, dayLong, dayShort, type QuotaPool, slotCell } from '@/lib/front-office';
import {
  approveLeaveTransferAction,
  changeQuotaAction,
  recordLeaveAction,
  sendScheduleToHfisAction,
} from './actions-demo';

interface SlotRef {
  slot: ScheduleSlot;
  doctor: ScheduleDoctor;
}

/** Keadaan toko demo `jadwal` yang tampak di layar (dihitung server). */
export interface ScheduleStoreView {
  rev: number;
  /** Slot dengan kuota RS berbeda dari HFIS (belum dikirim). */
  dirty: string[];
  /** Cuti yang belum dikirim ke HFIS. */
  unsynced: string[];
  /** Jam kiriman HFIS terakhir dari layar ini, null bila belum. */
  syncJam: string | null;
  /** Pengalihan pasien cuti yang sudah disetujui, per slot cuti. */
  transfers: Record<string, { jam: string; by: string; patients: number; substituteName: string }>;
}

const selectClass =
  'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small text-ink-900';

/**
 * F01 · Jadwal praktik mingguan (mockup Jadwal): filter, grid, detail kuota, sinkron HFIS, dampak cuti. Kuota, cuti,
 * pengalihan pasien, dan kiriman HFIS tersimpan di toko demo bersama (domain `jadwal`) atas nama pengguna sesi dan
 * langsung berlaku di meja pendaftaran, anjungan, dan info publik; booking dari pendaftaran ikut terhitung.
 */
export function JadwalClient({
  schedule,
  initialSlot,
  store,
}: {
  schedule: WeeklySchedule;
  initialSlot: string | null;
  store: ScheduleStoreView;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const slots = useMemo(
    () =>
      new Map<string, SlotRef>(
        schedule.doctors.flatMap((doctor) =>
          doctor.slots.map((slot) => [slot.id, { slot, doctor }] as const),
        ),
      ),
    [schedule],
  );
  const [poli, setPoli] = useState('all');
  const [day, setDay] = useState('all');
  const [sel, setSel] = useState<string | null>(initialSlot && slots.has(initialSlot) ? initialSlot : null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const { run, pending: busy } = useStoreAction(store.rev);
  const jam = () => formatJam(demoNow());
  const feedback = (r: { ok: boolean; message: string; stale?: boolean }) =>
    setNotice({ ok: r.ok, text: r.stale ? `${r.message} Ulangi aksi.` : r.message });

  const syncAt = store.syncJam ?? (schedule.hfis.lastSyncAt ? formatJam(schedule.hfis.lastSyncAt) : '—');
  const hfisPending = schedule.hfis.differences.length + store.unsynced.length;
  const pendingN = hfisPending + store.dirty.length;

  const select = (id: string | null) => {
    setSel(id);
    try {
      window.history.replaceState(
        null,
        '',
        id ? `?pilih=${encodeURIComponent(id)}` : window.location.pathname,
      );
    } catch {
      // tanpa History API: pilihan tetap di layar
    }
  };

  const record = (slotId: string, substituteId: string | null, reason: string) =>
    run(
      (r) => recordLeaveAction({ slotId, substituteId, reason, rev: r, jam: jam() }),
      (res) => {
        feedback(res);
        if (!res.ok) return;
        setFormOpen(false);
        select(slotId);
      },
    );

  const adjust = (pool: QuotaPool, delta: number) => {
    const r = sel ? slots.get(sel) : undefined;
    const q = r?.slot.kind === 'praktik' ? r.slot.quota : null;
    if (!r || !q) return;
    const next = adjustQuota(q, pool, delta);
    if (!next) return;
    run(
      (rev) => changeQuotaAction({ slotId: r.slot.id, jkn: next.jkn, nonJkn: next.nonJkn, rev, jam: jam() }),
      (res) => (res.ok ? setNotice(null) : feedback(res)),
    );
  };

  const sync = () => run((r) => sendScheduleToHfisAction({ rev: r, jam: jam() }), feedback);

  const leaves = schedule.doctors.flatMap((doctor) =>
    doctor.slots.filter((s) => s.kind === 'cuti' && s.relatedDoctorId).map((slot) => ({ slot, doctor })),
  );
  const approve = (slotId: string) =>
    run(
      (r) => approveLeaveTransferAction({ slotId, rev: r, jam: jam() }),
      (res) => !res.ok && feedback(res),
    );

  const poliNames = [...new Set(schedule.doctors.map((d) => d.poliName))];
  const dayIdx = day === 'all' ? schedule.days.map((_, i) => i) : [schedule.days.indexOf(day)];
  const rows: ScheduleGridRow[] = schedule.doctors
    .filter((d) => poli === 'all' || d.poliName === poli)
    .filter((d) => day === 'all' || d.slots[dayIdx[0] ?? 0]?.kind !== 'libur')
    .map((doctor) => ({
      doctorId: doctor.id,
      doctorName: doctor.name,
      poliName: doctor.poliName,
      cells: dayIdx.flatMap((i) => {
        const slot = doctor.slots[i];
        if (!slot) return [];
        const v = slotCell(slot, slot.quota, slot.hfisSynced);
        const aria = `${doctor.name}, ${dayLong(slot.date)}, ${v.time}, ${v.note}, ${v.status}`;
        return [{ ...v, slotId: slot.id, aria }];
      }),
    }));

  const nameOf = (id: string | null) => schedule.doctors.find((d) => d.id === id)?.name ?? '';
  const selRef = sel ? slots.get(sel) : undefined;
  let detail: SlotDetailView | null = null;
  if (selRef) {
    const { slot, doctor } = selRef;
    const q = slot.kind === 'praktik' ? slot.quota : null;
    const v = slotCell(slot, q, slot.hfisSynced);
    const text =
      slot.kind === 'cuti'
        ? `Dokter cuti. ${slot.affectedPatients ?? 0} pasien yang sudah booking perlu dialihkan atau dijadwal ulang.${
            slot.relatedDoctorId ? ` Pengganti: ${nameOf(slot.relatedDoctorId)}.` : ''
          }`
        : slot.kind === 'pengganti'
          ? `Menggantikan ${nameOf(slot.relatedDoctorId)}. Kuota mengikuti slot dokter yang digantikan.`
          : 'Tidak ada jadwal praktik di hari ini. Tambahkan lewat Catat cuti atau pengganti.';
    detail = {
      slotId: slot.id,
      doctorName: doctor.name,
      poliName: doctor.poliName,
      day: dayLong(slot.date),
      time: v.time === '—' ? 'tanpa jam' : v.time,
      kind: v.kind,
      status: v.status,
      quota: q,
      text,
      dirty: store.dirty.includes(slot.id),
    };
  }

  const first = leaves[0];
  const firstDay = first ? (dayLong(first.slot.date).split(' ')[0] ?? '') : '';
  const leaveText = store.unsynced.flatMap((id) => {
    const r = slots.get(id);
    return r ? [`Cuti ${r.doctor.name} ${dayLong(r.slot.date)} belum dikirim ke HFIS.`] : [];
  });
  const quotaText = !store.dirty.length
    ? ''
    : schedule.hfis.differences.length
      ? `Ditambah ${store.dirty.length} perubahan kuota yang belum dikirim.`
      : `${store.dirty.length} perubahan kuota di jadwal RS belum dikirim ke HFIS. Mobile JKN masih memakai kuota lama.`;
  const diffText = [schedule.hfis.differences.map((d) => d.text).join(' '), ...leaveText, quotaText]
    .filter(Boolean)
    .join(' ');
  const firstDate = schedule.days[0] ?? '';
  const last = schedule.days.at(-1) ?? '';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">Front office / Jadwal dokter</span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">
            Jadwal praktik · {dayShort(firstDate).split(' ')[1]}–{dayLong(last).split(' ').slice(1).join(' ')}{' '}
            {last.slice(0, 4)}
          </h1>
        </div>
        <div className="flex flex-wrap items-end gap-2.5">
          <span
            role="status"
            className={cx(
              'inline-flex h-11 items-center gap-2 rounded-full px-3.5 text-small font-semibold',
              pendingN ? 'bg-kunyit-100 text-kunyit-800' : 'bg-zamrud-100 text-zamrud-700',
            )}
          >
            <span
              aria-hidden="true"
              className={cx('size-2 rounded-full', pendingN ? 'bg-kunyit-600' : 'bg-zamrud-600')}
            />
            {pendingN ? `Sinkron HFIS ${syncAt} · ${pendingN} perbedaan` : `Tersinkron HFIS ${syncAt}`}
          </span>
          <label className="flex flex-col gap-1 text-caption font-semibold text-ink-700">
            Poli
            <select value={poli} onChange={(e) => setPoli(e.target.value)} className={selectClass}>
              <option value="all">Semua poli ({poliNames.length})</option>
              {poliNames.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-caption font-semibold text-ink-700">
            Hari
            <select value={day} onChange={(e) => setDay(e.target.value)} className={selectClass}>
              <option value="all">Semua hari</option>
              {schedule.days.map((d) => (
                <option key={d} value={d}>
                  {dayLong(d)}
                </option>
              ))}
            </select>
          </label>
          <Button aria-expanded={formOpen} onClick={() => setFormOpen((o) => !o)}>
            + Catat cuti atau pengganti
          </Button>
        </div>
      </header>

      {formOpen && (
        <LeaveForm
          doctors={schedule.doctors}
          isPractice={(id) => slots.get(id)?.slot.kind === 'praktik'}
          busy={busy}
          withReason
          onSubmit={record}
          onCancel={() => setFormOpen(false)}
        />
      )}

      {notice && (
        <Alert level={notice.ok ? 'success' : 'critical'} title={notice.ok ? 'Berhasil' : 'Gagal'}>
          {notice.text}
        </Alert>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <ScheduleGrid
          days={dayIdx.map((i) => dayShort(schedule.days[i] ?? ''))}
          rows={rows}
          selected={sel}
          onSelect={select}
        />
        <aside
          aria-label="Ringkasan dan perbedaan"
          className="flex min-w-0 max-w-full flex-[1_1_300px] flex-col gap-4 xl:max-w-[340px]"
        >
          {detail && <SlotDetail view={detail} busy={busy} onClose={() => select(null)} onAdjust={adjust} />}
          <HfisPanel
            pending={pendingN > 0}
            diffText={diffText}
            inSyncText={`Jadwal RS dan HFIS sama per pukul ${syncAt}.${
              first
                ? ` Cuti ${first.doctor.name} ${firstDay} sudah tercatat, slot tidak bisa dibooking di Mobile JKN.`
                : ''
            }`}
            busy={busy}
            onSync={sync}
          />
          <ScheduleLegend />
          {leaves.map(({ slot, doctor }) => {
            const cover = schedule.doctors
              .flatMap((d) => d.slots)
              .find((s) => s.kind === 'pengganti' && s.date === slot.date && s.relatedDoctorId === doctor.id);
            const t = store.transfers[slot.id];
            return (
              <LeaveImpact
                key={slot.id}
                dayName={dayLong(slot.date).split(' ')[0] ?? ''}
                doctorName={doctor.name}
                substituteName={nameOf(slot.relatedDoctorId)}
                time={cover?.start && cover.end ? `${cover.start}–${cover.end}` : ''}
                patients={slot.affectedPatients ?? 0}
                approved={
                  t
                    ? `${t.patients} pasien dialihkan ke ${t.substituteName}; notifikasi WhatsApp terkirim · ${t.jam} oleh ${t.by}`
                    : null
                }
                busy={busy}
                onApprove={() => approve(slot.id)}
              />
            );
          })}
        </aside>
      </div>
    </div>
  );
}
