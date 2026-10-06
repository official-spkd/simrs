'use client';

import { formatJam, formatTanggalLahir } from '@simrs/shared';
import { Alert, Button, Chip, cx, FilterChip, KpiCard, PatientBanner } from '@simrs/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { reportCriticalCenterAction } from '@/app/(staf)/penunjang/hasil-kritis/actions';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import { formatMmSs } from '@/lib/penunjang';
import {
  addMinutesIso,
  applyReports,
  CHANNEL_LABEL,
  complianceMetrics,
  type CriticalItem,
  type CriticalReport,
  criticalState,
  durationMetrics,
  elapsedSecondsAt,
  ESCALATION_TEXT,
  escalationLevel,
  formatPercentId,
  reportMinutes,
  reportedWithinLimit,
  SOURCE_LABEL,
  STATE_VIEW,
} from '@/lib/penunjang-kritis';
import type { CriticalCenter } from '@/lib/server/data/penunjang-lanjut';
import { CriticalReportCenterForm } from './kritis-report-form';
import { useElapsed } from './use-elapsed';

type Filter = 'semua' | 'terbuka' | 'dilaporkan';

/**
 * S09 · Pusat hasil kritis lintas unit: daftar dengan timer batas lapor, detail dengan jenjang eskalasi, pelaporan
 * berpenerima + read-back (gerbang), dan metrik kepatuhan durasi lapor (hari ini dan 7 hari).
 */
