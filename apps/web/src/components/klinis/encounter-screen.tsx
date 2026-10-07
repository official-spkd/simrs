import { type EncounterContext, formatTanggalLahir, type WorklistPatient } from '@simrs/shared';
import { Alert, Chip, Icon, PatientBanner } from '@simrs/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { EncounterResolution } from '@/lib/server/data/klinis/encounter-screen';

const SEX = { male: 'L', female: 'P', unknown: '–' } as const;
const CLASS_LABEL = { AMB: 'Rawat jalan', EMER: 'IGD', IMP: 'Rawat inap' } as const;

/**
 * Bagian bersama layar bagan RME mode api (worklist, CPPT, asesmen, diagnosis, askep, ringkasan, kelengkapan):
 * judul layar, daftar kunjungan berjalan sebagai pemilih, banner pasien dari konteks kunjungan, dan keadaan
 * kunjungan tidak ditemukan / akses ditolak. Komponen server (tanpa state).
 */
export function ApiScreenShell({
  crumb,
  title,
  children,
}: {
  crumb: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <span className="text-caption text-ink-500">{crumb}</span>
        <h1 className="m-0 text-h1 font-bold tracking-[-0.02em]">{title}</h1>
      </header>
      {children}
    </div>
  );
}

export function EncounterBanner({ context: c }: { context: EncounterContext }) {
  return (
    <PatientBanner
      name={c.patient.name}
      sex={SEX[c.patient.sex]}
      ageYears={c.patient.ageYears}
      birthDate={c.patient.birthDate ? formatTanggalLahir(c.patient.birthDate) : 'tgl lahir tidak diketahui'}
      mrn={c.patient.mrn}
      allergies={
        c.allergy.status === 'ada'
          ? c.allergy.labels
          : c.allergy.status === 'belum_dikaji'
            ? ['belum dikaji']
            : []
      }
      guarantor={c.coverage?.name ?? 'Penjamin belum tercatat'}
      attending={c.dpjp?.name}
    />
  );
}

/** Daftar kunjungan berjalan (dari worklist): tiap baris membuka layar ini untuk kunjungan itu. */
export function EncounterPickerList({
  route,
  patients,
}: {
  route: string;
  patients: readonly WorklistPatient[];
}) {
  return (
    <section
      aria-label="Kunjungan berjalan"
      className="overflow-hidden rounded-card border border-white/95 bg-white/90 shadow-card"
    >
      <h2 className="m-0 border-b border-line px-4 py-3 text-[15px] font-semibold">Pilih kunjungan pasien</h2>
      {patients.length === 0 ? (
        <p className="m-0 px-4 py-4 text-small text-ink-500">
          Belum ada kunjungan berjalan di unit Anda atau pasien tempat Anda DPJP.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {patients.map((e) => (
            <li key={e.encounterId} className="border-b border-line-soft last:border-b-0">
              <Link
                href={`${route}?kunjungan=${e.encounterId}`}
                className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-4 py-3 text-ink-900 no-underline hover:bg-brand-50/60"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold">{e.name}</span>
                  <span className="text-caption text-ink-500">
                    RM <span className="font-mono">{e.mrn}</span> · {e.encounterNumber} ·{' '}
                    {CLASS_LABEL[e.class]} · {e.unitName}
                    {e.bed ? ` · ${e.bed}` : ''}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {e.pendingTasks > 0 && <Chip tone="warning">{e.pendingTasks} tugas</Chip>}
                  <Icon name="chevronRight" size={16} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Keadaan non-`ok` sebuah kunjungan: pemilih, tidak ditemukan, atau akses ditolak (tercatat di audit API). Null bila
 * kunjungan siap dipakai layar.
 */
export function EncounterGate({ res, route }: { res: EncounterResolution; route: string }) {
  if (res.kind === 'pick') return <EncounterPickerList route={route} patients={res.patients} />;
  if (res.kind === 'not-found') {
    return (
      <>
        <Alert level="warning" title="Kunjungan tidak ditemukan">
          Kunjungan ini tidak ada di rumah sakit Anda. Pilih pasien dari daftar kunjungan berjalan.
        </Alert>
        <Link
          href={route}
          className="inline-flex min-h-11 items-center self-start rounded-control border border-line-strong bg-white/90 px-3.5 text-small font-semibold text-ink-900 no-underline hover:bg-brand-50/60"
        >
          Kembali ke daftar kunjungan
        </Link>
      </>
    );
  }
  if (res.kind === 'denied') {
    return (
      <Alert level="warning" title="Akses ke pasien ini ditolak">
        {res.message} Akses mengikuti unit penugasan dan relasi Anda dengan pasien; percobaan ini tercatat di
        jejak audit.
      </Alert>
    );
  }
  return null;
}
