import { Chip } from './chip';
import { Icon } from './icons';

export interface PatientBannerProps {
  name: string;
  /** `–` = jenis kelamin tidak diketahui (pasien tanpa identitas). */
  sex: 'L' | 'P' | '–';
  /** null = tanggal lahir tidak diketahui. */
  ageYears: number | null;
  birthDate: string;
  mrn: string;
  allergies: string[];
  guarantor: string;
  attending?: string;
}

/** Banner identitas pasien: dua pengenal (nama + tgl lahir/RM) dan alergi dalam satu baris pandang. */
export function PatientBanner(p: PatientBannerProps) {
  const initials = p.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <div
      className="sticky top-[var(--app-sticky-top,0px)] z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-white/95 bg-card-header px-4 py-3 shadow-card backdrop-blur-xl"
      aria-label="Identitas pasien"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-nav-active font-bold text-white shadow-[0_6px_16px_rgba(23,32,46,0.18)]">
          {initials}
        </span>
        <div className="flex flex-col">
          <span className="text-h2 font-bold">{p.name}</span>
          <span className="text-small text-ink-700">
            {p.sex} · {p.ageYears === null ? 'umur tidak diketahui' : `${p.ageYears} th`} · {p.birthDate} · RM{' '}
            <span className="font-mono">{p.mrn}</span>
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {p.allergies.length > 0 ? (
          <Chip tone="danger" icon={<Icon name="alert" size={13} strokeWidth={2} />}>
            Alergi: {p.allergies.join(', ')}
          </Chip>
        ) : (
          <Chip tone="neutral">Tidak ada alergi tercatat</Chip>
        )}
        <Chip tone="info">{p.guarantor}</Chip>
        {p.attending && <Chip tone="brand">DPJP {p.attending}</Chip>}
      </div>
    </div>
  );
}
