import { formatJam } from '@simrs/shared';
import { Chip, cx } from '@simrs/ui';
import type { Metadata } from 'next';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { IntegrasiSubnav } from '@/components/integrasi/integrasi-subnav';
import { ScenarioBanner } from '@/components/scenario-banner';
import { formatPercent } from '@/lib/manajemen';
import { getIntegrationOverview } from '@/lib/server/data/manajemen';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { IntegrationHub } from './integration-hub';

export const metadata: Metadata = { title: 'Integrasi' };

/** Sasaran kepatuhan pengiriman SATUSEHAT per resource (di bawahnya ditandai perlu tindak lanjut). */
const FHIR_TARGET = 95;

/** I01–I06 · Integration hub (mockup `Integrasi.dc.html`). Mode presentasi: data dummy fiktif (ADR-0023). */
export default async function IntegrasiPage() {
  const { session, screen, allowed } = await requireDemoScreen('integrasi');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const d = await getIntegrationOverview(session);

  const aside = (
    <>
      <section
        aria-labelledby="fhir-judul"
        className="flex flex-col gap-2.5 rounded-card border border-line bg-white p-4"
      >
        <h2 id="fhir-judul" className="m-0 text-base font-semibold">
          Kepatuhan SATUSEHAT hari ini
        </h2>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {d.fhirCompliance.map((f) => {
            const ok = f.percent >= FHIR_TARGET;
            return (
              <li
                key={f.resource}
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-small"
              >
                <span className="text-ink-700">{f.resource}</span>
                <span
                  className={cx('text-right font-mono font-semibold', ok ? 'text-ink-900' : 'text-warning')}
                >
                  {formatPercent(f.percent)}
                  <span className="sr-only">{ok ? ', memenuhi sasaran' : ', di bawah sasaran'}</span>
                </span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <span
                    className={cx('block h-1.5', ok ? 'bg-brand-600' : 'bg-[#E9B26B]')}
                    style={{ width: `${f.percent}%` }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
        <span className="text-caption text-ink-500">
          Sasaran ≥ {FHIR_TARGET}% resource terkirim tanpa galat.
        </span>
      </section>
      <section
        aria-labelledby="kred-judul"
        className="flex flex-col gap-2 rounded-card border border-line bg-white p-4"
      >
        <h2 id="kred-judul" className="m-0 text-base font-semibold">
          Kredensial dan sertifikat
        </h2>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {d.credentials.map((c) => (
            <li key={c.id} className="flex flex-col gap-0.5 text-small">
              <span className="text-ink-700">{c.label}</span>
              <span>
                <Chip tone={c.status === 'aman' ? 'success' : 'warning'}>{c.detail}</Chip>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section
        aria-labelledby="backup-judul"
        className="flex flex-col gap-1.5 rounded-card border border-line bg-white p-4"
      >
        <h2 id="backup-judul" className="m-0 text-base font-semibold">
          Backup (aturan 3-2-1)
        </h2>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-small text-ink-700">
          {d.backups.map((b) => (
            <li key={b.id}>
              {b.label}: {b.detail}
            </li>
          ))}
        </ul>
      </section>
    </>
  );

  return (
    <IntegrationHub
      heading={
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Sistem / Integration hub · I01–I06 · data per {formatJam(d.asOf)}
          </span>
          <h1 className="m-0 text-h1 font-semibold">Integrasi · pemantauan antarmuka</h1>
        </div>
      }
      subnav={
        <>
          <IntegrasiSubnav current="/sistem/integrasi" />
          <ScenarioBanner session={session} screen="integrasi" />
        </>
      }
      data={d}
      aside={aside}
    />
  );
}
