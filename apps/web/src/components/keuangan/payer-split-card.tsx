import { formatRupiah, formatTanggal, type PayerSplit, type Payment } from '@simrs/shared';
import { cx } from '@simrs/ui';
import { PAYMENT_METHOD_LABEL } from '@/lib/keuangan';

interface Row {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'muted' | 'total';
}

/**
 * Pembagian penjamin (mockup Kasir): BPJS membayar tarif INA-CBG hak kelas, pasien hanya menanggung selisih naik
 * kelas; sisa tarif RS di atas INA-CBG tidak ditagihkan ke pasien. Identitas: tarif RS = penjamin + pasien + RS.
 */
export function PayerSplitCard({
  split,
  payments,
  due,
}: {
  split: PayerSplit;
  payments: readonly Payment[];
  due: bigint;
}) {
  const absorbs = BigInt(split.hospitalAbsorbs);
  const rows: Row[] = [
    { label: 'Tarif RS (total tagihan)', value: formatRupiah(BigInt(split.hospitalTotal)) },
  ];
  if (split.scheme === 'bpjs') {
    rows.push(
      split.inacbg
        ? {
            label: `Tarif INA-CBG ${split.inacbg.code} (${split.inacbg.classLabel})${split.inacbg.estimate ? ' · estimasi grouper' : ''}`,
            value: formatRupiah(BigInt(split.inacbg.tariff)),
          }
        : { label: 'Tarif INA-CBG · menunggu diagnosis kerja', value: '—', tone: 'muted' },
    );
  }
  if (split.scheme !== 'umum') {
    rows.push({
      label: `Ditanggung ${split.payerLabel}`,
      value: formatRupiah(BigInt(split.payerPays)),
      tone: 'ok',
    });
  }
  if (split.classUpgrade) {
    rows.push({
      label: `Selisih ${split.classUpgrade.label.toLowerCase()}`,
      value: formatRupiah(BigInt(split.classUpgrade.amount)),
      tone: 'warn',
    });
  }
  if (split.scheme === 'asuransi' && BigInt(split.patientShare) > 0n) {
    rows.push({
      label: 'Ekses di atas plafon',
      value: formatRupiah(BigInt(split.patientShare)),
      tone: 'warn',
    });
  }
  if (split.scheme === 'bpjs' && absorbs !== 0n && split.inacbg) {
    rows.push({
      label:
        absorbs > 0n
          ? 'Tidak ditagihkan ke pasien (tarif RS di atas INA-CBG)'
          : 'Surplus INA-CBG atas tarif RS',
      value: formatRupiah(absorbs > 0n ? absorbs : -absorbs),
      tone: 'muted',
    });
  }
  rows.push({ label: 'Tanggungan pasien', value: formatRupiah(BigInt(split.patientShare)), tone: 'total' });
  for (const p of payments) {
    rows.push({
      label: `${p.kind === 'deposit' ? 'Deposit' : 'Pelunasan'} ${PAYMENT_METHOD_LABEL[p.method].name} · ${formatTanggal(p.at).replace(/^\w+, /, '')}`,
      value: `−${formatRupiah(BigInt(p.amount))}`,
      tone: 'ok',
    });
  }
  rows.push({ label: 'Sisa bayar pasien', value: formatRupiah(due), tone: 'total' });

  return (
    <section
      aria-label="Pembagian penjamin"
      className="flex flex-col gap-2.5 rounded-card border border-line bg-white p-4"
    >
      <span className="font-semibold">Pembagian penjamin</span>
      <dl className="m-0 flex flex-col gap-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className={cx(
              'flex justify-between gap-3 text-[13.5px]',
              r.tone === 'total' && 'border-t border-line pt-2 font-bold text-ink-900',
              r.tone === 'ok' && 'text-success',
              r.tone === 'warn' && 'text-warning',
              r.tone === 'muted' && 'text-ink-500',
              !r.tone && 'text-ink-700',
            )}
          >
            <dt className="min-w-0">{r.label}</dt>
            <dd className="m-0 flex-none font-mono">{r.value}</dd>
          </div>
        ))}
      </dl>
      <span className="text-caption text-ink-500">
        {split.classUpgrade
          ? `${split.classUpgrade.rule}. Rumus per jenis kenaikan kelas diambil dari master aturan, jadi bisa diperbarui tanpa rilis ulang.`
          : split.scheme === 'bpjs'
            ? 'Pasien JKN sesuai hak kelas tidak membayar; RS menagih tarif INA-CBG lewat klaim.'
            : split.scheme === 'asuransi'
              ? 'Penjamin membayar sesuai surat jaminan; ekses ditagihkan ke pasien.'
              : 'Pasien umum membayar seluruh tarif RS.'}
      </span>
    </section>
  );
}
