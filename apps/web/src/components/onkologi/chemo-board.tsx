'use client';

import { formatJam, formatTanggal } from '@simrs/shared';
import { Alert, Chip, SafetyGate } from '@simrs/ui';
import { useState } from 'react';
import {
  chemoGateAction,
  lockChemoOrderAction,
  verifyChemoAction,
} from '@/app/(staf)/klinis/onkologi/actions';
import {
  type Flash,
  FlashLine,
  KeyValues,
  Panel,
  ReasonButton,
  SelectField,
  StageTrack,
  TableWrap,
  TD,
  TextField,
  TH,
} from '@/components/backoffice/kit';
import { useStoreAction } from '@/lib/demo/store/client';
import {
  addDays,
  chemoInputValid,
  chemoVerifyBlock,
  doseMg,
  type LabValue,
  labFailures,
  lockChemoOrder,
  mosteller,
  verifierBlock,
} from '@/lib/onkologi';
import { cycleStage, type OncologyCycle } from '@/lib/onkologi-toko';

const STAGES = [
  'Order ditulis',
  'Gerbang laboratorium',
  'Verifikasi 1',
  'Verifikasi 2',
  'Siap diracik',
] as const;
const fmt = (n: number) => n.toLocaleString('id-ID');

interface Plan {
  regimen: string;
  intervalDays: number;
  totalCycles: number;
  cycle: number;
  lastCycleDate: string;
  writer: string;
  heightCm: number;
  weightKg: number;
  previousWeightKg: number;
  drugs: ReadonlyArray<{ name: string; mgPerM2: number; route: string }>;
}

/** Jejak siklus dari rekam tersimpan (order, gerbang, verifikasi), urut waktu. */
function trail(plan: Plan, c: OncologyCycle | undefined): string[] {
  if (!c?.lock) return [];
  const out = [
    `order ditulis ${plan.writer} (LPT ${c.lock.bsa.toLocaleString('id-ID')} m², dosis ${c.lock.pct}%) · ${formatJam(c.lock.at)}`,
  ];
  const g = c.gate;
  if (g) {
    out.push(
      g.decision === 'tunda' && g.deferredTo
        ? `Siklus ditunda ke ${formatTanggal(g.deferredTo)} · ${formatJam(g.at)}`
        : g.decision === 'override'
          ? `gerbang lab di-override: ${g.reason ?? ''} · ${formatJam(g.at)}`
          : `laboratorium memenuhi ambang · ${formatJam(g.at)}`,
    );
  }
  for (const v of c.verify) {
    out.push(
      v.n === 1
        ? `verifikasi 1 oleh ${v.verifier}: dosis cocok · ${formatJam(v.at)}`
        : `verifikasi 2 oleh ${v.verifier}: dosis cocok; siap diracik di BSC farmasi · ${formatJam(v.at)}`,
    );
  }
  return out;
}

/**
 * B11 · Satu siklus kemoterapi: dosis dari LPT Mosteller (penyesuaian < 100% beralasan), gerbang lab pra-kemo
 * (tunda atau override beralasan), verifikasi ganda dua pelaku berbeda, lalu siap diracik di farmasi. Setiap tahap
 * diperiksa dan disimpan server (toko demo `onkologi`, ADR-0085); tahap dan jejak siklus datang dari server.
 */
