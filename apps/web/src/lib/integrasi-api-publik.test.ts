import { describe, expect, it } from 'vitest';
import { demoApiClients } from './demo/fixtures/integrasi-api-publik';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { addDays, keyState, nextKeySuffix, registerGate, suspendGate } from './integrasi-api-publik';

describe('klien API publik / FHIR', () => {
  it('status kunci: satu perlu rotasi, satu aman', () => {
    const states = demoApiClients().map((c) => keyState(c, DEMO_TODAY).state);
    expect(states).toEqual(['rotasi', 'aman', 'aman']);
    expect(keyState({ keyExpires: '2026-10-01' }, DEMO_TODAY)).toEqual({ state: 'kedaluwarsa', days: -4 });
  });

  it('pendaftaran: cakupan klinis wajib dasar persetujuan', () => {
    const base = {
      name: 'Mitra D',
      purpose: 'Integrasi rujukan rawat jalan',
      scopes: ['Patient.read'] as const,
      basis: '',
    };
    expect(registerGate(base)).toEqual([]);
    expect(registerGate({ ...base, scopes: [] })).toEqual(['Pilih minimal satu cakupan.']);
    expect(registerGate({ ...base, scopes: ['Observation.read'] })).toHaveLength(1);
    expect(
      registerGate({ ...base, scopes: ['Observation.read'], basis: 'PKS No. 22/2026 dengan RS' }),
    ).toEqual([]);
  });

  it('penangguhan wajib alasan; kunci baru berakhiran deterministik dan berumur 365 hari', () => {
    expect(suspendGate('x')).not.toBeNull();
    expect(suspendGate('Kebocoran kunci dilaporkan mitra')).toBeNull();
    expect(nextKeySuffix('cl-asuransi-a', 1)).toMatch(/^[0-9a-f]{4}$/);
    expect(nextKeySuffix('cl-asuransi-a', 1)).toBe(nextKeySuffix('cl-asuransi-a', 1));
    expect(addDays(DEMO_TODAY, 365)).toBe('2027-10-05');
  });
});
