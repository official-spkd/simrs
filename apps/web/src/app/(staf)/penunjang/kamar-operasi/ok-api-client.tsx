'use client';

import { formatJam, formatTanggal, formatTanggalLahir, type SurgeryBoard } from '@simrs/shared';
import { Alert, Button, Chip, PatientBanner } from '@simrs/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { OkGantt } from '@/components/penunjang/ok-gantt';
import { API_STATUS_LABEL, ganttRooms } from '@/lib/penunjang-ok-api';
import {
  CancelPanel,
  ChecklistPanel,
  CountPanel,
  EventPanel,
  type Msg,
  ReportPanel,
  ScheduleForm,
  SuppliesPanel,
} from './ok-api-panels';

export interface OkPermissions {
  schedule: boolean;
  checklist: boolean;
  count: boolean;
  report: boolean;
  override: boolean;
}

const SEX_SHORT = { male: 'L', female: 'P' } as const;

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00+07:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * S06 · Kamar operasi mode api (4.7): papan Gantt 4 kamar (komponen sama dengan mode presentasi), kasus terpilih dengan
 * daftar tilik WHO, peristiwa, hitung kasa, BHP, laporan operasi ber-TTE, dan daftar tunggu. Setiap aksi lewat Server
 * Action; papan dimuat ulang dari server sesudahnya.
 */
