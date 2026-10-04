import type { RegistrationPatient } from '@simrs/shared';
import { Button, Icon } from '@simrs/ui';
import Link from 'next/link';
import { useId } from 'react';
import { dateShort, initials } from '@/lib/front-office';

/** F03 · Kolom identitas: cari pasien (NIK/RM/BPJS/nama + tgl lahir), baca e-KTP, pindai kartu BPJS. */
export function RegPatient({
  query,
  error,
  patient,
  locked,
  onQuery,
  onSearch,
  onReadKtp,
  onScanCard,
}: {
  query: string;
  error: string;
  patient: RegistrationPatient | null;
  /** Pasien skenario dipanggil dari antrean: pencarian dikunci sampai pendaftaran selesai. */
  locked: boolean;
  onQuery: (q: string) => void;
  onSearch: () => void;
  onReadKtp: () => void;
  onScanCard: () => void;
}) {
  const id = useId();
  const msg = `${id}-msg`;
  const ident = patient
    ? [
        { k: 'Tanggal lahir', v: `${dateShort(patient.birthDate)} · ${patient.ageYears} th` },
        { k: 'Jenis kelamin', v: patient.sex === 'L' ? 'Laki-laki' : 'Perempuan' },
        { k: 'NIK', v: patient.nikMasked },
        { k: 'No. HP', v: patient.phoneMasked },
        { k: 'Alamat', v: patient.address },
        { k: 'Penanggung jawab', v: patient.guardian },
        { k: 'Kunjungan terakhir', v: patient.lastVisit ?? 'Belum pernah' },
      ]
    : [];
  return (
    <section
      aria-label="Identitas pasien"
      className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 lg:max-w-[340px]"
    >
      <div className="flex flex-col gap-2 rounded-card border border-line bg-white p-4">
        <label htmlFor={id} className="text-small font-semibold text-ink-700">
          Cari pasien (NIK, No. RM, No. BPJS, nama + tgl lahir)
        </label>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
        >
          <input
            id={id}
            value={query}
            disabled={locked}
            onChange={(e) => onQuery(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? msg : undefined}
            placeholder="mis. 00-12-45-78 atau Siti 14-03-1972"
            className={`h-11 min-w-[200px] flex-[1_1_200px] rounded-control border px-3 font-[inherit] text-ink-900 disabled:bg-muted ${
              error
                ? 'border-danger bg-[#FFFBFA]'
                : patient
                  ? 'border-brand-600 bg-white'
                  : 'border-line-strong bg-white'
            }`}
          />
          <Button type="submit" variant="primary" disabled={locked}>
            <Icon name="search" size={16} />
            Cari pasien
          </Button>
        </form>
        {error && (
          <span id={msg} role="alert" className="text-caption text-danger">
            {error}
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={locked} onClick={onReadKtp}>
            <Icon name="idCard" size={15} />
            Baca e-KTP
          </Button>
          <Button size="sm" disabled={locked} onClick={onScanCard}>
            <Icon name="card" size={15} />
            Pindai kartu BPJS
          </Button>
        </div>
      </div>
      {patient ? (
        <div className="flex flex-col gap-2.5 rounded-card border border-brand-100 bg-card-header p-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-11 flex-none items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700"
            >
              {initials(patient.name)}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-h2 font-bold">{patient.name}</span>
              <span className="text-small text-ink-700">
                Pasien lama · RM <span className="font-mono">{patient.rm}</span>
              </span>
            </span>
          </div>
          <dl className="m-0 flex flex-col gap-1.5">
            {ident.map((i) => (
              <div key={i.k} className="flex justify-between gap-3 text-small">
                <dt className="text-ink-500">{i.k}</dt>
                <dd className="m-0 text-right font-medium text-ink-900">{i.v}</dd>
              </div>
            ))}
          </dl>
          {patient.identityVerified && (
            <span className="flex items-center gap-1.5 text-caption font-semibold text-success">
              <Icon name="check" size={13} strokeWidth={2.4} />
              NIK cocok dengan Dukcapil dan SATUSEHAT
            </span>
          )}
          <Link href="/rekam-medis/mpi" className="text-small font-semibold">
            Perbarui data pasien
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 rounded-card border border-dashed border-line-strong bg-white p-4">
          <span className="font-semibold">Belum ada pasien dipilih</span>
          <span className="text-small text-ink-700">
            Ketik NIK, No. RM, atau No. BPJS lalu tekan Cari pasien, atau baca e-KTP / pindai kartu BPJS.
            Langkah penjaminan aktif setelah pasien ditemukan.
          </span>
        </div>
      )}
    </section>
  );
}
