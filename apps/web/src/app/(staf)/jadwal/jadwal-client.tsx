'use client';

import {
  formatJam,
  type ScheduleDoctor,
  type ScheduleSlot,
  type SlotQuota,
  type WeeklySchedule,
} from '@simrs/shared';
import { Alert, Button, cx } from '@simrs/ui';
import { useMemo, useState, useTransition } from 'react';
import { HfisPanel, LeaveImpact } from '@/components/front-office/hfis-panel';
import { LeaveForm } from '@/components/front-office/leave-form';
import { ScheduleGrid, type ScheduleGridRow, ScheduleLegend } from '@/components/front-office/schedule-grid';
import { SlotDetail, type SlotDetailView } from '@/components/front-office/slot-detail';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { adjustQuota, dayLong, dayShort, type QuotaPool, slotCell } from '@/lib/front-office';
import { approveLeaveTransferAction, recordLeaveAction, sendScheduleToHfisAction } from './actions-demo';

interface SlotRef {
  slot: ScheduleSlot;
  doctor: ScheduleDoctor;
}

const sameQuota = (a: SlotQuota, b: SlotQuota) => a.jkn === b.jkn && a.nonJkn === b.nonJkn;

interface LocalLeave {
  substituteId: string | null;
  synced: boolean;
}

/** Jadwal dengan cuti yang dicatat di layar ini: slot praktik menjadi cuti, pasien booking menjadi terdampak. */
function withLeaves(schedule: WeeklySchedule, leaves: Record<string, LocalLeave>): WeeklySchedule {
  if (Object.keys(leaves).length === 0) return schedule;
  return {
    ...schedule,
    doctors: schedule.doctors.map((d) => ({
      ...d,
      slots: d.slots.map((s): ScheduleSlot => {
        const l = leaves[s.id];
        if (!l || !s.quota) return s;
        return {
          ...s,
          kind: 'cuti',
          start: null,
          end: null,
          quota: null,
          relatedDoctorId: l.substituteId,
          affectedPatients: s.quota.bookedJkn + s.quota.bookedNonJkn,
          hfisSynced: l.synced,
        };
      }),
    })),
  };
}

const selectClass =
  'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small text-ink-900';

