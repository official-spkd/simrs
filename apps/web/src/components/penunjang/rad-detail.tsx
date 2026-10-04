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
  exam: e,
  busy,
  error,
  feedback,
  handlers: h,
}: {
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
        className="flex flex-col gap-3 rounded-card border border-line bg-white bg-[linear-gradient(100deg,rgba(15,118,110,0.06),rgba(255,255,255,0)_60%)] px-4 py-3"
      >
        <div className="flex flex-wrap justify-between gap-2.5">
          <div className="flex min-w-0 flex-col">
            <h2 className="m-0 text-[16px] font-semibold">{e.procedure}</h2>
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
                  i <= stage ? 'font-semibold text-brand-700' : 'text-ink-500',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'flex size-[22px] items-center justify-center rounded-full text-caption font-bold',
                    done ? 'bg-brand-600 text-white' : i === stage ? 'bg-brand-50' : 'bg-muted',
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
          className="m-0 rounded-control border border-success-border bg-[#EAF6EC] px-3 py-2 text-small font-semibold text-success"
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
        <RadExpertise key={e.id} exam={e} busy={busy} serverError={error} onSign={h.onSign} />
      )}
      {e.status === 'ditandatangani' && e.report && (
        <section
          aria-label="Laporan radiologi"
          className="flex flex-col gap-2 rounded-card border border-success-border bg-white px-4 py-3.5"
        >
          <h3 className="m-0 text-body font-semibold">Laporan radiologi</h3>
          <p className="m-0 text-small text-ink-700">
            <span className="font-semibold">Temuan:</span> {e.report.findings}
          </p>
          <p className="m-0 text-small text-ink-900">
            <span className="font-semibold">Kesan:</span> {e.report.impression}
          </p>
          <span className="text-caption font-semibold text-success">
            ✓ Ditandatangani {e.report.radiologist}
            {e.report.signedAt ? ` · ${formatJam(e.report.signedAt)}` : ''} · terkirim ke DPJP dan SATUSEHAT
            (ImagingStudy, DiagnosticReport)
          </span>
        </section>
      )}
    </div>
  );
}
