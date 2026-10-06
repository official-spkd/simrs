'use client';

import { formatJam } from '@simrs/shared';
import { Button, Chip, cx, KpiCard, TabList } from '@simrs/ui';
import Link from 'next/link';
import { useId, useState } from 'react';
import { completeWorklistTaskAction } from '@/app/(staf)/klinis/worklist/actions';
import { StatusFlag } from '@/components/klinis/status-flag';
import { useStoreAction } from '@/lib/demo/store/client';
import { shortWhen } from '@/lib/rme';
import {
  completionBlocker,
  dueLabel,
  isOverdue,
  PATIENT_STATUS_META,
  PRIORITY_LABEL,
  readBackMatches,
  sortTasks,
  targetHref,
  WORKLIST_FOLLOW_UPS,
  WORKLIST_KIND_LABEL,
  type WorklistDone,
  type WorklistPatient,
  type WorklistRole,
  type WorklistTask,
  worklistSummary,
} from '@/lib/rme-worklist';

export interface WorklistPatientView extends WorklistPatient {
  name: string;
  rm: string;
  allergies: readonly string[];
}

const PRIORITY_TONE = { kritis: 'danger', tinggi: 'warning', normal: 'neutral' } as const;

/**
 * K01 · Papan worklist klinis: tugas tertunda per posisi, urut prioritas dan tenggat; nilai kritis wajib baca ulang
 * sebelum tercatat diterima; co-sign/verifikasi/tinjau order hanya DPJP; tugas lain menuju layar tindak lanjutnya.
 * Penyelesaian tersimpan di toko demo (`rekam-medis`); tugas juga selesai sendiri bila rekamnya diselesaikan di layar
 * lain (co-sign di CPPT, dosis di eMAR, resume final).
 */
