import { SEED_REF_SAMPLES } from '@simrs/db';
import { describe, expect, it } from 'vitest';
import { DEAD_LETTERS } from './demo/fixtures/manajemen';
import { demoSatusehatVisits } from './demo/fixtures/integrasi-satusehat';
import {
  complianceByType,
  effectiveStatus,
  holdText,
  maskPayload,
  resend,
  resendGate,
  type Visit,
  visitSummary,
} from './integrasi-satusehat';

const visit = (id: string): Visit => {
  const v = demoSatusehatVisits().find((x) => x.id === id);
  if (!v) throw new Error(id);
  return v;
};
let n = 0;
const nextId = (t: string) => `${t}/baru-${++n}`;
const noFix = { ihs: false, loinc: false, kfa: false };

describe('data SATUSEHAT', () => {
  it('galat sama dengan dead-letter queue hub; kode baku hanya dari seed', () => {
    const dlq = new Set(DEAD_LETTERS.map((d) => d.id));
    const seeds = new Set(
      [
        ...SEED_REF_SAMPLES.icd10,
        ...SEED_REF_SAMPLES.icd9cm,
        ...SEED_REF_SAMPLES.loinc,
        ...SEED_REF_SAMPLES.kfa,
      ].map((c) => c.code),
    );
    for (const v of demoSatusehatVisits())
      for (const r of v.resources) {
        if (r.error) expect(dlq.has(r.error.dlqId), r.error.dlqId).toBe(true);
        const code = r.code?.split(' ').at(-1);
        if (r.code && r.code !== 'lokal-HbA1c') expect(seeds.has(code ?? ''), r.code).toBe(true);
      }
  });
});

describe('urutan kirim', () => {
  it('anak ditahan selama Encounter gagal; Encounter selesai ditahan sampai anak terkirim', () => {
    const v = visit('ss-v2');
    const st = effectiveStatus(v);
    expect(st['ss-201']).toBe('gagal');
    expect(st['ss-202']).toBe('ditahan');
    expect(holdText(v, v.resources[1] ?? v.resources[0]!)).toBe('menunggu Encounter terkirim');
    expect(st['ss-204']).toBe('ditahan');
    expect(visitSummary(visit('ss-v4'))).toEqual({ total: 5, sent: 5, failed: 0, held: 0 });
  });

  it('kirim ulang butuh perbaikan data; setelah IHS ditemukan, anak dan Encounter selesai dilepas berurutan', () => {
    const v = visit('ss-v2');
    const enc = v.resources[0];
    if (!enc) throw new Error('encounter');
    expect(resendGate(enc, noFix)).toBe('FIX_REQUIRED');
    expect(resendGate(enc, { ...noFix, ihs: true })).toBeNull();
    const r = resend(v, enc.id, nextId);
    expect(visitSummary(r.visit)).toMatchObject({ sent: 4, failed: 0, held: 0 });
    expect(r.released).toEqual(['Gout', 'Kreatinin 0,9 mg/dL', 'Kunjungan selesai + diagnosis']);
  });

  it('perbaikan yang menunggu unit lain tidak bisa dikirim ulang; resume belum TTE tetap ditahan', () => {
    const v = visit('ss-v3');
    const racikan = v.resources.find((r) => r.id === 'ss-305');
    if (!racikan) throw new Error('racikan');
    expect(resendGate(racikan, { ihs: true, loinc: true, kfa: true })).toBe('FIX_BLOCKED');
    const comp = v.resources.find((r) => r.id === 'ss-306');
    expect(comp && holdText(v, comp)).toBe('menunggu TTE resume medis oleh DPJP');
    expect(resendGate(v.resources[0]!, noFix)).toBe('NOT_FAILED');
  });

  it('kepatuhan per jenis resource', () => {
    const c = complianceByType(demoSatusehatVisits());
    expect(c.find((x) => x.type === 'Encounter')).toEqual({ type: 'Encounter', sent: 3, total: 4 });
  });
});

describe('payload tersamar', () => {
  it('NIK dan nama disamarkan; rujukan pasien hanya 4 karakter terakhir', () => {
    const m = maskPayload({
      nik: '9999000000000000',
      name: 'X',
      subject: { reference: 'Patient/P02478375538' },
    });
    expect(m).toEqual({ nik: '•••', name: '•••', subject: { reference: 'Patient/••••••••5538' } });
  });
});
