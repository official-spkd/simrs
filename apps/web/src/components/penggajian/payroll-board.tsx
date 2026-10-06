'use client';

import { formatRupiah, formatTanggal, formatTanggalWaktu } from '@simrs/shared';
import { Alert, Button, Chip } from '@simrs/ui';
import { useState } from 'react';
import {
  FlashLine,
  Panel,
  ReasonButton,
  SelectField,
  StageTrack,
  TableWrap,
  TD,
  TH,
} from '@/components/backoffice/kit';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import {
  calculateBlock,
  computeSlip,
  journalBalanced,
  type PayInput,
  parseRupiahInput,
  payrollJournal,
  RUN_STAGES,
} from '@/lib/penggajian';
import {
  PAYROLL_APPROVER_ROLES,
  type PayrollStoreState,
  payrollLines,
  postingEvent,
} from '@/lib/penggajian-toko';

const rp = (n: bigint) => formatRupiah(n);

/**
 * B05 · Run gaji satu periode: draf (impor jasa pelayanan U08, isi PPh 21 manual) → hitung (penyusun = pengguna
 * sesi) → setujui (pengguna lain, posisi Akuntan/Manajemen) → posting jurnal berpasangan; slip per pegawai. Semua
 * tahap tersimpan di toko demo (domain `penggajian`, ADR-0085); tarif iuran simulasi.
 */
