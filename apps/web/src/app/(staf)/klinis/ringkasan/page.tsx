import { formatJam, formatTanggalLahir } from '@simrs/shared';
import { Chip, cx } from '@simrs/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ValueFlagBadge } from '@/components/klinis/status-flag';
import { RmeChartHeader } from '@/components/rme/chart-header';
import { DemoAccessDenied } from '@/components/demo-access-denied';
import { chartPatient } from '@/lib/demo/fixtures/rme-pasien';
import { EXTRA_RESULTS, OUTPATIENT_MEDS, recentVisits } from '@/lib/demo/fixtures/rme-ringkasan';
import { DEMO_NOW } from '@/lib/demo/fixtures/waktu';
import { formatTglJam } from '@/lib/rawat-inap';
import { chartHref, openRoute } from '@/lib/rme';
import { activeAllergies, current } from '@/lib/rme-diagnosis';
import { lastVitals, latestResults, riskFlags, type SummaryMed } from '@/lib/rme-ringkasan';
import { requireDemoScreen } from '@/lib/server/demo-guard';
import { diagnosisListsOf, rmeChart } from '@/lib/server/data/klinis/rme';
import { criticalNotices } from '@/lib/server/data/klinis/worklist';

export const metadata: Metadata = { title: 'Ringkasan pasien' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Box({
  title,
  source,
  children,
  more,
}: {
  title: string;
  source: string;
  children: ReactNode;
  more?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-white px-4 py-3.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-body font-semibold">{title}</h2>
        {more}
      </div>
      {children}
      <span className="mt-auto text-caption text-ink-500">Sumber: {source}</span>
    </section>
  );
}

/**
 * K14 · Ringkasan pasien satu halaman (`?pasien=`): identitas, flag risiko, alergi, problem aktif, obat aktif, hasil
 * terbaru (kritis di atas), tanda vital + EWS, kunjungan terakhir, rencana. Hanya baca; setiap blok menyebut
 * sumbernya dan menaut ke layar asal. Mode presentasi (ADR-0023): rekam dari toko demo (ADR-0085) — alergi, problem,
 * observasi, dan CPPT (`rekam-medis`), pelaporan nilai kritis dari Laboratorium/Pusat hasil kritis (`hasil-kritis`);
 * backend `GET /api/v1/summary/patients/:id` menyusul (rencana fase 3 · 3.2a).
 */
export default async function RingkasanPage({ searchParams }: { searchParams: SearchParams }) {
  const { session, screen, allowed } = await requireDemoScreen('ringkasan');
  if (!allowed) return <DemoAccessDenied screen={screen} />;
  const { chart, state } = await rmeChart((await searchParams).pasien);
  const p = chartPatient(chart);
  const role = session.role?.code ?? null;
  const d = chart.inpatient;
  const lists = diagnosisListsOf(chart, state);
  const dx = current(lists.dx).filter((x) => x.status === 'aktif');
  const problems = current(lists.problems).filter((x) => x.status === 'aktif');
  const allergies = { list: activeAllergies(lists.allergies), nkdaAt: lists.nkdaAt };
  const critical = (await criticalNotices(session)).filter((c) => c.rm === p.rm);
  const results = latestResults([...(d?.results ?? []), ...(EXTRA_RESULTS[chart.encounterId] ?? [])]);
  const vitals = d ? lastVitals(d.observations) : null;
  const meds: SummaryMed[] = d
    ? d.medications.map((m) => ({ name: m.name, sig: m.sig, highAlert: m.highAlert }))
    : [...(OUTPATIENT_MEDS[chart.encounterId] ?? [])];
  const flags = riskFlags({
    allergies: allergies.list.map((a) => a.substance),
    results,
    ewsLevel: vitals?.level ?? null,
    risk: d?.summary.risk ?? null,
    flags: d?.summary.flags ?? [],
  });
  const link = (id: string, label: string) => {
    const r = openRoute(id, role);
    return r ? (
      <Link href={chartHref(r, chart.encounterId)} className="text-small font-semibold text-brand-700">
        {label}
      </Link>
    ) : null;
  };

  return (
    <div className="flex flex-col gap-4">
      <RmeChartHeader
        chart={chart}
        screenId="ringkasan"
        title="Ringkasan pasien"
        tenantName={session.tenant.name}
        role={role}
        asOf={DEMO_NOW}
      />
      <section aria-label="Flag risiko" className="flex flex-wrap gap-2">
        {flags.length === 0 ? (
          <Chip tone="success">Tidak ada flag risiko aktif</Chip>
        ) : (
          flags.map((f) => (
            <Chip key={f.label} tone={f.tone}>
              {f.label}
            </Chip>
          ))
        )}
      </section>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Box title="Identitas & penjamin" source="Master pasien (MPI)">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-small">
            <dt className="text-ink-500">NIK</dt>
            <dd className="m-0 font-mono">{p.nikMasked}</dd>
            <dt className="text-ink-500">Tanggal lahir</dt>
            <dd className="m-0">{formatTanggalLahir(p.tanggalLahir)}</dd>
            <dt className="text-ink-500">Penjamin</dt>
            <dd className="m-0">
              {p.penjamin}
              {p.kelas ? ` · ${p.kelas}` : ''}
              {p.bpjsMasked ? ` · ${p.bpjsMasked}` : ''}
            </dd>
            <dt className="text-ink-500">Telepon</dt>
            <dd className="m-0">{p.telepon}</dd>
            <dt className="text-ink-500">Alamat</dt>
            <dd className="m-0">{p.alamat}</dd>
          </dl>
        </Box>
        <Box title="Alergi" source="Daftar alergi terverifikasi" more={link('diagnosis', 'Kelola')}>
          {allergies.list.length === 0 ? (
            <p className="m-0 text-small font-semibold text-success">
              Tidak ada alergi yang diketahui (NKDA)
              {allergies.nkdaAt ? ` · diverifikasi ${formatTglJam(allergies.nkdaAt)}` : ''}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {allergies.list.map((a) => (
                <li key={a.id} className="text-small">
                  <span className="font-semibold text-danger">
                    {a.substance} · {a.severity}
                  </span>{' '}
                  · {a.reaction}
                </li>
              ))}
            </ul>
          )}
        </Box>
        <Box title="Problem aktif" source="Problem list lintas kunjungan" more={link('diagnosis', 'Kelola')}>
          {problems.length === 0 ? (
            <p className="m-0 text-small text-ink-500">Belum ada masalah aktif tercatat.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {problems.map((x) => (
                <li key={x.id} className="text-small">
                  <span className="font-mono font-semibold">{x.code}</span> {x.display}
                  <span className="text-caption text-ink-500"> · sejak {formatTanggalLahir(x.onset)}</span>
                </li>
              ))}
            </ul>
          )}
        </Box>
        <Box
          title="Obat aktif"
          source={d ? 'eMAR rawat inap (resep terverifikasi)' : 'Resep rawat jalan terakhir'}
          more={d ? link('askep', 'Ronde obat') : null}
        >
          {meds.length === 0 ? (
            <p className="m-0 text-small text-ink-500">Tidak ada obat aktif.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {meds.map((m) => (
                <li key={m.name} className="flex flex-col text-small">
                  <span className="font-semibold">
                    {m.name}
                    {m.highAlert && (
                      <Chip tone="warning" className="ml-2">
                        High-alert
                      </Chip>
                    )}
                  </span>
                  <span className="text-caption text-ink-700">{m.sig}</span>
                </li>
              ))}
            </ul>
          )}
        </Box>
        {critical.length > 0 && (
          <Box
            title="Pelaporan nilai kritis"
            source="Laboratorium / Pusat hasil kritis (read-back)"
            more={link('kritis', 'Pusat hasil kritis')}
          >
            <ul aria-label="Nilai kritis" className="m-0 flex list-none flex-col gap-1.5 p-0">
              {critical.map((c) => (
                <li key={`${c.test}-${c.valueText}`} className="flex flex-col text-small">
                  <span className="font-semibold text-danger">
                    {c.test} · {c.valueText}
                  </span>
                  <span
                    className={cx('text-caption', c.report ? 'text-success' : 'font-semibold text-warning')}
                  >
                    {c.report
                      ? `Dilaporkan ${c.report.reportedBy} ke ${c.report.recipient} (${c.report.recipientRole}) · ${formatJam(c.report.reportedAt)} · read-back`
                      : 'Belum dilaporkan ke penerima; timer batas lapor berjalan'}
                  </span>
                </li>
              ))}
            </ul>
          </Box>
        )}
        <Box title="Hasil terbaru" source="Laboratorium tervalidasi (nilai kritis di atas)">
          {results.length === 0 ? (
            <p className="m-0 text-small text-ink-500">Belum ada hasil pemeriksaan pada kunjungan ini.</p>
          ) : (
            <ul aria-label="Daftar hasil" className="m-0 flex list-none flex-col gap-1.5 p-0">
              {results.map((r) => (
                <li
                  key={`${r.name}-${r.at}`}
                  className={cx(
                    'flex flex-wrap items-center gap-2 text-small',
                    r.flag === 'kritis' && 'rounded-control bg-danger-bg px-2 py-1',
                  )}
                >
                  <span className="font-semibold">{r.name}</span>
                  <span className="font-mono">{r.value}</span>
                  {r.flag !== 'normal' && <ValueFlagBadge flag={r.flag} />}
                  <span className="text-caption text-ink-500">{formatTglJam(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Box>
        <Box title="Tanda vital terakhir" source="Observasi + EWS (NEWS2)">
          {vitals ? (
            <>
              <p className="m-0 text-small">
                TD {vitals.sbp}/{vitals.dbp} · N {vitals.hr} · RR {vitals.rr} · S{' '}
                {String(vitals.temp).replace('.', ',')} °C · SpO2 {vitals.spo2}%
                {vitals.onOxygen ? ' (O2)' : ''} · {formatTglJam(vitals.at)}
              </p>
              <p className="m-0 text-small font-semibold">
                EWS {vitals.score} · {vitals.level} · {vitals.action}
              </p>
            </>
          ) : (
            <p className="m-0 text-small text-ink-500">
              Tanda vital rawat jalan tercatat di layar Pemeriksaan poli.
            </p>
          )}
        </Box>
        <Box title="Kunjungan terakhir" source="Riwayat kunjungan (kelompok RM)">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {recentVisits(chart).map((v) => (
              <li key={`${v.date}-${v.kind}`} className="flex flex-col text-small">
                <span className="font-semibold">
                  {formatTanggalLahir(v.date)} · {v.kind}
                </span>
                <span className="text-caption text-ink-700">
                  {v.unit} · {v.doctor} · {v.note}
                </span>
              </li>
            ))}
          </ul>
        </Box>
        <Box
          title="Rencana"
          source={d ? 'CPPT DPJP terakhir' : 'Diagnosis kunjungan'}
          more={link('cppt', 'CPPT')}
        >
          <p className="m-0 text-small">
            {d?.plan ??
              (dx.length
                ? dx.map((x) => `${x.code} ${x.display}`).join(' · ')
                : 'Belum ada rencana tercatat.')}
          </p>
        </Box>
      </div>
    </div>
  );
}
