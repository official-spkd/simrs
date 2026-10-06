'use client';

import { formatJam, formatTanggalLahir, type RadiologyExam } from '@simrs/shared';
import { Chip, cx, PatientBanner } from '@simrs/ui';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { formatLabNumber, formatWhen } from '@/lib/penunjang';
import { MODALITY_LABEL, procedureCodeText, RAD_FLOW, RAD_STATUS_VIEW } from '@/lib/penunjang-radiologi';
import { RadExpertise } from './rad-expertise';
import { RadFinish, RadStart } from './rad-steps';

export interface RadHandlers {
  onStart: (identity: boolean, contrast: boolean) => void;
  onFinish: (ctdiVol: number | null, dlp: number | null) => void;
  onSign: (findings: string, impression: string) => void;
}

/** Rincian pemeriksaan terpilih: banner pasien, order, alur status, lalu langkah sesuai status. */
export function RadDetail({
  role,
  exam: e,
  busy,
  error,
  feedback,
  handlers: h,
}: {
  role: string | null;
  exam: RadiologyExam;
  busy: boolean;
  error: string | null;
  feedback: string | null;
  handlers: RadHandlers;
}) {
  const stage = RAD_FLOW.indexOf(e.status);
  return (
    <div className="flex flex-col gap-4">
      <PatientBanner
        name={e.patient.name}
        sex={e.patient.sex}
        ageYears={e.patient.ageYears}
        birthDate={formatTanggalLahir(e.patient.birthDate)}
        mrn={e.patient.rm}
        allergies={e.patient.allergies}
        guarantor={e.patient.guarantor}
      />
      <section
        aria-label="Order pemeriksaan"
        className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card bg-card-header px-4 py-3"
      >
        <div className="flex flex-wrap justify-between gap-2.5">
          <div className="flex min-w-0 flex-col">
            <h2 className="m-0 text-[15px] font-semibold">{e.procedure}</h2>
            <span className="text-[12.5px] text-ink-500">
              {MODALITY_LABEL[e.modality]} · {e.room} · <span className="font-mono">{e.accession}</span> ·
              jadwal {formatWhen(e.scheduledAt, DEMO_TODAY)}
            </span>
            <span className="text-[12.5px] text-ink-700">
              {e.location} · pengirim {e.sender}
            </span>
          </div>
          <span className="flex flex-wrap items-start gap-1.5">
            <Chip tone={e.procedureCode ? 'brand' : 'neutral'} mono>
              {procedureCodeText(e.procedureCode)}
            </Chip>
            {e.priority === 'cito' && <Chip tone="danger">Cito</Chip>}
            {e.contrast && <Chip tone="warning">Kontras</Chip>}
          </span>
        </div>
        <p className="m-0 text-small text-ink-700">
          <span className="font-semibold">Indikasi klinis:</span> {e.indication}
        </p>
        <ol aria-label="Alur pemeriksaan" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0">
          {RAD_FLOW.map((s, i) => {
            const done = i < stage || e.status === 'ditandatangani';
            return (
              <li
                key={s}
                aria-current={i === stage ? 'step' : undefined}
                className={cx(
                  'flex items-center gap-1.5 text-small',
                  i <= stage ? 'font-semibold text-brand-800' : 'text-ink-500',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'flex size-[22px] items-center justify-center rounded-full text-caption font-bold',
                    done
                      ? 'bg-zamrud-100 text-zamrud-700'
                      : i === stage
                        ? 'bg-nav-active text-white'
                        : 'bg-[rgba(23,32,46,0.06)] text-ink-500',
                  )}
                >
                  {done ? '✓' : i + 1}
                </span>
                {RAD_STATUS_VIEW[s].label}
                <span className="sr-only">
                  {done ? ' (selesai)' : i === stage ? ' (tahap saat ini)' : ''}
                </span>
              </li>
            );
          })}
        </ol>
        {e.startedAt && (
          <span className="text-caption text-ink-500">Dimulai {formatWhen(e.startedAt, DEMO_TODAY)}</span>
        )}
        {e.dose && (
          <span className="text-caption text-ink-700">
            Dosis CT: CTDIvol {formatLabNumber(e.dose.ctdiVol, 1)} mGy · DLP {formatLabNumber(e.dose.dlp, 0)}{' '}
            mGy·cm
          </span>
        )}
      </section>
      {feedback && (
        <p
          role="status"
          className="m-0 rounded-control border border-zamrud-200 bg-alert-success px-3 py-2 text-small font-semibold text-zamrud-700 animate-pop"
        >
          {feedback}
        </p>
      )}
      {e.status === 'terjadwal' && (
        <RadStart key={e.id} exam={e} busy={busy} serverError={error} onStart={h.onStart} />
      )}
      {e.status === 'berlangsung' && (
        <RadFinish key={e.id} exam={e} busy={busy} serverError={error} onFinish={h.onFinish} />
      )}
      {e.status === 'ekspertise' && (
        <RadExpertise role={role} key={e.id} exam={e} busy={busy} serverError={error} onSign={h.onSign} />
      )}
      {e.status === 'ditandatangani' && e.report && (
        <section
          aria-label="Laporan radiologi"
          className="flex flex-col gap-2 rounded-card border border-zamrud-200 bg-white/90 px-4 py-3.5 shadow-card"
        >
          <h3 className="m-0 text-[15px] font-semibold">Laporan radiologi</h3>
          <p className="m-0 text-small text-ink-700">
            <span className="font-semibold">Temuan:</span> {e.report.findings}
          </p>
          <p className="m-0 text-small text-ink-900">
            <span className="font-semibold">Kesan:</span> {e.report.impression}
          </p>
          <span className="text-caption font-semibold text-zamrud-700">
            ✓ Ditandatangani {e.report.radiologist}
            {e.report.signedAt ? ` · ${formatJam(e.report.signedAt)}` : ''} · hasil final tersimpan dan masuk
            antrean integrasi
          </span>
        </section>
      )}
    </div>
  );
}
