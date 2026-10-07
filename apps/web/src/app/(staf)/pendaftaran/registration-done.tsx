'use client';

import {
  type BpjsQueueTask,
  ENCOUNTER_STATUS_LABEL,
  formatJam,
  type RegistrationResult,
} from '@simrs/shared';
import { Alert, Button, Chip, Icon } from '@simrs/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { RegQueuePreview } from '@/components/front-office/reg-quota';
import { sepSettled, sepStatusView, type StatusView, taskChips, tasksSettled } from '@/lib/registration-api';
import { retrySepAction } from './actions-api';
import { withBasePath } from '@/lib/base-path';

/** Selang pembaruan otomatis selama SEP/task masih menunggu kirim (worker outbox). */
const REFRESH_MS = 3_000;
/** Setelah ini pembaruan melambat (SEP pending bisa bertahan sampai akhir hari layanan saat BPJS terganggu). */
const FAST_FOR_MS = 5 * 60_000;
const SLOW_REFRESH_MS = 20_000;

function StatusChip({ view }: { view: StatusView }) {
  return (
    <Chip tone={view.tone}>
      <span className="inline-flex items-center gap-1.5">
        <Icon name={view.icon} size={14} strokeWidth={2.2} />
        {view.label}
      </span>
    </Chip>
  );
}

/**
 * F03/F06 · Hasil pendaftaran rawat jalan (mode api): nomor antrean poli, status SEP (pending/terbit/gagal + alasan +
 * kirim ulang), status task 1–3 Antrean BPJS, dan cetak tiket/SEP. SEP dan task dikirim worker lewat outbox, jadi
 * halaman memuat ulang datanya sendiri sampai semuanya selesai: gangguan BPJS terlihat jelas tanpa menahan pasien.
 */
