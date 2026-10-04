import type { Claim } from '@simrs/shared';
import { Chip, type ChipTone } from '@simrs/ui';
import type { ReactNode } from 'react';

const ROLE: Record<Claim['diagnoses'][number]['role'], { label: string; tone: ChipTone }> = {
  utama: { label: 'utama', tone: 'brand' },
  sekunder: { label: 'sekunder', tone: 'neutral' },
  'perlu-bukti': { label: 'perlu bukti', tone: 'warning' },
  sementara: { label: 'sementara', tone: 'info' },
};

const TH = 'pb-1.5 text-left text-caption font-semibold text-ink-500';
const TD = 'border-t border-[#EEF1F4] py-1.5 align-top';

/**
 * Tabel kode klaim (mockup Klaim): diagnosis ICD-10 dan prosedur ICD-9-CM yang ditarik dari resume, order, dan
 * tindakan. Koder memvalidasi, bukan mengetik ulang. Kode hanya dari rujukan seed.
 */
export function ClaimCodes({
  diagnoses,
  procedures,
  diagnosisExtra,
}: {
  diagnoses: Claim['diagnoses'];
  procedures: Claim['procedures'];
  /** Panel di bawah tabel diagnosis (saran koding, validasi skenario). */
  diagnosisExtra?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2.5 border-b border-[#EEF1F4] px-4 py-3.5 lg:border-r lg:border-b-0">
        <table aria-label="Diagnosis ICD-10" className="w-full border-collapse text-[13px]">
          <caption className="pb-2 text-left font-semibold">Diagnosis ICD-10</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>
                Kode
              </th>
              <th scope="col" className={TH}>
                Diagnosis
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Peran
              </th>
            </tr>
          </thead>
          <tbody>
            {diagnoses.map((d) => (
              <tr key={`${d.code}-${d.role}`}>
                <td className={`${TD} pr-2 font-mono font-semibold text-brand-700`}>{d.code}</td>
                <td className={`${TD} pr-2`}>{d.name}</td>
                <td className={`${TD} text-right`}>
                  <Chip tone={ROLE[d.role].tone}>{ROLE[d.role].label}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {diagnosisExtra}
      </div>
      <div className="flex min-w-0 flex-col gap-2.5 px-4 py-3.5">
        <table aria-label="Prosedur ICD-9-CM" className="w-full border-collapse text-[13px]">
          <caption className="pb-2 text-left font-semibold">Prosedur ICD-9-CM</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>
                Kode
              </th>
              <th scope="col" className={TH}>
                Prosedur
              </th>
            </tr>
          </thead>
          <tbody>
            {procedures.map((p) => (
              <tr key={p.code}>
                <td className={`${TD} w-16 pr-2 font-mono font-semibold text-brand-700`}>{p.code}</td>
                <td className={TD}>{p.name}</td>
              </tr>
            ))}
            {procedures.length === 0 && (
              <tr>
                <td colSpan={2} className={`${TD} text-ink-500`}>
                  Tidak ada prosedur tercatat.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <span className="text-caption text-ink-500">
          Kode ditarik otomatis dari resume, order, dan tindakan. Koder memvalidasi, bukan mengetik ulang.
        </span>
      </div>
    </div>
  );
}
