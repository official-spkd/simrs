'use client';

import type { ScheduleDoctor, ScheduleSlot, SlotQuota, WeeklySchedule } from '@simrs/shared';
import { Alert, Button, cx } from '@simrs/ui';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { HfisPanel, LeaveImpact } from '@/components/front-office/hfis-panel';
import { LeaveForm } from '@/components/front-office/leave-form';
import { ScheduleGrid, type ScheduleGridRow, ScheduleLegend } from '@/components/front-office/schedule-grid';
import { SlotDetail, type SlotDetailView } from '@/components/front-office/slot-detail';
import { adjustQuota, dayLong, dayShort, type QuotaPool, slotCell } from '@/lib/front-office';
import {
  addDaysIso,
  hfisSummary,
  leaveTransferNote,
  leavesWithPatients,
  quotaEquals,
} from '@/lib/jadwal-api';
import {
  type JadwalApiResult,
  pullHfisAction,
  pushHfisAction,
  recordLeaveApiAction,
  saveQuotaAction,
  transferToSubstituteAction,
} from './actions-api';

interface SlotRef {
  slot: ScheduleSlot;
  doctor: ScheduleDoctor;
}

const selectClass =
  'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small text-ink-900';

/**
 * F01 · Jadwal praktik mingguan mode api (mockup Jadwal): data dari `/api/v1/scheduling/week`, kuota disimpan per sesi
 * (berversi), cuti dengan alasan, pengalihan ke pengganti, kirim/tarik HFIS lewat outbox. Komponen grid, detail slot,
 * panel HFIS, dan formulir cuti dipakai bersama dengan jalur demo.
 */
