'use client';

import { type FinancingFacility, formatRupiah, type ScenarioClaim } from '@simrs/shared';
import { Button, Chip, type ChipTone } from '@simrs/ui';
import type { useScenarioTask } from './use-scenario-task';

type Scenario = ReturnType<typeof useScenarioTask>;

const STAGE: Record<ScenarioClaim['stage'], [string, ChipTone]> = {
  layak: ['Layak bayar · belum di pool', 'success'],
  'di-pool': ['Di pool · eligible', 'brand'],
  diajukan: ['Pencairan diajukan', 'info'],
  dicairkan: ['Dibiayai · cair', 'brand'],
  'dibayar-bpjs': ['Dibayar BPJS · lunas otomatis', 'neutral'],
};

/**
 * Klaim pasien skenario (Ny. Ratna Sari, layak bayar Rp 7.140.000) di pool pembiayaan piutang: langkah
 * `pembiayaan` (pool → ajukan → cair → BPJS membayar) dari tombol asli bila tugasnya giliran.
 */
export function ScenarioClaimCard({
  claim,
  facility,
  scenario,
}: {
  claim: ScenarioClaim;
  facility: FinancingFacility;
  scenario: Scenario;
}) {
  const [label, tone] = STAGE[claim.stage];
  const busy = scenario.pending;
  const r = claim.repayment;
  return (
    <section
      aria-label="Klaim pasien skenario"
      className="flex flex-col gap-2.5 rounded-card border border-brand-200 bg-card-header p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="text-caption font-semibold text-brand-700">Simulasi · Elektif TPDI × BTN</span>
          <span className="font-semibold">
            {claim.patient.name}{' '}
            <span className="font-mono text-small font-normal text-ink-500">RM {claim.patient.rm}</span>
          </span>
          <span className="text-small text-ink-700">
            Klaim rawat inap · SEP <span className="font-mono">{claim.sep}</span> ·{' '}
            {formatRupiah(BigInt(claim.amount))} · advance {facility.advanceRatePercent}%{' '}
            {formatRupiah(BigInt(claim.advance))}
          </span>
        </span>
        <Chip tone={tone}>{label}</Chip>
      </div>
      {scenario.can('pembiayaan', 'pool') && (
        <Button
          variant="primary"
          className="self-start"
          disabled={busy}
          onClick={() => scenario.fire('pembiayaan', 'pool')}
        >
          Masukkan klaim ke pool pembiayaan BTN
        </Button>
      )}
      {scenario.can('pembiayaan', 'ajukan') && (
        <div role="group" aria-label="Cairkan lebih awal?" className="flex flex-wrap items-center gap-2">
          <span className="text-small font-semibold">Cairkan lebih awal?</span>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => scenario.fire('pembiayaan', 'ajukan', 'ya')}
          >
            Ajukan {facility.advanceRatePercent}% · {formatRupiah(BigInt(claim.advance))}
          </Button>
          <Button disabled={busy} onClick={() => scenario.fire('pembiayaan', 'ajukan', 'tidak')}>
            Tunggu BPJS membayar
          </Button>
          <span className="text-caption text-ink-500">margin simulasi {facility.marginBps / 100}% p.a.</span>
        </div>
      )}
      {scenario.can('pembiayaan', 'cair') && (
        <Button
          variant="primary"
          className="self-start"
          disabled={busy}
          onClick={() => scenario.fire('pembiayaan', 'cair')}
        >
          Simulasi: BTN mencairkan ke {facility.operationalAccount}
        </Button>
      )}
      {scenario.can('pembiayaan', 'bpjs') && (
        <Button
          variant="primary"
          className="self-start"
          disabled={busy}
          onClick={() => scenario.fire('pembiayaan', 'bpjs')}
        >
          Lompat ke pembayaran BPJS ke {facility.claimAccount}
        </Button>
      )}
      {r && (
        <div role="status">
          <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-small">
            <dt>BPJS membayar ke penampungan {facility.claimAccount}</dt>
            <dd className="m-0 text-right font-mono font-semibold">{formatRupiah(BigInt(r.bpjsPaid))}</dd>
            {claim.decision === 'ya' && (
              <>
                <dt>Auto-debit pokok + margin {r.days} hari</dt>
                <dd className="m-0 text-right font-mono">
                  − {formatRupiah(BigInt(r.principal) + BigInt(r.margin))}
                </dd>
              </>
            )}
            <dt className="font-bold">Diteruskan ke operasional {facility.operationalAccount}</dt>
            <dd className="m-0 text-right font-mono font-bold">{formatRupiah(BigInt(r.forwarded))}</dd>
          </dl>
        </div>
      )}
      {scenario.error && (
        <span className="text-caption font-semibold text-danger">{scenario.error.message}</span>
      )}
    </section>
  );
}
