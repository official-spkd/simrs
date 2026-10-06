import type { Payer, PractitionerQuota, Referral } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import { useId } from 'react';
import { dateShort, deskQuota } from '@/lib/front-office';

const control =
  'h-11 w-full rounded-control border bg-white px-3 font-[inherit] text-ink-900 disabled:cursor-not-allowed disabled:bg-muted';

/** Tujuan kunjungan BPJS dari rujukan terpilih (mockup Registrasi). */
export function referralPurpose(referral: Referral | null | undefined): string {
  return referral?.kind === 'rujukan-fktp'
    ? `Rujukan baru dari FKTP${referral.visitNo ? ` (kunjungan ke-${referral.visitNo})` : ''}`
    : 'Kontrol (dengan surat kontrol)';
}

/** Info rujukan yang dipakai SEP (mockup Registrasi): surat kontrol dari kunjungan lalu, atau rujukan FKTP. */
export function ReferralInfo({ referral }: { referral: Referral }) {
  return (
    <Alert level="info">
      {referral.kind === 'surat-kontrol' ? (
        <>
          Surat kontrol <span className="font-mono">{referral.number}</span> dari kunjungan{' '}
          {dateShort(referral.issuedAt)} ditemukan dan dipakai otomatis.
        </>
      ) : (
        <>
          Rujukan FKTP <span className="font-mono">{referral.number}</span> dari {referral.origin} dipakai
          {referral.visitNo ? ` · kunjungan ke-${referral.visitNo}` : ''}.
          {referral.doctorId ? '' : ' Pilih DPJP di poli tujuan.'}
        </>
      )}
    </Alert>
  );
}

/** F06 · Data SEP (BPJS) atau tujuan kunjungan (umum/asuransi): poli, DPJP dari HFIS, diagnosa awal ICD-10. */
export function RegSep({
  payer,
  polis,
  poli,
  quotas,
  doctorId,
  tujuanLocked,
  diagnosis,
  diagnosisError,
  showDiagnosisError,
  sepLocked,
  referral,
  sepNo,
  sepAt,
  infoText,
  onPoli,
  onDoctor,
  onDiagnosis,
}: {
  payer: Payer;
  polis: Array<{ code: string; name: string }>;
  poli: string;
  quotas: PractitionerQuota[];
  doctorId: string | null;
  tujuanLocked: boolean;
  diagnosis: string;
  diagnosisError: string;
  showDiagnosisError: boolean;
  sepLocked: boolean;
  referral: Referral | null;
  sepNo: string | null;
  sepAt: string;
  /** Info bila belum ada rujukan dipilih. */
  infoText: string;
  onPoli: (code: string) => void;
  onDoctor: (id: string) => void;
  onDiagnosis: (v: string) => void;
}) {
  const id = useId();
  const bpjs = payer === 'BPJS';
  const list = quotas.filter((q) => q.poliCode === poli);
  return (
    <div className="@container flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-h2 font-semibold">{bpjs ? 'Data SEP' : 'Tujuan kunjungan'}</h2>
        <span className="text-caption text-ink-500">
          {bpjs ? 'Terisi otomatis dari rujukan · bisa disunting' : 'Pilih poli dan DPJP'}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-poli`} className="text-small font-semibold text-ink-700">
            Poli tujuan
          </label>
          <select
            id={`${id}-poli`}
            value={poli}
            disabled={tujuanLocked}
            onChange={(e) => onPoli(e.target.value)}
            className={`${control} border-line-strong`}
          >
            {polis.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} ({p.code})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-dpjp`} className="text-small font-semibold text-ink-700">
            DPJP (dari HFIS)
          </label>
          <select
            id={`${id}-dpjp`}
            value={doctorId ?? ''}
            disabled={tujuanLocked}
            onChange={(e) => e.target.value && onDoctor(e.target.value)}
            className={`${control} border-line-strong`}
          >
            <option value="" disabled>
              Pilih DPJP
            </option>
            {list.map((q) => {
              const full = deskQuota(q, payer, false).full;
              return (
                <option key={q.doctorId} value={q.doctorId} disabled={full}>
                  {q.doctorName} · {q.start}–{q.end}
                  {full ? ' · kuota penuh' : ''}
                </option>
              );
            })}
          </select>
        </div>
        {bpjs && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-dx`} className="text-small font-semibold text-ink-700">
              Diagnosa awal (ICD-10)
              <span aria-hidden="true" className="text-danger">
                {' '}
                *
              </span>
            </label>
            <input
              id={`${id}-dx`}
              value={diagnosis}
              required
              disabled={sepLocked}
              onChange={(e) => onDiagnosis(e.target.value)}
              aria-invalid={!!diagnosisError}
              aria-describedby={showDiagnosisError && diagnosisError ? `${id}-dx-msg` : undefined}
              className={`${control} ${diagnosisError ? 'border-danger' : 'border-line-strong'}`}
            />
            {showDiagnosisError && diagnosisError && (
              <span id={`${id}-dx-msg`} className="text-caption text-danger">
                {diagnosisError}
              </span>
            )}
          </div>
        )}
        {bpjs && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-tujuan`} className="text-small font-semibold text-ink-700">
              Tujuan kunjungan
            </label>
            <select id={`${id}-tujuan`} disabled={sepLocked} className={`${control} border-line-strong`}>
              <option>{referralPurpose(referral)}</option>
            </select>
          </div>
        )}
      </div>
      {bpjs && sepNo && (
        <Alert level="success">
          SEP <span className="font-mono font-semibold">{sepNo}</span> terbit pukul {sepAt}. Lanjut pilih poli
          dan dokter.
        </Alert>
      )}
      {bpjs && !sepNo && referral && <ReferralInfo referral={referral} />}
      {bpjs && !sepNo && !referral && <Alert level="info">{infoText}</Alert>}
    </div>
  );
}
