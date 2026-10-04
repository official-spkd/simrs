import { describe, expect, it } from 'vitest';
import { normalizePersonName } from './patient';
import {
  editDistance,
  MATCH_THRESHOLD,
  type MatchProfile,
  matchSeverity,
  matchSummary,
  nameSimilarity,
  normalizeAddress,
  scorePatientMatch,
  trigramSimilarity,
} from './patient-match';

/** Profil uji: hash identifier = nilainya sendiri (yang diuji logika skor, bukan kriptografi). */
function profile(p: {
  name: string;
  sex?: string;
  birthDate?: string | null;
  estimated?: boolean;
  mother?: string;
  phone?: string;
  address?: string;
  nik?: string;
  bpjs?: string;
  ihs?: string;
}): MatchProfile {
  const id = (v?: string) => (v ? { hash: `h:${v}`, value: v } : undefined);
  return {
    id: p.name,
    mrn: '00-00-00-01',
    nameSearch: normalizePersonName(p.name),
    sex: p.sex ?? 'female',
    birthDate: p.birthDate ?? null,
    birthDateEstimated: p.estimated ?? false,
    motherName: p.mother ? normalizePersonName(p.mother) : null,
    phoneHash: p.phone ? `h:${p.phone}` : null,
    address: p.address ? normalizeAddress(p.address) : null,
    identifiers: { nik: id(p.nik), bpjs: id(p.bpjs), ihs: id(p.ihs) },
  };
}

describe('kemiripan dasar', () => {
  it('trigram seperti pg_trgm; nama dengan singkatan; jarak edit dengan tukar digit', () => {
    expect(trigramSimilarity('siti rahmawati', 'siti rahmawati')).toBe(1);
    expect(trigramSimilarity('siti rahmawati', 'siti rachmawati')).toBeCloseTo(12 / 17, 5);
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
    expect(nameSimilarity('muhammad rizki', 'm rizky')).toBeGreaterThan(0.6);
    expect(nameSimilarity('ratna', 'arka pratama')).toBeLessThan(0.3);
    expect(editDistance('9999720911981180', '9999720911981810')).toBe(1);
    expect(editDistance('3174', '3175')).toBe(1);
    expect(editDistance('1234', '9876')).toBe(4);
  });

  it('alamat: singkatan dan tanda baca diseragamkan', () => {
    expect(normalizeAddress('Jl. Kenanga No. 12, Jakarta Timur')).toBe('kenanga 12 jakarta timur');
    expect(normalizeAddress('Kenanga No.12, Jaktim')).toBe('kenanga 12 jakarta timur');
  });
});

describe('skor kemungkinan rekam medis ganda (skenario design/mockups/MPI.dc.html)', () => {
  it('NIK, tanggal lahir, ibu kandung sama, nama beda ejaan → tinggi', () => {
    const r = scorePatientMatch(
      profile({
        name: 'Siti Rahmawati',
        birthDate: '1972-03-14',
        mother: 'Aminah',
        phone: '6281200004567',
        address: 'Jl. Kenanga No. 12, Jakarta Timur',
        nik: '9999745403724521',
        bpjs: '0000001234567',
      }),
      profile({
        name: 'Siti Rachmawati',
        birthDate: '1972-03-14',
        mother: 'Aminah',
        phone: '6281200004567',
        address: 'Kenanga No.12, Jaktim',
        nik: '9999745403724521',
      }),
    );
    expect(r.score).toBe(99);
    expect(matchSeverity(r.score)).toBe('tinggi');
    expect(r.reasons).toEqual([
      'nik_sama',
      'tgl_lahir_sama',
      'nama_mirip',
      'ibu_sama',
      'hp_sama',
      'alamat_sama',
    ]);
    expect(matchSummary(r.reasons)).toBe(
      'NIK, tanggal lahir, ibu kandung, no. HP, dan alamat sama; nama mirip',
    );
  });

  it('NIK kosong di B, BPJS dan tanggal lahir sama, nama beda satu huruf → tinggi', () => {
    const r = scorePatientMatch(
      profile({
        name: 'Budi Santoso',
        sex: 'male',
        birthDate: '1965-06-02',
        mother: 'Sumiati',
        address: 'Jl. Melati No. 4, Jakarta Timur',
        nik: '9999750206650937',
        bpjs: '0000017551143',
      }),
      profile({
        name: 'Budi Santosa',
        sex: 'male',
        birthDate: '1965-06-02',
        mother: 'Sumiyati',
        address: 'Jl. Melati No. 4, Jakarta Timur',
        bpjs: '0000017551143',
      }),
    );
    expect(r.reasons).toEqual(['bpjs_sama', 'tgl_lahir_sama', 'nama_mirip', 'ibu_mirip', 'alamat_sama']);
    expect(r.score).toBeGreaterThanOrEqual(85);
  });

  it('bayi yang kemudian diberi nama: nama beda, data keluarga sama → masuk antrean', () => {
    const r = scorePatientMatch(
      profile({
        name: 'By. Ny. Ratna',
        sex: 'male',
        birthDate: '2026-09-21',
        mother: 'Ratna Sari',
        phone: '6281200003301',
        address: 'Jl. Anggrek No. 7, Jakarta Timur',
      }),
      profile({
        name: 'Arka Pratama',
        sex: 'male',
        birthDate: '2026-09-21',
        mother: 'Ratna Sari',
        phone: '6281200003301',
        address: 'Jl. Anggrek No. 7, Jakarta Timur',
      }),
    );
    expect(r.reasons).toEqual(['tgl_lahir_sama', 'ibu_sama', 'hp_sama', 'alamat_sama']);
    expect(r.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(matchSeverity(r.score)).toBe('rendah');
  });

  it('NIK tertukar dua digit dianggap mirip (salah ketik), NIK lain sama sekali menurunkan skor', () => {
    const a = profile({
      name: 'Muhammad Rizki',
      sex: 'male',
      birthDate: '1998-11-09',
      nik: '9999720911981180',
    });
    const typo = scorePatientMatch(
      a,
      profile({ name: 'M. Rizky', sex: 'male', birthDate: '1998-11-09', nik: '9999720911981810' }),
    );
    expect(typo.reasons).toEqual(['nik_mirip', 'tgl_lahir_sama', 'nama_mirip']);
    expect(typo.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    const other = scorePatientMatch(
      a,
      profile({ name: 'M. Rizky', sex: 'male', birthDate: '1998-11-09', nik: '9999015306440001' }),
    );
    expect(other.reasons).toContain('nik_beda');
    expect(other.score).toBeLessThan(MATCH_THRESHOLD);
  });

  it('kembar beda jenis kelamin tidak diusulkan; tanggal lahir perkiraan tidak dihitung', () => {
    const twin = scorePatientMatch(
      profile({ name: 'Rina Lestari', sex: 'female', birthDate: '2001-01-01', mother: 'Sari' }),
      profile({ name: 'Rino Lestari', sex: 'male', birthDate: '2001-01-01', mother: 'Sari' }),
    );
    expect(twin.reasons).toContain('kelamin_beda');
    expect(twin.score).toBeLessThan(MATCH_THRESHOLD);
    const unknown = scorePatientMatch(
      profile({ name: 'Darmawan', sex: 'male', birthDate: '1962-08-17' }),
      profile({ name: 'Tn. X', sex: 'male', birthDate: '1962-08-17', estimated: true }),
    );
    expect(unknown.score).toBe(0);
    expect(matchSummary(unknown.reasons)).toBe('Diusulkan untuk ditinjau');
  });
});
