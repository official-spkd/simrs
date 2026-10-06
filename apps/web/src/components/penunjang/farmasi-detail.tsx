'use client';

import {
  formatJam,
  formatTanggalLahir,
  type PharmacyCdsAlert,
  type PharmacyPrescription,
} from '@simrs/shared';
import { Chip, PatientBanner } from '@simrs/ui';
import type { RxLocal } from '@/lib/penunjang-farmasi';
import { type CdsFollowUp, FarmasiCds } from './farmasi-cds';
import { FarmasiItems } from './farmasi-items';
import { FarmasiTelaah } from './farmasi-telaah';
import { FarmasiWork, type Receiver } from './farmasi-work';

export interface FarmasiHandlers {
  onCds: (alert: PharmacyCdsAlert, action: CdsFollowUp, reason?: string) => void;
  onApprove: () => void;
  onHoldToggle: () => void;
  onPartial: () => void;
  onToggle: (kind: 'prep' | 'handover', index: number, checked: boolean) => void;
  onReceiver: (receiver: Receiver) => void;
  onDoubleCheck: (second: string) => void;
  onDone: (receiver: Receiver | null) => void;
}

const SETTING = { 'rawat-jalan': 'Rawat jalan', 'rawat-inap': 'Rawat inap', igd: 'IGD' } as const;

/** Rincian resep terpilih: banner pasien, kepala resep, item, lalu telaah atau penyiapan/serah terima. */
export function FarmasiDetail({
  role,
  tab,
  rx,
  local,
  blocking,
  approveReason,
  workScenarioReason,
  scenarioReceivers,
  pharmacists,
  currentUser,
  busy,
  error,
  handlers: h,
}: {
  tab: 'telaah' | 'siap' | 'serah';
  role: string | null;
  rx: PharmacyPrescription;
  local: RxLocal | undefined;
  blocking: readonly PharmacyCdsAlert[];
  approveReason: string | null;
  workScenarioReason: string | null;
  scenarioReceivers: boolean;
  pharmacists: readonly string[];
  currentUser: string;
  busy: boolean;
  error: string | null;
  handlers: FarmasiHandlers;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PatientBanner
        name={rx.patient.name}
        sex={rx.patient.sex}
        ageYears={rx.patient.ageYears}
        birthDate={formatTanggalLahir(rx.patient.birthDate)}
        mrn={rx.patient.rm}
        allergies={rx.patient.allergies}
        guarantor={rx.patient.guarantor}
      />
      <div className="flex flex-wrap justify-between gap-3 rounded-card border border-line bg-white bg-[linear-gradient(100deg,color-mix(in_srgb,_var(--color-brand-600)_6%,_transparent),rgba(255,255,255,0)_60%)] px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <h2 className="m-0 text-[16px] font-semibold">
            Resep <span className="font-mono">{rx.no}</span>
          </h2>
          <span className="text-[12.5px] text-ink-500">
            {rx.location} · {rx.prescriber} · ditulis {formatJam(rx.writtenAt)} · {rx.depot}
          </span>
        </div>
        <span className="flex flex-wrap items-center gap-1.5">
          <Chip tone={rx.cito ? 'danger' : 'neutral'}>{rx.cito ? 'Cito' : SETTING[rx.setting]}</Chip>
          {rx.prb && <Chip tone="info">PRB {rx.days} hari</Chip>}
          {!rx.prb && rx.days && <Chip tone="neutral">{rx.days} hari</Chip>}
          {rx.egfr !== null && (
            <Chip tone={rx.egfr < 60 ? 'warning' : 'neutral'}>
              eGFR {rx.egfr}
              {rx.egfr < 30 ? ' · CKD G4' : rx.egfr < 45 ? ' · CKD G3b' : rx.egfr < 60 ? ' · CKD G3a' : ''}
            </Chip>
          )}
          {rx.weightKg !== null && <Chip tone="neutral">BB {rx.weightKg} kg</Chip>}
        </span>
      </div>
      <FarmasiItems rx={rx} blocking={blocking} showDispense={tab === 'serah'} />
      {error && (
        <p role="alert" className="m-0 text-small font-semibold text-danger">
          {error}
        </p>
      )}
      {tab === 'telaah' ? (
        <>
          <FarmasiCds role={role} rx={rx} local={local} busy={busy} onAction={h.onCds} />
          <FarmasiTelaah
            rxId={rx.id}
            blocking={blocking}
            hold={local?.hold ?? null}
            partial={local?.partial ?? null}
            busy={busy}
            approveReason={approveReason}
            onApprove={h.onApprove}
            onHoldToggle={h.onHoldToggle}
            onPartial={h.onPartial}
          />
        </>
      ) : (
        <FarmasiWork
          key={`${rx.id}-${tab}`}
          tab={tab}
          rx={rx}
          local={local}
          pharmacists={pharmacists}
          currentUser={currentUser}
          busy={busy}
          serverError={error}
          scenarioReason={workScenarioReason}
          scenarioReceivers={scenarioReceivers}
          onToggle={h.onToggle}
          onReceiver={h.onReceiver}
          onDoubleCheck={h.onDoubleCheck}
          onDone={h.onDone}
        />
      )}
    </div>
  );
}
