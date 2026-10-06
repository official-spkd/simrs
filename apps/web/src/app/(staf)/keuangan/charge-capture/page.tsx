import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ChargeWorkspace } from '@/components/keuangan/charge-workspace';
import { getChargeCaptureStore } from '@/lib/server/data/keuangan-lanjut';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Charge capture' };

/**
 * U02 · Monitor charge capture (tanpa mockup; rencana fase 5 potongan 5.4): event klinis → baris tagihan bersumber,
 * pengecualian, dan koreksi beralasan. Mode presentasi: data dummy fiktif (ADR-0023) + toko demo bersama (domain
 * `tagihan`, ADR-0085): kunjungan dari Pendaftaran dan item manual Kasir masuk sebagai event; tindak lanjut tersimpan.
 */
export default async function ChargeCapturePage() {
  const { session, screen, allowed } = await requireDemoScreen('charge');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const store = await getChargeCaptureStore();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Keuangan / Charge capture / Sen, 5 Okt 2026 · {session.tenant.name}
        </span>
        <h1 className="m-0 text-h1 font-semibold">Charge capture · event klinis jadi tagihan</h1>
      </header>
      <ChargeWorkspace events={store.events} eventTotal={store.eventTotal} rev={store.rev} />
    </div>
  );
}
