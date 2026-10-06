import type { CpptEntry } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { cpptNoteId, ENCOUNTER_ID } from './demo/fixtures/ids';
import { CPPT_VERIFIED, HANDOVERS } from './demo/fixtures/rme-cppt';
import { rmeChartByEncounter } from './demo/fixtures/rme-pasien';
import { correctCpptEntry, newCpptEntry } from './rawat-inap';
import {
  cosignBlocker,
  cpptStatus,
  handoverBlocker,
  handoverStatus,
  latestEntries,
  needsVerification,
  soapAbbreviations,
  submitLabel,
  verifyBlocker,
  versionChain,
} from './rme-cppt';

const NOW = '2026-10-05T10:45:00+07:00';
const soap = { s: 'Sesak berkurang', o: '', a: 'Perbaikan', p: '' };
const entry = (patch: Partial<CpptEntry> & Pick<CpptEntry, 'role'>): CpptEntry => ({
  ...newCpptEntry({
    id: 'e1',
    encounterId: 'enc',
    role: patch.role,
    author: 'dr. Residen',
    at: '2026-10-05T07:40:00+07:00',
    soap,
  }),
  ...patch,
});

describe('CPPT (K07): status, co-sign, verifikasi', () => {
  it('residen: belum final sampai co-sign DPJP; tombol simpan tidak memfinalkan', () => {
    const e = entry({ role: 'residen' });
    expect(e.cosignRequired).toBe(true);
    expect(cpptStatus(e, { superseded: false, cosign: null, verified: null, nowIso: NOW })).toEqual({
      label: 'Belum final · menunggu co-sign DPJP',
      tone: 'warning',
    });
    expect(
      cpptStatus(e, {
        superseded: false,
        cosign: { by: 'dr. Andini', at: '2026-10-05T10:50:00+07:00' },
        verified: null,
        nowIso: NOW,
      }).label,
    ).toBe('Final · co-sign DPJP dr. Andini · 10.50');
    expect(submitLabel('residen')).toBe('Simpan dan ajukan co-sign DPJP');
    expect(submitLabel('perawat')).toBe('Simpan dan tanda tangani (final)');
  });

  it('co-sign hanya DPJP, bukan catatan sendiri, sekali saja', () => {
    const e = entry({ role: 'residen' });
    const base = { user: 'dr. Andini', superseded: false, cosigned: false };
    expect(cosignBlocker(e, { ...base, role: 'dokter' })).toBeNull();
    expect(cosignBlocker(e, { ...base, role: 'dokter_residen' })).toMatch(/Hanya DPJP/);
    expect(cosignBlocker(e, { ...base, role: 'dokter', user: 'dr. Residen' })).toMatch(/catatan sendiri/);
    expect(cosignBlocker(e, { ...base, role: 'dokter', cosigned: true })).toMatch(/Sudah/);
    expect(cosignBlocker(entry({ role: 'perawat' }), { ...base, role: 'dokter' })).toMatch(
      /Bukan catatan residen/,
    );
  });

  it('verifikasi DPJP untuk PPA non-dokter dalam 24 jam; lewat batas ditandai', () => {
    expect(needsVerification({ role: 'perawat' })).toBe(true);
    expect(needsVerification({ role: 'dpjp' })).toBe(false);
    expect(needsVerification({ role: 'residen' })).toBe(false);
    const nurse = entry({ role: 'perawat', writtenAt: '2026-10-04T06:00:00+07:00' });
    const o = { superseded: false, cosign: null, verified: null };
    expect(cpptStatus(nurse, { ...o, nowIso: NOW })).toEqual({
      label: 'Final · verifikasi DPJP lewat 24 jam',
      tone: 'danger',
    });
    const fresh = entry({ role: 'farmasi', writtenAt: '2026-10-05T08:15:00+07:00' });
    expect(cpptStatus(fresh, { ...o, nowIso: NOW }).label).toBe(
      'Final · menunggu verifikasi DPJP (batas 08.15)',
    );
    expect(verifyBlocker(fresh, { role: 'perawat', user: 'x', superseded: false, verified: false })).toMatch(
      /Hanya DPJP/,
    );
    expect(
      verifyBlocker(fresh, { role: 'dokter', user: 'x', superseded: false, verified: false }),
    ).toBeNull();
  });

  it('koreksi = versi baru; rantai versi dan linimasa hanya versi terbaru', () => {
    const v1 = entry({ role: 'perawat', author: 'Ns. A' });
    const v2 = correctCpptEntry([v1], v1.id, {
      id: 'e2',
      author: 'Ns. A',
      role: 'perawat',
      at: '2026-10-05T08:00:00+07:00',
      soap,
      reason: 'Salah ketik nilai SpO2',
    });
    const all = [v1, v2];
    expect(versionChain(all, 'e1').map((e) => e.version)).toEqual([1, 2]);
    expect(versionChain(all, 'e2').map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(latestEntries(all).map((e) => e.id)).toEqual(['e2']);
  });

  it('singkatan terlarang terdeteksi sebagai peringatan', () => {
    const found = soapAbbreviations({ s: '', o: '', a: '', p: 'Insulin 10 U SC, metformin 1,0 mg' });
    expect(found.map((f) => f.found)).toEqual(['U', '1,0 mg']);
    expect(found.every((f) => f.field === 'p')).toBe(true);
  });
});

describe('serah terima SBAR', () => {
  const sbar = { s: 'a', b: 'b', a: 'c', r: 'd' };
  it('keempat bagian dan penerima wajib; penerima bukan pemberi', () => {
    expect(handoverBlocker({ ...sbar, b: ' ', r: '' }, 'Ns. B', 'Ns. A')).toBe('Lengkapi bagian B, R SBAR.');
    expect(handoverBlocker(sbar, '', 'Ns. A')).toMatch(/Pilih perawat penerima/);
    expect(handoverBlocker(sbar, 'Ns. A', 'Ns. A')).toMatch(/bukan pemberi/);
    expect(handoverBlocker(sbar, 'Ns. B', 'Ns. A')).toBeNull();
    expect(handoverStatus({ receiver: 'Ns. B', acceptedAt: null })).toBe('Menunggu konfirmasi Ns. B');
    expect(handoverStatus({ receiver: 'Ns. B', acceptedAt: '2026-10-05T14:02:00+07:00' })).toBe(
      'Diterima Ns. B · 14.02',
    );
  });

  it('fixture: verifikasi dan serah terima merujuk entri/kunjungan yang ada', () => {
    const endang = rmeChartByEncounter(ENCOUNTER_ID.endang)?.inpatient?.cppt ?? [];
    for (const id of Object.keys(CPPT_VERIFIED)) expect(endang.some((e) => e.id === id)).toBe(true);
    // Selaras worklist DPJP: farmasi 08.15 dan koreksi perawat 22.25 belum diverifikasi.
    expect(CPPT_VERIFIED[cpptNoteId(ENCOUNTER_ID.endang, 2)]).toBeUndefined();
    expect(CPPT_VERIFIED[cpptNoteId(ENCOUNTER_ID.endang, 6)]).toBeUndefined();
    for (const enc of Object.keys(HANDOVERS)) expect(rmeChartByEncounter(enc)).toBeDefined();
  });
});
