import { describe, expect, it } from 'vitest';
import { formatTanggalLahir, isoDateJakarta } from './datetime';
import {
  maskIdentifier,
  maskPhone,
  normalizeMrn,
  normalizePersonName,
  normalizePhone,
  parsePatientQuery,
  patientAge,
} from './patient';
import { createPatientSchema, patientSearchSchema, updatePatientSchema } from './schemas/patient';
import { PatientCrypto } from './security/patient-crypto';

describe('normalisasi identitas pasien (P05)', () => {
  it('nama untuk pencarian: tanpa sapaan di depan, gelar setelah koma, tanda baca, dan diakritik', () => {
    expect(normalizePersonName('SITI RAHMAWATI')).toBe('siti rahmawati');
    expect(normalizePersonName('By. Ny. Ratna')).toBe('ratna');
    expect(normalizePersonName('Budi Santoso, S.E.')).toBe('budi santoso');
    expect(normalizePersonName('Tn. X (tanpa identitas)')).toBe('x tanpa identitas');
    expect(normalizePersonName('dr. Désiré  Wijaya')).toBe('desire wijaya');
    // Nama yang seluruhnya sapaan tetap punya bentuk cari.
    expect(normalizePersonName('Bayi')).toBe('bayi');
  });

  it('no. HP ke bentuk baku 62…; nomor tak masuk akal ditolak', () => {
    expect(normalizePhone('0812-3456-7890')).toBe('6281234567890');
    expect(normalizePhone('+62 812 3456 7890')).toBe('6281234567890');
    expect(normalizePhone('6281234567890')).toBe('6281234567890');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('08123')).toBeNull();
  });

  it('penyamaran bawaan sesuai docs/05 §3 dan mockup MPI', () => {
    expect(maskIdentifier('nik', '3174012345674521')).toBe('3174••••••••4521');
    expect(maskIdentifier('bpjs', '0001234567890')).toBe('0001234•••890');
    expect(maskIdentifier('ihs', 'P02131234771')).toBe('P0213•••771');
    expect(maskIdentifier('paspor', 'A1234567')).toBe('A1••••67');
    expect(maskPhone('6281234567890')).toBe('0812•••7890');
  });

  it('nomor RM dengan atau tanpa strip', () => {
    expect(normalizeMrn('00412788')).toBe('00-41-27-88');
    expect(normalizeMrn(' 00-41-27-88 ')).toBe('00-41-27-88');
    expect(normalizeMrn('0041278')).toBeNull();
    expect(normalizeMrn('00-4127-88x')).toBeNull();
  });

  it('kotak pencarian: RM, NIK, BPJS, IHS, atau nama', () => {
    expect(parsePatientQuery('00-41-27-88')).toEqual({ kind: 'mrn', value: '00-41-27-88' });
    expect(parsePatientQuery('3174 0123 4567 4521')).toEqual({ kind: 'nik', value: '3174012345674521' });
    expect(parsePatientQuery('0001234567890')).toEqual({ kind: 'bpjs', value: '0001234567890' });
    expect(parsePatientQuery('p02131234771')).toEqual({ kind: 'ihs', value: 'P02131234771' });
    expect(parsePatientQuery('Ny. Siti Rachmawati')).toEqual({ kind: 'name', value: 'siti rachmawati' });
    expect(parsePatientQuery('12345')).toBeNull();
    expect(parsePatientQuery('a')).toBeNull();
  });

  it('umur ringkas dihitung pada tanggal WIB', () => {
    const now = new Date('2026-10-03T21:30:00Z'); // 4 Okt 2026 04.30 WIB
    expect(patientAge('1972-03-14', now)).toBe('54 th');
    expect(patientAge('1972-10-05', now)).toBe('53 th');
    expect(patientAge('2026-02-10', now)).toBe('7 bln');
    expect(patientAge('2026-09-21', now)).toBe('13 hr');
    expect(formatTanggalLahir('1972-03-14')).toBe('14 Mar 1972');
    expect(isoDateJakarta(now)).toBe('2026-10-04');
  });
});

describe('skema pasien', () => {
  it('tanggal lahir wajib kecuali pasien tanpa identitas; identifier dinormalisasi lalu divalidasi', () => {
    const ok = createPatientSchema.parse({
      name: 'Siti Rahmawati',
      sex: 'female',
      birthDate: '1972-03-14',
      phone: '0812-0000-4567',
      identifiers: { nik: '9999 7454 0372 4521', bpjs: '0000-0123-4567-8' },
    });
    expect(ok.identifiers).toEqual({ nik: '9999745403724521', bpjs: '0000012345678' });
    expect(ok.phone).toBe('6281200004567');

    expect(createPatientSchema.safeParse({ name: 'Budi', sex: 'male' }).success).toBe(false);
    expect(createPatientSchema.safeParse({ name: 'Tn. X', sex: 'male', unidentified: true }).success).toBe(
      true,
    );
    const badNik = createPatientSchema.safeParse({
      name: 'Budi',
      sex: 'male',
      birthDate: '1965-06-02',
      identifiers: { nik: '12345' },
    });
    expect(badNik.success).toBe(false);
    expect(JSON.stringify(badNik.error?.issues)).toContain('NIK harus 16 digit');
  });

  it('tanggal lahir di masa depan dan field tak dikenal ditolak', () => {
    expect(
      createPatientSchema.safeParse({ name: 'Budi', sex: 'male', birthDate: '2999-01-01' }).success,
    ).toBe(false);
    expect(
      createPatientSchema.safeParse({
        name: 'Budi',
        sex: 'male',
        birthDate: '1965-06-02',
        mrn: '00-00-00-01',
      }).success,
    ).toBe(false);
    expect(updatePatientSchema.safeParse({}).success).toBe(false);
    expect(patientSearchSchema.parse({ q: 'siti' }).limit).toBe(20);
  });
});

describe('PatientCrypto', () => {
  const keys = {
    encKeyB64: Buffer.alloc(32, 7).toString('base64'),
    hashKeyB64: Buffer.alloc(32, 9).toString('base64'),
  };
  const a = new PatientCrypto(keys, '0199a000-0000-7000-8000-000000000001');
  const b = new PatientCrypto(keys, '0199a000-0000-7000-8000-000000000002');

  it('nilai terenkripsi tidak memuat teks asli; hash stabil per tenant × sistem', () => {
    const nik = '9999745403724521';
    const enc = a.encryptIdentifier('nik', nik);
    expect(enc.valueEnc.startsWith('v1.')).toBe(true);
    expect(enc.valueEnc).not.toContain(nik);
    expect(a.decryptIdentifier(enc.valueEnc)).toBe(nik);
    expect(a.identifierHash('nik', nik)).toBe(enc.valueHash);
    // Nilai sama di sistem lain atau tenant lain → hash berbeda (tidak bisa dikorelasikan).
    expect(a.identifierHash('bpjs', nik)).not.toBe(enc.valueHash);
    expect(b.identifierHash('nik', nik)).not.toBe(enc.valueHash);
    // Ciphertext tenant A tidak bisa dibuka dengan konteks tenant B.
    expect(() => b.decryptIdentifier(enc.valueEnc)).toThrow();
  });

  it('kontak terenkripsi dengan tujuan terpisah dari identifier', () => {
    const enc = a.encryptContact('Jl. Kenanga No. 12');
    expect(a.decryptContact(enc)).toBe('Jl. Kenanga No. 12');
    expect(() => a.decryptIdentifier(enc)).toThrow();
    expect(a.phoneHash('6281200004567')).toMatch(/^[0-9a-f]{64}$/);
  });
});