export function RegistrationDone({
  result,
  tasks,
  patient,
  visit,
  canRetry,
  canPrint,
}: {
  result: RegistrationResult;
  /** null = tidak dibaca (non-JKN atau peran tanpa `queue.read`). */
  tasks: BpjsQueueTask[] | null;
  patient: { name: string; mrn: string } | null;
  visit: { poliName: string; doctorName: string; room: string; eta: string | null } | null;
  canRetry: boolean;
  canPrint: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [since] = useState(() => Date.now());
  const { encounter, sep, queueTicket } = result;
  const settled = sepSettled(sep) && (tasks === null || tasksSettled(tasks));

  useEffect(() => {
    if (settled) return;
    const ms = Date.now() - since > FAST_FOR_MS ? SLOW_REFRESH_MS : REFRESH_MS;
    const id = setTimeout(() => router.refresh(), ms);
    return () => clearTimeout(id);
  }, [settled, since, router, result, tasks]);

  const retry = () => {
    if (!sep) return;
    start(async () => {
      const r = await retrySepAction(sep.id);
      setNotice(
        r.ok
          ? { ok: true, text: `SEP dikirim ulang ke BPJS · ${formatJam(new Date())}.` }
          : { ok: false, text: r.message },
      );
      router.refresh();
    });
  };

  const at = encounter.arrivedAt ? formatJam(encounter.arrivedAt) : '';
  const sepView = sep ? sepStatusView(sep) : null;
  const bpjs = result.coverage?.payerKind === 'bpjs';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Front office / Pendaftaran / Rawat jalan</span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Pendaftaran rawat jalan selesai</h1>
      </header>

      <Alert
        level="success"
        title={`Terdaftar pukul ${at}${queueTicket ? ` · antrean ${queueTicket.queueNo}` : ''} · ${encounter.number}`}
      >
        {patient ? `${patient.name} · RM ${patient.mrn}` : 'Pasien'} ·{' '}
        {ENCOUNTER_STATUS_LABEL[encounter.status]}
        {result.coverage ? ` · ${result.coverage.payerName}` : ''}
        {result.appointment ? ` · kode booking ${result.appointment.bookingCode}` : ''}.
      </Alert>

      {notice && <Alert level={notice.ok ? 'success' : 'warning'}>{notice.text}</Alert>}

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-4 lg:max-w-[340px]">
          <RegQueuePreview
            label="NOMOR ANTREAN POLI"
            queueNo={queueTicket?.queueNo ?? '—'}
            line={
              visit
                ? `${visit.poliName} · ${visit.doctorName} · ${visit.room}${visit.eta ? ` · perkiraan dipanggil ${visit.eta}` : ''}`
                : 'Poli tujuan sesuai pendaftaran.'
            }
            note={
              bpjs
                ? 'Pasien boleh langsung ke poli walau SEP masih menunggu BPJS.'
                : 'Antrean non-JKN · tidak dikirim ke Antrean BPJS.'
            }
          />
          <div className="flex flex-col gap-2">
            {canPrint ? (
              <a
                href={withBasePath(`/cetak/pendaftaran/${encounter.id}`)}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-line-strong bg-white px-4 font-semibold text-ink-900 no-underline"
              >
                <Icon name="printer" size={16} />
                {bpjs ? 'Cetak tiket dan SEP' : 'Cetak tiket'}
              </a>
            ) : (
              <span className="text-caption text-ink-500">Peran Anda tidak berizin mencetak.</span>
            )}
            {/* Mockup Registrasi: "Lihat antrean" utama; di mode api ke layar kendali antrean staf (display TV
                hanya dibuka perangkat terdaftar). */}
            <Link
              href="/antrean"
              className="inline-flex min-h-12 items-center justify-center rounded-control border border-brand-800 bg-btn-primary px-4 font-semibold text-white no-underline shadow-button"
            >
              Lihat antrean
            </Link>
            <Link
              href="/pendaftaran"
              className="inline-flex min-h-11 items-center justify-center rounded-control px-4 font-medium text-brand-600 no-underline"
            >
              Pasien berikutnya
            </Link>
          </div>
        </div>

        <section
          aria-label="Status SEP dan Antrean BPJS"
          aria-live="polite"
          className="flex min-w-0 flex-[999_1_420px] flex-col gap-4"
        >
          {sep && sepView ? (
            <div className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="m-0 text-h2 font-semibold">SEP</h2>
                <StatusChip view={sepView} />
              </div>
              <p className="m-0 text-small text-ink-700">{sepView.detail}</p>
              <dl className="m-0 grid grid-cols-2 gap-2 text-small sm:grid-cols-3">
                <div className="flex flex-col">
                  <dt className="text-caption text-ink-500">No. SEP</dt>
                  <dd className="m-0 font-mono font-semibold">{sep.sepNo ?? 'belum terbit'}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-caption text-ink-500">Diagnosa awal</dt>
                  <dd className="m-0 font-semibold">
                    {sep.initialDiagnosis
                      ? `${sep.initialDiagnosis.code} · ${sep.initialDiagnosis.display}`
                      : '—'}
                  </dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-caption text-ink-500">Terbit</dt>
                  <dd className="m-0 font-semibold">{sep.issuedAt ? formatJam(sep.issuedAt) : '—'}</dd>
                </div>
              </dl>
              {sep.status === 'failed' &&
                (canRetry ? (
                  <Button variant="primary" disabled={pending} onClick={retry} className="self-start">
                    {pending ? 'Mengirim ulang…' : 'Kirim ulang SEP'}
                  </Button>
                ) : (
                  <span className="text-caption text-ink-500">
                    Kirim ulang SEP butuh izin penjaminan (`coverage.write`).
                  </span>
                ))}
              {!sepSettled(sep) && (
                <span role="status" className="flex items-center gap-1.5 text-caption text-ink-500">
                  <Icon name="clock" size={14} />
                  Status diperbarui otomatis.
                </span>
              )}
            </div>
          ) : (
            <Alert level="info">Penjamin bukan BPJS · tanpa SEP.</Alert>
          )}

          {tasks && (
            <div className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4">
              <h2 className="m-0 text-h2 font-semibold">Task ID Antrean BPJS</h2>
              <ul aria-label="Task ID 1–3" className="m-0 flex list-none flex-col gap-2 p-0">
                {taskChips(tasks).map((t) => (
                  <li key={t.taskId} className="flex flex-wrap items-center gap-2 text-small">
                    <StatusChip view={t} />
                    {t.at && <span className="text-ink-500">kejadian {formatJam(t.at)}</span>}
                    {t.detail && <span className="text-ink-700">{t.detail}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
