'use client';

import { formatJam, formatTanggalLahir, type LabSample } from '@simrs/shared';
import { Button, cx, PatientBanner } from '@simrs/ui';
import { useState } from 'react';
import type { ScenarioId } from '@/lib/demo/engine/types';
import { STAF } from '@/lib/demo/fixtures/staf';
import { DEMO_TODAY } from '@/lib/demo/fixtures/waktu';
import { emptyResultText, formatWhen, nextValidation, resampleBlock, validationBlock } from '@/lib/penunjang';
import { LabResultsTable } from './lab-results-table';
import { NOT_YOUR_TURN, type ScenarioTasks } from './use-scenario-tasks';

interface PrimaryAction {
  label: string;
  disabled: boolean;
  reason: string | null;
  run: () => void;
}

/**
 * Hasil sampel terpilih (mockup Lab): banner pasien, tabel hasil, status validasi, dan tombol berurutan
 * (validasi teknis → klinis TTE). Sampel pasien skenario memakai tugas simulasi (pindai tabung, terima hasil HL7,
 * buka hasil kritis, validasi dan rilis) bila sedang giliran.
 */
export function LabDetail({
  role,
  sample: s,
  resample,
  scenario,
  tasks,
  busy,
  feedback,
  onValidate,
  onReceive,
  onResample,
}: {
  role: string | null;
  sample: LabSample;
  resample: string | null;
  scenario: ScenarioId | null;
  tasks: ScenarioTasks;
  busy: boolean;
  feedback: string | null;
  onReceive: (specimen: string, identityConfirmed: boolean) => void;
  onValidate: (level: 'teknis' | 'klinis') => void;
  onResample: () => void;
}) {
  const [specimen, setSpecimen] = useState('');
  const [identity, setIdentity] = useState(false);
  const block =
    nextValidation(s) === 'klinis' && role !== 'dokter'
      ? 'Validasi klinis wajib posisi Dokter; ganti posisi untuk melanjutkan.'
      : validationBlock(s, !!resample);
  const next = nextValidation(s);
  const step = (label: string, task: string): PrimaryAction => {
    const turn = tasks.enabled(scenario, task);
    return {
      label,
      disabled: !turn || tasks.pending,
      reason: turn ? null : NOT_YOUR_TURN,
      run: () => scenario && tasks.runTask(scenario, task),
    };
  };
  let primary: PrimaryAction;
  if (scenario === 'rawat-jalan' && s.status === 'order') primary = step('Pindai tabung', 'sampling');
  else if (scenario === 'rawat-jalan' && s.status === 'diterima')
    primary = step('Terima hasil (HL7 ORU)', 'hasil');
  else if (scenario === 'igd-ranap' && s.status === 'diterima') primary = step('Buka hasil', 'hasil');
  else if (scenario === 'rawat-jalan' && s.status === 'validasi-teknis')
    primary = step('Validasi dan rilis', 'validasi');
  else if (!next) primary = { label: 'Tervalidasi', disabled: true, reason: null, run: () => undefined };
  else {
    primary = {
      label: next === 'teknis' ? 'Validasi teknis' : 'Validasi klinis (TTE Sp.PK)',
      disabled: !!block || busy,
      reason: block,
      run: () => onValidate(next),
    };
  }
  // Mockup: "Minta ulang sampel" selalu tampil; bila tidak berlaku, nonaktif dengan alasan tertulis.
  const resampleReason = resample !== null ? null : resampleBlock(s, !!scenario);
  const status =
    resample !== null
      ? {
          tone: 'warning',
          text: `Permintaan sampel ulang dikirim ke ruangan pukul ${formatJam(resample)}. Hasil lama ditandai tidak valid.`,
        }
      : s.status === 'selesai' && s.clinical
        ? {
            tone: 'success',
            text: `Validasi klinis selesai pukul ${formatJam(s.clinical.at)} (TTE ${s.clinical.by}) · hasil final tersimpan dan masuk antrean integrasi.`,
          }
        : s.status === 'validasi-teknis' && s.technical
          ? {
              tone: 'brand',
              text: `Validasi teknis tersimpan pukul ${formatJam(s.technical.at)} oleh ${s.technical.by}. Menunggu validasi klinis Sp.PK.`,
            }
          : null;

  return (
    <div className="flex flex-col gap-3">
      <PatientBanner
        name={s.patient.name}
        sex={s.patient.sex}
        ageYears={s.patient.ageYears}
        birthDate={formatTanggalLahir(s.patient.birthDate)}
        mrn={s.patient.rm}
        allergies={s.patient.allergies}
        guarantor={s.patient.guarantor}
      />
      <section
        aria-label="Hasil pemeriksaan"
        className="overflow-hidden rounded-card border border-line bg-white"
      >
        <div className="flex flex-wrap justify-between gap-2.5 border-b border-line bg-[linear-gradient(100deg,rgba(15,118,110,0.06),#FFFFFF_60%)] px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <h2 className="m-0 text-[16px] font-semibold">{s.tests}</h2>
            <span className="text-[12.5px] text-ink-500">
              {s.location} · no. lab <span className="font-mono">{s.labNo}</span> ·{' '}
              {s.receivedAt
                ? `sampel diterima ${formatWhen(s.receivedAt, DEMO_TODAY)}`
                : `order ${formatWhen(s.orderedAt, DEMO_TODAY)}, belum sampling`}
            </span>
          </div>
          <span className="text-[12.5px] text-ink-700">
            Pengirim: {s.sender} · cito: {s.priority === 'cito' ? 'ya' : 'tidak'}
          </span>
        </div>
        {!scenario && s.status === 'order' && (
          <form
            className="flex flex-col gap-2 border-b border-line p-4"
            onSubmit={(e) => {
              e.preventDefault();
              onReceive(specimen, identity);
            }}
          >
            <label className="flex flex-col gap-1 text-small">
              Jenis spesimen yang diterima
              <input
                className="min-h-11 rounded-control border border-line-strong px-3"
                value={specimen}
                onChange={(e) => setSpecimen(e.target.value)}
                required
                minLength={3}
                maxLength={120}
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-small">
              <input type="checkbox" checked={identity} onChange={(e) => setIdentity(e.target.checked)} />
              Nama, RM, dan label tabung sudah dicocokkan
            </label>
            <Button type="submit" disabled={busy || !identity || specimen.trim().length < 3}>
              Terima spesimen
            </Button>
            <p className="m-0 text-small">Terima spesimen dengan dua pengenal sebelum hasil alat diproses.</p>
          </form>
        )}
        {s.results.length > 0 ? (
          <LabResultsTable results={s.results} caption={`Hasil ${s.tests} · ${s.patient.name}`} />
        ) : (
          <p className="m-0 border-b border-line-soft px-4 py-4 text-small text-ink-500">
            {emptyResultText(s, resample !== null)}
          </p>
        )}
        {status && (
          <div
            role="status"
            className={cx(
              'mx-4 mt-3 rounded-control border px-3 py-2 text-small font-semibold',
              status.tone === 'warning' && 'border-warning-border bg-[#FFF7EB] text-warning',
              status.tone === 'success' && 'border-success-border bg-[#EAF6EC] text-success',
              status.tone === 'brand' && 'border-brand-100 bg-selected text-brand-700',
            )}
          >
            {status.text}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3">
          <span className="min-w-0 flex-[1_1_240px] text-small text-ink-700">{s.qcNote}</span>
          <span className="flex flex-wrap gap-2">
            <Button
              onClick={onResample}
              disabled={busy || !!resampleReason}
              aria-describedby={resampleReason ? `ulang-${s.id}` : undefined}
            >
              {resample !== null ? 'Batalkan sampel ulang' : 'Minta ulang sampel'}
            </Button>
            <Button
              variant="primary"
              disabled={primary.disabled}
              aria-describedby={primary.reason ? `alasan-${s.id}` : undefined}
              onClick={primary.run}
            >
              {primary.label}
            </Button>
          </span>
          {primary.reason && (
            <span
              id={`alasan-${s.id}`}
              className="basis-full text-right text-[12.5px] font-semibold text-warning"
            >
              {primary.reason}
            </span>
          )}
          {resampleReason && (
            <span id={`ulang-${s.id}`} className="basis-full text-right text-[12.5px] text-ink-500">
              Minta ulang sampel: {resampleReason}
            </span>
          )}
          {(next === 'klinis' || primary.label === 'Validasi dan rilis') && (
            <span className="basis-full text-right text-caption text-ink-500">
              Validasi klinis ditandatangani {STAF.dokterPatologiKlinik} (TTE, simulasi).
            </span>
          )}
          {(feedback || tasks.error) && (
            <span role="status" className="basis-full text-right text-caption font-semibold text-ink-700">
              {tasks.error?.message ?? feedback}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
