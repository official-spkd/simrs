'use client';

import { formatJam, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip, type ChipTone, cx, KpiCard } from '@simrs/ui';
import { useEffect, useRef, useState } from 'react';
import { DEMO_NOW, demoNow } from '@/lib/demo/fixtures/waktu';
import {
  canRunNow,
  formatDuration,
  HEALTH_LABEL,
  type JobHealth,
  jobHealth,
  jobSummary,
  recordRun,
  type ScheduledJob,
} from '@/lib/platform-penjadwal';
import { type ConfirmRequest, ConfirmDialog, Panel, Stamp, TableWrap, TD, TH } from './parts';

const TONE: Record<JobHealth, ChipTone> = {
  berhasil: 'success',
  gagal: 'danger',
  terlambat: 'warning',
  dijeda: 'neutral',
};

/** Pesan hasil jalan manual yang berhasil (mock pihak luar sudah pulih). */
const RERUN_MESSAGE: Record<string, string> = {
  'aplicare-bed': '8 kelas rawat terkirim (Aplicare pulih)',
  'laporan-rl': 'RL 3.1 September terkirim ulang setelah koreksi koding; tanda terima SIRS diterima',
};

type Pending = { kind: 'run' | 'pause' | 'resume'; job: ScheduledJob } | null;

/**
 * P11 · Penjadwal pekerjaan: daftar job berkala dengan status tertulis (berhasil/gagal/terlambat/dijeda), riwayat
 * jalan, jalankan sekarang berkonfirmasi (alasan wajib untuk job berisiko), dan jeda/lanjutkan beralasan.
 */
