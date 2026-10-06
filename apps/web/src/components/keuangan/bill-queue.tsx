import { formatRupiah, type Invoice } from '@simrs/shared';
import { Chip, cx } from '@simrs/ui';
import Link from 'next/link';
import { invoiceStatusView } from '@/lib/keuangan';

const KIND: Record<Invoice['encounter']['kind'], string> = {
  'rawat-jalan': 'RJ',
  igd: 'IGD',
  'rawat-inap': 'RI',
};

/** Antrean tagihan kasir (daftar kiri); pilihan lewat `?pilih=<id>`. Status selalu berupa teks. */
export function BillQueue({ invoices, selectedId }: { invoices: readonly Invoice[]; selectedId: string }) {
  const ready = invoices.filter((i) => i.status === 'final').length;
  return (
    <nav
      aria-label="Antrean tagihan"
      className="flex min-w-0 flex-[1_1_280px] flex-col overflow-hidden rounded-card border border-line bg-white xl:max-w-[320px]"
    >
      <span className="flex flex-col border-b border-line px-4 py-3">
        <span className="font-semibold">Antrean tagihan</span>
        <span className="text-caption text-ink-500">
          {invoices.length} tagihan · {ready} siap dibayar atau ditutup
        </span>
      </span>
      <ul className="m-0 list-none p-0">
        {invoices.map((i) => {
          const sel = i.id === selectedId;
          const st = invoiceStatusView(i.status, BigInt(i.patientDue), i.encounter.discharged);
          return (
            <li key={i.id}>
              <Link
                href={`/keuangan/kasir?pilih=${i.id}`}
                aria-current={sel ? 'page' : undefined}
                className={cx(
                  'grid min-h-14 grid-cols-[4px_minmax(0,1fr)_auto] gap-3 border-b border-line-soft py-2.5 pr-3 text-ink-900 no-underline',
                  sel ? 'bg-brand-50' : 'bg-white hover:bg-subtle',
                )}
              >
                <span aria-hidden="true" className={sel ? 'bg-brand-600' : ''} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold">{i.patient.name}</span>
                  <span className="text-caption text-ink-500">
                    {i.queueNo ?? 'Loket RI'} · {KIND[i.encounter.kind]} · {i.split.payerLabel}
                  </span>
                  {i.scenario && (
                    <span className="text-caption font-semibold text-info">
                      Pasien simulasi · {i.encounter.period}
                    </span>
                  )}
                </span>
                <span className="flex flex-col items-end gap-1">
                  <Chip tone={st.tone}>{st.label}</Chip>
                  <span className="font-mono text-caption whitespace-nowrap text-ink-700">
                    Pasien {formatRupiah(BigInt(i.patientDue))}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
