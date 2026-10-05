import type { Provider } from '@nestjs/common';
import type { DukcapilLookupResult } from '@simrs/shared';
import { z } from 'zod';
import { API_ENV, type ApiEnv } from '../../config/env';
import type { LookupConnector } from '../../infra/lookup/lookup-connector';

/**
 * ADR-0025 · Lookup demografi Dukcapil per NIK (isian otomatis pasien baru; tidak disimpan sebelum petugas
 * mengonfirmasi). Fase 2: mock `POST <MOCK_BASE_URL>/dukcapil/verify` (docs/06 §5); layanan resmi menyusul dengan
 * kredensial per RS. Hasil hanya dikembalikan ke petugas, tidak pernah ke log/audit.
 */
export const DUKCAPIL_LOOKUP = Symbol('DUKCAPIL_LOOKUP');

const responseSchema = z.discriminatedUnion('found', [
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    person: z.object({
      nama: z.string().min(1).max(120),
      jenisKelamin: z.enum(['L', 'P']),
      tanggalLahir: z.iso.date(),
      tempatLahir: z.string().max(80).optional(),
      alamat: z.string().max(300).optional(),
      kabupaten: z.string().max(120).optional(),
    }),
  }),
]);

export function dukcapilConnector(
  baseUrl: string,
  doFetch: typeof fetch = fetch,
): LookupConnector<{ nik: string }, DukcapilLookupResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/dukcapil/verify`;
  return {
    name: 'dukcapil.demografi',
    target: 'dukcapil',
    auditAction: 'verify',
    async call(input, signal) {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ nik: input.nik }),
        redirect: 'manual',
        signal,
      });
      if (!res.ok) throw new Error(`Dukcapil HTTP ${res.status}`);
      const parsed = responseSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error('Respons Dukcapil tidak dikenali');
      const d = parsed.data;
      if (!d.found) return { found: false };
      const p = d.person;
      return {
        found: true,
        name: p.nama,
        sex: p.jenisKelamin === 'L' ? 'male' : 'female',
        birthDate: p.tanggalLahir,
        birthPlace: p.tempatLahir ?? null,
        address: p.alamat ?? p.kabupaten ?? null,
      };
    },
    summarize: (r) => ({ found: r.found }),
  };
}

export const dukcapilLookupProvider: Provider = {
  provide: DUKCAPIL_LOOKUP,
  inject: [API_ENV],
  useFactory: (env: ApiEnv): LookupConnector<{ nik: string }, DukcapilLookupResult> => {
    if (env.INTEGRATION_MODE === 'mock') return dukcapilConnector(env.MOCK_BASE_URL);
    // Layanan resmi belum disambungkan: lookup gagal tertutup (503, petugas isi manual), bukan ke mock.
    return {
      ...dukcapilConnector(env.MOCK_BASE_URL),
      call: () => Promise.reject(new Error('Dukcapil belum dikonfigurasi untuk mode ini')),
    };
  },
};
