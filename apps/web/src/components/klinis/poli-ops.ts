'use client';

import { useMemo } from 'react';
import {
  callNextAction,
  cosignPoliCpptAction,
  recordVitalsAction,
  saveCpptDraftAction,
  signCpptAction,
} from '@/app/(staf)/klinis/poli/actions-demo';
import { useStoreAction } from '@/lib/demo/store/client';

/** Hasil aksi layar poli (bentuk sama di mode presentasi dan mode api). */
export interface PoliActionResult {
  ok: boolean;
  /** Jam simpan `08.53`. */
  at?: string;
  message?: string;
  error?: string;
  /** Isian yang galat (untuk menandai field). */
  field?: string;
  /** CPPT residen: tersimpan tetapi belum final, menunggu co-sign DPJP. */
  cosignRequired?: true;
  /** Tampilan basi: halaman dimuat ulang. */
  stale?: boolean;
  /** Panggil berikutnya: pasien yang dipanggil. */
  patientId?: string;
}

/**
 * Isian SOAP poli. `plan`/`followUp`/`condition` hanya dipakai mode api (resume rawat jalan ringkas saat "Tanda
 * tangani dan selesai"); mode presentasi mengabaikannya.
 */
export interface PoliSoapInput {
  encounterId: string;
  subjective: string;
  objective: string;
  diagnosisCodes: string[];
  plan?: string;
  followUp?: string;
  condition?: string;
  /** Cara pulang rawat jalan (pulang, pulang_paksa, rujuk); dipilih dokter, tanpa nilai bawaan. */
  disposition?: string;
}

export interface PoliVitalsFormInput {
  encounterId: string;
  td: string;
  nadi: string;
  suhu: string;
  spo2: string;
  /** Mode api (NEWS2 dihitung server): frekuensi napas, berat badan, kesadaran ACVPU, oksigen tambahan. */
  napas?: string;
  berat?: string;
  kesadaran?: string;
  oksigen?: boolean;
}

type Done = (r: PoliActionResult) => void;

/**
 * Aksi layar Pemeriksaan poli yang disuntikkan ke komponen bersama (antrean, tanda vital, SOAP): mode presentasi
 * memakai toko demo (`useDemoPoliOps`), mode api memakai Server Action yang memanggil API (`useApiPoliOps`). Komponen
 * tampilan sama di kedua mode (ADR-0023 keputusan 4).
 */
export interface PoliOps {
  pending: boolean;
  /** `lengkap` = form tanda vital meminta napas + berat badan (API observasi, NEWS2 dihitung server). */
  vitalsMode?: 'ringkas' | 'lengkap';
  saveDraft(input: PoliSoapInput, done: Done): void;
  sign(input: PoliSoapInput, done: Done): void;
  cosign(input: PoliSoapInput, done: Done): void;
  recordVitals(input: PoliVitalsFormInput, done: Done): void;
  callNext(done: Done): void;
}

/** Aksi mode presentasi (toko demo `klinis-poli`, revisi `rev`). */
export function useDemoPoliOps(rev: number): PoliOps {
  const { run, pending } = useStoreAction(rev);
  return useMemo(
    () => ({
      pending,
      saveDraft: (input, done) =>
        run(
          (rv) =>
            saveCpptDraftAction(
              {
                encounterId: input.encounterId,
                subjective: input.subjective,
                objective: input.objective,
                diagnosisCodes: input.diagnosisCodes,
              },
              rv,
            ),
          done,
        ),
      sign: (input, done) =>
        run(
          (rv) =>
            signCpptAction(
              {
                encounterId: input.encounterId,
                subjective: input.subjective,
                objective: input.objective,
                diagnosisCodes: input.diagnosisCodes,
              },
              rv,
            ),
          done,
        ),
      cosign: (input, done) =>
        run((rv) => cosignPoliCpptAction({ encounterId: input.encounterId }, rv), done),
      recordVitals: ({ encounterId, td, nadi, suhu, spo2 }, done) =>
        run((rv) => recordVitalsAction({ encounterId, td, nadi, suhu, spo2 }, rv), done),
      callNext: (done) => run((rv) => callNextAction(rv), done),
    }),
    [run, pending],
  );
}
