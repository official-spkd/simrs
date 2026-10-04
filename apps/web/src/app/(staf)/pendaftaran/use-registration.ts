'use client';

import { formatJam, type Payer, type RegistrationDesk, type RegistrationPatient } from '@simrs/shared';
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
  enabled: { panggil: boolean; cek: boolean; sep: boolean };
}

export interface RegFixed {
  ticket: string;
  sep: string;
  queueNo: string;
  diagnosis: string;
  patientId: string;
}

const dxOf = (p: RegistrationPatient, refId: string | null) => {
  const r = p.referrals.find((x) => x.id === refId);
  return r ? `${r.diagnosis.code} · ${r.diagnosis.label}` : '';
};

/**
 * State lokal formulir pendaftaran satu pasien (mockup Registrasi). `showcase` = keadaan awal mockup (pasien
 * bawaan sudah dicek, surat kontrol dipakai, persetujuan umum ada); `preset` = surat kontrol, DPJP, dan diagnosa
 * sudah terisi (pasien skenario yang SEP-nya sudah terbit); `fresh` = pasien yang baru dipanggil, mulai dari awal.
 */
export function useRegistration(
  desk: RegistrationDesk,
  patients: RegistrationPatient[],
  initial: string | null,
  mode: 'showcase' | 'preset' | 'fresh',
) {
  const first = patients.find((p) => p.id === initial) ?? null;
  const firstRef = first?.referrals.find((r) => r.kind === 'surat-kontrol') ?? null;
  const showcase = mode === 'showcase';
  const preset = mode !== 'fresh';
  const [query, setQuery] = useState(first?.nikMasked ?? '');
  const [queryError, setQueryError] = useState('');
  const [patientId, setPatientId] = useState<string | null>(first?.id ?? null);
  const [payer, setPayerState] = useState<Payer>(first?.defaultPayer ?? 'BPJS');
  const [checkedLocal, setCheckedLocal] = useState(showcase);
  const [referralId, setReferralId] = useState<string | null>(preset ? (firstRef?.id ?? null) : null);
  const [diagnosis, setDiagnosisState] = useState(first && preset ? dxOf(first, firstRef?.id ?? null) : '');
  const [diagTouched, setDiagTouched] = useState(false);
  const [sepLocal, setSepLocal] = useState<{ no: string; at: string } | null>(null);
  const [poli, setPoli] = useState(firstRef?.poliCode ?? desk.quotas[0]?.poliCode ?? 'PD');
  const [doctorId, setDoctorId] = useState<string | null>(preset ? (firstRef?.doctorId ?? null) : null);
  const [scheduleLocked, setScheduleLocked] = useState(false);
  const [consent, setConsent] = useState(showcase);
  const [done, setDone] = useState<{ at: string; queueNo: string } | null>(null);
  const [printedAt, setPrintedAt] = useState<string | null>(null);

  const patient = patients.find((p) => p.id === patientId) ?? null;

  const load = (p: RegistrationPatient | null, q: string) => {
    setQuery(q);
    setQueryError('');
    setPatientId(p?.id ?? null);
    setPayerState(p?.defaultPayer ?? 'BPJS');
    setCheckedLocal(false);
    setReferralId(null);
    setDiagnosisState('');
    setDiagTouched(false);
    setSepLocal(null);
    setPoli(desk.quotas[0]?.poliCode ?? 'PD');
    setDoctorId(null);
    setScheduleLocked(false);
    setConsent(false);
    setDone(null);
    setPrintedAt(null);
  };

  const search = () => {
    if (query.trim().length < 3) return setQueryError(SEARCH_TOO_SHORT);
    const hit = matchPatient(query, patients);
    if (!hit) {
      return setQueryError(
        'Pasien tidak ditemukan. Periksa nomor atau daftarkan sebagai pasien baru di Rekam medis.',
      );
    }
    load(hit, query);
  };

  const setPayer = (p: Payer) => {
    if (p === payer) return;
    setPayerState(p);
    setSepLocal(null);
    setScheduleLocked(false);
  };

  const pickReferral = (id: string) => {
    if (!patient) return;
    const r = patient.referrals.find((x) => x.id === id);
    if (!r) return;
    setReferralId(id);
    setPoli(r.poliCode);
    setDoctorId(r.doctorId);
    if (!diagTouched) setDiagnosisState(dxOf(patient, id));
  };

  return {
    query,
    queryError,
    patient,
    payer,
    checkedLocal,
    referralId,
    diagnosis,
    diagTouched,
    diagnosisError: diagnosisProblem(diagnosis),
    sepLocal,
    poli,
    doctorId,
    scheduleLocked,
    consent,
    done,
    printedAt,
    setQuery: (q: string) => {
      setQuery(q);
      if (patientId) load(null, q);
      else setQueryError('');
    },
    search,
    load,
    setPayer,
    setCheckedLocal,
    pickReferral,
    setDiagnosis: (v: string) => {
      setDiagnosisState(v);
      setDiagTouched(true);
    },
    setSepLocal,
    setPoli: (code: string) => {
      setPoli(code);
      setDoctorId(null);
    },
    setDoctorId,
    setScheduleLocked,
    setConsent,
    setDone,
    print: () => setPrintedAt(formatJam(new Date())),
  };
}
