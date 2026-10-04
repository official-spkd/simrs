import { Chip, cx, KpiCard } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { ScenarioBanner } from '@/components/scenario-banner';
import { patientById } from '@/lib/demo/fixtures/pasien';
import { INPATIENT_FLAG_LABEL } from '@/lib/demo/fixtures/rawat-inap';
import { BANGSAL } from '@/lib/demo/fixtures/rs';
import { ewsLevel } from '@/lib/rawat-inap';
import { getInpatientList } from '@/lib/server/data/rawat-inap';
import { requireDemoScreen } from '@/lib/server/demo-guard';

export const metadata: Metadata = { title: 'Rawat inap' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const COLS = 'lg:grid-cols-[120px_1.6fr_1.5fr_1.3fr_64px_96px_1.4fr]';

/** K04 · Daftar pasien rawat inap (pintu ke CPPT, eMAR, EWS per pasien). Mode presentasi (ADR-0023). */
export default async function RawatInapPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('ranap');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const sp = await searchParams;
  const all = await getInpatientList(session);
  const ward = typeof sp.bangsal === 'string' ? sp.bangsal.toUpperCase() : 'SEMUA';
  const list = all.filter((x) => ward === 'SEMUA' || x.wardCode === ward);
  const wards = BANGSAL.filter((w) => all.some((x) => x.wardCode === w.code));
  const count = (f: (typeof all)[number]['flags'][number]) => all.filter((x) => x.flags.includes(f)).length;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">Klinis / Rawat inap · {session.tenant.name}</span>
        <h1 className="m-0 text-h1 font-semibold">Pasien rawat inap</h1>
      </header>
      <ScenarioBanner session={session} screen="ranap" />
      <div role="region" aria-label="Ringkasan rawat inap" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Pasien di daftar ini" value={all.length} detail="pasien dengan rekam rawat aktif" />
        <KpiCard
          label="Menunggu co-sign DPJP"
          value={count('cosign')}
          hint="catatan residen"
          tone="warning"
          tinted
        />
        <KpiCard
          label="Obat terlambat"
          value={count('emar-terlambat')}
          hint="perlu alasan"
          tone="danger"
          tinted
        />
        <KpiCard
          label="Rencana pulang"
          value={count('rencana-pulang')}
          hint="resume disiapkan"
          tone="success"
        />
      </div>
      <nav aria-label="Filter bangsal" className="flex flex-wrap gap-1.5">
        {[{ code: 'SEMUA', name: 'Semua bangsal' }, ...wards].map((w) => {
          const on = w.code === ward;
          return (
            <Link
              key={w.code}
              href={w.code === 'SEMUA' ? '?' : `?bangsal=${w.code.toLowerCase()}`}
              aria-current={on ? 'page' : undefined}
              className={cx(
                'inline-flex h-11 items-center rounded-full border px-3.5 text-small no-underline',
                on
                  ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
                  : 'border-line-strong bg-white text-ink-700',
              )}
            >
              {w.name}
            </Link>
          );
        })}
      </nav>
      <section
        aria-label="Daftar pasien rawat inap"
        className="overflow-hidden rounded-card border border-line bg-white"
      >
        <div
          aria-hidden="true"
          className={cx('hidden bg-subtle text-caption font-semibold text-ink-700 lg:grid', COLS)}
        >
          {['Bed', 'Pasien', 'Diagnosis', 'DPJP', 'Hari', 'EWS', 'Penanda'].map((h) => (
            <span key={h} className="px-3 py-2.5">
              {h}
            </span>
          ))}
        </div>
        <ul className="m-0 list-none p-0">
          {list.map((x) => {
            const p = patientById(x.patientId);
            const dx = x.diagnoses.find((d) => d.primary) ?? x.diagnoses[0];
            const lv = ewsLevel(x.lastEws);
            const w = BANGSAL.find((b) => b.code === x.wardCode);
            return (
              <li key={x.encounterId} className="border-t border-line-soft">
                <Link
                  href={`/klinis/rawat-inap/${x.encounterId}`}
                  className={cx(
                    'grid grid-cols-[1fr_auto] gap-x-2 px-0 py-1 text-ink-900 no-underline lg:py-0',
                    COLS,
                  )}
                >
                  <span className="px-3 py-1.5 lg:py-2.5">
                    <span className="block font-mono font-semibold">{x.bed}</span>
                    <span className="block text-caption text-ink-500">{w?.name ?? x.wardCode}</span>
                  </span>
                  <span className="order-first col-span-2 flex flex-col px-3 pt-2 lg:order-none lg:col-span-1 lg:py-2.5">
                    <span className="font-semibold text-brand-700 underline-offset-2 hover:underline">
                      {p?.nama}
                    </span>
                    <span className="text-caption text-ink-500">
                      RM <span className="font-mono">{p?.rm}</span> · {p?.jk} · {p?.umur} th
                      {x.scenario ? ' · pasien simulasi' : ''}
                    </span>
                  </span>
                  <span className="px-3 py-1.5 text-small lg:py-2.5">
                    {dx && (
                      <>
                        <span className="font-mono font-semibold">{dx.code}</span> {dx.label}
                      </>
                    )}
                  </span>
                  <span className="hidden px-3 py-2.5 text-small text-ink-700 lg:block">{x.dpjp}</span>
                  <span className="px-3 py-1.5 text-small lg:py-2.5">H{x.day}</span>
                  <span className="px-3 py-1.5 lg:py-2.5">
                    <span className={cx('rounded-full px-2 py-[3px] text-caption font-bold', lv.tone)}>
                      {x.lastEws} · {lv.level}
                    </span>
                  </span>
                  <span className="col-span-2 flex flex-wrap gap-1 px-3 pb-2 lg:col-span-1 lg:py-2.5">
                    {x.flags.map((f) => (
                      <Chip
                        key={f}
                        tone={
                          f === 'emar-terlambat' ? 'danger' : f === 'rencana-pulang' ? 'success' : 'warning'
                        }
                      >
                        {INPATIENT_FLAG_LABEL[f]}
                      </Chip>
                    ))}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {list.length === 0 && (
          <p className="m-0 px-4 py-3.5 text-small text-ink-500">Tidak ada pasien di bangsal ini.</p>
        )}
      </section>
    </div>
  );
}
