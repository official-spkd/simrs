'use client';

import { formatJam, formatRupiah, formatTanggal, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip } from '@simrs/ui';
import { useState } from 'react';
import {
  type Flash,
  FlashLine,
  Panel,
  ReasonButton,
  SelectField,
  StageTrack,
  TableWrap,
  TD,
  TH,
} from '@/components/backoffice/kit';
import { demoNow } from '@/lib/demo/fixtures/waktu';
import {
  calculateBlock,
  computeSlip,
  journalBalanced,
  type PayInput,
  parseRupiahInput,
  payrollApproveBlock,
  payrollJournal,
  RUN_STAGES,
} from '@/lib/penggajian';

const rp = (n: bigint) => formatRupiah(n);

/**
 * B05 · Run gaji satu periode: draf (impor jasa pelayanan U08, isi PPh 21 manual) → hitung → setujui (penyetuju ≠
 * penyusun) → posting jurnal berpasangan; slip per pegawai. Angka simulasi, tidak disimpan.
 */
export function PayrollBoard({
  period,
  inputs,
  serviceFees,
  preparer,
  approvers,
}: {
  period: { label: string; number: string; payDate: string };
  inputs: readonly PayInput[];
  serviceFees: Record<string, number>;
  preparer: string;
  approvers: readonly string[];
}) {
  const [stage, setStage] = useState(0);
  const [at, setAt] = useState<Record<number, string>>({});
  const [imported, setImported] = useState(false);
  const [pph, setPph] = useState<Record<string, string>>(() =>
    Object.fromEntries(inputs.map((i) => [i.employeeId, i.pph21 === null ? '' : String(i.pph21)])),
  );
  const [approver, setApprover] = useState('');
  const [slipFor, setSlipFor] = useState(inputs[0]?.employeeId ?? '');
  const [sent, setSent] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);

  const lines: PayInput[] = inputs.map((i) => ({
    ...i,
    serviceFee: imported ? BigInt(serviceFees[i.name] ?? 0) : 0n,
    pph21: parseRupiahInput(pph[i.employeeId] ?? ''),
  }));
  const slips = lines.map(computeSlip);
  const totals = slips.reduce(
    (t, s) => ({ gross: t.gross + s.gross, ded: t.ded + s.totalDeductions, net: t.net + s.net }),
    { gross: 0n, ded: 0n, net: 0n },
  );
  const journal = payrollJournal(slips);
  const go = (to: number, text: string) => {
    setStage(to);
    setAt((cur) => ({ ...cur, [to]: formatTanggalWaktu(demoNow()) }));
    setFlash({ ok: true, text: `${period.number}: ${text} · ${formatJam(demoNow())}.` });
  };
  const calcBlock = calculateBlock(lines, imported);
  const apprBlock = approver ? payrollApproveBlock(preparer, approver) : 'Pilih penyetuju.';
  const idx = inputs.findIndex((i) => i.employeeId === slipFor);
  const slip = slips[idx];
  const slipLine = lines[idx];

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <Panel
        title={`Run gaji ${period.label} · ${period.number}`}
        sub={`Disusun ${preparer} · dibayar ${formatTanggal(period.payDate)} · tarif iuran simulasi`}
        actions={<Chip tone={stage >= 3 ? 'success' : 'info'}>{RUN_STAGES[Math.min(stage, 3)]}</Chip>}
      >
        <StageTrack
          label="Tahap run gaji"
          stages={RUN_STAGES.map((label, i) => ({ label, at: (i === 3 ? at[3] : at[i + 1]) ?? null }))}
          current={stage >= 3 ? RUN_STAGES.length : stage}
        />
        {stage === 0 && (
          <span className="flex flex-wrap items-start gap-2">
            {imported ? (
              <Chip tone="success">Jasa pelayanan diimpor dari modul jasa pelayanan</Chip>
            ) : (
              <Button
                onClick={() => {
                  setImported(true);
                  setFlash({
                    ok: true,
                    text: `Jasa pelayanan ${period.label} diimpor untuk ${inputs.length} pegawai · ${formatJam(demoNow())}.`,
                  });
                }}
              >
                Impor jasa pelayanan
              </Button>
            )}
            <ReasonButton
              reason={calcBlock}
              onClick={() => go(1, `gaji ${inputs.length} pegawai dihitung; neto ${rp(totals.net)}`)}
            >
              Hitung gaji
            </ReasonButton>
          </span>
        )}
        {stage === 1 && (
          <div className="flex flex-col gap-3">
            <SelectField
              label="Penyetuju"
              value={approver}
              onChange={setApprover}
              placeholder="Pilih penyetuju…"
              options={approvers.map((a) => [a, a])}
              hint={`Penyusun: ${preparer}. Penyetuju wajib orang lain.`}
            />
            <span className="flex flex-wrap items-start gap-2">
              <ReasonButton reason={apprBlock} onClick={() => go(2, `disetujui ${approver}`)}>
                Setujui run gaji
              </ReasonButton>
              <Button variant="ghost" onClick={() => setStage(0)}>
                Kembali ke draf
              </Button>
            </span>
          </div>
        )}
        {stage === 2 && (
          <span>
            <ReasonButton
              reason={journalBalanced(journal) ? null : 'Jurnal tidak seimbang; periksa ulang run.'}
              onClick={() => go(3, 'jurnal gaji diposting ke buku besar')}
            >
              Posting jurnal gaji
            </ReasonButton>
          </span>
        )}
        {stage >= 3 && (
          <Alert level="success" title={`Diposting · ${at[3] ?? ''}`}>
            Jurnal gaji {rp(totals.gross)} seimbang tercatat; transfer neto {rp(totals.net)} dijadwalkan ke
            rekening pegawai pada tanggal bayar.
          </Alert>
        )}
      </Panel>

      <Panel
        title="Rincian per pegawai"
        sub={imported ? 'Termasuk jasa pelayanan periode ini' : 'Jasa pelayanan belum diimpor'}
        flush
      >
        <TableWrap label="Rincian gaji per pegawai" minWidth={760}>
          <thead>
            <tr>
              <th className={TH}>Pegawai</th>
              <th className={`${TH} text-right`}>Bruto</th>
              <th className={`${TH} text-right`}>Jasa pelayanan</th>
              <th className={TH}>PPh 21 (manual)</th>
              <th className={`${TH} text-right`}>Potongan</th>
              <th className={`${TH} text-right`}>Neto</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const s = slips[i];
              const raw = pph[l.employeeId] ?? '';
              const bad = raw.trim() !== '' && l.pph21 === null;
              return (
                <tr key={l.employeeId}>
                  <td className={TD}>
                    <span className="block font-semibold">{l.name}</span>
                    <span className="block text-caption text-ink-500">{l.position}</span>
                  </td>
                  <td className={`${TD} text-right font-mono whitespace-nowrap`}>{s ? rp(s.gross) : ''}</td>
                  <td className={`${TD} text-right font-mono whitespace-nowrap`}>{rp(l.serviceFee)}</td>
                  <td className={TD}>
                    <input
                      aria-label={`PPh 21 ${l.name}`}
                      inputMode="numeric"
                      value={raw}
                      disabled={stage > 0}
                      aria-invalid={bad || raw.trim() === ''}
                      onChange={(e) => setPph((cur) => ({ ...cur, [l.employeeId]: e.target.value }))}
                      className="h-11 w-36 rounded-control border border-line-strong bg-white px-3 text-right font-mono disabled:bg-muted"
                    />
                    {raw.trim() === '' && (
                      <span className="block text-caption text-warning">belum diisi</span>
                    )}
                    {bad && <span className="block text-caption text-danger">angka rupiah utuh</span>}
                  </td>
                  <td className={`${TD} text-right font-mono whitespace-nowrap`}>
                    {s ? rp(s.totalDeductions) : ''}
                  </td>
                  <td className={`${TD} text-right font-mono font-semibold whitespace-nowrap`}>
                    {s ? rp(s.net) : ''}
                  </td>
                </tr>
              );
            })}
            <tr>
              <th scope="row" className={`${TD} text-left`}>
                Total {inputs.length} pegawai
              </th>
              <td className={`${TD} text-right font-mono font-semibold`}>{rp(totals.gross)}</td>
              <td className={TD} />
              <td className={TD} />
              <td className={`${TD} text-right font-mono font-semibold`}>{rp(totals.ded)}</td>
              <td className={`${TD} text-right font-mono font-semibold`}>{rp(totals.net)}</td>
            </tr>
          </tbody>
        </TableWrap>
      </Panel>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1_1_420px]">
          <Panel
            title="Jurnal gaji"
            sub={journalBalanced(journal) ? 'Debit = kredit' : 'Tidak seimbang'}
            flush
          >
            <TableWrap label="Jurnal posting gaji" minWidth={480}>
              <thead>
                <tr>
                  <th className={TH}>Akun</th>
                  <th className={`${TH} text-right`}>Debit</th>
                  <th className={`${TH} text-right`}>Kredit</th>
                </tr>
              </thead>
              <tbody>
                {journal.map((j) => (
                  <tr key={j.account}>
                    <td className={TD}>{j.account}</td>
                    <td className={`${TD} text-right font-mono whitespace-nowrap`}>
                      {j.debit ? rp(j.debit) : ''}
                    </td>
                    <td className={`${TD} text-right font-mono whitespace-nowrap`}>
                      {j.credit ? rp(j.credit) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Panel>
        </div>
        <div className="min-w-0 flex-[1_1_360px]">
          <Panel
            title="Slip gaji"
            sub={stage >= 1 ? 'Dari hasil hitung run' : 'Pratinjau; final setelah dihitung'}
          >
            <SelectField
              label="Pegawai"
              value={slipFor}
              onChange={setSlipFor}
              options={inputs.map((i) => [i.employeeId, i.name])}
            />
            {slip && slipLine && (
              <dl aria-label={`Slip ${slipLine.name}`} className="m-0 flex flex-col gap-1 text-small">
                {slip.earnings.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt>{k}</dt>
                    <dd className="m-0 font-mono">{rp(v)}</dd>
                  </div>
                ))}
                {slip.deductions.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 text-ink-700">
                    <dt>{k}</dt>
                    <dd className="m-0 font-mono">−{rp(v)}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t border-line pt-1.5 font-semibold">
                  <dt>Diterima (neto)</dt>
                  <dd className="m-0 font-mono">{rp(slip.net)}</dd>
                </div>
              </dl>
            )}
            {stage >= 3 &&
              (sent ? (
                <span className="text-small font-semibold text-success">{sent}</span>
              ) : (
                <span>
                  <Button
                    onClick={() =>
                      setSent(
                        `Slip ${inputs.length} pegawai terkirim ke akun masing-masing · ${formatJam(demoNow())}`,
                      )
                    }
                  >
                    Kirim slip ke pegawai
                  </Button>
                </span>
              ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}
