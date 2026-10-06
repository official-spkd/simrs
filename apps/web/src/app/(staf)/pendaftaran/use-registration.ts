'use client';

import type { Payer, RegistrationDesk, RegistrationPatient } from '@simrs/shared';
import { useState } from 'react';
import { diagnosisProblem, matchPatient, SEARCH_TOO_SHORT } from '@/lib/front-office';

/** Keadaan Tn. Suryo (skenario rawat jalan) di meja pendaftaran, dihitung server dari replay skenario. */
export interface RegScenarioView {
  rev: number;
  /** Indeks langkah `pendaftaran` bila aktif; null bila tidak. */
  stepIndex: number | null;
  /** Langkah `kedatangan` masih aktif tetapi sudah lengkap (perlu "lanjut" sebelum memanggil). */
  arrivalPending: boolean;
  /** Tiket A-031 tercetak dan belum dipanggil. */
  callable: boolean;
  /** Tn. Suryo sedang dilayani di loket ini (sudah dipanggil, belum ke langkah perawat). */
  atCounter: boolean;
  checked: boolean;
  sepIssued: boolean;
  sepAt: string | null;
  /** Jam naskah skenario saat ini (`HH.MM`): cap waktu catatan Tn. Suryo, selaras jam SEP-nya. */
  clock: string;
  enabled: { panggil: boolean; cek: boolean; sep: boolean };
}

export interface RegFixed {
  ticket: string;
  sep: string;
  queueNo: string;
  diagnosis: string;
  patientId: string;
}

/** SEP dan kunjungan yang sudah tersimpan di toko demo (domain `pendaftaran`) untuk satu pasien. */
export interface RegStored {
  sep: { sepNo: string; referralId: string; diagnosis: string; jam: string } | null;
  visit: {
    queueNo: string;
    jam: string;
    payer: Payer;
    poliCode: string;
    doctorId: string;
    doctorName: string;
    printedAt: string | null;
  } | null;
}

const NONE: RegStored = { sep: null, visit: null };

const dxOf = (p: RegistrationPatient, refId: string | null) => {
  const r = p.referrals.find((x) => x.id === refId);
  return r ? `${r.diagnosis.code} · ${r.diagnosis.label}` : '';
};

interface FormState {
  query: string;
  queryError: string;
  patientId: string | null;
  payer: Payer;
  checkedLocal: boolean;
  referralId: string | null;
  diagnosis: string;
  diagTouched: boolean;
  poli: string;
  doctorId: string | null;
  scheduleLocked: boolean;
  consent: boolean;
  /** Hanya pasien skenario (Tn. Suryo): pendaftaran selesai lewat mesin skenario, bukan toko. */
  done: { at: string; queueNo: string } | null;
  printedAt: string | null;
}

/**
 * State lokal formulir pendaftaran satu pasien (mockup Registrasi). SEP dan kunjungan yang sudah tersimpan di toko
 * mengisi ulang formulir saat pasien dimuat (bertahan setelah muat ulang). `showcase` = keadaan awal mockup (pasien
 * bawaan sudah dicek, surat kontrol dipakai, persetujuan umum ada); `preset` = surat kontrol, DPJP, dan diagnosa sudah
 * terisi (pasien skenario yang SEP-nya sudah terbit); `fresh` = pasien yang baru dipanggil, mulai dari awal.
 */