export function JadwalApiClient({
  schedule,
  today,
  initialSlot,
  canWrite,
  canSync,
}: {
  schedule: WeeklySchedule;
  today: string;
  initialSlot: string | null;
  canWrite: boolean;
  canSync: boolean;
}) {
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
  /** Kuota yang sedang diubah (belum disimpan), per sel; berlaku untuk versi sesi saat itu saja. */
  const [drafts, setDrafts] = useState<Record<string, { quota: SlotQuota; updatedAt?: string }>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [approved, setApproved] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const summary = hfisSummary(schedule);

  const draftOf = (r: SlotRef) => {
    const d = drafts[r.slot.id];
    return d && d.updatedAt === r.slot.updatedAt ? d.quota : null;
  };
  const quotaOf = (r: SlotRef) => (r.slot.kind === 'praktik' ? (draftOf(r) ?? r.slot.quota) : null);

  const run = (fn: () => Promise<JadwalApiResult>, after?: (r: JadwalApiResult) => void) =>
    startTransition(async () => {
      const r = await fn();
      setNotice({ ok: r.ok, text: r.message });
      if (r.ok) after?.(r);
    });

  const select = (id: string | null) => {
    setSel(id);
    try {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}?minggu=${schedule.weekStart}${id ? `&pilih=${encodeURIComponent(id)}` : ''}`,
      );
    } catch {
      // tanpa History API: pilihan tetap di layar
    }
  };

  const adjust = (pool: QuotaPool, delta: number) => {
    const r = sel ? slots.get(sel) : undefined;
    const q = r ? quotaOf(r) : null;
    if (!r || !q || !canWrite) return;
    const next = adjustQuota(q, pool, delta);
    if (next) setDrafts((cur) => ({ ...cur, [r.slot.id]: { quota: next, updatedAt: r.slot.updatedAt } }));
  };

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
        const v = slotCell(slot, quotaOf({ slot, doctor }), slot.hfisSynced);
        const aria = `${doctor.name}, ${dayLong(slot.date)}, ${v.time}, ${v.note}, ${v.status}`;
        return [{ ...v, slotId: slot.id, aria }];
      }),
    }));

  const nameOf = (id: string | null) => schedule.doctors.find((d) => d.id === id)?.name ?? '';
  const selRef = sel ? slots.get(sel) : undefined;
  let detail: SlotDetailView | null = null;
  let draft: SlotQuota | null = null;
  if (selRef) {
    const { slot, doctor } = selRef;
    const q = quotaOf(selRef);
    draft = draftOf(selRef);
    const v = slotCell(slot, q, slot.hfisSynced);
    const text =
      slot.kind === 'cuti'
        ? `Dokter cuti. ${slot.affectedPatients ?? 0} pasien yang sudah booking perlu dialihkan atau dijadwal ulang.${
            slot.relatedDoctorId ? ` Pengganti: ${nameOf(slot.relatedDoctorId)}.` : ''
          }`
        : slot.kind === 'pengganti'
          ? `Menggantikan ${nameOf(slot.relatedDoctorId)}. Kuota mengikuti slot dokter yang digantikan.`
          : `Tidak ada jadwal praktik di hari ini.${canWrite ? ' Tambahkan lewat Catat cuti atau pengganti.' : ''}`;
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
      dirty: false,
    };
  }
  const changed = !!(selRef && draft && !quotaEquals(draft, selRef.slot.quota));
  const saveQuota = () => {
    if (!selRef?.slot.sessionId || !draft) return;
    const slotId = selRef.slot.id;
    run(
      () =>
        saveQuotaAction({
          sessionId: selRef.slot.sessionId,
          quotaJkn: draft.jkn,
          quotaNonJkn: draft.nonJkn,
          ...(selRef.slot.updatedAt ? { baseUpdatedAt: selRef.slot.updatedAt } : {}),
        }),
      () =>
        setDrafts((cur) => {
          const { [slotId]: _done, ...rest } = cur;
          return rest;
        }),
    );
  };

  const recordLeave = (slotId: string, substituteId: string | null, reason: string) => {
    const sessionId = slots.get(slotId)?.slot.sessionId;
    if (!sessionId) return;
    run(
      // Baris "(sesi 2)" dokter yang sama ber-ID `<praktisi>~2`: API butuh ID praktisi.
      () => recordLeaveApiAction({ sessionId, substituteId: substituteId?.split('~')[0] ?? null, reason }),
      () => {
        setFormOpen(false);
        select(slotId);
      },
    );
  };

  // Cuti yang belum dialihkan didahulukan; yang sudah dialihkan tetap tampil sebagai "sudah dialihkan".
  const leave = leavesWithPatients(schedule).find((l) => l.substitute && l.slot.sessionId);
  const cover = leave
    ? schedule.doctors
        .flatMap((d) => d.slots)
        .find((s) => s.kind === 'pengganti' && s.sessionId === leave.slot.sessionId)
    : undefined;
  const transferred = leave?.substitute ? leaveTransferNote(leave.slot, leave.substitute.name) : null;
  const leaveDay = leave ? (dayLong(leave.slot.date).split(' ')[0] ?? '') : '';

  const first = schedule.days[0] ?? '';
  const last = schedule.days.at(-1) ?? '';
  const hfisText = [
    summary.text,
    summary.needsHfisApp
      ? 'Cuti/libur per tanggal dan kapasitas tidak bisa dikirim lewat web service: catat di aplikasi HFIS, lalu tarik ulang.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">Front office / Jadwal dokter</span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">
            Jadwal praktik · {dayShort(first).split(' ')[1]}–{dayLong(last).split(' ').slice(1).join(' ')}{' '}
            {last.slice(0, 4)}
          </h1>
          <nav aria-label="Pilih minggu" className="flex gap-3 text-small">
            <Link href={`/jadwal?minggu=${addDaysIso(schedule.weekStart, -7)}`}>← Minggu sebelumnya</Link>
            <Link href="/jadwal">Minggu ini</Link>
            <Link href={`/jadwal?minggu=${addDaysIso(schedule.weekStart, 7)}`}>Minggu berikutnya →</Link>
          </nav>
        </div>
        <div className="flex flex-wrap items-end gap-2.5">
          <span
            role="status"
            className={cx(
              'inline-flex h-11 items-center gap-2 rounded-full px-3.5 text-small font-semibold',
              summary.pending ? 'bg-kunyit-100 text-kunyit-800' : 'bg-zamrud-100 text-zamrud-700',
            )}
          >
            <span
              aria-hidden="true"
              className={cx('size-2 rounded-full', summary.pending ? 'bg-kunyit-600' : 'bg-zamrud-600')}
            />
            {summary.label}
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
          {canSync && (
            <Button disabled={busy} onClick={() => run(pullHfisAction)}>
              Tarik dari HFIS
            </Button>
          )}
          {canWrite && (
            <Button aria-expanded={formOpen} onClick={() => setFormOpen((o) => !o)}>
              + Catat cuti atau pengganti
            </Button>
          )}
        </div>
      </header>

      {formOpen && (
        <LeaveForm
          doctors={schedule.doctors.filter((d) =>
            d.slots.some((s) => s.kind === 'praktik' && s.date >= today),
          )}
          isPractice={(id) => {
            const s = slots.get(id)?.slot;
            return s?.kind === 'praktik' && s.date >= today;
          }}
          busy={busy}
          withReason
          onSubmit={recordLeave}
          onCancel={() => setFormOpen(false)}
        />
      )}

      {notice && (
        <Alert level={notice.ok ? 'success' : 'critical'} title={notice.ok ? 'Berhasil' : 'Gagal'}>
          {notice.text}
        </Alert>
      )}

      {schedule.doctors.length === 0 ? (
        <Alert level="info" title="Belum ada jadwal">
          Belum ada sesi praktik di minggu ini. Sesi dibangkitkan otomatis dari templat jadwal setiap malam.
        </Alert>
      ) : (
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
            {detail && (
              <>
                <SlotDetail view={detail} onClose={() => select(null)} onAdjust={adjust} />
                {changed && canWrite && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="primary" disabled={busy} onClick={saveQuota}>
                      {busy ? 'Menyimpan…' : 'Simpan kuota'}
                    </Button>
                    <Button disabled={busy} onClick={() => setDrafts({})}>
                      Batalkan perubahan
                    </Button>
                  </div>
                )}
              </>
            )}
            <HfisPanel
              pending={summary.pending}
              diffText={hfisText}
              inSyncText={`Jadwal RS dan HFIS sama menurut tarikan HFIS terakhir (${summary.label.replace('Tersinkron HFIS ', 'pukul ')}).`}
              busy={busy}
              canSync={canSync}
              onSync={() => run(pushHfisAction)}
            />
            <ScheduleLegend />
            {leave?.substitute && leave.slot.sessionId && canWrite && (
              <LeaveImpact
                dayName={leaveDay}
                doctorName={leave.doctor.name}
                substituteName={leave.substitute.name}
                time={cover?.start && cover.end ? `${cover.start}–${cover.end}` : ''}
                patients={leave.slot.affectedPatients ?? 0}
                approved={approved ?? transferred}
                busy={busy}
                onApprove={() =>
                  run(
                    () => transferToSubstituteAction(leave.slot.sessionId),
                    (r) => setApproved(r.message),
                  )
                }
              />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
