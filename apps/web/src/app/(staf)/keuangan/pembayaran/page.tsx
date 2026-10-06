import type { Metadata } from 'next';
import Link from 'next/link';
import { MoneyFlow } from '@/components/btn/money-flow';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { screenById } from '@/lib/screens';
import { getPaymentOverview } from '@/lib/server/data/btn';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { PembayaranClient } from './pembayaran-client';

export const metadata: Metadata = { title: 'Pembayaran digital' };

/** Rute layar terkait bila sudah tersedia di presentasi (layar `belum` tidak ditautkan). */
function routeOf(id: string): string | null {
  const s = screenById(id);
  return s && s.status !== 'belum' ? s.route : null;
}

/**
 * I05 + U09 · Pembayaran digital TPDI × BTN dan rekonsiliasi 3 arah (mockup `PembayaranBTN.dc.html`). Mode
 * presentasi: data dummy fiktif; deposit dan rekonsiliasi Ny. Ratna Sari mengikuti skenario elektif (ADR-0023).
 */
export default async function PembayaranPage() {
  const { session, screen, allowed } = await requireDemoScreen('pembayaran');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const { data, hook } = await getPaymentOverview(session);
  const related = [
    { id: 'kasir', label: 'Kasir' },
    { id: 'akuntansi', label: 'Akuntansi' },
    { id: 'pembiayaan', label: 'Pembiayaan BTN' },
  ].flatMap((r) => {
    const href = routeOf(r.id);
    return href ? [{ ...r, href }] : [];
  });
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Keuangan / Pembayaran digital · I05 + U09 · {session.tenant.name}
          </span>
          <h1 className="m-0 text-h1 font-semibold">Pembayaran digital · TPDI × BTN</h1>
        </div>
        {related.length > 0 && (
          <nav aria-label="Layar terkait" className="flex flex-wrap gap-2">
            {related.map((r) => (
              <Link
                key={r.id}
                href={r.href}
                className={
                  r.id === 'pembiayaan'
                    ? 'inline-flex min-h-11 items-center rounded-control border border-brand-700 bg-white px-3 font-semibold text-brand-700 no-underline'
                    : 'inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 font-medium text-ink-900 no-underline'
                }
              >
                {r.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <ScenarioBanner session={session} screen="pembayaran" />
      <PembayaranClient
        moneyFlow={<MoneyFlow operational={data.config.operationalAccount} />}
        data={data}
        hook={hook}
        userName={session.user.displayName}
        kasirHref={routeOf('kasir')}
        journalHref={routeOf('akuntansi')}
      />
    </div>
  );
}