export function useRegistration(
  desk: RegistrationDesk,
  patients: RegistrationPatient[],
  initial: string | null,
  mode: 'showcase' | 'preset' | 'fresh',
  stored: (patientId: string) => RegStored = () => NONE,
) {
  const defaultPoli = desk.quotas[0]?.poliCode ?? 'PD';

  /** Formulir untuk pasien `p` (null = kosong), diisi dari toko bila SEP/kunjungannya sudah tersimpan. */
  const build = (p: RegistrationPatient | null, query: string, m: typeof mode): FormState => {
    const st = p ? stored(p.id) : NONE;
    const control = p?.referrals.find((r) => r.kind === 'surat-kontrol') ?? null;
    const preset = !!p && m !== 'fresh';
    const referralId = st.sep?.referralId ?? (preset ? (control?.id ?? null) : null);
    const ref = p?.referrals.find((r) => r.id === referralId) ?? null;
    return {
      query,
      queryError: '',
      patientId: p?.id ?? null,
      payer: st.visit?.payer ?? p?.defaultPayer ?? 'BPJS',
      checkedLocal: m === 'showcase' || !!st.sep,
      referralId,
      diagnosis: st.sep?.diagnosis ?? (p && ref ? dxOf(p, ref.id) : ''),
      diagTouched: false,
      poli: st.visit?.poliCode ?? ref?.poliCode ?? defaultPoli,
      doctorId: st.visit?.doctorId ?? ref?.doctorId ?? null,
      scheduleLocked: !!st.visit,
      consent: m === 'showcase' || !!st.visit,
      done: null,
      printedAt: null,
    };
  };

  const first = patients.find((p) => p.id === initial) ?? null;
  const [s, setS] = useState<FormState>(() => {
    const f = build(first, first?.nikMasked ?? '', mode);
    // Pasien baru dipanggil: rujukan/dokter belum dipilih kecuali sudah tersimpan.
    return mode === 'fresh' && first && !stored(first.id).sep && !stored(first.id).visit
      ? { ...f, referralId: null, diagnosis: '', doctorId: null }
      : f;
  });
  const set = (patch: Partial<FormState>) => setS((cur) => ({ ...cur, ...patch }));

  const patient = patients.find((p) => p.id === s.patientId) ?? null;

  const load = (p: RegistrationPatient | null, q: string) => {
    const f = build(p, q, 'fresh');
    const st = p ? stored(p.id) : NONE;
    setS(st.sep || st.visit ? f : { ...f, referralId: null, diagnosis: '', doctorId: null });
  };

  const search = () => {
    if (s.query.trim().length < 3) return set({ queryError: SEARCH_TOO_SHORT });
    const hit = matchPatient(s.query, patients);
    if (!hit) {
      return set({
        queryError:
          'Pasien tidak ditemukan. Periksa nomor atau daftarkan sebagai pasien baru di Rekam medis.',
      });
    }
    load(hit, s.query);
  };

  const pickReferral = (id: string) => {
    if (!patient) return;
    const r = patient.referrals.find((x) => x.id === id);
    if (!r) return;
    setS((cur) => ({
      ...cur,
      referralId: id,
      poli: r.poliCode,
      doctorId: r.doctorId,
      diagnosis: cur.diagTouched ? cur.diagnosis : dxOf(patient, id),
    }));
  };

  return {
    query: s.query,
    queryError: s.queryError,
    patient,
    payer: s.payer,
    checkedLocal: s.checkedLocal,
    referralId: s.referralId,
    diagnosis: s.diagnosis,
    diagTouched: s.diagTouched,
    diagnosisError: diagnosisProblem(s.diagnosis),
    poli: s.poli,
    doctorId: s.doctorId,
    scheduleLocked: s.scheduleLocked,
    consent: s.consent,
    done: s.done,
    printedAt: s.printedAt,
    setQuery: (q: string) => {
      if (s.patientId) load(null, q);
      else set({ query: q, queryError: '' });
    },
    search,
    load,
    setPayer: (p: Payer) => {
      if (p !== s.payer) set({ payer: p, scheduleLocked: false });
    },
    setCheckedLocal: (v: boolean) => set({ checkedLocal: v }),
    pickReferral,
    setDiagnosis: (v: string) => set({ diagnosis: v, diagTouched: true }),
    setPoli: (code: string) => set({ poli: code, doctorId: null }),
    setDoctorId: (v: string | null) => set({ doctorId: v }),
    setScheduleLocked: (v: boolean) => set({ scheduleLocked: v }),
    setConsent: (v: boolean) => set({ consent: v }),
    setDone: (v: { at: string; queueNo: string } | null) => set({ done: v }),
    /** Cetak tiket/SEP/gelang pasien skenario pada jam `at` (`HH.MM`, jam naskah skenario). */
    print: (at: string) => set({ printedAt: at }),
  };
}
