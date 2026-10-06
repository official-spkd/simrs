'use client';

import { formatJam, formatTanggal } from '@simrs/shared';
import { Alert, Chip, SafetyGate, type SafetyGateResolution } from '@simrs/ui';
import { useState } from 'react';
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
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  addDays,
  adjustmentBlock,
  doseMg,
  type LabValue,
  labFailures,
  mosteller,
  verifierBlock,
} from '@/lib/onkologi';

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

/**
 * B11 · Satu siklus kemoterapi: dosis dari LPT Mosteller (penyesuaian < 100% beralasan), gerbang lab pra-kemo
 * (tunda atau override beralasan), verifikasi ganda dua pelaku berbeda, lalu siap diracik di farmasi.
 */
export function ChemoBoard({
  plan,
  labs,
  verifiers,
}: {
  plan: Plan;
  labs: readonly LabValue[];
  verifiers: readonly string[];
}) {
  const [height, setHeight] = useState(String(plan.heightCm));
  const [weight, setWeight] = useState(String(plan.weightKg));
  const [pct, setPct] = useState('100');
  const [reason, setReason] = useState('');
  const [stage, setStage] = useState(0);
  const [gate, setGate] = useState<SafetyGateResolution | null>(null);
  const [deferred, setDeferred] = useState<string | null>(null);
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [flash, setFlash] = useState<Flash | null>(null);

  const h = Number(height);
  const w = Number(weight);
  const valid = Number.isFinite(h) && Number.isFinite(w) && h >= 100 && h <= 220 && w >= 25 && w <= 200;
  const bsa = valid ? mosteller(h, w) : 0;
  const p = Number(pct);
  const failures = labFailures(labs);
  const weightShift = Math.abs(w - plan.previousWeightKg) / plan.previousWeightKg;
  const due = addDays(plan.lastCycleDate, plan.intervalDays);
  const step = (to: number, text: string) => {
    const at = formatJam(demoNow());
    setStage(to);
    setLog((cur) => [...cur, `${text} · ${at}`]);
    setFlash({ ok: true, text: `Siklus ${plan.cycle}: ${text} · ${at}.` });
  };
  const orderBlock = !valid
    ? 'Isi tinggi (100–220 cm) dan berat badan (25–200 kg) yang wajar.'
    : adjustmentBlock(p, reason);

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
              <TextField label="Tinggi badan (cm)" inputMode="decimal" value={height} onChange={setHeight} />
              <TextField
                label="Berat badan (kg)"
                inputMode="decimal"
                value={weight}
                onChange={setWeight}
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
                options={[
                  ['100', '100% (penuh)'],
                  ['80', '80% (penyesuaian)'],
                  ['75', '75% (penyesuaian)'],
                ]}
              />
            </div>
            {p < 100 && (
              <div className="px-4 pb-3">
                <TextField label="Alasan penyesuaian dosis" rows={2} value={reason} onChange={setReason} />
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
                      {valid ? `${fmt(doseMg(d.mgPerM2, bsa, p))} mg` : '—'}
                    </td>
                    <td className={TD}>{d.route}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            {stage === 0 && !deferred && (
              <div className="p-4">
                <ReasonButton
                  reason={orderBlock}
                  onClick={() =>
                    step(
                      1,
                      `order ditulis ${plan.writer} (LPT ${bsa.toLocaleString('id-ID')} m², dosis ${p}%)`,
                    )
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
            (failures.length > 0 && !gate ? (
              <SafetyGate
                title={`${failures.map((f) => f.label).join(', ')} di bawah ambang`}
                recommendation={`Tunda siklus ${plan.intervalDays / 2} hari`}
                overrideLabel="Tetap berikan dengan alasan klinis"
                onFollow={() => {
                  const to = addDays(due, 7);
                  setGate({ kind: 'ikuti', text: `Siklus ditunda ke ${formatTanggal(to)}` });
                  setDeferred(to);
                  setLog((cur) => [
                    ...cur,
                    `Siklus ditunda ke ${formatTanggal(to)} · ${formatJam(demoNow())}`,
                  ]);
                  setFlash({
                    ok: true,
                    text: `Siklus ${plan.cycle} ditunda ke ${formatTanggal(to)}; cek ulang darah lengkap dijadwalkan (simulasi).`,
                  });
                }}
                onOverride={(why) => {
                  setGate({ kind: 'override', text: why });
                  step(2, `gerbang lab di-override: ${why}`);
                }}
              >
                {failures
                  .map((f) => `${f.label} ${fmt(f.value)} ${f.unit} (ambang ${fmt(f.min)})`)
                  .join('; ')}
                . Pemberian tertahan sampai ditindaklanjuti.
              </SafetyGate>
            ) : (
              <ReasonButton reason={null} onClick={() => step(2, 'laboratorium memenuhi ambang')}>
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
                reason={verifierBlock(plan.writer, v1 || null, v2 || null, stage === 2 ? 1 : 2)}
                onClick={() =>
                  stage === 2
                    ? step(3, `verifikasi 1 oleh ${v1}: dosis cocok`)
                    : step(4, `verifikasi 2 oleh ${v2}: dosis cocok; siap diracik di BSC farmasi`)
                }
              >
                Dosis cocok, verifikasi
              </ReasonButton>
            </Panel>
          )}
          {stage >= 4 && (
            <Alert level="success" title="Siap diracik">
              Verifikasi ganda selesai ({v1} dan {v2}). Order masuk antrean peracikan sitostatika farmasi.
              {gate?.kind === 'override' ? ' Override gerbang lab tercatat untuk ditinjau.' : ''}
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}
