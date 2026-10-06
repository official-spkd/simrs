import { describe, expect, it } from 'vitest';
import { GRANTED_PRIVILEGES, PRIVILEGE_APPLICATIONS } from './demo/fixtures/kredensial';
import { EMPLOYEES } from './demo/fixtures/pegawai';
import { STAF } from './demo/fixtures/staf';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import { credentialVerifyBlock, orderGuard, reviewBlock, rkkExpiry, rkkNumber } from './kredensial';

const licensesOf = (name: string) => EMPLOYEES.find((e) => e.name === name)?.licenses ?? [];

describe('B04 · kredensial', () => {
  it('setiap pengajuan merujuk pegawai yang ada', () => {
    for (const a of PRIVILEGE_APPLICATIONS)
      expect(
        EMPLOYEES.some((e) => e.id === a.employeeId),
        a.number,
      ).toBe(true);
  });

  it('verifikasi berkas: SIP kedaluwarsa menahan; berkas susulan menahan sampai diterima', () => {
    const rina = PRIVILEGE_APPLICATIONS.find((a) => a.practitioner === STAF.dokterJagaIgd);
    const sinta = PRIVILEGE_APPLICATIONS.find((a) => a.number === 'KRD-2610-005');
    if (!rina || !sinta) throw new Error('fixture');
    expect(credentialVerifyBlock(licensesOf(rina.practitioner), DEMO_TODAY, rina.documents)).toMatch(
      /SIP kedaluwarsa/,
    );
    expect(credentialVerifyBlock(licensesOf(sinta.practitioner), DEMO_TODAY, sinta.documents)).toMatch(
      /Sertifikat pelatihan biopsi ginjal/,
    );
    const complete = sinta.documents.map((d) => ({ ...d, ok: true }));
    expect(credentialVerifyBlock(licensesOf(sinta.practitioner), DEMO_TODAY, complete)).toBeNull();
  });

  it('telaah: semua butir diputuskan dan catatan mitra bestari wajib', () => {
    const items = ['A', 'B'];
    expect(reviewBlock(items, { A: 'diberikan' }, 'Logbook memadai')).toMatch(/1 butir/);
    expect(reviewBlock(items, { A: 'diberikan', B: 'tidak' }, 'pendek')).toMatch(/catatan/);
    expect(reviewBlock(items, { A: 'diberikan', B: 'supervisi' }, 'Logbook memadai')).toBeNull();
  });

  it('RKK berlaku 3 tahun; nomor berurutan per periode', () => {
    expect(rkkExpiry(DEMO_TODAY)).toBe('2029-10-05');
    expect(rkkNumber(14)).toBe('RKK/2026/10/014');
  });

  it('kait CPOE: tanpa kewenangan / SIP kedaluwarsa diblokir; supervisi masuk co-sign', () => {
    const yohanes = orderGuard(
      STAF.dpjpBedah,
      'Kolesistektomi laparoskopik',
      GRANTED_PRIVILEGES,
      licensesOf(STAF.dpjpBedah),
      DEMO_TODAY,
    );
    expect(yohanes.ok).toBe(true);
    const sinta = 'dr. Sinta Maharani, Sp.PD-KGH';
    const none = orderGuard(
      sinta,
      'Biopsi ginjal perkutan',
      GRANTED_PRIVILEGES,
      licensesOf(sinta),
      DEMO_TODAY,
    );
    expect(none).toMatchObject({ ok: false, code: 'PRIVILEGE_REQUIRED' });
    const rina = orderGuard(
      STAF.dokterJagaIgd,
      'Resusitasi jantung paru lanjut',
      GRANTED_PRIVILEGES,
      licensesOf(STAF.dokterJagaIgd),
      DEMO_TODAY,
    );
    expect(rina).toMatchObject({ ok: false, code: 'LICENSE_EXPIRED' });
    const sup = orderGuard(
      sinta,
      'Biopsi ginjal perkutan',
      [{ practitioner: sinta, item: 'Biopsi ginjal perkutan', decision: 'supervisi', expiry: '2029-10-05' }],
      licensesOf(sinta),
      DEMO_TODAY,
    );
    expect(sup.ok && sup.text).toMatch(/supervisi/);
    const old = orderGuard(
      sinta,
      'X',
      [{ practitioner: sinta, item: 'X', decision: 'diberikan', expiry: '2026-10-01' }],
      licensesOf(sinta),
      DEMO_TODAY,
    );
    expect(old).toMatchObject({ ok: false, code: 'PRIVILEGE_EXPIRED' });
  });
});
