import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_GRANTS } from './authz';
import {
  aboCompatible,
  BLOOD_ISSUE_CHECK_ITEMS,
  bloodIssueBlock,
  normalizeScanCode,
  rhCompatible,
  transfusionReactionCheck,
} from './rules/blood';
import { bloodIssueCheckInputSchema } from './schemas/gizi-darah';

/** 4.9 · ADR-0105: tabel kompatibilitas per komponen, cek ganda, deteksi reaksi, matriks izin bank darah/gizi. */

const GROUPS = ['O', 'A', 'B', 'AB'] as const;
const table = (rule: 'sel_darah_merah' | 'plasma' | 'identik') =>
  Object.fromEntries(GROUPS.map((p) => [p, GROUPS.filter((d) => aboCompatible(p, d, rule))]));

describe('kompatibilitas darah', () => {
  it('sel darah merah: pasien menerima donor tanpa antigen asing (O donor universal)', () => {
    expect(table('sel_darah_merah')).toEqual({
      O: ['O'],
      A: ['O', 'A'],
      B: ['O', 'B'],
      AB: ['O', 'A', 'B', 'AB'],
    });
  });
  it('plasma/trombosit: AB donor universal, plasma O hanya untuk pasien O', () => {
    expect(table('plasma')).toEqual({ O: ['O', 'A', 'B', 'AB'], A: ['A', 'AB'], B: ['B', 'AB'], AB: ['AB'] });
  });
  it('darah lengkap: identik', () => {
    expect(table('identik')).toEqual({ O: ['O'], A: ['A'], B: ['B'], AB: ['AB'] });
  });
  it('Rh-negatif pasien hanya menerima Rh-negatif', () => {
    expect(rhCompatible('neg', 'pos')).toBe(false);
    expect(rhCompatible('neg', 'neg')).toBe(true);
    expect(rhCompatible('pos', 'neg')).toBe(true);
  });
  it('pengeluaran: darurat tanpa crossmatch hanya PRC golongan O; plasma wajib golongan pasien', () => {
    const base = {
      patientAbo: null,
      patientRh: null,
      unitAbo: 'O' as const,
      unitRh: 'neg' as const,
      unitExpired: false,
      crossmatchCompatible: false,
      emergencyReason: 'Syok hemoragik, tidak sempat crossmatch',
    };
    expect(bloodIssueBlock(base)).toBeNull();
    expect(bloodIssueBlock({ ...base, unitRh: 'pos' })).toBe('BLOOD_INCOMPATIBLE');
    expect(bloodIssueBlock({ ...base, rule: 'plasma' })).toBe('BLOOD_INCOMPATIBLE');
    expect(bloodIssueBlock({ ...base, patientAbo: 'A', patientRh: 'pos', rule: 'plasma' })).toBe(
      'BLOOD_INCOMPATIBLE',
    );
    expect(
      bloodIssueBlock({
        ...base,
        patientAbo: 'A',
        patientRh: 'pos',
        unitAbo: 'AB',
        unitRh: 'pos',
        rule: 'plasma',
      }),
    ).toBe('CROSSMATCH_REQUIRED');
    expect(bloodIssueBlock({ ...base, emergencyReason: 'pendek' })).toBe('CROSSMATCH_REQUIRED');
    expect(bloodIssueBlock({ ...base, unitExpired: true })).toBe('BATCH_EXPIRED');
  });
});

describe('gerbang bank darah', () => {
  it('cek ganda: lima butir wajib dicentang semuanya', () => {
    const all = Object.fromEntries(BLOOD_ISSUE_CHECK_ITEMS.map((i) => [i.id, true]));
    const ok = {
      bloodRequestId: crypto.randomUUID(),
      bloodUnitId: crypto.randomUUID(),
      emergencyReason: null,
    };
    expect(bloodIssueCheckInputSchema.safeParse({ ...ok, checklist: all }).success).toBe(true);
    expect(bloodIssueCheckInputSchema.safeParse({ ...ok, checklist: { ...all, nomor: false } }).success).toBe(
      false,
    );
  });
  it('kode pindai dinormalisasi (spasi, huruf besar)', () => {
    expect(normalizeScanCode(' ktg 0001 ')).toBe('KTG0001');
  });
  it('dugaan reaksi: gejala, suhu naik ≥ 1 °C, sistolik turun ≥ 30 mmHg', () => {
    const base = { tempC: 36.8, systolic: 120 };
    expect(transfusionReactionCheck(base, { tempC: 37.5, systolic: 110 }, []).reaction).toBe(false);
    expect(transfusionReactionCheck(base, { tempC: 37.8, systolic: 120 }, []).reasons).toEqual([
      'Suhu naik 1,0 °C',
    ]);
    expect(
      transfusionReactionCheck(base, { tempC: 36.8, systolic: 90 }, ['Gatal / urtikaria']).reasons,
    ).toEqual(['Gatal / urtikaria', 'Sistolik turun 30 mmHg']);
  });
  it('matriks: perawat/bidan transfusi + gizi lingkup unit; dokter meminta darah; analis lab tidak memasang', () => {
    const has = (role: keyof typeof DEFAULT_ROLE_GRANTS, r: string, a: string) =>
      DEFAULT_ROLE_GRANTS[role].find(([res, act]) => res === r && act === a)?.[2] ?? null;
    expect(has('perawat', 'blood_bank', 'transfuse')).toBe('unit');
    expect(has('bidan', 'nutrition', 'write')).toBe('unit');
    expect(has('perawat', 'blood_bank', 'issue')).toBeNull();
    expect(has('dokter', 'blood_bank', 'request')).toBe('relationship');
    expect(has('dokter', 'blood_bank', 'issue')).toBeNull();
    expect(has('analis_lab', 'blood_bank', 'transfuse')).toBeNull();
    expect(has('analis_lab', 'blood_bank', 'request')).toBeNull();
  });
});
