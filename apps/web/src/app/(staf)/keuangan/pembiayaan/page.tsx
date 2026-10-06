import type { Metadata } from 'next';
import Link from 'next/link';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { formatTanggalPendek } from '@/lib/btn';
import { screenById } from '@/lib/screens';
import { getFinancingOverview } from '@/lib/server/data/btn';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { PembiayaanClient } from './pembiayaan-client';

export const metadata: Metadata = { title: 'Pembiayaan BTN' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * U04 · Pembiayaan BTN: piutang klaim BPJS dan cicilan biaya pasien (mockup `PembiayaanBTN.dc.html`). Mode
 * presentasi: data dummy fiktif; klaim dan cicilan Ny. Ratna Sari mengikuti skenario elektif (ADR-0023); klaim
 * layak bayar dari Klaim, cicilan dari Kasir, dan aksi layar tersimpan di toko demo (domain `pembiayaan-btn`).
 */
export default async function PembiayaanPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('pembiayaan');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const sp = await searchParams;
  const { data, hook, rev, state } = await getFinancingOverview(session);
  const f = data.facility;
  const related = [
    { id: 'klaim', label: 'Klaim BPJS' },
    { id: 'akuntansi', label: 'Jurnal pembiayaan' },
    { id: 'pembayaran', label: 'Pembayaran via BTN' },
  ].flatMap((r) => {
    const s = screenById(r.id);
    return s && s.status !== 'belum' ? [{ ...r, href: s.route }] : [];
  });
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Keuangan / Pembiayaan / BTN · {session.tenant.name}
          </span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">
            Pembiayaan BTN · fasilitas kesehatan (simulasi)
          </h1>
          <span className="text-caption text-ink-500">
            No. perjanjian <span className="font-mono">{f.agreementNo}</span> (fiktif) · berlaku{' '}
            {formatTanggalPendek(f.validFrom, true)} – {formatTanggalPendek(f.validTo, true)} · semua angka
            simulasi
          </span>
        </div>
        {related.length > 0 && (
          <nav aria-label="Layar terkait" className="flex flex-wrap gap-2">
            {related.map((r) => (
              <Link
                key={r.id}
                href={r.href}
                className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 font-medium text-ink-900 no-underline"
              >
                {r.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <ScenarioBanner session={session} screen="pembiayaan" />
      <PembiayaanClient
        data={data}
        hook={hook}
        store={{ rev, stamps: state.stamps, lastPay: state.lastPay }}
        initialTab={sp.tab === 'cicilan' ? 'cicilan' : 'piutang'}
      />
    </div>
  );
}
