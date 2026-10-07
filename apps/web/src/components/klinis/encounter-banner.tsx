import { type EncounterContext, formatTanggalLahir } from '@simrs/shared';
import { Chip, Icon } from '@simrs/ui';

const SEX = { male: 'L', female: 'P', unknown: 'Jenis kelamin belum diketahui' } as const;
const COVERAGE_KIND: Readonly<Record<string, string>> = {
  bpjs: 'BPJS',
  umum: 'Umum',
  asuransi: 'Asuransi',
  perusahaan: 'Perusahaan',
};

/**
 * Banner pasien mode api (CLAUDE.md §6: nama, umur, RM, alergi, penjamin) dari `GET /encounters/:id/context`, tampilan
 * sama dengan `PatientBanner` Pelangi Klinis (dipakai layar klinis mode api lain juga). Data
 * yang belum diketahui ditulis apa adanya ("belum dikaji", "umur belum diketahui"), tidak diisi tebakan. Status alergi
 * selalu bertulisan, tidak hanya warna.
 */
export function EncounterBanner({ ctx }: { ctx: EncounterContext }) {
  const p = ctx.patient;
  const initials = p.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  const identity = [
    SEX[p.sex],
    p.ageYears !== null ? `${p.ageYears} th` : 'umur belum diketahui',
    p.birthDate ? formatTanggalLahir(p.birthDate) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const allergy =
    ctx.allergy.status === 'ada'
      ? { tone: 'danger' as const, text: `Alergi: ${ctx.allergy.labels.join(', ')}` }
      : ctx.allergy.status === 'nkda'
        ? { tone: 'neutral' as const, text: 'Tidak ada alergi obat (NKDA)' }
        : { tone: 'warning' as const, text: 'Alergi belum dikaji' };
  return (
    <div
      aria-label="Identitas pasien"
      className="sticky top-[var(--app-sticky-top,0px)] z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-white/95 bg-card-header px-4 py-3 shadow-card backdrop-blur-xl"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-nav-active font-bold text-white shadow-[0_6px_16px_rgba(23,32,46,0.18)]">
          {initials}
        </span>
        <div className="flex flex-col">
          <span className="text-h2 font-bold">{p.name}</span>
          <span className="text-small text-ink-700">
            {identity} · RM <span className="font-mono">{p.mrn}</span> · {ctx.encounter.number}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip
          tone={allergy.tone}
          icon={allergy.tone === 'danger' ? <Icon name="alert" size={13} strokeWidth={2} /> : undefined}
        >
          {allergy.text}
        </Chip>
        <Chip tone="info">
          {ctx.coverage
            ? `${COVERAGE_KIND[ctx.coverage.kind] ?? ctx.coverage.name} · ${ctx.coverage.name}`
            : 'Penjamin belum tercatat'}
        </Chip>
        {ctx.dpjp && <Chip tone="brand">DPJP {ctx.dpjp.name}</Chip>}
        {p.confidential && <Chip tone="warning">Pasien rahasia</Chip>}
      </div>
    </div>
  );
}
