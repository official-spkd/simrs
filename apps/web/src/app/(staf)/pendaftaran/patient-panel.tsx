'use client';

import { formatTanggalLahir, PATIENT_SEX_LABEL } from '@simrs/shared';
import { Button, Chip, Icon } from '@simrs/ui';
import Link from 'next/link';
import { useId } from 'react';
import { initials } from '@/lib/front-office';
import { ageYears, maskedIdentifier, type PatientSummaryView } from '@/lib/registration-api';
import type { OpenedPatient } from './actions-api';

const input =
  'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-ink-900 disabled:bg-muted';

/**
 * F03 · Kolom identitas mode api: cari pasien di MPI (RM, NIK, no. BPJS, nama + tanggal lahir), pilih dari hasil
 * (tersamar), atau daftarkan pasien baru. Pasien terpilih tampil dengan identitas tersamar, penanggung jawab, dan
 * status persetujuan umum.
 */
export function PatientPanel({
  query,
  birthDate,
  error,
  results,
  opened,
  today,
  busy,
  canCreate,
  onQuery,
  onBirthDate,
  onSearch,
  onPick,
  onClear,
  onNew,
}: {
  query: string;
  birthDate: string;
  error: string;
  results: PatientSummaryView[] | null;
  opened: OpenedPatient | null;
  today: string;
  busy: boolean;
  canCreate: boolean;
  onQuery: (v: string) => void;
  onBirthDate: (v: string) => void;
  onSearch: () => void;
  onPick: (id: string) => void;
  onClear: () => void;
  onNew: () => void;
}) {
  const id = useId();
  const p = opened?.patient ?? null;
  return (
    <section
      aria-label="Identitas pasien"
      className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 lg:max-w-[360px]"
    >
      {!p && (
        <div className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onSearch();
            }}
          >
            <label htmlFor={`${id}-q`} className="text-small font-semibold text-ink-700">
              Cari pasien (NIK, No. RM, No. BPJS, atau nama)
            </label>
            <input
              id={`${id}-q`}
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-msg` : undefined}
              placeholder="mis. 00-12-45-78 atau Siti Rahma"
              className={input}
            />
            <label htmlFor={`${id}-dob`} className="text-small font-semibold text-ink-700">
              Tanggal lahir (opsional, untuk cari nama)
            </label>
            <input
              id={`${id}-dob`}
              type="date"
              value={birthDate}
              max={today}
              onChange={(e) => onBirthDate(e.target.value)}
              className={input}
            />
            <Button type="submit" variant="primary" disabled={busy}>
              <Icon name="search" size={16} />
              Cari pasien
            </Button>
          </form>
          {error && (
            <span id={`${id}-msg`} role="alert" className="text-caption text-danger">
              {error}
            </span>
          )}
          {canCreate && (
            <Button size="sm" onClick={onNew} disabled={busy}>
              <Icon name="userPlus" size={15} />
              Pasien baru
            </Button>
          )}
        </div>
      )}

      {!p && results && (
        <div className="flex flex-col gap-2 rounded-card border border-white/95 bg-white/90 shadow-card p-4">
          <span className="text-small font-semibold text-ink-700">
            {results.length === 0 ? 'Pasien tidak ditemukan' : `${results.length} pasien ditemukan`}
          </span>
          {results.length === 0 && (
            <span className="text-small text-ink-700">
              Periksa nomor/nama atau tambahkan tanggal lahir.
              {canCreate ? ' Bila memang belum pernah berobat, daftarkan sebagai pasien baru.' : ''}
            </span>
          )}
          <ul aria-label="Hasil pencarian pasien" className="m-0 flex list-none flex-col gap-2 p-0">
            {results.map((r) => {
              const merged = r.status === 'merged';
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={busy || merged}
                    onClick={() => onPick(r.id)}
                    aria-label={`Pilih ${r.name}, RM ${r.mrn}`}
                    className="flex min-h-14 w-full cursor-pointer flex-col gap-0.5 rounded-control border border-line bg-white px-3 py-2 text-left font-[inherit] hover:bg-brand-50/60 disabled:cursor-not-allowed disabled:bg-subtle"
                  >
                    <span className="text-small font-semibold text-ink-900">{r.name}</span>
                    <span className="text-caption text-ink-700">
                      RM <span className="font-mono">{r.mrn}</span>
                      {r.birthDate ? ` · lahir ${formatTanggalLahir(r.birthDate)}` : ''}
                      {maskedIdentifier(r, 'nik') ? ` · NIK ${maskedIdentifier(r, 'nik')}` : ''}
                    </span>
                    {merged && (
                      <span className="text-caption text-danger">
                        Sudah digabung ke RM {r.mergedInto?.mrn ?? '-'}; cari RM tujuan.
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {p ? (
        <div className="flex flex-col gap-2.5 rounded-card border border-white/95 bg-card-header p-4 shadow-card">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-11 flex-none items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-brand-100),var(--color-brand-50))] font-bold text-brand-700"
            >
              {initials(p.name)}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-h2 font-bold">{p.name}</span>
              <span className="text-small text-ink-700">
                RM <span className="font-mono">{p.mrn}</span>
              </span>
            </span>
          </div>
          <dl className="m-0 flex flex-col gap-1.5" aria-label="Identitas pasien terpilih">
            {[
              {
                k: 'Tanggal lahir',
                v: p.birthDate
                  ? `${formatTanggalLahir(p.birthDate)} · ${ageYears(p.birthDate, today)} th`
                  : 'Belum diisi',
              },
              { k: 'Jenis kelamin', v: PATIENT_SEX_LABEL[p.sex] },
              { k: 'NIK', v: maskedIdentifier(p, 'nik') ?? 'Belum ada' },
              { k: 'No. BPJS', v: maskedIdentifier(p, 'bpjs') ?? 'Belum ada' },
              { k: 'No. HP', v: p.phoneMasked ?? '—' },
              { k: 'Alamat', v: p.address ?? '—' },
            ].map((i) => (
              <div key={i.k} className="flex justify-between gap-3 text-small">
                <dt className="text-ink-500">{i.k}</dt>
                <dd className="m-0 text-right font-medium text-ink-900">{i.v}</dd>
              </div>
            ))}
          </dl>
          {p.identifiers.some((i) => i.system === 'nik' && i.verification === 'verified') && (
            <span className="flex items-center gap-1.5 text-caption font-semibold text-success">
              <Icon name="check" size={13} strokeWidth={2.4} />
              NIK cocok dengan Dukcapil
            </span>
          )}
          <span>
            <Chip tone={opened?.consent ? 'success' : 'warning'}>
              {opened?.consent ? 'Persetujuan umum berlaku' : 'Persetujuan umum belum ada'}
            </Chip>
          </span>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/rekam-medis/mpi"
              className="inline-flex min-h-11 items-center text-small font-semibold"
            >
              Perbarui data pasien
            </Link>
            <Button size="sm" onClick={onClear} disabled={busy}>
              Ganti pasien
            </Button>
          </div>
        </div>
      ) : (
        !results && (
          <div className="flex flex-col gap-1.5 rounded-card border border-dashed border-line-strong bg-white/70 p-4">
            <span className="font-semibold">Belum ada pasien dipilih</span>
            <span className="text-small text-ink-700">
              Panggil nomor loket berikutnya, atau cari pasien lewat NIK, No. RM, No. BPJS, atau nama. Langkah
              penjaminan aktif setelah pasien dipilih.
            </span>
          </div>
        )
      )}
    </section>
  );
}