export function WorklistBoard({
  role,
  now,
  tasks,
  done,
  notes,
  rev,
  patients,
  routes,
  screenLabels,
}: {
  role: WorklistRole | null;
  /** "Data per" (instan ISO) untuk tenggat. */
  now: string;
  tasks: readonly WorklistTask[];
  /** Tugas selesai (server: rekam sumber + penyelesaian langsung). */
  done: Readonly<Record<string, WorklistDone>>;
  /** Keterangan tambahan per tugas (status pelaporan nilai kritis dari lab). */
  notes: Readonly<Record<string, string>>;
  /** Revisi toko `rekam-medis` yang dilihat layar. */
  rev: number;
  patients: readonly WorklistPatientView[];
  /** Rute layar tindak lanjut yang terbuka untuk posisi ini (id layar → rute). */
  routes: Readonly<Record<string, string | null>>;
  screenLabels: Readonly<Record<string, string>>;
}) {
  const [tab, setTab] = useState<'tugas' | 'pasien' | 'selesai'>('tugas');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { run, pending } = useStoreAction(rev);
  const sum = worklistSummary(tasks, done, now);
  const open = sortTasks(
    tasks.filter((t) => !done[t.id]),
    now,
  );
  const finished = tasks.filter((t) => done[t.id]);
  const nameOf = (patientId: string) => patients.find((p) => p.patientId === patientId)?.name ?? '';

  const complete = (task: WorklistTask, readBack?: { value: string; follow: string }) =>
    run(
      (r) =>
        completeWorklistTaskAction(
          { taskId: task.id, readBack: readBack?.value ?? null, followUp: readBack?.follow ?? null },
          r,
        ),
      (res) =>
        setMsg(
          res.ok
            ? { ok: true, text: `${res.message} · ${nameOf(task.patientId)}` }
            : { ok: false, text: res.message },
        ),
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Tugas tertunda" value={sum.open} hint="urut prioritas" />
        <KpiCard label="Nilai kritis" value={sum.critical} hint="baca ulang wajib" tone="danger" tinted />
        <KpiCard label="Lewat batas" value={sum.overdue} hint="perlu segera" tone="warning" tinted />
        <KpiCard label="Selesai shift ini" value={sum.done} hint="tercatat berjam" tone="success" />
      </div>
      {msg && (
        <p
          role={msg.ok ? 'status' : 'alert'}
          className={cx(
            'm-0 rounded-control border px-3.5 py-2.5 text-small font-semibold',
            msg.ok
              ? 'border-zamrud-200 bg-alert-success text-success'
              : 'border-kunyit-200 bg-alert-warning text-warning',
          )}
        >
          {msg.text}
        </p>
      )}
      <TabList
        label="Tampilan worklist"
        value={tab}
        onChange={(v) => setTab(v as typeof tab)}
        items={[
          {
            id: 'tugas',
            label: 'Tugas tertunda',
            badge: String(sum.open),
            badgeTone: sum.critical > 0 ? 'danger' : 'brand',
          },
          { id: 'pasien', label: 'Pasien saya', badge: String(patients.length) },
          { id: 'selesai', label: 'Selesai', badge: String(sum.done) },
        ]}
      />
      {tab === 'tugas' && (
        <section aria-label="Tugas tertunda" className="flex flex-col gap-2.5">
          {open.length === 0 && (
            <p className="m-0 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5 text-small text-ink-500">
              Semua tugas shift ini sudah selesai. Tugas baru (hasil, konsul, co-sign) muncul di sini.
            </p>
          )}
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
            {open.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                role={role}
                now={now}
                route={t.target ? (routes[t.target.screen] ?? null) : null}
                screenLabel={t.target ? (screenLabels[t.target.screen] ?? '') : ''}
                note={notes[t.id] ?? null}
                busy={pending}
                onComplete={(rb) => complete(t, rb)}
              />
            ))}
          </ol>
        </section>
      )}
      {tab === 'pasien' && (
        <section
          aria-label="Pasien saya"
          className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
        >
          <ul className="m-0 list-none p-0">
            {patients.map((p) => {
              const st = PATIENT_STATUS_META[p.status];
              const pending = open.filter((t) => t.encounterId === p.encounterId).length;
              const summary = routes.ringkasan;
              return (
                <li
                  key={p.encounterId}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3 hover:bg-brand-50/60"
                >
                  <span className="flex min-w-0 flex-col">
                    {summary ? (
                      <Link
                        href={`${summary}?pasien=${p.encounterId}`}
                        className="font-semibold text-brand-700"
                      >
                        {p.name}
                      </Link>
                    ) : (
                      <span className="font-semibold">{p.name}</span>
                    )}
                    <span className="text-caption text-ink-500">
                      RM <span className="font-mono">{p.rm}</span> · {p.note}
                      {p.allergies.length > 0 ? ` · Alergi ${p.allergies.join(', ')}` : ''}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Chip tone={st.tone}>{st.label}</Chip>
                    <Chip tone={pending > 0 ? 'warning' : 'success'}>
                      {pending > 0 ? `${pending} tugas` : 'Tidak ada tugas'}
                    </Chip>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {tab === 'selesai' && (
        <section
          aria-label="Tugas selesai"
          className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
        >
          {finished.length === 0 ? (
            <p className="m-0 px-4 py-3.5 text-small text-ink-500">
              Belum ada tugas yang diselesaikan di shift ini.
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {finished.map((t) => {
                const d = done[t.id];
                return (
                  <li key={t.id} className="flex flex-col gap-0.5 border-b border-line-soft px-4 py-3">
                    <span className="font-semibold">{t.title}</span>
                    <span className="text-small font-semibold text-success">
                      ✓ {d?.note} · {d ? formatJam(d.at) : ''} · {d?.by}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function TaskCard({
  task,
  role,
  now,
  route,
  screenLabel,
  note,
  busy,
  onComplete,
}: {
  task: WorklistTask;
  role: WorklistRole | null;
  now: string;
  route: string | null;
  screenLabel: string;
  /** Keterangan dari layar lain (mis. status pelaporan nilai kritis oleh lab). */
  note: string | null;
  busy: boolean;
  onComplete: (readBack?: { value: string; follow: string }) => void;
}) {
  const id = useId();
  const [readBack, setReadBack] = useState<{ value: string; follow: string; tried: boolean } | null>(null);
  const blocker = completionBlocker(task, role);
  const overdue = isOverdue(task, now);
  const href = route ? targetHref(route, task) : null;
  const a = task.action;
  const inlineDone = a.kind !== 'buka' && !task.waitingFor;
  const readOk = a.kind === 'baca-ulang' && readBack ? readBackMatches(readBack.value, a.value) : false;

  return (
    <li>
      <article
        aria-labelledby={`${id}-judul`}
        className={cx(
          'flex flex-col gap-2 rounded-card border bg-white/90 px-4 py-3 shadow-card',
          task.priority === 'kritis' ? 'border-danger-border' : 'border-white/95',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Chip>
          <span className="text-caption font-semibold text-ink-700">{WORKLIST_KIND_LABEL[task.kind]}</span>
          <span className="ml-auto">
            {overdue ? (
              <StatusFlag icon="clock" tone="danger">
                {dueLabel(task, now)}
              </StatusFlag>
            ) : (
              <StatusFlag icon="clock" tone="neutral" inline>
                {task.dueAt
                  ? `Batas ${shortWhen(task.dueAt, now)} · ${dueLabel(task, now)}`
                  : dueLabel(task, now)}
              </StatusFlag>
            )}
          </span>
        </div>
        <h2 id={`${id}-judul`} className="m-0 text-body font-semibold text-ink-900">
          {task.title}
        </h2>
        <span className="text-small text-ink-700">{task.detail}</span>
        {note && <span className="text-small font-semibold text-info">{note}</span>}
        {task.waitingFor && (
          <StatusFlag icon="clock" tone="warning" inline>
            {task.waitingFor}
          </StatusFlag>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {a.kind === 'baca-ulang' && !readBack && (
            <Button
              variant="danger"
              disabled={!!blocker}
              onClick={() => setReadBack({ value: '', follow: '', tried: false })}
            >
              Terima nilai kritis
            </Button>
          )}
          {a.kind === 'tandai-dibaca' && (
            <Button variant="primary" disabled={!!blocker || busy} onClick={() => onComplete()}>
              Tandai sudah dibaca
            </Button>
          )}
          {a.kind === 'cosign' && (
            <Button
              variant="primary"
              disabled={!!blocker || busy}
              aria-describedby={blocker ? `${id}-why` : undefined}
              onClick={() => onComplete()}
            >
              Co-sign sekarang
            </Button>
          )}
          {a.kind === 'verifikasi' && (
            <Button
              variant="primary"
              disabled={!!blocker || busy}
              aria-describedby={blocker ? `${id}-why` : undefined}
              onClick={() => onComplete()}
            >
              Verifikasi
            </Button>
          )}
          {a.kind === 'setujui-order' && (
            <Button
              variant="primary"
              disabled={!!blocker || busy}
              aria-describedby={blocker ? `${id}-why` : undefined}
              onClick={() => onComplete()}
            >
              Setujui order
            </Button>
          )}
          {href && (
            <Link
              href={href}
              className={cx(
                'inline-flex h-11 items-center rounded-control px-3.5 text-small font-semibold',
                inlineDone
                  ? 'text-brand-600'
                  : 'border border-brand-800 bg-btn-primary text-white no-underline shadow-button',
              )}
            >
              Buka {screenLabel}
            </Link>
          )}
          {!href && a.kind === 'buka' && (
            <span className="text-caption text-ink-500">
              Layar tindak lanjut belum tersedia untuk posisi ini.
            </span>
          )}
          {blocker && inlineDone && (
            <span id={`${id}-why`} className="text-caption text-ink-500">
              {blocker}
            </span>
          )}
        </div>
        {a.kind === 'baca-ulang' && readBack && (
          <form
            className="flex flex-col gap-2 rounded-control border border-danger-border bg-white p-3"
            onSubmit={(e) => {
              e.preventDefault();
              setReadBack({ ...readBack, tried: true });
              if (readOk && readBack.follow) onComplete({ value: readBack.value, follow: readBack.follow });
            }}
          >
            <span className="text-small font-semibold text-danger-strong">
              Baca ulang nilai yang dilaporkan sebelum menerima (komunikasi efektif)
            </span>
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${id}-nilai`} className="text-small font-semibold">
                  Nilai dibaca ulang ({a.unit})
                </label>
                <input
                  id={`${id}-nilai`}
                  inputMode="decimal"
                  value={readBack.value}
                  aria-invalid={readBack.tried && !readOk ? true : undefined}
                  aria-describedby={`${id}-cek`}
                  onChange={(e) => setReadBack({ ...readBack, value: e.target.value, tried: false })}
                  className="h-11 w-36 rounded-control border border-line-strong bg-white px-3 font-mono"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor={`${id}-tl`} className="text-small font-semibold">
                  Tindak lanjut
                </label>
                <select
                  id={`${id}-tl`}
                  value={readBack.follow}
                  onChange={(e) => setReadBack({ ...readBack, follow: e.target.value })}
                  className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
                >
                  <option value="">Pilih tindak lanjut…</option>
                  {WORKLIST_FOLLOW_UPS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <span
              id={`${id}-cek`}
              className={cx(
                'text-caption',
                readBack.tried && !readOk ? 'font-semibold text-danger' : 'text-ink-700',
              )}
            >
              {readBack.tried && !readOk
                ? 'Nilai tidak cocok dengan laporan lab. Konfirmasi ulang ke pelapor sebelum menerima.'
                : readOk
                  ? '✓ Nilai cocok dengan laporan lab.'
                  : 'Ketik nilai seperti yang Anda dengar dari pelapor.'}
            </span>
            <span className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="danger"
                disabled={!readBack.value.trim() || !readBack.follow || busy}
              >
                Simpan penerimaan
              </Button>
              <Button variant="ghost" onClick={() => setReadBack(null)}>
                Batal
              </Button>
            </span>
          </form>
        )}
      </article>
    </li>
  );
}
