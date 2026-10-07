'use client';

import { ARRIVAL_MODE_LABEL, ARRIVAL_MODES, type ArrivalMode } from '@simrs/shared';
import { Button, cx } from '@simrs/ui';
import { useId, useRef, useState, useTransition } from 'react';
import { type PatientSummaryView, parseDiagnosis } from '@/lib/registration-api';
import { searchPatientsAction } from '../../pendaftaran/actions-api';
import { registerEmergencyAction } from './actions-api';

const INPUT = 'h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-body';
const SEX_LABEL = { male: 'Laki-laki', female: 'Perempuan', unknown: 'Tidak diketahui' } as const;

function newKey(): string {
  return crypto.randomUUID();
}

/**
 * F03/K03 · Pendaftaran IGD dari papan IGD mode api (`POST /registration/emergency`): pasien terdaftar (cari MPI) atau
 * pasien TANPA IDENTITAS (jenis kelamin, perkiraan umur, ciri-ciri; rekam medis sementara "Tn./Ny. X"), cara datang,
 * penjamin umum atau BPJS (diagnosa awal opsional → SEP IGD langsung; kosong → SEP menyusul). Idempotency-Key per isian.
 */
export function IgdRegisterForm({
  unitId,
  onDone,
  onCancel,
}: {
  unitId: string;
  onDone: (encounterId: string, number: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const key = useRef(newKey());
  const [mode, setMode] = useState<'known' | 'unidentified'>('known');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PatientSummaryView[] | null>(null);
  const [patient, setPatient] = useState<PatientSummaryView | null>(null);
  const [sex, setSex] = useState<'male' | 'female' | 'unknown'>('male');
  const [age, setAge] = useState('');
  const [desc, setDesc] = useState('');
  const [arrival, setArrival] = useState<ArrivalMode>('datang_sendiri');
  const [payer, setPayer] = useState<'umum' | 'bpjs'>('umum');
  const [dx, setDx] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();

  const dxParsed = dx.trim() ? parseDiagnosis(dx, null) : null;
  const ageNum = age.trim() ? Number(age) : undefined;
  const ageOk = ageNum === undefined || (Number.isInteger(ageNum) && ageNum >= 0 && ageNum <= 120);
  const ready =
    (mode === 'known' ? !!patient : desc.trim().length >= 3 && ageOk) && (!dx.trim() || !!dxParsed);

  const search = () =>
    startSearch(async () => {
      setError(null);
      const r = await searchPatientsAction({ q });
      if (r.ok) setResults(r.data);
      else {
        setResults(null);
        setError(r.message);
      }
    });

  const submit = () =>
    startSave(async () => {
      setError(null);
      const coverage =
        payer === 'umum'
          ? { payer: 'umum' as const }
          : { payer: 'bpjs' as const, ...(dxParsed ? { initialDiagnosis: dxParsed } : {}) };
      const body = {
        patient:
          mode === 'known'
            ? { kind: 'known' as const, patientId: patient?.id }
            : {
                kind: 'unidentified' as const,
                sex,
                ...(ageNum !== undefined ? { estimatedAgeYears: ageNum } : {}),
                description: desc.trim(),
              },
        unitId,
        arrivalMode: arrival,
        coverage,
      };
      const r = await registerEmergencyAction(body, key.current);
      if (r.ok) {
        key.current = newKey();
        onDone(r.data.encounterId, r.data.number);
      } else setError(r.message);
    });

  return (
    <section
      aria-label="Pendaftaran pasien IGD"
      className="flex flex-col gap-3 rounded-card border border-brand-200 bg-white/95 px-4 py-3.5 shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-body font-semibold">Daftarkan pasien IGD</h2>
        <span className="text-caption text-ink-500">Gawat darurat tidak menunggu persetujuan umum</span>
      </div>
      <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-small font-semibold">Identitas</legend>
        {(
          [
            ['known', 'Pasien terdaftar (cari rekam medis)'],
            ['unidentified', 'Pasien tanpa identitas'],
          ] as const
        ).map(([v, l]) => (
          <label
            key={v}
            className={cx(
              'flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3 text-small',
              mode === v ? 'border-brand-600 bg-brand-50' : 'border-line-strong bg-white',
            )}
          >
            <input
              type="radio"
              name={`${id}-mode`}
              checked={mode === v}
              onChange={() => setMode(v)}
              className="accent-brand-600"
            />
            {l}
          </label>
        ))}
      </fieldset>
      {mode === 'known' ? (
        <div className="flex flex-col gap-2">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <label
              htmlFor={`${id}-q`}
              className="flex min-w-[240px] flex-1 flex-col gap-1 text-small font-semibold"
            >
              No. RM, NIK, No. BPJS, atau nama
              <input id={`${id}-q`} value={q} onChange={(e) => setQ(e.target.value)} className={INPUT} />
            </label>
            <Button type="submit" disabled={searching || q.trim().length < 3}>
              {searching ? 'Mencari…' : 'Cari pasien'}
            </Button>
          </form>
          {results && results.length === 0 && (
            <p className="m-0 text-small text-ink-500">
              Tidak ditemukan. Daftarkan sebagai pasien tanpa identitas bila identitas belum bisa dipastikan.
            </p>
          )}
          {results && results.length > 0 && (
            <ul aria-label="Hasil cari pasien" className="m-0 flex list-none flex-col gap-1 p-0">
              {results.map((p) => (
                <li key={p.id}>
                  <label
                    className={cx(
                      'flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3 py-1.5 text-small',
                      patient?.id === p.id ? 'border-brand-600 bg-brand-50' : 'border-line-soft bg-white',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${id}-pasien`}
                      checked={patient?.id === p.id}
                      disabled={p.status !== 'active'}
                      onChange={() => setPatient(p)}
                      className="accent-brand-600"
                    />
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-ink-500">
                      RM <span className="font-mono">{p.mrn}</span> · {SEX_LABEL[p.sex]}
                      {p.birthDate ? ` · lahir ${p.birthDate}` : ''}
                      {p.status !== 'active' ? ' · sudah digabung' : ''}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label htmlFor={`${id}-sex`} className="flex flex-col gap-1 text-small font-semibold">
            Jenis kelamin
            <select
              id={`${id}-sex`}
              value={sex}
              onChange={(e) => setSex(e.target.value as typeof sex)}
              className={INPUT}
            >
              {(['male', 'female', 'unknown'] as const).map((s) => (
                <option key={s} value={s}>
                  {SEX_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${id}-age`} className="flex flex-col gap-1 text-small font-semibold">
            Perkiraan umur (tahun, opsional)
            <input
              id={`${id}-age`}
              inputMode="numeric"
              value={age}
              maxLength={3}
              onChange={(e) => setAge(e.target.value)}
              aria-invalid={!ageOk}
              className={INPUT}
            />
          </label>
          <label
            htmlFor={`${id}-desc`}
            className="flex flex-col gap-1 text-small font-semibold sm:col-span-3"
          >
            Ciri-ciri untuk identifikasi (tanpa diagnosis)
            <input
              id={`${id}-desc`}
              value={desc}
              maxLength={300}
              placeholder="Mis. kaus biru, tato di lengan kanan, diantar warga"
              onChange={(e) => setDesc(e.target.value)}
              className={INPUT}
            />
          </label>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label htmlFor={`${id}-arr`} className="flex flex-col gap-1 text-small font-semibold">
          Cara datang
          <select
            id={`${id}-arr`}
            value={arrival}
            onChange={(e) => setArrival(e.target.value as ArrivalMode)}
            className={INPUT}
          >
            {ARRIVAL_MODES.map((a) => (
              <option key={a} value={a}>
                {ARRIVAL_MODE_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-pay`} className="flex flex-col gap-1 text-small font-semibold">
          Penjamin
          <select
            id={`${id}-pay`}
            value={payer}
            onChange={(e) => setPayer(e.target.value as 'umum' | 'bpjs')}
            className={INPUT}
          >
            <option value="umum">Umum (bayar sendiri)</option>
            <option value="bpjs">BPJS Kesehatan</option>
          </select>
        </label>
        {payer === 'bpjs' && (
          <label htmlFor={`${id}-dx`} className="flex flex-col gap-1 text-small font-semibold">
            Diagnosa awal ICD-10 (opsional)
            <input
              id={`${id}-dx`}
              value={dx}
              maxLength={200}
              placeholder="Kosong = SEP menyusul"
              onChange={(e) => setDx(e.target.value)}
              className={INPUT}
            />
          </label>
        )}
      </div>
      {payer === 'bpjs' && dx.trim() && !dxParsed && (
        <span className="text-caption font-semibold text-danger">
          Awali diagnosa dengan kode ICD-10 yang sah.
        </span>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!ready || saving} onClick={submit}>
          {saving ? 'Mendaftarkan…' : 'Daftarkan ke IGD'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Batal
        </Button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-small font-semibold text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
