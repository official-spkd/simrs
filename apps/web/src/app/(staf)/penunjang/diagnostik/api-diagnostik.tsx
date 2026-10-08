import { Chip } from '@simrs/ui';
import { DiagnosticItem } from '@/components/penunjang/mikro-diagnostik-api';
import { diagnosticWorklist } from '@/lib/server/data/penunjang/mikro-diagnostik-api';
import { can, type SessionView } from '@/lib/session-view';

/**
 * S10 · Layar Diagnostik lain mode api (fase 4 · 4.8, ADR-0120): order ber-kode ICD-9-CM EKG/USG/echo/endoskopi/
 * treadmill, isian formulir `diag_<jenis>` + kesimpulan, TTE (`diagnostics.sign`); laporan bertanda tangan tampil di
 * panel hasil fase 3.
 */
export async function ApiDiagnostik({ session }: { session: SessionView }) {
  const wl = await diagnosticWorklist();
  const canSign = can(session, 'diagnostics', 'sign');
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Penunjang / Diagnostik lain · {session.tenant.name}</span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Diagnostik lain</h1>
      </header>
      <section aria-label="Order diagnostik" className="flex flex-col gap-3">
        <h2 className="m-0 text-body font-semibold">
          Order ({wl.items.length}){' '}
          <Chip tone="neutral">{wl.view === 'layanan' ? 'Semua ruangan' : 'Pasien saya/unit saya'}</Chip>
        </h2>
        {wl.items.length === 0 && <p className="m-0 text-small text-ink-500">Belum ada order diagnostik.</p>}
        {wl.items.map((i) => (
          <DiagnosticItem key={i.serviceRequestId} item={i} canSign={canSign} />
        ))}
      </section>
    </div>
  );
}
