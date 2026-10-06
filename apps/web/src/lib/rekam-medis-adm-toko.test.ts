import { describe, expect, it } from 'vitest';
import { actor, applyAll, denied } from './backoffice-toko.testing';
import { RECORD_FILES } from './demo/fixtures/rekam-medis-adm';
import { initialRecordsAdmin, type RecordsAdminEvent, recordsAdminDomain } from './rekam-medis-adm-toko';

const when = '2026-10-05T03:50:00.000Z';
const rm = actor('u-rm', 'petugas_rm', 'Petugas RM Uji');
const privasi = actor('u-pv', 'petugas_privasi', 'Petugas Privasi Uji');
const direktur = actor('u-dir', 'manajemen', 'Direktur Uji');

describe('B09 · domain toko rekam medis administratif', () => {
  it('ROI: pemverifikasi (sesi) tidak bisa menyetujui; posisi penyetuju dibatasi; urutan dijaga', () => {
    const verify: RecordsAdminEvent = { type: 'roi.diverifikasi', id: 'roi-08', when };
    const approve: RecordsAdminEvent = { type: 'roi.disetujui', id: 'roi-08', when };
    const s0 = initialRecordsAdmin();
    expect(denied(recordsAdminDomain, s0, approve, privasi)).toMatch(/belum diverifikasi/);
    const s1 = applyAll(recordsAdminDomain, [[verify, privasi]]);
    expect(s1.roi['roi-08']?.verifiedBy?.name).toBe('Petugas Privasi Uji');
    expect(denied(recordsAdminDomain, s1, approve, privasi)).toMatch(/pemisahan tugas/);
    expect(denied(recordsAdminDomain, s1, approve, rm)).toMatch(/Petugas privasi atau Manajemen/);
    const s2 = applyAll(recordsAdminDomain, [
      [verify, privasi],
      [approve, direktur],
      [{ type: 'roi.dipenuhi', id: 'roi-08', when }, rm],
    ]);
    expect(s2.roi['roi-08']).toMatchObject({ stage: 3, approvedBy: { name: 'Direktur Uji' } });
  });

  it('ROI fixture yang sudah diverifikasi penerima loket bisa disetujui pengguna lain; tolak wajib alasan', () => {
    const s = initialRecordsAdmin();
    expect(denied(recordsAdminDomain, s, { type: 'roi.disetujui', id: 'roi-09', when }, privasi)).toBeNull();
    expect(
      recordsAdminDomain.eventSchema.safeParse({ type: 'roi.ditolak', id: 'roi-07', reason: 'kurang', when })
        .success,
    ).toBe(false);
    const r = applyAll(recordsAdminDomain, [
      [{ type: 'roi.ditolak', id: 'roi-07', reason: 'Surat kuasa tidak sah', when }, rm],
    ]);
    expect(denied(recordsAdminDomain, r, { type: 'roi.diverifikasi', id: 'roi-07', when }, rm)).toMatch(
      /ditolak/,
    );
  });

  it('peminjaman: legal hold/dipinjam ditolak, kembali dan pengingat tersimpan', () => {
    const free = RECORD_FILES.find(
      (f) => !f.legalHold && !initialRecordsAdmin().loans.some((l) => l.fileId === f.id && !l.returnedAt),
    );
    const hold = RECORD_FILES.find((f) => f.legalHold);
    if (!free || !hold) throw new Error('fixture');
    const lend = (fileId: string): RecordsAdminEvent => ({
      type: 'berkas.dipinjam',
      fileId,
      unit: 'Komite medik',
      borrower: 'dr. Peminjam Uji',
      purpose: 'Audit klinis kasus sepsis',
      jam: '10.00',
    });
    expect(denied(recordsAdminDomain, initialRecordsAdmin(), lend(hold.id), rm)).toMatch(/Legal hold/);
    const s = applyAll(recordsAdminDomain, [[lend(free.id), rm]]);
    expect(denied(recordsAdminDomain, s, lend(free.id), rm)).toMatch(/sedang dipinjam/);
    const back = applyAll(recordsAdminDomain, [
      [lend(free.id), rm],
      [{ type: 'berkas.kembali', loanId: 'pinjam-baru-1', when }, rm],
    ]);
    expect(back.loans[0]?.returnedAt).toBe(when);
  });

  it('pemusnahan: urutan, posisi berhak, direktur ≠ pengusul', () => {
    const step = (target: number): RecordsAdminEvent => ({ type: 'pemusnahan.maju', target, when });
    const s0 = initialRecordsAdmin();
    expect(denied(recordsAdminDomain, s0, step(2), direktur)).toMatch(/dilompati/);
    expect(denied(recordsAdminDomain, s0, step(1), privasi)).toMatch(/komite RM/);
    const s1 = applyAll(recordsAdminDomain, [[step(1), direktur]]);
    expect(denied(recordsAdminDomain, s1, step(2), direktur)).toMatch(/pemisahan tugas/);
    expect(denied(recordsAdminDomain, s1, step(2), rm)).toMatch(/direktur/);
    const done = applyAll(recordsAdminDomain, [
      [step(1), rm],
      [step(2), direktur],
      [step(3), direktur],
      [step(4), rm],
    ]);
    expect(done.destruction.stage).toBe(4);
    expect(done.destruction.steps.map((x) => x.who)).toEqual([
      'Sistem (job retensi 01.30)',
      'Petugas RM Uji',
      'Direktur Uji',
      'Direktur Uji',
      'Petugas RM Uji',
    ]);
  });
});