/** F01 · Jadwal praktik mingguan (mockup Jadwal): filter, grid, detail kuota, sinkron HFIS, dampak cuti. */
export function JadwalClient({
  schedule: base,
  initialSlot,
}: {
  schedule: WeeklySchedule;
  initialSlot: string | null;
}) {
  /** Cuti yang dicatat di layar ini (simulasi), per slot; `synced` setelah dikirim ke HFIS. */
  const [leaves, setLeaves] = useState<Record<string, LocalLeave>>({});
  const [formOpen, setFormOpen] = useState(false);
  const schedule = useMemo(() => withLeaves(base, leaves), [base, leaves]);
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
  /** Kuota yang diubah petugas di layar ini, dan kuota terakhir yang sudah terkirim ke HFIS. */
  const [quotas, setQuotas] = useState<Record<string, SlotQuota>>({});
  const [sent, setSent] = useState<Record<string, SlotQuota>>({});
  const [synced, setSynced] = useState(false);
  const [syncAt, setSyncAt] = useState(schedule.hfis.lastSyncAt ? formatJam(schedule.hfis.lastSyncAt) : '—');
  const [approved, setApproved] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, startTransition] = useTransition();

  const quotaOf = (r: SlotRef) => (r.slot.kind === 'praktik' ? (quotas[r.slot.id] ?? r.slot.quota) : null);
  const dirty = Object.keys(quotas).filter((id) => {
    const base = sent[id] ?? slots.get(id)?.slot.quota;
    const cur = quotas[id];
    return !!cur && !!base && !sameQuota(cur, base);
  });
  const newLeaves = Object.entries(leaves)
    .filter(([, l]) => !l.synced)
    .map(([id]) => id);
  const hfisPending = (synced ? 0 : schedule.hfis.differences.length) + newLeaves.length;
  const pendingN = hfisPending + dirty.length;
  const isSynced = (s: ScheduleSlot) => s.hfisSynced || (synced && !leaves[s.id]);

  const record = (slotId: string, substituteId: string | null) =>
    startTransition(async () => {
      const r = await recordLeaveAction({ slotId, substituteId });
      setNotice({ ok: r.ok, text: r.message });
      if (!r.ok) return;
      setLeaves((cur) => ({ ...cur, [slotId]: { substituteId, synced: false } }));
      setFormOpen(false);
      select(slotId);
    });

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

  const adjust = (pool: QuotaPool, delta: number) => {
    const r = sel ? slots.get(sel) : undefined;
    const q = r ? quotaOf(r) : null;
    if (!r || !q) return;
    const next = adjustQuota(q, pool, delta);
    if (next) setQuotas((cur) => ({ ...cur, [r.slot.id]: next }));
  };

  const sync = () =>
    startTransition(async () => {
      const changes = dirty.flatMap((id) => {
        const q = quotas[id];
        return q ? [{ slotId: id, jkn: q.jkn, nonJkn: q.nonJkn }] : [];
      });
      const r = await sendScheduleToHfisAction(changes);
      setNotice({ ok: r.ok, text: r.message });
      if (!r.ok) return;
      setSynced(true);
      setSent((cur) => ({ ...cur, ...quotas }));
      setLeaves((cur) =>
        Object.fromEntries(Object.entries(cur).map(([id, l]) => [id, { ...l, synced: true }])),
      );
      // Jam sinkron terakhir adalah catatan jadwal: ikut jam hari demo (setelah 07.30 HFIS pagi ini).
      setSyncAt(formatJam(demoNow()));
    });

  const leave = base.doctors.flatMap((doctor) =>
    doctor.slots.filter((s) => s.kind === 'cuti').map((slot) => ({ slot, doctor })),
  )[0];
  const approve = () =>
    startTransition(async () => {
      if (!leave) return;
      const r = await approveLeaveTransferAction(leave.slot.id);
      if (r.ok) setApproved(r.message);
      else setNotice({ ok: false, text: r.message });
    });

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
        const v = slotCell(slot, quotas[slot.id] ?? slot.quota, isSynced(slot));
        const aria = `${doctor.name}, ${dayLong(slot.date)}, ${v.time}, ${v.note}, ${v.status}`;
        return [{ ...v, slotId: slot.id, aria }];
      }),
    }));

  const nameOf = (id: string | null) => schedule.doctors.find((d) => d.id === id)?.name ?? '';
  const selRef = sel ? slots.get(sel) : undefined;
  let detail: SlotDetailView | null = null;
  if (selRef) {
    const { slot, doctor } = selRef;
    const q = quotaOf(selRef);
    const v = slotCell(slot, q, isSynced(slot));
    const text =
      slot.kind === 'cuti'
        ? `Dokter cuti. ${slot.affectedPatients ?? 0} pasien yang sudah booking perlu dialihkan atau dijadwal ulang.${
            slot.relatedDoctorId ? ` Pengganti: ${nameOf(slot.relatedDoctorId)}.` : ''
          }`
        : slot.kind === 'pengganti'
          ? `Menggantikan ${nameOf(slot.relatedDoctorId)}. Kuota mengikuti slot dokter yang digantikan.`
          : 'Tidak ada jadwal praktik di hari ini.';
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
      dirty: dirty.includes(slot.id),
    };
  }

  const bagus = leave ? leave.doctor.name : '';
  const cover = leave
    ? schedule.doctors
        .flatMap((d) => d.slots)
        .find(
          (s) =>
            s.kind === 'pengganti' && s.date === leave.slot.date && s.relatedDoctorId === leave.doctor.id,
        )
    : undefined;
  const leaveDay = leave ? (dayLong(leave.slot.date).split(' ')[0] ?? '') : '';
  const leaveText = newLeaves.flatMap((id) => {
    const r = slots.get(id);
    return r ? [`Cuti ${r.doctor.name} ${dayLong(r.slot.date)} belum dikirim ke HFIS.`] : [];
  });
  const quotaText = !dirty.length
    ? ''
    : !synced
      ? `Ditambah ${dirty.length} perubahan kuota yang belum dikirim.`
      : `${dirty.length} perubahan kuota di jadwal RS belum dikirim ke HFIS. Mobile JKN masih memakai kuota lama.`;
  const diffText = [
    synced ? '' : schedule.hfis.differences.map((d) => d.text).join(' '),
    ...leaveText,
    quotaText,
  ]
    .filter(Boolean)
    .join(' ');
  const first = schedule.days[0] ?? '';
  const last = schedule.days.at(-1) ?? '';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">Front office / Jadwal dokter</span>
          <h1 className="m-0 text-h1 font-semibold">
            Jadwal praktik · {dayShort(first).split(' ')[1]}–{dayLong(last).split(' ').slice(1).join(' ')}{' '}
            {last.slice(0, 4)}
          </h1>
        </div>
        <div className="flex flex-wrap items-end gap-2.5">
          <span
            role="status"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-white px-3 text-small text-ink-700"
          >
            <span
              aria-hidden="true"
              className={cx('size-2 rounded-full', pendingN ? 'bg-[#D97706]' : 'bg-[#16A34A]')}
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
          {detail && <SlotDetail view={detail} onClose={() => select(null)} onAdjust={adjust} />}
          <HfisPanel
            pending={pendingN > 0}
            diffText={diffText}
            inSyncText={`Jadwal RS dan HFIS sama per pukul ${syncAt}. Cuti ${bagus} ${leaveDay} sudah tercatat, slot tidak bisa dibooking di Mobile JKN.`}
            busy={busy}
            onSync={sync}
          />
          <ScheduleLegend />
          {leave && (
            <LeaveImpact
              dayName={leaveDay}
              doctorName={bagus}
              substituteName={nameOf(leave.slot.relatedDoctorId)}
              time={cover?.start && cover.end ? `${cover.start}–${cover.end}` : ''}
              patients={leave.slot.affectedPatients ?? 0}
              approved={approved}
              busy={busy}
              onApprove={approve}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