export function PenjadwalBoard({ initial }: { initial: ScheduledJob[] }) {
  const [jobs, setJobs] = useState(initial);
  const [selected, setSelected] = useState(initial[0]?.id ?? '');
  const [running, setRunning] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // Saat render memakai jam demo tetap (hindari hidrasi tidak cocok); aksi memakai jam berjalan.
  const now = new Date(DEMO_NOW);
  const sum = jobSummary(jobs, now);
  const job = jobs.find((j) => j.id === selected) ?? jobs[0];
  if (!job) return null;

  const start = (j: ScheduledJob, reason: string) => {
    const t0 = demoNow();
    setRunning((cur) => ({ ...cur, [j.id]: formatJam(t0) }));
    setFlash(`${j.name} mulai berjalan · ${formatJam(t0)}${reason ? ` · alasan: ${reason}` : ''}`);
    const timer = window.setTimeout(() => {
      const t1 = demoNow();
      setJobs((cur) =>
        cur.map((x) =>
          x.id === j.id
            ? recordRun(x, {
                at: t1.toISOString(),
                durationSec: 2,
                result: 'berhasil',
                message: RERUN_MESSAGE[j.id] ?? j.runs[0]?.message ?? 'Selesai',
                manual: true,
              })
            : x,
        ),
      );
      setRunning((cur) => {
        const next = { ...cur };
        delete next[j.id];
        return next;
      });
      setFlash(`${j.name} selesai · ${formatJam(t1)} · berhasil (jalan manual)`);
    }, 1200);
    timers.current.push(timer);
  };

  const request: ConfirmRequest | null = pending
    ? pending.kind === 'run'
      ? {
          title: `Jalankan ${pending.job.name} sekarang?`,
          body: (
            <>
              Job berjalan di luar jadwal ({pending.job.schedule}) dengan kunci idempoten yang sama, jadi
              pesan yang sudah terkirim tidak terkirim dua kali.
              {pending.job.sensitive &&
                ' Job ini menyentuh pihak luar atau data besar: alasan wajib dan tercatat.'}
            </>
          ),
          confirmLabel: 'Ya, jalankan',
          ...(pending.job.sensitive
            ? {
                reasonLabel: 'Alasan menjalankan manual',
                reasonPlaceholder: 'mis. koreksi koding RL selesai',
              }
            : {}),
        }
      : pending.kind === 'pause'
        ? {
            title: `Jeda ${pending.job.name}?`,
            body: <>Job tidak berjalan sampai dilanjutkan. Tampil sebagai “Dijeda” di pemantauan.</>,
            confirmLabel: 'Ya, jeda',
            danger: true,
            reasonLabel: 'Alasan menjeda',
          }
        : {
            title: `Lanjutkan ${pending.job.name}?`,
            body: <>Job kembali berjalan sesuai jadwal ({pending.job.schedule}).</>,
            confirmLabel: 'Ya, lanjutkan',
          }
    : null;

  const health = jobHealth(job, now);
  const check = canRunNow(job, !!running[job.id]);

  return (
    <div className="flex flex-col gap-4">
      <div role="region" aria-label="Ringkasan job" className="grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        <KpiCard label="Job aktif" value={`${sum.active}/${sum.total}`} detail={`${sum.paused} dijeda`} />
        <KpiCard
          label="Gagal saat ini"
          value={String(sum.failing)}
          hint={sum.failing > 0 ? 'perlu ditindaklanjuti' : 'semua berhasil'}
          tone={sum.failing > 0 ? 'danger' : 'success'}
          tinted
        />
        <KpiCard
          label="Jalan gagal 24 jam"
          value={String(sum.failedRuns24h)}
          detail="termasuk coba ulang otomatis"
          tone={sum.failedRuns24h > 0 ? 'warning' : 'neutral'}
        />
        <KpiCard label="Terlambat" value={String(sum.late)} detail="lebih dari 2× selang jadwal" />
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <Panel
          className="flex-[2_1_520px]"
          title="Job berkala"
          sub={`Data per ${formatTanggalWaktu(DEMO_NOW)}`}
        >
          <TableWrap label="Daftar job berkala">
            <table className="w-full min-w-[600px] border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Job
                  </th>
                  <th scope="col" className={TH}>
                    Jadwal
                  </th>
                  <th scope="col" className={TH}>
                    Terakhir jalan
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Pilih</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const h = jobHealth(j, now);
                  const last = j.runs[0];
                  return (
                    <tr key={j.id} className={cx(j.id === job.id && 'bg-brand-50')}>
                      <td className={TD}>
                        <span className="font-medium">{j.name}</span>
                        <span className="block text-caption text-ink-500">{j.owner}</span>
                      </td>
                      <td className={TD}>{j.schedule}</td>
                      <td className={cx(TD, 'font-mono')}>
                        {last ? formatTanggalWaktu(last.at).split(', ')[1] : '–'}
                      </td>
                      <td className={TD}>
                        {running[j.id] ? (
                          <Chip tone="info">Berjalan sejak {running[j.id]}</Chip>
                        ) : (
                          <Chip tone={TONE[h]}>{HEALTH_LABEL[h]}</Chip>
                        )}
                      </td>
                      <td className={cx(TD, 'text-right')}>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-pressed={j.id === job.id}
                          onClick={() => {
                            setSelected(j.id);
                            setFlash(null);
                          }}
                        >
                          Detail<span className="sr-only"> {j.name}</span>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Panel>

        <Panel
          className="flex-[1_1_340px]"
          title={job.name}
          sub={`${job.schedule} · berikutnya ${job.paused ? '–' : formatTanggalWaktu(job.nextAt)}`}
          tone={health === 'gagal' ? 'danger' : undefined}
        >
          {health === 'gagal' && !running[job.id] && (
            <Alert level="critical" title="Jalan terakhir gagal">
              {job.runs[0]?.message}
            </Alert>
          )}
          {job.paused && (
            <Alert level="warning" title="Dijeda">
              {job.pausedReason}
            </Alert>
          )}
          <span className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={!check.ok}
              aria-describedby={!check.ok ? 'job-alasan' : undefined}
              onClick={() => setPending({ kind: 'run', job })}
            >
              {health === 'gagal' ? 'Jalankan ulang' : 'Jalankan sekarang'}
            </Button>
            {job.paused ? (
              <Button onClick={() => setPending({ kind: 'resume', job })}>Lanjutkan</Button>
            ) : (
              <Button disabled={!!running[job.id]} onClick={() => setPending({ kind: 'pause', job })}>
                Jeda
              </Button>
            )}
            {!check.ok && (
              <span id="job-alasan" className="text-caption text-ink-500">
                {check.reason}
              </span>
            )}
          </span>
          {flash && (
            <span role="status">
              <Stamp tone={running[job.id] ? 'info' : 'success'}>{flash}</Stamp>
            </span>
          )}
          <ol aria-label={`Riwayat jalan ${job.name}`} className="m-0 flex list-none flex-col gap-2 p-0">
            {job.runs.map((r, i) => (
              <li
                key={`${r.at}-${i}`}
                className="flex flex-col gap-0.5 border-b border-[#EEF1F4] pb-2 last:border-0"
              >
                <span className="flex flex-wrap items-center gap-2 text-small">
                  <span className="font-mono">{formatTanggalWaktu(r.at)}</span>
                  <Chip tone={r.result === 'berhasil' ? 'success' : 'danger'}>
                    {r.result === 'berhasil' ? 'Berhasil' : 'Gagal'}
                  </Chip>
                  {r.manual && <Chip tone="info">Manual</Chip>}
                  <span className="text-caption text-ink-500">{formatDuration(r.durationSec)}</span>
                </span>
                <span className="text-small text-ink-700">{r.message}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
      <ConfirmDialog
        request={request}
        onClose={() => setPending(null)}
        onConfirm={(reason) => {
          if (!pending) return;
          const j = pending.job;
          const t = formatJam(demoNow());
          if (pending.kind === 'run') start(j, reason);
          else if (pending.kind === 'pause') {
            setJobs((cur) =>
              cur.map((x) => (x.id === j.id ? { ...x, paused: true, pausedReason: reason } : x)),
            );
            setFlash(`${j.name} dijeda · ${t}`);
          } else {
            setJobs((cur) =>
              cur.map((x) => (x.id === j.id ? { ...x, paused: false, pausedReason: undefined } : x)),
            );
            setFlash(`${j.name} dilanjutkan · ${t}`);
          }
        }}
      />
    </div>
  );
}
