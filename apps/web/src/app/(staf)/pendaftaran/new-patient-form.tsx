'use client';

import { formatTanggalLahir } from '@simrs/shared';
import { Alert, Button, Field, Icon } from '@simrs/ui';
import { useId, useState, useTransition } from 'react';
import { maskedIdentifier, type PatientSummaryView } from '@/lib/registration-api';
import { createPatientAction, dukcapilLookupAction, findDuplicatesAction } from './actions-api';

type Sex = 'male' | 'female';

interface Draft {
  nik: string;
  bpjs: string;
  name: string;
  sex: Sex | '';
  birthDate: string;
  phone: string;
  address: string;
  motherName: string;
}

const EMPTY: Draft = {
  nik: '',
  bpjs: '',
  name: '',
  sex: '',
  birthDate: '',
  phone: '',
  address: '',
  motherName: '',
};

const digits = (v: string) => v.replace(/\D/g, '');

/**
 * F03 · Pasien baru (MPI) dari meja pendaftaran: NIK → isian otomatis Dukcapil (lookup sinkron, belum disimpan),
 * lalu cek duplikat (NIK/no. BPJS sama, atau nama + tanggal lahir sama) sebelum disimpan. Petugas memilih pasien yang
 * sudah ada atau menyatakan tetap membuat pasien baru. Nomor RM dari layanan penomoran; NIK diverifikasi ke Dukcapil
 * lewat outbox setelah disimpan.
 */
