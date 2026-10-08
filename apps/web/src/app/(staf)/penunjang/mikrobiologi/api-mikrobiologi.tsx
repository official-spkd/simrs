import { isoDateJakarta } from '@simrs/shared';
import { Chip } from '@simrs/ui';
import { MicroOrderCard, PaItem } from '@/components/penunjang/mikro-diagnostik-api';
import { antibiogram, microWorklist, paWorklist } from '@/lib/server/data/penunjang/mikro-diagnostik-api';
import { can, type SessionView } from '@/lib/session-view';

const CARD =
  'flex min-w-0 flex-col gap-3 rounded-card border border-white/95 bg-white/90 px-4 py-3.5 shadow-card';
const SELECT =
  'h-11 min-w-0 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-small';

/**
 * S02 · Layar Mikrobiologi & PA mode api (fase 4 · 4.8, ADR-0120): worklist kultur (isolat per tahap, validasi teknis
 * analis, rilis klinis ber-TTE dokter lain), antibiogram kumulatif, dan worklist PA dari spesimen kamar operasi
 * (laporan + TTE, untuk dokter pemegang `lab.result.release`).
 */
export async function ApiMikrobiologi({
  session,
  from,
  to,
}: {
  session: SessionView;
  from?: string;
  to?: string;
}) {
  const perms = {
    me: session.user.id,
    write: can(session, 'lab.result', 'write'),
    verify: can(session, 'lab.result', 'verify'),
    release: can(session, 'lab.result', 'release'),
  };
  const today = isoDateJakarta();
  const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const abTo = valid(to) ?? today;
  const abFrom = valid(from) ?? `${today.slice(0, 4)}-01-01`;
  const [wl, ab, pa] = await Promise.all([
    microWorklist(),
    antibiogram(abFrom, abTo),
    perms.release ? paWorklist() : null,
  ]);
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">
          Penunjang / Mikrobiologi & PA · {session.tenant.name}
        </span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Mikrobiologi & PA</h1>
      </header>
      <section aria-label="Kultur" className="flex flex-col gap-3">
        <h2 className="m-0 text-body font-semibold">
          Kultur ({wl.orders.length}){' '}
          <Chip tone="neutral">{wl.view === 'layanan' ? 'Semua ruangan' : 'Pasien saya/unit saya'}</Chip>
        </h2>
        {wl.orders.length === 0 && <p className="m-0 text-small text-ink-500">Belum ada order kultur.</p>}
        {wl.orders.map((o) => (
          <MicroOrderCard key={o.labOrderId} order={o} perms={perms} />
        ))}
      </section>
      {pa && (
        <section aria-label="Patologi anatomi" className={CARD}>
          <h2 className="m-0 text-body font-semibold">
            Patologi anatomi · spesimen kamar operasi ({pa.items.length})
          </h2>
          {pa.items.length === 0 && <p className="m-0 text-small text-ink-500">Belum ada spesimen.</p>}
          {pa.items.map((i) => (
            <PaItem key={i.surgerySpecimenId} item={i} />
          ))}
        </section>
      )}
      <section aria-label="Antibiogram" className={CARD}>
        <h2 className="m-0 text-body font-semibold">Antibiogram kumulatif</h2>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <span className="flex flex-col gap-1">
            <label htmlFor="ab-from" className="text-small font-semibold">
              Dari
            </label>
            <input id="ab-from" name="dari" type="date" defaultValue={abFrom} className={SELECT} />
          </span>
          <span className="flex flex-col gap-1">
            <label htmlFor="ab-to" className="text-small font-semibold">
              Sampai
            </label>
            <input id="ab-to" name="sampai" type="date" defaultValue={abTo} className={SELECT} />
          </span>
          <button
            type="submit"
            className="h-11 rounded-control border border-line-strong bg-white px-3.5 text-small font-semibold"
          >
            Tampilkan
          </button>
        </form>
        {ab.rows.length === 0 ? (
          <p className="m-0 text-small text-ink-500">Belum ada laporan akhir dirilis di periode ini.</p>
        ) : (
          <table className="w-full border-collapse text-small">
            <thead>
              <tr>
                <th className="border-b border-line px-2 py-1 text-left">Organisme (isolat)</th>
                <th className="border-b border-line px-2 py-1 text-left">Antibiotik · %S (diuji)</th>
              </tr>
            </thead>
            <tbody>
              {ab.rows.map((r) => (
                <tr key={r.organismCode}>
                  <td className="border-b border-line-soft px-2 py-1 align-top">
                    {r.organismCode} ({r.isolates})
                  </td>
                  <td className="border-b border-line-soft px-2 py-1">
                    {r.antibiotics
                      .map((a) => `${a.antibioticCode} ${a.percentSusceptible ?? '–'}% (${a.tested})`)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
