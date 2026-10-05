import type { BpjsQueueTask, Referral, Sep } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  activeGeneralConsent,
  ageYears,
  idempotencyFor,
  parseDiagnosis,
  participantFromQuery,
  sameMaskedTail,
  sepSettled,
  sepStatusView,
  taskChips,
  tasksSettled,
  visitKindOf,
} from './registration-api';

const referral: Referral = {
  id: '0199a000-0000-7000-8000-000000000001',
  kind: 'rujukan-fktp',
  number: '9999P00112345678901',
  title: 'Rujukan FKTP',
  origin: 'Klinik Fiktif',
  diagnosis: { code: 'I10', label: 'Hipertensi esensial (primer)' },
  issuedAt: '2026-09-20',
  validUntil: '2026-12-18',
  visitNo: null,
  poliCode: 'PD',
  doctorId: null,
};

const sep = (patch: Partial<Sep>): Sep => ({
  id: '0199a000-0000-7000-8000-000000000002',
  encounterId: '0199a000-0000-7000-8000-000000000003',
  coverageId: '0199a000-0000-7000-8000-000000000004',
  referralId: null,
  version: 1,
  supersedesId: null,
  correctionReason: null,
  status: 'pending',
  sepNo: null,
  serviceType: 'rawat_jalan',
  careClass: null,
  bpjsPoliCode: 'INT',
  initialDiagnosis: { code: 'I10', display: 'Hipertensi' },
  lastErrorCode: null,
  rejectionReason: null,
  issuedAt: null,
  cancelledAt: null,
  cancelReason: null,
  sync: { status: 'pending', sentAt: null, error: null },
  ...patch,
});

const task = (taskId: 1 | 2 | 3, status: BpjsQueueTask['sync']['status']): BpjsQueueTask => ({
  id: `0199a000-0000-7000-8000-00000000001${taskId}`,
  appointmentId: '0199a000-0000-7000-8000-000000000020',
  taskId,
  at: '2026-10-05T01:00:00.000Z',
  sync: { status, sentAt: null, error: null },
});

describe('registration-api: aturan tampilan Pendaftaran mode api', () => {
  it('nomor peserta dari kotak cari: 13 digit kartu, 16 digit NIK, selain itu null', () => {
    expect(participantFromQuery('0000 1234 5678 9')).toEqual({ by: 'kartu', value: '0000123456789' });
    expect(participantFromQuery('9999010190012345')).toEqual({ by: 'nik', value: '9999010190012345' });
    expect(participantFromQuery('00-12-45-78')).toBeNull();
    expect(participantFromQuery('Siti Rahma')).toBeNull();
  });

  it('diagnosa awal: kode ICD-10 sah di depan; teks dari isian, rujukan, atau kode', () => {
    expect(parseDiagnosis('I10 · Hipertensi esensial (primer)', null)).toEqual({
      code: 'I10',
      display: 'Hipertensi esensial (primer)',
    });
    expect(parseDiagnosis('i10', referral)).toEqual({ code: 'I10', display: 'Hipertensi esensial (primer)' });
    expect(parseDiagnosis('E11.9', referral)).toEqual({ code: 'E11.9', display: 'E11.9' });
    expect(parseDiagnosis('Hipertensi', referral)).toBeNull();
    expect(parseDiagnosis('', referral)).toBeNull();
  });

  it('jenis kunjungan dari rujukan: surat kontrol → kontrol, FKTP → rujukan_fktp', () => {
    expect(visitKindOf(referral)).toBe('rujukan_fktp');
    expect(visitKindOf({ ...referral, kind: 'surat-kontrol' })).toBe('kontrol');
  });

  it('Idempotency-Key: isi sama → kunci sama (kirim ulang aman), isi beda → kunci baru', () => {
    let n = 0;
    const next = () => `kunci-${++n}`;
    const a = idempotencyFor(null, { x: 1 }, next);
    expect(idempotencyFor(a, { x: 1 }, next)).toBe(a);
    const b = idempotencyFor(a, { x: 2 }, next);
    expect(b.key).toBe('kunci-2');
  });

  it('status SEP: pending/gagal tampil dengan alasan; terbit/gagal/batal dianggap selesai', () => {
    const pending = sepStatusView(sep({}));
    expect(pending.label).toBe('SEP menunggu BPJS');
    expect(pending.detail).toContain('Pasien tetap boleh ke poli');
    expect(sepSettled(sep({}))).toBe(false);

    const failed = sep({
      status: 'failed',
      lastErrorCode: 'BPJS_PESERTA_TIDAK_AKTIF',
      rejectionReason: 'Peserta tidak aktif',
      sync: { status: 'rejected', sentAt: null, error: { code: 'BPJS_PESERTA_TIDAK_AKTIF', message: 'x' } },
    });
    const v = sepStatusView(failed);
    expect(v.label).toBe('SEP ditolak BPJS');
    expect(v.tone).toBe('danger');
    expect(v.detail).toContain('Peserta tidak aktif (BPJS_PESERTA_TIDAK_AKTIF)');
    expect(sepSettled(failed)).toBe(true);
    expect(
      sepStatusView(sep({ status: 'failed', sync: { status: 'dead', sentAt: null, error: null } })).label,
    ).toBe('SEP gagal dikirim');
    expect(sepStatusView(sep({ status: 'issued', sepNo: '0301R0011026V005102' })).detail).toContain(
      '0301R0011026V005102',
    );
    expect(sepSettled(null)).toBe(true);
  });

  it('task 1–3: belum tercatat / menunggu / terkirim; selesai bila tidak ada yang menunggu', () => {
    const chips = taskChips([task(1, 'sent'), task(3, 'pending')]);
    expect(chips.map((c) => c.label)).toEqual([
      'Task 1 · tunggu admisi: terkirim',
      'Task 2 · layan admisi: belum tercatat',
      'Task 3 · tunggu poli: menunggu kirim',
    ]);
    expect(tasksSettled([task(1, 'sent'), task(3, 'pending')])).toBe(false);
    expect(tasksSettled([task(1, 'sent'), task(3, 'rejected')])).toBe(true);
  });

  it('persetujuan umum aktif = umum tanpa penerima yang belum dicabut; umur; ekor no. tersamar', () => {
    const base = { id: referral.id, givenAt: '2026-10-01T01:00:00.000Z' };
    expect(
      activeGeneralConsent([
        { ...base, kind: 'pembukaan_data', recipient: 'Asuransi', active: true },
        { ...base, kind: 'umum', recipient: null, active: false },
      ]),
    ).toBeNull();
    expect(activeGeneralConsent([{ ...base, kind: 'umum', recipient: null, active: true }])).not.toBeNull();
    expect(ageYears('1972-03-14', '2026-10-05')).toBe(54);
    expect(ageYears('1972-10-06', '2026-10-05')).toBe(53);
    expect(ageYears(null, '2026-10-05')).toBeNull();
    expect(sameMaskedTail('*********6789', '0000****6789')).toBe(true);
    expect(sameMaskedTail('*********6789', '0000****1234')).toBe(false);
  });
});
