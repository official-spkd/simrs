import { cx, TabPanel } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import type { LogKind } from '@/lib/demo/engine/format';
import { runScenario } from '@/lib/demo/engine/run';
import { SCENARIO_ORDER, SCENARIOS } from '@/lib/demo/skenario';
import { scenarioName, simulationView } from '@/lib/demo/simulasi-view';
import { OpenScreenButton } from '@/components/open-screen-button';
import { screenById } from '@/lib/screens';
import { SYSTEM_ROLES, type SystemRoleCode } from '@simrs/shared';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { loadDemoRuns } from '@/lib/server/demo/scenario';
import { SimulasiControls } from './simulasi-controls';
import { StepCard, SummaryActions } from './step-card';

export const metadata: Metadata = { title: 'Simulasi pasien' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Tautan di kartu ringkasan (mockup Simulasi): sisi pasien dan dasbor direksi. */
const SUMMARY_LINKS = [
  { id: 'app-pasien', text: 'Lihat dari sisi pasien' },
  { id: 'dasbor', text: 'Dasbor direksi' },
] as const;

/** Tab skenario (kontrol) ↔ panel skenario aktif (halaman). */
const SCENARIO_TABS = 'simulasi-skenario';

const TAG: Record<LogKind, string> = {
  bpjs: 'bg-samudra-100 text-samudra-700',
  satusehat: 'bg-brand-100 text-brand-800',
  keselamatan: 'bg-koral-100 text-koral-800',
  pembayaran: 'bg-batu-200 text-batu-800',
  internal: 'bg-batu-100 text-ink-700',
};
const STAT: Record<Exclude<LogKind, 'internal'>, string> = {
  bpjs: 'bg-[linear-gradient(135deg,var(--color-samudra-100),var(--color-samudra-50))] text-samudra-800',
  satusehat: 'bg-[linear-gradient(135deg,var(--color-brand-100),var(--color-brand-50))] text-brand-800',
  pembayaran: 'bg-[linear-gradient(135deg,var(--color-batu-200),var(--color-batu-100))] text-batu-800',
  keselamatan: 'bg-[linear-gradient(135deg,var(--color-koral-100),var(--color-koral-50))] text-koral-800',
};

/**
 * Simulasi pasien end-to-end (mockup `Simulasi.dc.html`, mode presentasi ADR-0023): tiga skenario fiktif yang
 * dijalankan langkah demi langkah oleh presenter. Keadaan disimpan di server per akun demo; layar lain membaca
 * keadaan yang sama.
 */
export default async function SimulasiPage({ searchParams }: { searchParams: SearchParams }) {
  const { session } = await requireDemoScreen('simulasi');
  const sp = await searchParams;
  const view = z.coerce.number().int().min(0).max(60).optional().catch(undefined).parse(sp.langkah);
  const runs = await loadDemoRuns(session);
  const def = SCENARIOS[runs.active];
  const R = runScenario(def, runs.runs[runs.active]);
  const v = simulationView(R, view ?? null);
  const order = SCENARIO_ORDER.indexOf(runs.active);
  const nextId = SCENARIO_ORDER[(order + 1) % SCENARIO_ORDER.length] ?? 'rawat-jalan';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Umum / Simulasi / Data fiktif, tidak tersimpan ke rekam medis
          </span>
          <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">Simulasi pasien end-to-end</h1>
        </div>
        <SimulasiControls
          rev={runs.rev}
          scenario={runs.active}
          tabs={SCENARIO_ORDER.map((id) => ({ id, label: SCENARIOS[id].label }))}
          finished={v.finished}
          activeStep={v.activeStep}
          stages={def.steps.map((s) => s.stage)}
          idBase={SCENARIO_TABS}
        />
      </header>

      <TabPanel idBase={SCENARIO_TABS} value={runs.active} className="flex flex-col gap-4">
        <section
          aria-label="Pasien"
          className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-white/95 bg-card-header px-[18px] py-3.5 shadow-card"
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-brand-100),var(--color-brand-50))] font-bold text-brand-700"
            >
              {v.patient.initials}
            </span>
            <span className="flex flex-col">
              <span className="text-[17px] font-semibold tracking-[-0.01em]">{v.patient.nama}</span>
              <span className="text-[12.5px] text-ink-500">{v.patient.meta}</span>
            </span>
          </div>
          <div className="flex flex-[1_1_360px] flex-wrap gap-2">
            <span className="rounded-full bg-batu-200 px-[11px] py-1 text-[12.5px] font-semibold text-batu-800">
              {v.patient.alergi}
            </span>
            <span className="rounded-full bg-kunyit-100 px-[11px] py-1 text-[12.5px] font-semibold text-kunyit-800">
              {v.patient.riwayat}
            </span>
            <span className="rounded-full bg-brand-100 px-[11px] py-1 text-[12.5px] font-semibold text-brand-800">
              {v.patient.penjamin}
            </span>
            <span className="rounded-full bg-samudra-100 px-[11px] py-1 text-[12.5px] font-semibold text-samudra-700">
              Lokasi: {v.patient.lokasi}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-caption text-ink-500">Jam simulasi</span>
            <span className="font-mono text-[20px] font-semibold" data-testid="jam-simulasi">
              {v.clock.text}
            </span>
            <span className="text-caption text-ink-500">{v.clock.sub}</span>
          </div>
        </section>

        <nav aria-label="Tahap perjalanan pasien" className="flex flex-col gap-2">
          {/* Membungkus ke baris berikutnya, bukan digulir: semua tahap terlihat tanpa petunjuk geser. */}
          <div>
            <ol className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-2 p-0 pb-1">
              {v.journey.map((j) => {
                const now = j.state === 'aktif';
                const past = j.state === 'selesai';
                const sub = now ? 'text-white/85' : past ? 'text-zamrud-700' : 'text-ink-500';
                const inner = (
                  <>
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cx(
                          'flex size-6 flex-none items-center justify-center rounded-full border-[1.5px] text-caption font-bold',
                          past
                            ? j.stage === 'Selesai'
                              ? 'border-zamrud-600 bg-zamrud-600 text-white'
                              : 'border-transparent bg-white/80 text-zamrud-700'
                            : now
                              ? 'border-white/60 bg-white/20 text-white'
                              : 'border-line-strong bg-white text-ink-500',
                        )}
                      >
                        {j.mark}
                      </span>
                      <span className={cx('truncate text-[11.5px]', sub)}>{j.time}</span>
                    </span>
                    <span className="text-small leading-tight font-semibold">{j.stage}</span>
                    <span className={cx('text-[11.5px] leading-tight', sub)}>{j.actor}</span>
                  </>
                );
                const box = cx(
                  'flex h-full w-full flex-col gap-1.5 rounded-[12px] border-[1.5px] p-2.5 no-underline transition-shadow',
                  now
                    ? 'border-transparent bg-btn-primary text-white shadow-[0_6px_16px_rgba(23,32,46,0.18)] hover:text-white'
                    : past
                      ? 'border-transparent bg-zamrud-100 text-zamrud-800 hover:text-zamrud-800'
                      : 'border-transparent bg-ink-900/5 text-ink-700 hover:text-ink-700',
                  j.viewing && 'ring-2 ring-brand-600 ring-offset-2 ring-offset-canvas',
                );
                return (
                  <li key={j.index}>
                    {j.clickable ? (
                      <Link
                        href={
                          j.index === v.activeStep && !v.finished
                            ? '/simulasi'
                            : `/simulasi?langkah=${j.index}`
                        }
                        aria-current={j.state === 'aktif' ? 'step' : undefined}
                        className={box}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div aria-disabled="true" className={cx(box, 'cursor-default')}>
                        {inner}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
          <span
            className="block h-1.5 overflow-hidden rounded-full bg-ink-900/8"
            role="progressbar"
            aria-label="Kemajuan simulasi"
            aria-valuenow={v.progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className="block h-1.5 rounded-full bg-domain-bar" style={{ width: `${v.progress}%` }} />
          </span>
        </nav>

        <div className="flex flex-wrap items-start gap-5">
          <section aria-label="Langkah aktif" className="flex min-w-0 flex-[999_1_560px] flex-col gap-3.5">
            {v.step && <StepCard step={v.step} rev={runs.rev} activeHref="/simulasi" finished={v.finished} />}
            {v.summary && (
              <div className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card">
                <div className="flex flex-col gap-1.5 border-b border-line bg-alert-success p-[18px]">
                  <span className="self-start rounded-full bg-zamrud-100 px-[11px] py-0.5 text-caption font-semibold text-zamrud-700">
                    Simulasi selesai
                  </span>
                  <h2 className="m-0 text-h1 font-bold tracking-[-0.02em]">{v.summary.title}</h2>
                  <p className="m-0 text-[13.5px] text-ink-700">{v.summary.sub}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 px-[18px] py-4 lg:grid-cols-4">
                  {v.summary.stats.map((s) => (
                    <div
                      key={s.label}
                      className="shine-once flex flex-col gap-0.5 rounded-card border border-white/90 bg-[linear-gradient(135deg,var(--color-brand-100),var(--color-brand-50))] p-3 shadow-[0_8px_22px_rgba(23,32,46,0.07)]"
                    >
                      <span className="text-caption text-ink-500">{s.label}</span>
                      <span className="text-[20px] font-bold tracking-[-0.03em]">{s.value}</span>
                      <span className="text-caption text-ink-700">{s.note}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2 px-[18px] pb-4">
                  <span className="font-semibold">Waktu per tahap</span>
                  {v.summary.bars.map((b) => (
                    <div
                      key={b.stage}
                      className="grid grid-cols-1 items-center gap-1 text-small md:grid-cols-[170px_minmax(0,1fr)_200px] md:gap-3"
                    >
                      <span>{b.stage}</span>
                      <span
                        className="flex h-2.5 overflow-hidden rounded-full bg-ink-900/8"
                        aria-hidden="true"
                      >
                        <span className="bg-kunyit-300" style={{ width: `${b.waitPct}%` }} />
                        <span className="bg-brand-600" style={{ width: `${b.servicePct}%` }} />
                      </span>
                      <span className="text-[12.5px] text-ink-700">{b.text}</span>
                    </div>
                  ))}
                  <span className="flex flex-wrap gap-4 text-caption text-ink-700">
                    <span>
                      <span className="mr-1.5 inline-block size-2.5 rounded-[3px] bg-kunyit-300" />
                      Jeda atau menunggu sebelum tahap dimulai
                    </span>
                    <span>
                      <span className="mr-1.5 inline-block size-2.5 rounded-[3px] bg-brand-600" />
                      Waktu pengerjaan
                    </span>
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 px-[18px] pb-4">
                  <span className="font-semibold">Terjadi otomatis, tanpa input ulang</span>
                  <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-small text-ink-700">
                    {v.summary.auto.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
                <SummaryActions
                  rev={runs.rev}
                  scenario={runs.active}
                  nextScenario={{ id: nextId, label: scenarioName(SCENARIOS[nextId]) }}
                >
                  {SUMMARY_LINKS.map(({ id, text }) => {
                    const target = screenById(id);
                    if (!target || target.status === 'belum') return null;
                    const role = target.demoRoles === 'semua' ? null : (target.demoRoles[0] ?? null);
                    return (
                      <OpenScreenButton
                        key={id}
                        screen={{ id: target.id, label: target.label, ready: true }}
                        role={role}
                        roleName={role ? SYSTEM_ROLES[role as SystemRoleCode] : null}
                        variant="outline"
                        text={text}
                      />
                    );
                  })}
                </SummaryActions>
              </div>
            )}
          </section>

          <aside
            aria-label="Rekam pasien dan jejak sistem"
            className="flex w-full flex-[1_1_340px] flex-col gap-3.5 lg:max-w-[440px]"
          >
            <div className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">Rekam medis terbentuk</span>
                <span className="text-caption text-ink-500">diisi sekali, dipakai semua unit</span>
              </span>
              {v.record.map((r) => (
                <div
                  key={r.label}
                  className="grid grid-cols-[92px_minmax(0,1fr)] gap-2.5 border-t border-line-soft pt-1.5"
                >
                  <span className="text-[12.5px] text-ink-500">{r.label}</span>
                  <span className="text-small whitespace-pre-line">{r.value}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2.5 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5">
              <span className="font-semibold">Integrasi dan keselamatan</span>
              <div className="grid grid-cols-2 gap-2">
                {v.integration.map((s) => (
                  <span
                    key={s.kind}
                    className={cx('flex flex-col rounded-control px-2.5 py-2', STAT[s.kind])}
                  >
                    <span className="text-[20px] font-bold">{s.value}</span>
                    <span className="text-[11.5px] leading-tight text-ink-700">{s.label}</span>
                  </span>
                ))}
              </div>
              {v.bpjsTasks && (
                <>
                  <span className="text-[12.5px] text-ink-500">Status antrean ke BPJS (task ID)</span>
                  <ol className="m-0 grid list-none grid-cols-7 gap-1 p-0">
                    {v.bpjsTasks.map((t) => (
                      <li
                        key={t.n}
                        title={`Task ${t.n}: ${t.name}`}
                        className={cx(
                          'flex flex-col items-center rounded-[8px] border px-0.5 py-1.5',
                          t.time ? 'border-transparent bg-samudra-100' : 'border-transparent bg-ink-900/5',
                        )}
                      >
                        <span className={cx('font-bold', t.time ? 'text-info' : 'text-ink-400')}>{t.n}</span>
                        <span className="font-mono text-[10.5px] text-ink-500">{t.time ?? '—'}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>

            <div className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card px-4 py-3.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">Tagihan berjalan</span>
                <span className="text-caption text-ink-500">charge capture otomatis</span>
              </span>
              {v.charges.length === 0 && (
                <span className="text-small text-ink-500">Belum ada layanan yang ditagihkan.</span>
              )}
              {v.charges.map((c, i) => (
                <span
                  key={`${i}-${c.name}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 text-small"
                >
                  <span>{c.name}</span>
                  <span className="font-mono">{c.amount}</span>
                  <span className="text-[11.5px] text-ink-500">{c.src}</span>
                </span>
              ))}
              <span className="flex justify-between border-t border-line pt-2 font-bold">
                <span>Total tarif RS</span>
                <span className="font-mono" data-testid="total-tarif">
                  {v.bill.total}
                </span>
              </span>
              <span className="flex justify-between text-small text-success">
                <span>Ditanggung penjamin</span>
                <span className="font-mono">{v.bill.covered}</span>
              </span>
              <span className="flex justify-between text-small text-ink-700">
                <span>Dibayar pasien</span>
                <span className="font-mono">{v.bill.patient}</span>
              </span>
            </div>

            <div className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card">
              <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
                <span className="font-semibold">Jejak sistem</span>
                <span className="text-caption text-ink-500">{v.logs.length} kejadian · terbaru di atas</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                {v.logs.length === 0 && (
                  <span className="block px-4 py-3 text-small text-ink-500">
                    Mulai langkah pertama untuk melihat apa yang dicatat sistem.
                  </span>
                )}
                <ol className="m-0 list-none p-0">
                  {v.logs.map((l) => (
                    <li
                      key={l.key}
                      className="grid grid-cols-[74px_minmax(0,1fr)] gap-2.5 border-b border-line-soft px-4 py-2"
                    >
                      <span className="font-mono text-[11.5px] leading-snug text-ink-500">{l.time}</span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-small">{l.text}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11.5px] text-ink-500">{l.actor}</span>
                          {l.sys && (
                            <span
                              className={cx(
                                'rounded-full px-1.5 py-px text-[11px] font-semibold',
                                TAG[l.kind],
                              )}
                            >
                              {l.sys}
                            </span>
                          )}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </aside>
        </div>
      </TabPanel>
    </div>
  );
}
