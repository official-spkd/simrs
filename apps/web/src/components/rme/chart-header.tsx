import { formatTanggal, formatTanggalLahir } from '@simrs/shared';
import { Chip, cx, PatientBanner } from '@simrs/ui';
import Link from 'next/link';
import {
  chartPatient,
  demoRmeCharts,
  RME_SETTING_LABEL,
  type RmeChart,
} from '@/lib/demo/fixtures/rme-pasien';
import { chartLinks } from '@/lib/rme';
import { PatientPicker } from './patient-picker';

/**
 * Kepala setiap layar bagan RME (FE2): judul, banner pasien wajib (nama, umur, RM, alergi, penjamin; CLAUDE.md §6),
 * konteks kunjungan, pemilih pasien, dan navigasi antarlayar RME untuk pasien yang sama.
 */
export function RmeChartHeader({
  chart,
  screenId,
  title,
  tenantName,
  role,
  asOf,
}: {
  chart: RmeChart;
  screenId: string;
  title: string;
  tenantName: string;
  role: string | null;
  /** "Data per …" (instan ISO). */
  asOf: string;
}) {
  const p = chartPatient(chart);
  const guarantor = `${p.penjamin}${p.kelas ? ` ${p.kelas}` : ''}`;
  const links = chartLinks(role, chart.encounterId, screenId);
  const options = demoRmeCharts().map((c) => {
    const cp = chartPatient(c);
    return {
      encounterId: c.encounterId,
      label: `${cp.nama} · ${c.lokasi}`,
      group: RME_SETTING_LABEL[c.setting],
    };
  });
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-caption text-ink-500">
            Klinis / Rekam medis / {title} · {tenantName} · data per {formatTanggal(asOf)}
          </span>
          <h1 className="m-0 text-h1 font-semibold">
            {title} · {p.nama}
          </h1>
        </div>
        <div className="w-full sm:w-80">
          <PatientPicker options={options} current={chart.encounterId} />
        </div>
      </header>
      <PatientBanner
        name={p.nama}
        sex={p.jk}
        ageYears={p.umur}
        birthDate={formatTanggalLahir(p.tanggalLahir)}
        mrn={p.rm}
        allergies={[...p.alergi]}
        guarantor={guarantor}
        attending={chart.dpjp}
      />
      <div className="flex flex-wrap gap-2" aria-label="Konteks kunjungan">
        <Chip tone="brand">{RME_SETTING_LABEL[chart.setting]}</Chip>
        <Chip tone="neutral">{chart.lokasi}</Chip>
        {chart.day !== null && <Chip tone="neutral">Hari rawat ke-{chart.day}</Chip>}
        <Chip tone="neutral">Mulai {formatTanggal(chart.startedOn)}</Chip>
      </div>
      {links.length > 1 && (
        <nav aria-label="Bagan rekam medis pasien" className="flex flex-wrap gap-1.5">
          {links.map((l) => (
            <Link
              key={l.id}
              href={l.href}
              aria-current={l.current ? 'page' : undefined}
              className={cx(
                'inline-flex h-11 items-center rounded-full border px-3.5 text-small no-underline',
                l.current
                  ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
                  : 'border-line-strong bg-white text-ink-700',
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
