import { cx } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import type { LogKind } from '@/lib/demo/engine/format';
import { runScenario } from '@/lib/demo/engine/run';
import { SCENARIO_ORDER, SCENARIOS } from '@/lib/demo/skenario';
import { simulationView } from '@/lib/demo/simulasi-view';
import { OpenScreenButton } from '@/components/open-screen-button';
import { screenById } from '@/lib/screens';
import { SYSTEM_ROLES, type SystemRoleCode } from '@simrs/shared';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { loadDemoRuns } from '@/lib/server/demo/scenario';
import { SimulasiControls } from './simulasi-controls';
import { StepCard, SummaryActions } from './step-card';

export const metadata: Metadata = { title: 'Simulasi pasien' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TAG: Record<LogKind, string> = {
  bpjs: 'bg-info-bg text-info',
  satusehat: 'bg-brand-50 text-brand-700',
  keselamatan: 'bg-danger-bg text-danger',
  pembayaran: 'bg-[#E8EDF2] text-ink-900',
  internal: 'bg-muted text-ink-700',
};
const STAT: Record<Exclude<LogKind, 'internal'>, string> = {
  bpjs: 'bg-info-bg text-info',
  satusehat: 'bg-brand-50 text-brand-700',
  pembayaran: 'bg-[#E8EDF2] text-ink-900',
  keselamatan: 'bg-danger-bg text-danger',
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
          <h1 className="m-0 text-h1 font-semibold">Simulasi pasien end-to-end</h1>
        </div>
        <SimulasiControls
          rev={runs.rev}
          scenario={runs.active}
          tabs={SCENARIO_ORDER.map((id) => ({ id, label: SCENARIOS[id].label }))}
          finished={v.finished}
          activeStep={v.activeStep}
          stages={def.steps.map((s) => s.stage)}
        />
      </header>

      <section
        aria-label="Pasien"
        className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-white bg-[linear-gradient(100deg,rgba(15,118,110,0.08),rgba(255,255,255,0)_55%)] px-[18px] py-3.5"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-11 items-center justify-center rounded-full bg-[linear-gradient(160deg,#1D7E77,#0B5D56)] font-semibold text-white"
          >
            {v.patient.initials}
          </span>
          <span className="flex flex-col">
            <span className="text-[17px] font-semibold">{v.patient.nama}</span>
            <span className="text-[12.5px] text-ink-500">{v.patient.meta}</span>
          </span>
        </div>
        <div className="flex flex-[1_1_360px] flex-wrap gap-2">
          <span className="rounded-full bg-muted px-2.5 py-1 text-[12.5px] font-semibold text-ink-700">
            {v.patient.alergi}
          </span>
          <span className="rounded-full bg-warning-bg px-2.5 py-1 text-[12.5px] font-semibold text-warning">
            {v.patient.riwayat}
          </span>
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[12.5px] font-semibold text-brand-700">
            {v.patient.penjamin}
          </span>
          <span className="rounded-full bg-info-bg px-2.5 py-1 text-[12.5px] font-semibold text-info">
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
        <div className="overflow-x-auto">
          <ol className="m-0 flex w-max list-none gap-2 p-0 pb-1">
            {v.journey.map((j) => {
              const inner = (
                <>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cx(
                        'flex size-6 flex-none items-center justify-center rounded-full border-[1.5px] text-caption font-bold',
                        j.state === 'selesai'
                          ? j.stage === 'Selesai'
                            ? 'border-success bg-success text-white'
                            : 'border-brand-600 bg-brand-600 text-white'
                          : j.state === 'aktif'
                            ? 'border-brand-600 bg-white text-brand-700'
                            : 'border-line-strong bg-white text-ink-500',
                      )}
                    >
                      {j.mark}
                    </span>
                    <span className="truncate text-[11.5px] text-ink-500">{j.time}</span>
                  </span>
                  <span className="text-small leading-tight font-semibold">{j.stage}</span>
                  <span className="text-[11.5px] leading-tight text-ink-500">{j.actor}</span>
                </>
              );
              const box = cx(
                'flex w-[132px] flex-col gap-1.5 rounded-[12px] border-[1.5px] p-2.5 text-ink-900 no-underline',
                j.viewing
                  ? 'border-brand-600 bg-selected'
                  : j.state === 'aktif'
                    ? 'border-[#9FCFC8] bg-white'
                    : 'border-line bg-white',
              );
              return (
                <li key={j.index}>
                  {j.clickable ? (
                    <Link
                      href={
                        j.index === v.activeStep && !v.finished ? '/simulasi' : `/simulasi?langkah=${j.index}`
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
          className="block h-1 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-label="Kemajuan simulasi"
          aria-valuenow={v.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span
            className="block h-1 bg-[linear-gradient(90deg,#1D7E77,#0F766E)]"
            style={{ width: `${v.progress}%` }}
          />
        </span>
      </nav>

      <div className="flex flex-wrap items-start gap-5">
        <section aria-label="Langkah aktif" className="flex min-w-0 flex-[999_1_560px] flex-col gap-3.5">
          {v.step && <StepCard step={v.step} rev={runs.rev} activeHref="/simulasi" />}
          {v.summary && (
            <div className="overflow-hidden rounded-card border border-line bg-white">
              <div className="flex flex-col gap-1.5 border-b border-line bg-[linear-gradient(100deg,rgba(30,107,52,0.10),#FFFFFF_60%)] p-[18px]">
                <span className="self-start rounded-full bg-success-bg px-2.5 py-0.5 text-caption font-semibold text-success">
                  Simulasi selesai
                </span>
                <h2 className="m-0 text-h1 font-semibold">{v.summary.title}</h2>
                <p className="m-0 text-[13.5px] text-ink-700">{v.summary.sub}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 px-[18px] py-4 lg:grid-cols-4">
                {v.summary.stats.map((s) => (
                  <div
                    key={s.label}
                    className="flex flex-col gap-0.5 rounded-[12px] border border-line bg-[linear-gradient(160deg,#FFFFFF_55%,rgba(15,118,110,0.06))] p-3"
                  >
                    <span className="text-caption text-ink-500">{s.label}</span>
                    <span className="text-[20px] font-bold">{s.value}</span>
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
                    <span className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <span className="bg-[#E9B26B]" style={{ width: `${b.waitPct}%` }} />
                      <span className="bg-brand-600" style={{ width: `${b.servicePct}%` }} />
                    </span>
                    <span className="text-[12.5px] text-ink-700">{b.text}</span>
                  </div>
                ))}
                <span className="flex flex-wrap gap-4 text-caption text-ink-700">
                  <span>
                    <span className="mr-1.5 inline-block size-2.5 rounded-[3px] bg-[#E9B26B]" />
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
                nextScenario={{ id: nextId, label: SCENARIOS[nextId].label }}
              />
              <div className="flex flex-wrap gap-4 px-[18px] pb-4">
                {(['dasbor', 'app-pasien'] as const).map((id) => {
                  const target = screenById(id);
                  if (!target || target.status === 'belum') return null;
                  const role = target.demoRoles === 'semua' ? null : (target.demoRoles[0] ?? null);
                  return (
                    <OpenScreenButton
                      key={id}
                      screen={{ id: target.id, label: target.label, ready: true }}
                      role={role}
                      roleName={role ? SYSTEM_ROLES[role as SystemRoleCode] : null}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <aside
          aria-label="Rekam pasien dan jejak sistem"
          className="flex w-full flex-[1_1_340px] flex-col gap-3.5 lg:max-w-[440px]"
        >
          <div className="flex flex-col gap-2 rounded-card border border-line bg-white px-4 py-3.5">
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

          <div className="flex flex-col gap-2.5 rounded-card border border-line bg-white px-4 py-3.5">
            <span className="font-semibold">Integrasi dan keselamatan</span>
            <div className="grid grid-cols-2 gap-2">
              {v.integration.map((s) => (
                <span key={s.kind} className={cx('flex flex-col rounded-control px-2.5 py-2', STAT[s.kind])}>
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
                        t.time ? 'border-info-border bg-info-bg' : 'border-line bg-subtle',
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

          <div className="flex flex-col gap-2 rounded-card border border-line bg-white px-4 py-3.5">
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

          <div className="overflow-hidden rounded-card border border-line bg-white">
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
                            className={cx('rounded-full px-1.5 py-px text-[11px] font-semibold', TAG[l.kind])}
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
    </div>
  );
}
