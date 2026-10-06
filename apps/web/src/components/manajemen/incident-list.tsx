import { formatTanggalWaktu, type IncidentReport } from '@simrs/shared';
import { Chip, type ChipTone } from '@simrs/ui';
import { daysUntil, GRADE_LABEL, INCIDENT_TYPE_LABEL, INVESTIGATION_LABEL } from '@/lib/manajemen';

const GRADE_TONE: Record<IncidentReport['grade'], ChipTone> = {
  biru: 'info',
  hijau: 'success',
  kuning: 'warning',
  merah: 'danger',
};
const INVESTIGATION_TONE: Record<IncidentReport['investigation'], ChipTone> = {
  'belum-dimulai': 'neutral',
  'investigasi-sederhana': 'brand',
  rca: 'warning',
  selesai: 'success',
};
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const tanggal = (iso: string) => {
  const [, m = 1, d = 1] = iso.split('-').map(Number);
  return `${d} ${BULAN[m - 1]}`;
};

/**
 * B06 · Laporan insiden keselamatan pasien (IKP): grading, jenis, unit, nomor RM (tanpa nama pasien), dan status
 * investigasi beserta batas waktunya. Grading ditulis sebagai teks, tidak hanya warna.
 */
export function IncidentList({ incidents, today }: { incidents: IncidentReport[]; today: string }) {
  return (
    <section
      aria-labelledby="ikp-judul"
      className="flex flex-col gap-3 rounded-card border border-white/95 bg-white/90 shadow-card p-4"
    >
      <span className="flex min-w-0 flex-col">
        <h2 id="ikp-judul" className="m-0 text-[15px] font-semibold">
          Laporan insiden keselamatan pasien
        </h2>
        <span className="text-[12.5px] text-ink-500">
          Identitas pasien hanya nomor RM. Grading biru/hijau → investigasi sederhana; kuning/merah → RCA 45
          hari.
        </span>
      </span>
      <ul className="m-0 flex list-none flex-col p-0">
        {incidents.map((i) => {
          const open = i.investigation !== 'selesai';
          const left = daysUntil(i.dueDate, today);
          return (
            <li
              key={i.id}
              className="flex flex-col gap-1.5 border-b border-line-soft py-3 first:pt-0 last:border-0 last:pb-0"
            >
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-small font-semibold text-ink-900">{i.id}</span>
                <Chip tone={GRADE_TONE[i.grade]}>{GRADE_LABEL[i.grade]}</Chip>
                <span className="text-caption text-ink-700">{INCIDENT_TYPE_LABEL[i.type]}</span>
              </span>
              <span className="text-small text-ink-900">{i.summary}</span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-500">
                <span>{formatTanggalWaktu(i.reportedAt)}</span>
                <span>{i.unit}</span>
                <span>{i.patientRm ? `RM ${i.patientRm}` : 'Tanpa pasien'}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2 text-caption">
                <Chip tone={INVESTIGATION_TONE[i.investigation]}>{INVESTIGATION_LABEL[i.investigation]}</Chip>
                <span className={open && left < 0 ? 'font-semibold text-danger' : 'text-ink-700'}>
                  {open
                    ? `${i.owner} · batas ${tanggal(i.dueDate)}${left < 0 ? ' · lewat batas' : ` · ${left} hari lagi`}`
                    : `${i.owner} · ditutup`}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
