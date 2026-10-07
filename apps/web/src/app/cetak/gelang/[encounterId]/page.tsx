import { formatTanggal, formatTanggalWaktu, type WristbandPrint, wristbandPrintSchema } from '@simrs/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/server/api';
import { ApiError } from '@/lib/server/api-core';
import { requireSession } from '@/lib/server/session';
import { webEnv } from '@/lib/server/web-env';
import { can } from '@/lib/session-view';
import { WristbandActions } from './wristband-actions';

export const metadata: Metadata = { title: 'Cetak gelang pasien' };

const SEX: Record<string, string> = { male: 'L', female: 'P', unknown: '?' };

/** Gelang identitas pasien: pita 25 × 280 mm. Hanya berlaku di halaman ini. */
const PRINT_CSS = `
@page { size: 280mm 25mm; margin: 0; }
@media print {
  .band-actions { display: none !important; }
  body { background: #fff !important; }
  .band { box-shadow: none !important; margin: 0 !important; }
}
`;

/**
 * K04 · Cetak gelang identitas pasien rawat inap (keputusan fase 3 no. 8, tetap HTML): dua pengenal (nama + tanggal
 * lahir/RM) dan kode gelang acak per kunjungan untuk pindai eMAR. Mode api saja; `bed.write`; setiap pembukaan dicatat
 * API sebagai audit `print`. Cetak ulang beralasan membatalkan gelang lama. Di luar kerangka staf.
 */
export default async function CetakGelangPage({ params }: { params: Promise<{ encounterId: string }> }) {
  if (webEnv().dataSource === 'demo') notFound();
  const session = await requireSession();
  const id = z.uuid().safeParse((await params).encounterId);
  if (!id.success) notFound();
  if (!can(session, 'bed', 'write')) {
    return <p className="p-6 text-small">Peran Anda tidak berizin mencetak gelang pasien.</p>;
  }
  let band: WristbandPrint;
  try {
    band = await api(`/api/v1/encounters/${id.data}/wristband`, { schema: wristbandPrintSchema });
  } catch (err) {
    if (err instanceof ApiError && err.status !== 401) {
      return <p className="p-6 text-small">Gelang tidak bisa dimuat: {err.message}</p>;
    }
    throw err;
  }
  return (
    <main className="flex min-h-screen flex-col gap-3 bg-line p-3">
      <style>{PRINT_CSS}</style>
      <article
        aria-label="Gelang identitas pasien"
        className="band mx-auto flex h-[25mm] w-[280mm] max-w-full items-center gap-4 overflow-hidden rounded-[12px] border border-black bg-white px-4 text-black"
      >
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[15px] font-bold">{band.patientName}</span>
          <span className="text-[11px]">
            {SEX[band.sex] ?? band.sex} · lahir{' '}
            {band.birthDate ? formatTanggal(band.birthDate) : 'tidak diketahui'} · RM{' '}
            <span className="font-mono font-semibold">{band.rm}</span>
          </span>
        </span>
        <span className="flex flex-col items-end leading-tight">
          <span className="text-[10px]">Kode gelang</span>
          <span className="font-mono text-[18px] font-bold tracking-wider">{band.code}</span>
          <span className="text-[10px]">Terbit {formatTanggalWaktu(band.issuedAt)}</span>
        </span>
      </article>
      <WristbandActions encounterId={band.encounterId} />
    </main>
  );
}
