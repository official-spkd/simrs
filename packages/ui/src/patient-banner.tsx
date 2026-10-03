import { Chip } from './chip';
import { Icon } from './icons';

export interface PatientBannerProps {
  name: string;
  sex: 'L' | 'P';
  ageYears: number;
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
      className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-brand-100 bg-card-header px-4 py-3"
      aria-label="Identitas pasien"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">
          {initials}
        </span>
        <div className="flex flex-col">
          <span className="text-h2 font-bold">{p.name}</span>
          <span className="text-small text-ink-700">
            {p.sex} · {p.ageYears} th · {p.birthDate} · RM <span className="font-mono">{p.mrn}</span>
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
