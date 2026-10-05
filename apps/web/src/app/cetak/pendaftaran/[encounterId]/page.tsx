import {
  formatJam,
  formatTanggal,
  formatTanggalWaktu,
  type PrintableVisit,
  SEP_STATUS_LABEL,
} from '@simrs/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ApiError } from '@/lib/server/api-core';
import { getPrintableVisitApi } from '@/lib/server/data/front-office/pendaftaran';
import { requireSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { can } from '@/lib/session-view';
import { SlipActions } from './slip-actions';

export const metadata: Metadata = { title: 'Cetak tiket pendaftaran' };

const CLASS_LABEL: Record<string, string> = { kelas_1: 'Kelas 1', kelas_2: 'Kelas 2', kelas_3: 'Kelas 3' };

/** Lebar kertas termal 80 mm; tinggi mengikuti isi. Hanya berlaku di halaman ini. */
const PRINT_CSS = `
@page { size: 80mm auto; margin: 3mm; }
@media print {
  .slip-actions { display: none !important; }
  body { background: #fff !important; }
  .slip { box-shadow: none !important; border: 0 !important; margin: 0 !important; }
}
`;

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-ink-700">{k}</dt>
      <dd className={`m-0 text-right font-semibold ${mono ? 'font-mono' : ''}`}>{v}</dd>
    </div>
  );
}

function Slip({ v }: { v: PrintableVisit }) {
  const sep = v.sep;
  return (
    <article
      aria-label="Tiket pendaftaran"
      className="slip mx-auto my-4 flex w-[80mm] max-w-full flex-col gap-2 border border-line bg-white p-3 text-[12px] leading-snug text-black shadow-sm"
    >
      <header className="flex flex-col items-center border-b border-dashed border-black pb-2 text-center">
        <span className="text-[13px] font-bold">{v.tenantName}</span>
        <span>Tiket pendaftaran rawat jalan</span>
        <span>{formatTanggalWaktu(v.arrivedAt ?? v.printedAt)}</span>
      </header>
      <section className="flex flex-col items-center gap-0.5 border-b border-dashed border-black pb-2 text-center">
        <span className="text-[11px] tracking-wide">NOMOR ANTREAN POLI</span>
        <span className="font-mono text-[36px] leading-none font-bold">{v.queueNo ?? '—'}</span>
        <span className="font-semibold">{v.poliName}</span>
        {v.room && <span>{v.room}</span>}
        {v.practitionerName && <span>{v.practitionerName}</span>}
        {v.estimatedCallAt && <span>Perkiraan dipanggil {formatJam(v.estimatedCallAt)}</span>}
      </section>
      <dl className="m-0 flex flex-col gap-0.5 border-b border-dashed border-black pb-2">
        <Row k="Pasien" v={v.patient.name} />
        <Row k="No. RM" v={v.patient.mrn} mono />
        <Row k="Kunjungan" v={v.encounterNumber} mono />
        <Row k="Tanggal layanan" v={formatTanggal(v.serviceDate)} />
        {v.bookingCode && <Row k="Kode booking" v={v.bookingCode} mono />}
        <Row k="Penjamin" v={v.payerName ?? '—'} />
      </dl>
      {sep && (
        <section
          aria-label="Ringkasan SEP"
          className="flex flex-col gap-0.5 border-b border-dashed border-black pb-2"
        >
          <span className="font-bold">SURAT ELIGIBILITAS PESERTA</span>
          <dl className="m-0 flex flex-col gap-0.5">
            <Row
              k="No. SEP"
              v={sep.sepNo ?? `Belum terbit (${SEP_STATUS_LABEL[sep.status]})`}
              mono={!!sep.sepNo}
            />
            {sep.cardNoMasked && <Row k="No. kartu" v={sep.cardNoMasked} mono />}
            {sep.classEntitlement && <Row k="Hak kelas" v={CLASS_LABEL[sep.classEntitlement] ?? '—'} />}
            {sep.referenceNumber && <Row k="No. rujukan" v={sep.referenceNumber} mono />}
            {sep.referrerName && <Row k="Faskes perujuk" v={sep.referrerName} />}
            {sep.initialDiagnosis && (
              <Row k="Diagnosa awal" v={`${sep.initialDiagnosis.code} · ${sep.initialDiagnosis.display}`} />
            )}
            {sep.issuedAt && <Row k="Terbit" v={formatTanggalWaktu(sep.issuedAt)} />}
          </dl>
          {!sep.sepNo && (
            <span className="text-[11px]">
              SEP masih diproses BPJS. Pasien tetap dilayani di poli; cetak ulang setelah SEP terbit.
            </span>
          )}
        </section>
      )}
      <footer className="text-center text-[11px]">Simpan tiket ini. Dicetak {formatJam(v.printedAt)}.</footer>
    </article>
  );
}

/**
 * F03/F06 · Cetak tiket pendaftaran + ringkasan SEP (HTML 80 mm, keputusan fase 2 no. 10): dialog cetak browser
 * (printer termal atau simpan PDF). Mode api saja; izin `documents.print`; setiap pembukaan dicatat API sebagai audit
 * `print`. Di luar kerangka staf agar yang tercetak hanya tiketnya.
 */
export default async function CetakPendaftaranPage({ params }: { params: Promise<{ encounterId: string }> }) {
  if (webEnv().dataSource === 'demo') notFound();
  const session = await requireSession();
  const id = z.uuid().safeParse((await params).encounterId);
  if (!id.success) notFound();
  if (!can(session, 'documents', 'print')) {
    return <p className="p-6 text-small">Peran Anda tidak berizin mencetak tiket pendaftaran.</p>;
  }
  let visit: PrintableVisit;
  try {
    visit = await getPrintableVisitApi(id.data);
  } catch (err) {
    if (err instanceof ApiError && err.status !== 401) {
      if (err.status === 404) notFound();
      return <p className="p-6 text-small">Tiket tidak bisa dimuat: {err.message}</p>;
    }
    throw err;
  }
  return (
    <main className="min-h-screen bg-[#E9EEF2] p-2">
      <style>{PRINT_CSS}</style>
      <SlipActions />
      <Slip v={visit} />
    </main>
  );
}