export function CriticalCenterView({
  data,
  initialSelected,
  userName,
}: {
  data: CriticalCenter;
  initialSelected: string | null;
  userName: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [local, setLocal] = useState<Record<string, CriticalReport>>({});
  const [filter, setFilter] = useState<Filter>('semua');
  const [selectedId, setSelectedId] = useState(initialSelected ?? data.items[0]?.id ?? null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const items = useMemo(() => applyReports(data.items, local), [data.items, local]);
  const anyOpen = items.some((i) => !i.report);
  const tick = useElapsed(0, anyOpen);
  const elapsed = Object.fromEntries(items.map((i) => [i.id, elapsedSecondsAt(i, data.asOf) + tick]));
  const today = complianceMetrics(items, elapsed);
  const week = durationMetrics(data.history7d, 30);
  const shown = items.filter((i) =>
    filter === 'semua' ? true : filter === 'terbuka' ? !i.report : !!i.report,
  );
  const sel = items.find((i) => i.id === selectedId) ?? null;

  const select = (id: string) => {
    setSelectedId(id);
    setFormOpen(false);
    setError(null);
    setFeedback(null);
    router.replace(`${pathname}?pilih=${id}`, { scroll: false });
  };

  const submit = (
    item: CriticalItem,
    input: Omit<CriticalReport, 'reportedAt' | 'reportedBy' | 'readBackConfirmed'>,
  ) => {
    setError(null);
    startTransition(async () => {
      const r = await reportCriticalCenterAction({ id: item.id, ...input, readBack: true });
      if (!r.ok) return setError(r.message);
      setLocal((cur) => ({
        ...cur,
        [item.id]: {
          ...input,
          reportedBy: userName,
          reportedAt: demoNow().toISOString(),
          readBackConfirmed: true,
        },
      }));
      setFormOpen(false);
      setFeedback(r.message);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Kepatuhan hasil kritis" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Belum dilaporkan"
          value={String(today.open)}
          tone={today.overdue ? 'danger' : today.open ? 'warning' : 'success'}
          hint={
            today.overdue
              ? `${today.overdue} lewat batas 30 menit`
              : today.open
                ? 'timer berjalan, belum lewat batas'
                : 'semua sudah dilaporkan'
          }
        />
        <KpiCard
          label="Dilaporkan ≤ 30 menit (hari ini)"
          value={formatPercentId(today.percent)}
          tone={today.percent !== null && today.percent < 100 ? 'warning' : 'success'}
          hint={`${today.withinLimit} dari ${today.reported} laporan`}
        />
        <KpiCard
          label="Median · p90 durasi lapor"
          value={`${today.medianMinutes ?? '—'} · ${today.p90Minutes ?? '—'} mnt`}
          detail="hari ini, dari hasil terbit sampai read-back"
        />
        <KpiCard
          label="Kepatuhan 7 hari"
          value={formatPercentId(week.percent)}
          tone={week.percent !== null && week.percent < 95 ? 'warning' : 'success'}
          hint={`${week.withinLimit}/${week.total} ≤ 30 mnt · median ${week.medianMinutes} · p90 ${week.p90Minutes} mnt`}
          detail="sasaran ≥ 95% (indikator mutu)"
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <section
          aria-label="Daftar hasil kritis"
          className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-white p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 text-h2 font-semibold">Hasil kritis hari ini</h2>
            <span className="text-caption text-ink-500">semua unit · batas lapor 30 menit</span>
          </div>
          <div role="group" aria-label="Saring status" className="flex flex-wrap gap-2">
            {(
              [
                ['semua', `Semua (${items.length})`],
                ['terbuka', `Belum dilaporkan (${today.open})`],
                ['dilaporkan', `Dilaporkan (${today.reported})`],
              ] as const
            ).map(([id, label]) => (
              <FilterChip key={id} selected={filter === id} onClick={() => setFilter(id)}>
                {label}
              </FilterChip>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="m-0 rounded-control bg-canvas p-4 text-small text-ink-700">
              {filter === 'terbuka'
                ? 'Tidak ada hasil kritis yang menunggu dilaporkan. Semua sudah dibacakan ulang penerimanya.'
                : 'Belum ada hasil kritis pada saringan ini.'}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {shown.map((i) => {
                const e = elapsed[i.id] ?? 0;
                const st = criticalState(i, e);
                const mins = reportMinutes(i);
                return (
                  <li key={i.id}>
                    <button
                      type="button"
                      aria-pressed={i.id === sel?.id}
                      onClick={() => select(i.id)}
                      className={cx(
                        'flex w-full cursor-pointer flex-col gap-1 rounded-[12px] border p-3 text-left font-[inherit]',
                        i.id === sel?.id ? 'border-brand-600 bg-selected' : 'border-line bg-white',
                        st === 'lewat-batas' && i.id !== sel?.id && 'border-danger-border',
                      )}
                    >
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{i.patient.name}</span>
                        <Chip tone={STATE_VIEW[st].tone}>{STATE_VIEW[st].label}</Chip>
                      </span>
                      <span className="text-small text-ink-700">
                        {SOURCE_LABEL[i.source]} · {i.test.split(' · ')[0]}{' '}
                        <span className="font-mono font-semibold text-danger">{i.valueText}</span>
                      </span>
                      <span className="flex flex-wrap gap-x-3 text-caption text-ink-500">
                        <span>{i.location}</span>
                        <span>terbit {formatJam(i.raisedAt)}</span>
                        {i.report ? (
                          <span>
                            dilaporkan {formatJam(i.report.reportedAt)} · {mins} mnt
                          </span>
                        ) : (
                          <span
                            className={cx(
                              'font-mono font-semibold',
                              st === 'lewat-batas' ? 'text-danger' : 'text-warning',
                            )}
                          >
                            {formatMmSs(e)} berjalan
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <details className="text-small text-ink-700">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold text-ink-900">
              Aturan batas kritis aktif
            </summary>
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
              {data.rules.map((r) => (
                <li key={r.test}>
                  {r.test}: {r.rule}
                </li>
              ))}
            </ul>
          </details>
        </section>

        <section
          aria-label="Detail hasil kritis"
          className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-white p-4"
        >
          {sel ? (
            <CriticalDetail
              item={sel}
              elapsed={elapsed[sel.id] ?? 0}
              formOpen={formOpen}
              busy={pending}
              error={error}
              feedback={feedback}
              onOpenForm={() => {
                setFormOpen(true);
                setFeedback(null);
              }}
              onCancel={() => setFormOpen(false)}
              onSubmit={(input) => submit(sel, input)}
            />
          ) : (
            <p className="m-0 text-small text-ink-700">
              Pilih hasil kritis di daftar untuk melihat detail dan melaporkannya.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function CriticalDetail({
  item,
  elapsed,
  formOpen,
  busy,
  error,
  feedback,
  onOpenForm,
  onCancel,
  onSubmit,
}: {
  item: CriticalItem;
  elapsed: number;
  formOpen: boolean;
  busy: boolean;
  error: string | null;
  feedback: string | null;
  onOpenForm: () => void;
  onCancel: () => void;
  onSubmit: (input: Omit<CriticalReport, 'reportedAt' | 'reportedBy' | 'readBackConfirmed'>) => void;
}) {
  const st = criticalState(item, elapsed);
  const level = item.report ? 0 : escalationLevel(elapsed, item.limitMinutes);
  const mins = reportMinutes(item);
  const steps = [
    { label: 'Hasil kritis terbit', at: item.raisedAt, done: true, note: `${item.unit}` },
    {
      label: 'Eskalasi 1 (batas 30 menit)',
      at: addMinutesIso(item.raisedAt, item.limitMinutes),
      done: level >= 1,
      note: 'kepala unit, DPJP, kepala ruangan',
    },
    {
      label: 'Eskalasi 2 (batas + 30 menit)',
      at: addMinutesIso(item.raisedAt, item.limitMinutes + 30),
      done: level >= 2,
      note: 'manajemen dan komite mutu',
    },
  ];
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex flex-col">
          <h2 className="m-0 text-h2 font-semibold">{item.test.split(' · ')[0]}</h2>
          <span className="text-small text-ink-700">{item.test}</span>
        </span>
        <Chip tone={STATE_VIEW[st].tone}>{STATE_VIEW[st].label}</Chip>
      </div>
      <PatientBanner
        name={item.patient.name}
        sex={item.patient.sex}
        ageYears={item.patient.ageYears}
        birthDate={formatTanggalLahir(item.patient.birthDate)}
        mrn={item.patient.rm}
        allergies={item.patient.allergies}
        guarantor={item.patient.guarantor}
        attending={item.dpjp}
      />
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-small">
        <dt className="text-ink-500">Nilai / temuan</dt>
        <dd className="m-0 font-mono font-semibold text-danger">{item.valueText}</dd>
        <dt className="text-ink-500">Batas kritis</dt>
        <dd className="m-0">{item.limitText}</dd>
        <dt className="text-ink-500">Lokasi pasien</dt>
        <dd className="m-0">{item.location}</dd>
        <dt className="text-ink-500">Timer</dt>
        <dd className="m-0">
          {item.report ? (
            <span>
              berhenti saat read-back · {mins} menit{' '}
              {reportedWithinLimit(item) ? '(< batas)' : '(lewat batas)'}
            </span>
          ) : (
            <span
              role="timer"
              aria-live="off"
              className={cx('font-mono font-semibold', st === 'lewat-batas' ? 'text-danger' : 'text-warning')}
            >
              {formatMmSs(elapsed)}
            </span>
          )}
        </dd>
      </dl>

      <ol
        aria-label="Jenjang eskalasi"
        className="m-0 flex list-none flex-col gap-1.5 border-l-2 border-line p-0 pl-3"
      >
        {steps.map((s) => (
          <li key={s.label} className="text-small">
            <span className={cx('font-semibold', s.done ? 'text-ink-900' : 'text-ink-500')}>
              {s.done ? '● ' : '○ '}
              {formatJam(s.at)} · {s.label}
            </span>
            <span className="text-ink-500"> · {s.note}</span>
          </li>
        ))}
        {item.report && (
          <li className="text-small font-semibold text-success">
            ● {formatJam(item.report.reportedAt)} · Dilaporkan ke {item.report.recipient} (
            {item.report.recipientRole}) · {CHANNEL_LABEL[item.report.channel]} · read-back terkonfirmasi ·
            oleh {item.report.reportedBy}
          </li>
        )}
      </ol>

      {level !== 0 && (
        <Alert level="critical">{ESCALATION_TEXT[level]}. Segera laporkan dengan read-back.</Alert>
      )}
      {feedback && <Alert level="success">{feedback}</Alert>}

      {!item.report && item.scenario && (
        <Alert level="info" title="Pasien skenario Simulasi">
          Laporkan dari layar <Link href="/penunjang/lab">Laboratorium</Link> agar alur Simulasi ikut maju.
          Pusat hasil kritis ikut menampilkan statusnya.
        </Alert>
      )}
      {!item.report && !item.scenario && !formOpen && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="danger" onClick={onOpenForm}>
            Catat pelaporan
          </Button>
          <span className="text-small text-ink-700">
            Hasil kritis hanya tertutup lewat laporan berpenerima dengan read-back.
          </span>
        </div>
      )}
      {!item.report && !item.scenario && formOpen && (
        <CriticalReportCenterForm
          item={item}
          busy={busy}
          serverError={error}
          onCancel={onCancel}
          onSubmit={(input) =>
            onSubmit({
              recipient: input.recipient.trim(),
              recipientRole: input.recipientRole.trim(),
              channel: input.channel,
            })
          }
        />
      )}
    </>
  );
}
