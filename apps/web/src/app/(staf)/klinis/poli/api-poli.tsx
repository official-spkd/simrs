import { formatJam, formatTanggal } from '@simrs/shared';
import { Alert, Chip, cx } from '@simrs/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { screenById, screenOpen } from '@/lib/screens';
import { ApiError } from '@/lib/server/api-core';
import { getPoliVisitApi, getPoliWorklistApi } from '@/lib/server/data/klinis/poli';
import { can, type SessionView } from '@/lib/session-view';
import { ApiPoliClient } from './api-poli-client';

function LoadError({ title, err }: { title: string; err: unknown }) {
  if (err instanceof ApiError && err.status !== 401) {
    return (
      <Alert level="critical" title={title}>
        {err.message}
      </Alert>
    );
  }
  throw err;
}

/**
 * K01/K02 · Pemeriksaan poli mode api (W1, mockup `Main.dc.html`): antrean poli hari ini (`GET /poli/worklist`),
 * kunjungan terpilih (`GET /encounters/:id/poli-visit`), TTV, SOAP + ICD-10, order lewat CPOE, resume RJ ber-TTE, dan
 * panggil antrean (task 4/5). `?pasien=<id>` memilih pasien di antrean hari ini; pasien yang tidak ada di antrean →
 * 404 (cegah salah pasien). Izin ditegakkan ulang API.
 */
export async function ApiPoli({
  session,
  pasien,
  poli,
}: {
  session: SessionView;
  pasien: string | null;
  poli: string | null;
}) {
  let worklist;
  try {
    worklist = await getPoliWorklistApi(poli);
  } catch (err) {
    return <LoadError title="Antrean poli tidak bisa dimuat" err={err} />;
  }
  const selected = pasien
    ? worklist.items.find((i) => i.patientId === pasien)
    : (worklist.items.find((i) => i.status === 'diperiksa') ??
      worklist.items.find((i) => i.status === 'menunggu') ??
      worklist.items[0]);
  if (pasien && !selected) notFound();
  let visit = null;
  if (selected) {
    try {
      visit = await getPoliVisitApi(selected.encounterId);
    } catch (err) {
      return <LoadError title="Kunjungan tidak bisa dimuat" err={err} />;
    }
  }
  const role = session.role?.code ?? null;
  /** Tautan hanya ke layar yang terbuka di mode api untuk peran ini (tanpa tombol mati). */
  const routeOf = (id: string): string | null => {
    const s = screenById(id);
    return s && screenOpen(s, { dataSource: 'api', role, permissions: session.permissions }) ? s.route : null;
  };
  const resume = routeOf('resume');
  const cpoe = routeOf('order');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Rawat jalan / {worklist.poli.name} / Pemeriksaan · {session.tenant.name}
          </span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Pemeriksaan pasien</h1>
        </div>
        <span className="flex flex-wrap gap-2">
          <Chip tone="neutral">
            {formatTanggal(worklist.date)} · {formatJam(new Date())}
          </Chip>
          <Chip tone="brand">
            {worklist.poli.room} · {worklist.doctor}
          </Chip>
        </span>
      </header>
      {worklist.options.length > 1 && (
        <nav aria-label="Pilih poli atau sesi" className="flex flex-wrap gap-2">
          {[{ serviceId: null as string | null, label: 'Semua pasien saya' }, ...worklist.options].map(
            (o) => {
              const on = (o.serviceId ?? null) === poli;
              return (
                <Link
                  key={o.serviceId ?? 'semua'}
                  href={o.serviceId ? `/klinis/poli?poli=${o.serviceId}` : '/klinis/poli'}
                  aria-current={on ? 'page' : undefined}
                  className={cx(
                    'inline-flex min-h-11 items-center rounded-control border px-3 text-small font-semibold no-underline',
                    on
                      ? 'border-brand-600 bg-brand-100 text-brand-800'
                      : 'border-line-strong bg-white/90 text-ink-900 hover:bg-brand-50/60',
                  )}
                >
                  {o.label}
                </Link>
              );
            },
          )}
        </nav>
      )}
      {visit && selected ? (
        <ApiPoliClient
          key={selected.encounterId}
          worklist={worklist}
          visit={visit}
          role={role}
          cpoeHref={cpoe ? `${cpoe}/${selected.encounterId}` : null}
          kasirHref={routeOf('kasir')}
          rujukHref={routeOf('rujukan')}
          resumeHref={resume ? `${resume}/${selected.encounterId}` : null}
          canCall={can(session, 'queue', 'call') && Boolean(worklist.serviceId)}
          query={poli ? `&poli=${poli}` : ''}
        />
      ) : (
        <Alert level="info" title="Antrean kosong">
          Belum ada pasien di antrean {worklist.poli.name} hari ini.
        </Alert>
      )}
    </div>
  );
}
