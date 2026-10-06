'use client';

import type { PaymentTransaction } from '@simrs/shared';
import { Alert, Button, RadioSegmented } from '@simrs/ui';
import { useState } from 'react';
import type { useScenarioTask } from './use-scenario-task';

type Scenario = ReturnType<typeof useScenarioTask>;

const ACTIONS: ReadonlyArray<{ task: string; label: string; note: string; warn?: boolean }> = [
  {
    task: 'buat',
    label: 'Buat tagihan Rp 3.000.000 lewat API TPDI',
    note: 'VA/QR dikirim ke WhatsApp dan aplikasi pasien',
  },
  {
    task: 'bayar',
    label: 'Simulasikan pembayaran dari m-banking',
    note: 'dana masuk langsung ke rekening operasional RS',
  },
  {
    task: 'webhook',
    label: 'Proses webhook TPDI',
    note: 'signature HMAC diverifikasi sebelum status diubah',
  },
  {
    task: 'dupe',
    label: 'Proses webhook kedua (retry TPDI)',
    note: 'event id sama: harus diabaikan agar deposit tidak tercatat dua kali',
    warn: true,
  },
];

/**
 * Tombol asli untuk deposit pasien skenario (langkah `deposit`): kanal → buat tagihan → bayar → webhook → webhook
 * ganda. Hanya tugas giliran yang aktif; urutannya sama dengan gerbang mesin skenario.
 */
export function DepositControls({ tx, scenario }: { tx: PaymentTransaction; scenario: Scenario }) {
  const [kanal, setKanal] = useState<'va' | 'qris'>(tx.channel === 'QRIS' ? 'qris' : 'va');
  const next = ACTIONS.find((a) => scenario.can('deposit', a.task));
  const choosing = scenario.can('deposit', 'kanal');
  if (!choosing && !next) {
    return tx.status === 'lunas' ? (
      <span className="text-caption text-ink-500">
        Deposit lunas otomatis dari webhook TPDI; callback ulang dengan event id yang sama tidak menambah
        saldo.
      </span>
    ) : null;
  }
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-brand-200 bg-brand-50 p-3">
      <span className="text-caption font-semibold text-brand-700">
        Simulasi · langkah deposit pasien skenario
      </span>
      {choosing ? (
        <>
          <RadioSegmented
            label="Kanal pembayaran deposit"
            value={kanal}
            disabled={scenario.pending}
            items={[
              { id: 'va', label: 'VA BTN' },
              { id: 'qris', label: 'QRIS dinamis' },
            ]}
            onChange={(id) => setKanal(id === 'qris' ? 'qris' : 'va')}
          />
          <span className="text-caption text-ink-700">
            {kanal === 'va'
              ? 'Virtual Account BTN berlaku 24 jam, bisa dibayar dari bank mana pun.'
              : 'QRIS dinamis acquirer BTN, berlaku 10 menit.'}
          </span>
          <Button
            variant="primary"
            disabled={scenario.pending}
            onClick={() => scenario.fire('deposit', 'kanal', kanal)}
          >
            Pakai kanal ini
          </Button>
        </>
      ) : next ? (
        <>
          {next.warn && (
            <Alert level="warning" title="Webhook yang sama datang lagi">
              Tanpa idempotensi, deposit bisa tercatat dua kali.
            </Alert>
          )}
          <Button
            variant={next.warn ? 'secondary' : 'primary'}
            disabled={scenario.pending}
            onClick={() => scenario.fire('deposit', next.task)}
          >
            {next.label}
          </Button>
          <span className="text-caption text-ink-700">{next.note}</span>
        </>
      ) : null}
      {scenario.error && (
        <span className="text-caption font-semibold text-danger">{scenario.error.message}</span>
      )}
    </div>
  );
}
