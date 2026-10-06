'use client';

import { formatTanggal, formatTanggalWaktu } from '@simrs/shared';
import { Button, Chip } from '@simrs/ui';
import { useState } from 'react';
import {
  FlashLine,
  Panel,
  ReasonButton,
  SelectField,
  TableWrap,
  TD,
  TextField,
  TH,
} from '@/components/backoffice/kit';
import { useTokoAction } from '@/components/backoffice/use-toko';
import { demoStamp } from '@/lib/backoffice-toko';
import { MIN_LOAN_PURPOSE } from '@/lib/rekam-medis-adm-toko';
import {
  LOAN_DAYS,
  lendBlock,
  loanDueDate,
  loanStatus,
  overdueDays,
  type RecordFile,
  type RecordLoan,
} from '@/lib/rekam-medis-adm';

const MIN_PURPOSE = MIN_LOAN_PURPOSE;

/**
 * B09 · Peminjaman berkas fisik lama: daftar pinjaman (jatuh tempo `record.loan_days`, terlambat ditandai), catat
 * pengembalian, kirim pengingat, dan formulir pinjam dengan gerbang legal hold / sedang dipinjam.
 */
export function LoanTab({
  files,
  loans,
  rev,
  units,
  today,
}: {
  files: readonly RecordFile[];
  /** Peminjaman dari toko demo (domain `rekam-medis-adm`). */
  loans: readonly RecordLoan[];
  rev: number;
  units: readonly string[];
  today: string;
}) {
  const [fileId, setFileId] = useState('');
  const [unit, setUnit] = useState(units[0] ?? '');
  const [borrower, setBorrower] = useState('');
  const [purpose, setPurpose] = useState('');
  const { act, pending, flash } = useTokoAction('rekam-medis-adm', rev);
  const byId = new Map(files.map((f) => [f.id, f]));
  const file = byId.get(fileId) ?? null;

  const block = !file
    ? 'Pilih berkas dulu.'
    : (lendBlock(file, loans) ??
      (borrower.trim().length < 3
        ? 'Isi nama peminjam.'
        : purpose.trim().length < MIN_PURPOSE
          ? `Tulis keperluan minimal ${MIN_PURPOSE} huruf.`
          : null));

  const lend = () => {
    if (!file || block) return;
    const due = loanDueDate(today);
    const { jam } = demoStamp();
    act(
      { type: 'berkas.dipinjam', fileId: file.id, unit, borrower: borrower.trim(), purpose: purpose.trim(), jam },
      `Berkas RM ${file.rm} keluar ${jam} ke ${unit}; kembali paling lambat ${formatTanggal(due)}${
        file.confidential ? ' · petugas privasi diberi tahu (pasien bertanda rahasia)' : ''
      }.`,
      () => {
        setFileId('');
        setBorrower('');
        setPurpose('');
      },
    );
  };

  const markReturned = (loanId: string) => {
    const l = loans.find((x) => x.id === loanId);
    const f = l ? byId.get(l.fileId) : undefined;
    const { jam, when } = demoStamp();
    act({ type: 'berkas.kembali', loanId, when }, `Berkas RM ${f?.rm ?? ''} kembali ke rak ${f?.rack ?? ''} · ${jam}.`);
  };
  const remind = (loanId: string) => {
    const l = loans.find((x) => x.id === loanId);
    const { jam } = demoStamp();
    act({ type: 'pengingat.dikirim', loanId, jam }, `Pengingat keterlambatan terkirim ke ${l?.unit ?? 'peminjam'} · ${jam}.`);
  };

  return (
    <div className="flex flex-col gap-4">
      <FlashLine flash={flash} />
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_560px]">
          <Panel
            title="Berkas fisik yang dipinjam"
            sub={`Jatuh tempo ${LOAN_DAYS} hari sejak keluar · terlambat diberi pengingat otomatis tiap pagi`}
            flush
          >
            <TableWrap label="Daftar peminjaman berkas">
              <thead>
                <tr>
                  <th className={TH}>Berkas</th>
                  <th className={TH}>Peminjam</th>
                  <th className={TH}>Jatuh tempo</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>
                    <span className="sr-only">Aksi</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l) => {
                  const f = byId.get(l.fileId);
                  const st = loanStatus(l, today);
                  return (
                    <tr key={l.id}>
                      <td className={TD}>
                        <span className="block font-mono font-semibold">{f?.rm}</span>
                        <span className="block">{f?.patientName}</span>
                        <span className="block text-caption text-ink-500">Rak {f?.rack}</span>
                      </td>
                      <td className={TD}>
                        <span className="block">{l.borrower}</span>
                        <span className="block text-caption text-ink-500">
                          {l.unit} · {l.purpose}
                        </span>
                      </td>
                      <td className={TD}>
                        <span className="block whitespace-nowrap">{formatTanggal(l.dueDate)}</span>
                        <span className="block text-caption text-ink-500">
                          keluar {formatTanggal(l.outDate)}
                        </span>
                      </td>
                      <td className={TD}>
                        {st === 'kembali' ? (
                          <>
                            <Chip tone="success">Kembali</Chip>
                            {l.returnedAt && (
                              <span className="mt-1 block text-caption text-ink-500">
                                {formatTanggalWaktu(l.returnedAt)}
                              </span>
                            )}
                          </>
                        ) : st === 'terlambat' ? (
                          <Chip tone="danger">Terlambat {overdueDays(l, today)} hari</Chip>
                        ) : (
                          <Chip tone="info">Dipinjam</Chip>
                        )}
                        {l.remindedAt && (
                          <span className="mt-1 block text-caption text-ink-500">
                            Pengingat terkirim {l.remindedAt}
                          </span>
                        )}
                      </td>
                      <td className={TD}>
                        {st !== 'kembali' && (
                          <span className="flex flex-wrap gap-1.5">
                            <Button size="sm" disabled={pending} onClick={() => markReturned(l.id)}>
                              Catat kembali
                              <span className="sr-only"> berkas RM {f?.rm}</span>
                            </Button>
                            {st === 'terlambat' && !l.remindedAt && (
                              <Button size="sm" variant="ghost" disabled={pending} onClick={() => remind(l.id)}>
                                Kirim pengingat
                                <span className="sr-only"> untuk berkas RM {f?.rm}</span>
                              </Button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Panel>
        </div>
        <div className="min-w-0 flex-[1_1_320px] xl:max-w-[420px]">
          <Panel title="Pinjamkan berkas" sub="Setiap keluar-masuk berkas tercatat di jejak audit">
            <SelectField
              label="Berkas (RM · pasien · rak)"
              value={fileId}
              onChange={setFileId}
              placeholder="Pilih berkas…"
              options={files.map((f) => [
                f.id,
                `${f.rm} · ${f.patientName} · ${f.rack}${f.legalHold ? ' · legal hold' : ''}${f.confidential ? ' · rahasia' : ''}`,
              ])}
              hint={
                file?.confidential && !lendBlock(file, loans)
                  ? 'Pasien bertanda rahasia: peminjaman otomatis diberitahukan ke petugas privasi.'
                  : undefined
              }
            />
            <SelectField
              label="Unit peminjam"
              value={unit}
              onChange={setUnit}
              options={units.map((u) => [u, u])}
            />
            <TextField label="Nama peminjam" value={borrower} onChange={setBorrower} />
            <TextField label="Keperluan" value={purpose} onChange={setPurpose} rows={2} />
            <ReasonButton reason={pending ? 'Menyimpan…' : block} onClick={lend}>
              Catat berkas keluar
            </ReasonButton>
          </Panel>
        </div>
      </div>
    </div>
  );
}
