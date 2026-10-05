import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScaleToFit } from '@/components/scale-to-fit';
import { CONSENT_ID } from '@/lib/demo/fixtures/ids';
import { patientById } from '@/lib/demo/fixtures/pasien';
import { CONSENT_IDS } from '@/lib/demo/fixtures/rawat-inap';
import { CONSENT_STATUS_LABEL } from '@/lib/rawat-inap';
import { consentTurn, getConsentDocument } from '@/lib/server/data/klinis/consent';
import { scenarioSteps } from '@/lib/server/data/klinis/shared';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Persetujuan tindakan' };

/**
 * K11 · Pintu tablet persetujuan: bila tugas persetujuan Tn. Hartono sedang gilirannya, langsung ke dokumennya;
 * selain itu daftar dokumen yang menunggu tanda tangan di tablet ini.
 */
export default async function PersetujuanIndexPage() {
  const { session, screen, allowed } = await requireDemoScreen('consent');
  if (!allowed) {
    return (
      <div className="mx-auto max-w-3xl p-16">
        <DemoAccessDenied screen={screen} />
      </div>
    );
  }
  const [tl] = await scenarioSteps(session, [['igd-ranap', 'tata-laksana']]);
  if (tl?.tasks.consent?.enabled) redirect(`/tablet/persetujuan/${CONSENT_ID.hartono}`);
  const docs = await Promise.all(
    (await Promise.all(CONSENT_IDS.map((id) => getConsentDocument(session, id))))
      .filter((d) => d !== null)
      .map(async (d) => ({ ...d, wait: (await consentTurn(session, d)).wait })),
  );

  return (
    <ScaleToFit
      width={834}
      height={1194}
      label="Tablet persetujuan tindakan"
      className="overflow-hidden rounded-[24px] shadow-[0_12px_40px_rgba(20,33,43,0.18)]"
    >
      <div className="flex h-full flex-col bg-canvas text-ink-900">
        <header className="flex flex-col border-b border-line bg-white px-7 py-[18px]">
          <span className="text-[13px] text-ink-500">
            Persetujuan tindakan kedokteran · {session.tenant.name}
          </span>
          <h1 className="m-0 text-[22px] font-semibold">Dokumen di tablet ini</h1>
        </header>
        <ul className="m-0 flex list-none flex-col gap-3 p-7 text-[17px]">
          {docs.map((d) => {
            const p = patientById(d.patientId);
            return (
              <li key={d.id}>
                <Link
                  href={`/tablet/persetujuan/${d.id}`}
                  className="flex min-h-20 items-center justify-between gap-4 rounded-card border border-line bg-white px-5 py-4 text-ink-900 no-underline"
                >
                  <span className="flex flex-col">
                    <span className="font-semibold">{d.procedure}</span>
                    <span className="text-[14px] text-ink-700">
                      {p?.nama} · RM {p?.rm} · {d.location}
                    </span>
                  </span>
                  <span
                    className={
                      d.status === 'final'
                        ? 'rounded-full bg-success-bg px-3 py-1 text-[13px] font-semibold text-success'
                        : d.status === 'ditolak'
                          ? 'rounded-full bg-danger-bg px-3 py-1 text-[13px] font-semibold text-danger'
                          : 'rounded-full bg-warning-bg px-3 py-1 text-[13px] font-semibold text-warning'
                    }
                  >
                    {d.wait ? 'Menunggu giliran simulasi' : CONSENT_STATUS_LABEL[d.status]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </ScaleToFit>
  );
}