export function PayrollBoard({
  period,
  inputs,
  state,
  rev,
  viewerId,
  viewerRole,
}: {
  period: { label: string; number: string; payDate: string };
  inputs: readonly PayInput[];
  state: PayrollStoreState;
  rev: number;
  viewerId: string;
  viewerRole: string | null;
}) {
  const stage = state.stage;
  const imported = state.imported;
  const { act, pending, flash } = useTokoAction('penggajian', rev);
  // Isian PPh 21 yang sedang diketik; selain itu nilai tersimpan run (toko) atau nilai awal fixture.
  const [pphEdit, setPph] = useState<Record<string, string>>({});
  const pph = Object.fromEntries(
    inputs.map((i) => [
      i.employeeId,
      pphEdit[i.employeeId] ?? state.pph[i.employeeId] ?? (i.pph21 === null ? '' : String(i.pph21)),
    ]),
  );
  const [slipFor, setSlipFor] = useState(inputs[0]?.employeeId ?? '');
  const draftPph = Object.fromEntries(
    inputs.map((i) => [i.employeeId, parseRupiahInput(pph[i.employeeId] ?? '')]),
  );
  const lines: PayInput[] = payrollLines(state, draftPph);
  const slips = lines.map(computeSlip);
  const totals = slips.reduce(
    (t, s) => ({ gross: t.gross + s.gross, ded: t.ded + s.totalDeductions, net: t.net + s.net }),
    { gross: 0n, ded: 0n, net: 0n },
  );
  const journal = payrollJournal(slips);
  const at = (i: 1 | 2 | 3) => (state.at[i] ? formatTanggalWaktu(state.at[i] as string) : null);
  const calcBlock = pending ? 'Menyimpan…' : calculateBlock(lines, imported);
  const apprBlock = pending
    ? 'Menyimpan…'
    : !viewerRole || !(PAYROLL_APPROVER_ROLES as readonly string[]).includes(viewerRole)
      ? 'Penyetuju run gaji: posisi Akuntan atau Manajemen.'
      : state.preparedBy?.userId === viewerId
        ? 'Anda penyusun run ini: penyetuju harus pengguna lain (pemisahan tugas).'
        : null;
  const idx = inputs.findIndex((i) => i.employeeId === slipFor);
  const slip = slips[idx];
  const slipLine = lines[idx];
  const calculate = () => {
    const values = Object.fromEntries(lines.map((l) => [l.employeeId, (l.pph21 ?? 0n).toString()]));
    act(
      { type: 'run.dihitung', pph: values, when: demoStamp().when },
      `${period.number}: gaji ${inputs.length} pegawai dihitung; neto ${rp(totals.net)} · ${demoStamp().jam}.`,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <Panel
        title={`Run gaji ${period.label} · ${period.number}`}
        sub={`${state.preparedBy ? `Disusun ${state.preparedBy.name}` : 'Penyusun = pengguna yang menghitung run'} · dibayar ${formatTanggal(period.payDate)} · tarif iuran simulasi`}
        actions={<Chip tone={stage >= 3 ? 'success' : 'info'}>{RUN_STAGES[Math.min(stage, 3)]}</Chip>}
      >
        <StageTrack
          label="Tahap run gaji"
          stages={RUN_STAGES.map((label, i) => ({
            label,
            at: i === 0 ? null : at(i as 1 | 2 | 3),
          }))}
          current={stage >= 3 ? RUN_STAGES.length : stage}
        />
        {stage === 0 && (
          <span className="flex flex-wrap items-start gap-2">
            {imported ? (
              <Chip tone="success">Jasa pelayanan diimpor dari modul jasa pelayanan</Chip>
            ) : (
              <Button
                disabled={pending}
                onClick={() =>
                  act(
                    { type: 'jaspel.diimpor', when: demoStamp().when },
                    `Jasa pelayanan ${period.label} diimpor untuk ${inputs.length} pegawai · ${demoStamp().jam}.`,
                  )
                }
              >
                Impor jasa pelayanan
              </Button>
            )}
            <ReasonButton reason={calcBlock} onClick={calculate}>
              Hitung gaji
            </ReasonButton>
          </span>
        )}
        {stage === 1 && (
          <div className="flex flex-col gap-3">
            <span className="text-small text-ink-700">
              Penyusun: {state.preparedBy?.name ?? '—'}. Penyetuju = pengguna yang masuk (posisi Akuntan atau
              Manajemen), wajib orang lain.
            </span>
            <span className="flex flex-wrap items-start gap-2">
              <ReasonButton
                reason={apprBlock}
                onClick={() =>
                  act(
                    { type: 'run.disetujui', when: demoStamp().when },
                    `${period.number}: disetujui · ${demoStamp().jam}.`,
                  )
                }
              >
                Setujui run gaji
              </ReasonButton>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  act(
                    { type: 'run.dikembalikan', when: demoStamp().when },
                    `${period.number}: dikembalikan ke draf.`,
                  )
                }
              >
                Kembali ke draf
              </Button>
            </span>
          </div>
        )}
        {stage === 2 && (
          <span>
            <ReasonButton
              reason={
                pending
                  ? 'Menyimpan…'
                  : journalBalanced(journal)
                    ? null
                    : 'Jurnal tidak seimbang; periksa ulang run.'
              }
              onClick={() =>
                act(
                  postingEvent(state, demoStamp().when),
                  `${period.number}: jurnal gaji diposting ke buku besar · ${demoStamp().jam}.`,
                )
              }
            >
              Posting jurnal gaji
            </ReasonButton>
          </span>
        )}
        {stage >= 3 && (
          <Alert level="success" title={`Diposting · ${at(3) ?? ''}`}>
            Jurnal gaji {rp(totals.gross)} seimbang tercatat oleh {state.postedBy?.name ?? '—'} (disusun{' '}
            {state.preparedBy?.name ?? '—'}, disetujui {state.approvedBy?.name ?? '—'}); transfer neto{' '}
            {rp(totals.net)} dijadwalkan ke rekening pegawai pada tanggal bayar.
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
              const raw = stage > 0 ? (state.pph[l.employeeId] ?? '') : (pph[l.employeeId] ?? '');
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
              (state.slipsSent ? (
                <span className="text-small font-semibold text-success">
                  Slip {inputs.length} pegawai terkirim ke akun masing-masing · {state.slipsSent.jam} oleh{' '}
                  {state.slipsSent.by.name}
                </span>
              ) : (
                <span>
                  <Button
                    disabled={pending}
                    onClick={() => act({ type: 'slip.dikirim', jam: demoStamp().jam }, null)}
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
