import { describe, expect, it } from 'vitest';
import { actor, applyAll, denied } from './backoffice-toko.testing';
import { project, type StoredEvent } from './demo/store/define';
import { PRIVILEGE_APPLICATIONS } from './demo/fixtures/kredensial';
import { type CredentialEvent, credentialDomain, initialCredentials, licensesOf } from './kredensial-toko';
import { orderGuard } from './kredensial';
import { DEMO_TODAY } from './demo/fixtures/waktu';

const when = '2026-10-05T03:50:00.000Z';
const dokterA = actor('u-a', 'dokter', 'dr. Penelaah A');
const dokterB = actor('u-b', 'dokter', 'dr. Komite B');
const direktur = actor('u-dir', 'manajemen', 'Direktur Uji');
const krd5 = PRIVILEGE_APPLICATIONS.find((a) => a.id === 'krd-05');
const krd6 = PRIVILEGE_APPLICATIONS.find((a) => a.id === 'krd-06');

describe('B04 · domain toko kredensial', () => {
  it('telaah Dokter → komite pengguna lain → RKK hanya direktur; RKK baru ditegakkan', () => {
    if (!krd5) throw new Error('fixture');
    const steps: Array<readonly [CredentialEvent, ReturnType<typeof actor>]> = [
      [{ type: 'berkas.diverifikasi', id: 'krd-05', docs: krd5.documents.map(() => true), when }, direktur],
      [
        {
          type: 'telaah.dikirim',
          id: 'krd-05',
          decisions: Object.fromEntries(krd5.items.map((i, n) => [i, n === 0 ? 'diberikan' : 'supervisi'])),
          note: 'Logbook memadai dan observasi langsung baik',
          when,
        },
        dokterA,
      ],
    ];
    const s = applyAll(credentialDomain, steps);
    expect(denied(credentialDomain, s, steps[1]?.[0] as CredentialEvent, direktur)).toMatch(/belum siap/);
    const komite: CredentialEvent = { type: 'komite.disetujui', id: 'krd-05', when };
    expect(denied(credentialDomain, s, komite, dokterA)).toMatch(/pemisahan tugas/);
    expect(denied(credentialDomain, s, komite, direktur)).toMatch(/posisi Dokter/);
    const s3 = applyAll(credentialDomain, [...steps, [komite, dokterB]]);
    const rkk: CredentialEvent = { type: 'rkk.diterbitkan', id: 'krd-05', when };
    expect(denied(credentialDomain, s3, rkk, dokterB)).toMatch(/direktur/);
    const done = applyAll(credentialDomain, [...steps, [komite, dokterB], [rkk, direktur]]);
    expect(done.apps['krd-05']?.rkk?.number).toBe('RKK/2026/10/014');
    const item = krd5.items[1] ?? '';
    expect(
      orderGuard(krd5.practitioner, item, done.granted, licensesOf(done, krd5.practitioner), DEMO_TODAY).ok,
    ).toBe(true);
  });

  it('melanggan SDM: SIP baru membuka verifikasi berkas yang tertahan', () => {
    if (!krd6) throw new Error('fixture');
    const s0 = initialCredentials();
    const verify: CredentialEvent = {
      type: 'berkas.diverifikasi',
      id: 'krd-06',
      docs: krd6.documents.map(() => true),
      when,
    };
    expect(denied(credentialDomain, s0, verify, direktur)).toMatch(/kedaluwarsa/);
    const sip: StoredEvent = {
      seq: 1,
      domain: 'sdm',
      at: when,
      actor: direktur,
      data: {
        type: 'sip.diperbarui',
        employeeId: krd6.employeeId,
        number: '9999/UM/0533',
        until: '2031-10-05',
        jam: '10.00',
      },
    };
    const s = project(credentialDomain, { seq: 1, resetSeq: 0, events: [sip] }).state;
    expect(denied(credentialDomain, s, verify, direktur)).toBeNull();
  });
});