export function NewPatientForm({
  today,
  initialNik,
  onCreated,
  onUseExisting,
  onCancel,
}: {
  today: string;
  /** NIK yang sudah diketik di kotak cari (16 digit), bila ada. */
  initialNik: string;
  onCreated: (patientId: string, raw: { nik: string; bpjs: string }) => void;
  onUseExisting: (patientId: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [d, setD] = useState<Draft>({ ...EMPTY, nik: initialNik });
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [dukcapil, setDukcapil] = useState<'belum' | 'terisi' | 'tidak-ditemukan'>('belum');
  const [dupes, setDupes] = useState<PatientSummaryView[] | null>(null);
  const [busy, start] = useTransition();
  const set = (patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDupes(null);
  };

  const nikOk = /^\d{16}$/.test(d.nik);
  const bpjsOk = d.bpjs === '' || /^\d{13}$/.test(d.bpjs);
  const ready = nikOk && bpjsOk && d.name.trim().length >= 2 && d.sex !== '' && d.birthDate !== '';

  const lookup = () =>
    start(async () => {
      setNotice(null);
      const r = await dukcapilLookupAction({ nik: d.nik });
      if (!r.ok) return setNotice({ ok: false, text: r.message });
      if (!r.data.found) {
        setDukcapil('tidak-ditemukan');
        return setNotice({
          ok: false,
          text: 'NIK tidak ditemukan di Dukcapil. Periksa KTP; bila benar, isi data secara manual.',
        });
      }
      setDukcapil('terisi');
      set({
        name: r.data.name,
        sex: r.data.sex === 'female' ? 'female' : 'male',
        birthDate: r.data.birthDate,
        address: r.data.address ?? d.address,
      });
      setNotice({ ok: true, text: 'Data Dukcapil terisi. Periksa kembali dengan KTP pasien.' });
    });

  const save = (force: boolean) =>
    start(async () => {
      setNotice(null);
      if (!force) {
        const dup = await findDuplicatesAction({
          nik: d.nik,
          bpjs: d.bpjs || undefined,
          name: d.name.trim(),
          birthDate: d.birthDate,
        });
        if (!dup.ok) return setNotice({ ok: false, text: dup.message });
        if (dup.data.length > 0) return setDupes(dup.data);
      }
      const r = await createPatientAction({
        name: d.name.trim(),
        sex: d.sex,
        birthDate: d.birthDate,
        ...(d.motherName.trim() ? { motherName: d.motherName.trim() } : {}),
        ...(d.address.trim() ? { address: d.address.trim() } : {}),
        ...(d.phone.trim() ? { phone: d.phone.trim() } : {}),
        identifiers: { nik: d.nik, ...(d.bpjs ? { bpjs: d.bpjs } : {}) },
      });
      if (!r.ok) return setNotice({ ok: false, text: r.message });
      onCreated(r.data.id, { nik: d.nik, bpjs: d.bpjs });
    });

  return (
    <section
      aria-label="Pasien baru"
      className="flex min-w-0 flex-[1_1_300px] flex-col gap-3 rounded-card border border-line bg-white p-4 lg:max-w-[420px]"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-h2 font-semibold">Pasien baru</h2>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field
          label="NIK"
          required
          inputMode="numeric"
          className="flex-[1_1_200px]"
          value={d.nik}
          onChange={(e) => {
            set({ nik: digits(e.target.value).slice(0, 16) });
            setDukcapil('belum');
          }}
          error={d.nik && !nikOk ? 'NIK 16 digit' : null}
          hint={dukcapil === 'terisi' ? 'Terisi dari Dukcapil' : undefined}
        />
        <Button onClick={lookup} disabled={!nikOk || busy}>
          <Icon name="idCard" size={15} />
          Ambil data Dukcapil
        </Button>
      </div>
      <Field
        label="Nama lengkap (sesuai KTP)"
        required
        value={d.name}
        onChange={(e) => set({ name: e.target.value })}
      />
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-[1_1_160px] flex-col gap-1.5">
          <label htmlFor={`${id}-sex`} className="text-small font-semibold text-ink-700">
            Jenis kelamin
            <span aria-hidden="true" className="text-danger">
              {' '}
              *
            </span>
          </label>
          <select
            id={`${id}-sex`}
            required
            value={d.sex}
            onChange={(e) => set({ sex: e.target.value as Sex | '' })}
            className="h-11 rounded-control border border-line-strong bg-white px-3 font-[inherit]"
          >
            <option value="">Pilih</option>
            <option value="male">Laki-laki</option>
            <option value="female">Perempuan</option>
          </select>
        </div>
        <Field
          label="Tanggal lahir"
          required
          type="date"
          max={today}
          className="flex-[1_1_160px]"
          value={d.birthDate}
          onChange={(e) => set({ birthDate: e.target.value })}
        />
      </div>
      <Field
        label="No. kartu BPJS (opsional)"
        inputMode="numeric"
        value={d.bpjs}
        onChange={(e) => set({ bpjs: digits(e.target.value).slice(0, 13) })}
        error={!bpjsOk ? 'No. kartu BPJS 13 digit' : null}
      />
      <Field label="No. HP (opsional)" value={d.phone} onChange={(e) => set({ phone: e.target.value })} />
      <Field label="Alamat (opsional)" value={d.address} onChange={(e) => set({ address: e.target.value })} />
      <Field
        label="Nama ibu kandung (opsional)"
        value={d.motherName}
        onChange={(e) => set({ motherName: e.target.value })}
      />

      {notice && <Alert level={notice.ok ? 'success' : 'warning'}>{notice.text}</Alert>}

      {dupes && dupes.length > 0 ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-control border border-warning-border bg-warning-bg p-3"
        >
          <span className="font-semibold">Kemungkinan pasien yang sama sudah terdaftar</span>
          <ul aria-label="Kemungkinan duplikat" className="m-0 flex list-none flex-col gap-2 p-0">
            {dupes.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-small">
                <span>
                  <span className="font-semibold">{p.name}</span> · RM{' '}
                  <span className="font-mono">{p.mrn}</span>
                  {p.birthDate ? ` · ${formatTanggalLahir(p.birthDate)}` : ''}
                  {maskedIdentifier(p, 'nik') ? ` · NIK ${maskedIdentifier(p, 'nik')}` : ''}
                </span>
                <Button size="sm" onClick={() => onUseExisting(p.id)} disabled={busy}>
                  Pakai pasien ini
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={() => save(true)} disabled={busy}>
            Bukan pasien di atas, simpan sebagai pasien baru
          </Button>
        </div>
      ) : (
        <Button variant="primary" onClick={() => save(false)} disabled={!ready || busy}>
          {busy ? 'Memproses…' : 'Periksa duplikat dan simpan pasien'}
        </Button>
      )}
    </section>
  );
}
