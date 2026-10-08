import {
  type DispenseView,
  formatTanggal,
  MEDICATION_FREQUENCIES,
  type PharmacyPrescriptionView,
} from '@simrs/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PrintActions } from '@/app/cetak/gizi/print-actions';
import { ApiError } from '@/lib/server/api-core';
import { getDispenseApi, getPharmacyPrescriptionApi } from '@/lib/server/data/penunjang/farmasi';
import { requireSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { can } from '@/lib/session-view';

export const metadata: Metadata = { title: 'Cetak etiket obat' };

type Params = Promise<{ dispenseId: string }>;

/** Etiket 70 × 35 mm, 3 kolom per A4. Hanya berlaku di halaman ini. */
const PRINT_CSS = `
@page { size: A4; margin: 10mm; }
@media print {
  .print-actions { display: none !important; }
  body { background: #fff !important; }
}
`;

/**
 * S05 · Cetak HTML etiket obat satu penyiapan (rencana fase 4 §4.6b): dua pengenal pasien (nama + No. RM), obat, aturan
 * pakai, batch + ED, jumlah, dan label dosis `OBT-…` yang dipindai eMAR (F3-5). Mode api saja; izin
 * `pharmacy.review.read`; lingkup depo ditegakkan API. Di luar kerangka staf.
 */
export default async function CetakEtiketObatPage({ params }: { params: Params }) {
  if (webEnv().dataSource === 'demo') notFound();
  const session = await requireSession();
  if (!can(session, 'pharmacy.review', 'read')) {
    return <p className="p-6 text-small">Peran Anda tidak berizin mencetak etiket obat.</p>;
  }
  const { dispenseId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(dispenseId)) notFound();
  let d: DispenseView;
  let rx: PharmacyPrescriptionView;
  try {
    d = await getDispenseApi(dispenseId);
    rx = await getPharmacyPrescriptionApi(d.pharmacyPrescriptionId);
  } catch (err) {
    if (err instanceof ApiError && err.status !== 401) {
      return <p className="p-6 text-small">Etiket tidak bisa dimuat: {err.message}</p>;
    }
    throw err;
  }
  const meds = new Map(rx.items.map((i) => [i.id, i]));
  return (
    <main className="flex min-h-screen flex-col gap-4 bg-white p-4 text-black">
      <style>{PRINT_CSS}</style>
      <PrintActions />
      <header>
        <h1 className="m-0 text-[18px] font-bold">Etiket obat · {d.prescriptionNo}</h1>
        <p className="m-0 text-[12px]">
          {session.tenant.name} · {d.stockLocation.name} · dicetak {session.user.displayName}
        </p>
      </header>
      <section aria-label="Etiket obat" className="grid grid-cols-3 gap-[3mm]">
        {d.items.map((i) => {
          const m = meds.get(i.medicationRequestId);
          return (
            <article
              key={i.id}
              aria-label={`Etiket ${i.drugName}`}
              className="flex h-[35mm] flex-col justify-between overflow-hidden rounded-[2mm] border border-black p-[2mm] text-[10px] leading-tight"
            >
              <span className="truncate text-[12px] font-bold">{d.patient.name}</span>
              <span>
                RM <span className="font-mono font-semibold">{d.patient.mrn}</span> · {d.encounter.number}
              </span>
              <span className="truncate font-semibold">
                {i.drugName} × {i.quantity}
              </span>
              <span className="truncate">
                {m ? `${m.dose} · ${m.route} · ${MEDICATION_FREQUENCIES[m.frequency].label}` : '–'}
              </span>
              <span className="truncate">
                Batch {i.batchNo} · ED {formatTanggal(i.expiryDate)}
                {i.highAlert ? ' · KEWASPADAAN TINGGI' : ''}
              </span>
              <span className="font-mono text-[12px] font-bold tracking-wider">{i.labelBarcode}</span>
            </article>
          );
        })}
      </section>
    </main>
  );
}