export function OkApiClient({
  tenantName,
  board,
  initialCaseId,
  perms,
  userId,
  staff,
  supplies,
}: {
  tenantName: string;
  board: SurgeryBoard;
  initialCaseId: string | null;
  perms: OkPermissions;
  userId: string;
  staff: Array<{ userId: string; name: string; role: string }>;
  supplies: Array<{
    stockBatchId: string;
    name: string;
    batchNo: string;
    expiryDate: string;
    quantity: number;
  }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const cases = board.rooms.flatMap((r) => r.cases.map((c) => ({ room: r, c })));
  const [selectedId, setSelectedId] = useState<string | null>(initialCaseId);
  const [scheduling, setScheduling] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const sel = cases.find((x) => x.c.id === selectedId) ?? cases[0] ?? null;
  const nowMin = Math.round(
    (Date.parse(board.serverNow) - Date.parse(`${board.date}T00:00:00+07:00`)) / 60_000,
  );
  const go = (date: string) => router.push(`${pathname}?tanggal=${date}`);
  const done = (m: Msg) => {
    setMsg(m);
    router.refresh();
  };
  const stats = [
    { label: 'Utilisasi', value: `${board.stats.utilizationPercent}%` },
    {
      label: 'On-time start',
      value: board.stats.onTimeStartPercent === null ? '—' : `${board.stats.onTimeStartPercent}%`,
    },
    { label: 'Pembatalan', value: String(board.stats.cancellations) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Penunjang / Instalasi bedah sentral · {tenantName} ·{' '}
            {formatTanggal(`${board.date}T12:00:00+07:00`)}
          </span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Kamar operasi · jadwal dan keselamatan</h1>
        </div>
        <dl className="m-0 flex flex-wrap gap-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex items-baseline gap-1.5 rounded-full border border-white/95 bg-white/90 px-3 py-1.5 text-small shadow-[0_2px_8px_rgba(23,32,46,0.06)]"
            >
              <dt className="text-ink-700">{s.label}</dt>
              <dd className="m-0 font-mono font-semibold">{s.value}</dd>
            </div>
          ))}
        </dl>
      </header>
      <div role="group" aria-label="Tanggal jadwal" className="flex flex-wrap items-end gap-2">
        <Button size="sm" onClick={() => go(shiftDate(board.date, -1))}>
          ‹ Hari sebelumnya
        </Button>
        <label className="flex flex-col gap-1 text-caption font-semibold text-ink-700">
          Tanggal
          <input
            type="date"
            value={board.date}
            onChange={(e) => e.target.value && go(e.target.value)}
            className="h-11 rounded-control border border-line-strong bg-white px-2.5"
          />
        </label>
        <Button size="sm" onClick={() => go(shiftDate(board.date, 1))}>
          Hari berikutnya ›
        </Button>
        {perms.schedule && (
          <Button variant="primary" onClick={() => setScheduling(true)} disabled={scheduling}>
            + Jadwalkan operasi
          </Button>
        )}
      </div>
      {scheduling && (
        <ScheduleForm
          date={board.date}
          rooms={board.rooms.map((r) => ({ id: r.id, name: r.name }))}
          staff={staff}
          onCancel={() => setScheduling(false)}
          onDone={(c) => {
            setScheduling(false);
            setSelectedId(c.id);
            done({ ok: true, text: `Operasi ${c.caseNo} dijadwalkan ${formatJam(c.startsAt)}.` });
            if (c.startsAt.slice(0, 10) !== board.date) go(c.startsAt.slice(0, 10));
          }}
        />
      )}
      {msg && (
        <Alert level={msg.ok ? 'success' : 'critical'}>
          <span>{msg.text}</span>
          {msg.reasons && msg.reasons.length > 0 && (
            <ul className="m-0 mt-1 pl-5">
              {msg.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      <OkGantt
        rooms={ganttRooms(board)}
        dayStart={board.dayStartMin}
        dayEnd={board.dayEndMin}
        nowMin={nowMin}
        selectedId={sel?.c.id ?? ''}
        onSelect={(id) => {
          setSelectedId(id);
          setMsg(null);
        }}
      />
      {!sel ? (
        <p className="m-0 rounded-card border border-dashed border-line-strong bg-white/70 p-4 text-small text-ink-500">
          Belum ada operasi terjadwal pada tanggal ini.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
          <section
            aria-label="Daftar tilik keselamatan"
            className="flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 p-4 shadow-card"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="flex min-w-0 flex-col">
                <h2 className="m-0 text-[15px] font-semibold">
                  {sel.room.name} · {sel.c.procedureName}
                </h2>
                <span className="text-small text-ink-700">
                  {sel.c.caseNo} · {formatJam(sel.c.startsAt)}–{formatJam(sel.c.endsAt)} ·{' '}
                  {sel.c.team.map((t) => `${t.name} (${t.role.replace('_', ' ')})`).join(' · ')}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <Chip tone={sel.c.priority === 'cito' ? 'danger' : 'brand'}>
                  {sel.c.priority === 'cito' ? 'Cito' : 'Elektif'}
                </Chip>
                <Chip tone={sel.c.status === 'selesai' ? 'success' : 'neutral'}>
                  {API_STATUS_LABEL[sel.c.status]}
                </Chip>
              </span>
            </div>
            {sel.c.patient.ageYears !== null && sel.c.patient.birthDate && sel.c.patient.sex !== 'unknown' ? (
              <PatientBanner
                name={sel.c.patient.name}
                sex={SEX_SHORT[sel.c.patient.sex]}
                ageYears={sel.c.patient.ageYears}
                birthDate={formatTanggalLahir(sel.c.patient.birthDate)}
                mrn={sel.c.patient.rm}
                allergies={sel.c.patient.allergies}
                guarantor={sel.c.patient.guarantor ?? 'Belum ada penjamin'}
                attending={sel.c.team.find((t) => t.role === 'operator')?.name}
              />
            ) : (
              <p className="m-0 text-small">
                <span className="font-semibold">{sel.c.patient.name}</span> · RM{' '}
                <span className="font-mono">{sel.c.patient.rm}</span> · alergi:{' '}
                {sel.c.patient.allergies.length ? sel.c.patient.allergies.join(', ') : 'tidak ada tercatat'}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Chip tone="info" mono>
                {sel.c.procedureCode
                  ? `ICD-9-CM ${sel.c.procedureCode} · ${sel.c.procedureName}`
                  : 'ICD-9-CM dikode di laporan operasi'}
              </Chip>
            </div>
            <Alert level={sel.c.consent ? 'success' : 'critical'}>
              {sel.c.consent
                ? `Persetujuan tindakan "${sel.c.consent.procedure}" final ber-TTE · ${formatJam(sel.c.consent.decidedAt)}. Butir persetujuan sign in diisi sistem.`
                : 'Persetujuan tindakan bertanda tangan belum ada (atau dicabut). Sign in dan time out tertahan sampai persetujuan final di tablet persetujuan.'}
            </Alert>
            <ChecklistPanel key={`${sel.c.id}-cl`} c={sel.c} canWrite={perms.checklist} onDone={done} />
          </section>
          <div className="flex min-w-0 flex-col gap-4">
            <EventPanel
              key={`${sel.c.id}-ev`}
              c={sel.c}
              canWrite={perms.checklist}
              canOverride={perms.override}
              onDone={done}
            />
            <CountPanel key={`${sel.c.id}-ct`} c={sel.c} canWrite={perms.count} onDone={done} />
            <SuppliesPanel
              key={`${sel.c.id}-bhp`}
              c={sel.c}
              options={supplies}
              canWrite={perms.checklist}
              onDone={done}
            />
            <ReportPanel
              key={`${sel.c.id}-rep`}
              c={sel.c}
              isOperator={
                perms.report && sel.c.team.some((t) => t.userId === userId && t.role === 'operator')
              }
              onDone={done}
            />
            {perms.schedule && <CancelPanel key={`${sel.c.id}-x`} c={sel.c} onDone={done} />}
          </div>
        </div>
      )}
      <section
        aria-label="Daftar tunggu operasi"
        className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 p-4 shadow-card"
      >
        <h2 className="m-0 text-body font-semibold">Daftar tunggu (14 hari)</h2>
        {board.waitlist.length === 0 ? (
          <p className="m-0 text-small text-ink-500">Tidak ada operasi terjadwal di 14 hari ke depan.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-small">
            {board.waitlist.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => go(w.startsAt.slice(0, 10))}
                  className="min-h-11 cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] text-ink-900 underline-offset-2 hover:underline"
                >
                  {formatTanggal(w.startsAt)} {formatJam(w.startsAt)} · {w.roomName} · {w.patientName} ·{' '}
                  {w.procedureName}
                  {w.priority === 'cito' ? ' · cito' : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