export function ChemoBoard({
  plan,
  labs,
  verifiers,
  cycle,
  rev,
}: {
  plan: Plan;
  labs: readonly LabValue[];
  verifiers: readonly string[];
  /** Keadaan siklus tersimpan. */
  cycle: OncologyCycle | undefined;
  /** Revisi toko `onkologi`. */
  rev: number;
}) {
  const { run, pending } = useStoreAction(rev);
  const lockedSaved = cycle?.lock ?? null;
  const [height, setHeight] = useState(String(lockedSaved?.heightCm ?? plan.heightCm));
  const [weight, setWeight] = useState(String(lockedSaved?.weightKg ?? plan.weightKg));
  const [pct, setPct] = useState(String(lockedSaved?.pct ?? 100));
  const [reason, setReason] = useState(lockedSaved?.reason ?? '');
  const [v1, setV1] = useState(cycle?.verify.find((v) => v.n === 1)?.verifier ?? '');
  const [v2, setV2] = useState('');
  const [flash, setFlash] = useState<Flash | null>(null);

  const stage = cycleStage(cycle);
  const locked = lockedSaved;
  const deferred = cycle?.gate?.decision === 'tunda' ? cycle.gate.deferredTo : null;
  const overridden = cycle?.gate?.decision === 'override';
  const log = trail(plan, cycle);
  const h = Number(height);
  const w = Number(weight);
  const valid = chemoInputValid(h, w);
  const bsa = locked ? locked.bsa : valid ? mosteller(h, w) : 0;
  const p = Number(pct);
  const lockResult = lockChemoOrder({ heightCm: h, weightKg: w, pct: p, reason }, plan.drugs);
  const failures = labFailures(labs);
  const weightShift = Math.abs(w - plan.previousWeightKg) / plan.previousWeightKg;
  const due = addDays(plan.lastCycleDate, plan.intervalDays);
  const orderBlock = 'block' in lockResult ? lockResult.block : null;
  const say = (res: { ok: boolean; message: string }) => setFlash({ ok: res.ok, text: res.message });
  const firstVerifier = cycle?.verify.find((v) => v.n === 1)?.verifier ?? (v1 || null);

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <Panel
        title={`${plan.regimen} · siklus ${plan.cycle} dari ${plan.totalCycles}`}
        sub={`Tiap ${plan.intervalDays} hari · siklus sebelumnya ${formatTanggal(plan.lastCycleDate)} · jadwal ${formatTanggal(due)}`}
        actions={
          deferred ? (
            <Chip tone="warning">Ditunda</Chip>
          ) : (
            <Chip tone={stage >= 4 ? 'success' : 'info'}>{STAGES[Math.min(stage, 4)]}</Chip>
          )
        }
      >
        <StageTrack
          label={`Tahap siklus ${plan.cycle}`}
          stages={STAGES.map((label) => ({ label }))}
          current={stage >= 4 ? STAGES.length : stage}
          rejected={!!deferred}
        />
        {log.length > 0 && (
          <ol
            aria-label="Jejak siklus"
            className="m-0 flex list-none flex-col gap-1 p-0 text-caption text-ink-700"
          >
            {log.map((l) => (
              <li key={l} className="border-l-2 border-brand-600 pl-2">
                {l}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_460px]">
          <Panel title="Perhitungan dosis" sub={`Penulis order: ${plan.writer}`} flush>
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
              <TextField
                label="Tinggi badan (cm)"
                inputMode="decimal"
                value={height}
                onChange={setHeight}
                disabled={locked !== null}
              />
              <TextField
                label="Berat badan (kg)"
                inputMode="decimal"
                value={weight}
                onChange={setWeight}
                disabled={locked !== null}
                hint={
                  valid && weightShift > 0.1
                    ? 'Berubah > 10% dari siklus lalu: tinjau ulang dosis.'
                    : `Siklus lalu ${plan.previousWeightKg} kg`
                }
              />
              <SelectField
                label="Dosis"
                value={pct}
                onChange={setPct}
                disabled={locked !== null}
                options={[
                  ['100', '100% (penuh)'],
                  ['80', '80% (penyesuaian)'],
                  ['75', '75% (penyesuaian)'],
                ]}
              />
            </div>
            {p < 100 && (
              <div className="px-4 pb-3">
                <TextField
                  label="Alasan penyesuaian dosis"
                  rows={2}
                  value={reason}
                  onChange={setReason}
                  disabled={locked !== null}
                />
              </div>
            )}
            <div className="px-4 pb-2 text-small">
              Luas permukaan tubuh (Mosteller):{' '}
              <span className="font-mono font-semibold">
                {valid ? `${bsa.toLocaleString('id-ID')} m²` : '—'}
              </span>
            </div>
            <TableWrap label="Dosis per obat" minWidth={520}>
              <thead>
                <tr>
                  <th className={TH}>Obat</th>
                  <th className={`${TH} text-right`}>mg/m²</th>
                  <th className={`${TH} text-right`}>Dosis</th>
                  <th className={TH}>Cara</th>
                </tr>
              </thead>
              <tbody>
                {plan.drugs.map((d) => (
                  <tr key={d.name}>
                    <td className={TD}>{d.name}</td>
                    <td className={`${TD} text-right font-mono`}>{fmt(d.mgPerM2)}</td>
                    <td className={`${TD} text-right font-mono font-semibold whitespace-nowrap`}>
                      {locked
                        ? `${fmt(locked.doses[d.name] ?? 0)} mg`
                        : valid
                          ? `${fmt(doseMg(d.mgPerM2, bsa, p))} mg`
                          : '—'}
                    </td>
                    <td className={TD}>{d.route}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            {stage === 0 && !deferred && (
              <div className="p-4">
                <ReasonButton
                  reason={orderBlock ?? (pending ? 'Menyimpan…' : null)}
                  onClick={() =>
                    run((r) => lockChemoOrderAction({ heightCm: h, weightKg: w, pct: p, reason }, r), say)
                  }
                >
                  Kunci order siklus {plan.cycle}
                </ReasonButton>
              </div>
            )}
          </Panel>
        </div>
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 xl:max-w-[440px]">
          <Panel title="Laboratorium pra-kemoterapi" sub="Pagi ini · ambang minimal protokol">
            <KeyValues
              rows={labs.map((l) => [
                l.label,
                <span key={l.label} className={l.value < l.min ? 'font-semibold text-danger' : ''}>
                  {fmt(l.value)} {l.unit} {l.value < l.min ? `(< ${fmt(l.min)})` : '✓'}
                </span>,
              ])}
            />
          </Panel>
          {stage === 1 &&
            !deferred &&
            (failures.length > 0 ? (
              <SafetyGate
                title={`${failures.map((f) => f.label).join(', ')} di bawah ambang`}
                recommendation={`Tunda siklus ${plan.intervalDays / 2} hari`}
                overrideLabel="Tetap berikan dengan alasan klinis"
                onFollow={() => run((r) => chemoGateAction({ decision: 'tunda', reason: '' }, r), say)}
                onOverride={(why) =>
                  run((r) => chemoGateAction({ decision: 'override', reason: why }, r), say)
                }
              >
                {failures
                  .map((f) => `${f.label} ${fmt(f.value)} ${f.unit} (ambang ${fmt(f.min)})`)
                  .join('; ')}
                . Pemberian tertahan sampai ditindaklanjuti.
              </SafetyGate>
            ) : (
              <ReasonButton
                reason={pending ? 'Menyimpan…' : null}
                onClick={() => run((r) => chemoGateAction({ decision: 'lolos', reason: '' }, r), say)}
              >
                Lanjut ke verifikasi
              </ReasonButton>
            ))}
          {deferred && (
            <Alert level="info" title={`Ditunda ke ${formatTanggal(deferred)}`}>
              Order tidak diteruskan ke farmasi. Pasien dijadwalkan ulang dan diberi tahu lewat aplikasi.
            </Alert>
          )}
          {(stage === 2 || stage === 3) && (
            <Panel
              title={`Verifikasi ${stage - 1} dari 2`}
              sub="Hitung ulang LPT dan dosis secara independen"
            >
              <SelectField
                label={`Verifikator ${stage - 1}`}
                value={stage === 2 ? v1 : v2}
                onChange={stage === 2 ? setV1 : setV2}
                placeholder="Pilih verifikator…"
                options={verifiers.map((v) => [v, v])}
              />
              <ReasonButton
                reason={
                  chemoVerifyBlock(locked, { heightCm: h, weightKg: w, pct: p }) ??
                  verifierBlock(plan.writer, firstVerifier, v2 || null, stage === 2 ? 1 : 2) ??
                  (pending ? 'Menyimpan…' : null)
                }
                onClick={() =>
                  run(
                    (r) =>
                      verifyChemoAction(stage === 2 ? { n: 1, verifier: v1 } : { n: 2, verifier: v2 }, r),
                    say,
                  )
                }
              >
                Dosis cocok, verifikasi
              </ReasonButton>
            </Panel>
          )}
          {stage >= 4 && (
            <Alert level="success" title="Siap diracik">
              Verifikasi ganda selesai ({cycle?.verify.map((v) => v.verifier).join(' dan ')}). Order masuk
              antrean peracikan sitostatika farmasi.
              {overridden ? ' Override gerbang lab tercatat untuk ditinjau.' : ''}
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}
