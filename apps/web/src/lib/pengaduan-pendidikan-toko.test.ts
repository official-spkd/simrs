import { describe, expect, it } from 'vitest';
import { actor, applyAll, denied } from './backoffice-toko.testing';
import { LOGBOOK, TRAINEES } from './demo/fixtures/pendidikan';
import { DEMO_NOW } from './demo/fixtures/waktu';
import { responseRate } from './pengalaman';
import { type ComplaintEvent, complaintDomain, complaintRecords, initialComplaints } from './pengaduan-toko';
import { educationDomain, initialEducation } from './pendidikan-toko';

const when = '2026-10-05T03:50:00.000Z';
const loket = actor('u-l', 'petugas_pendaftaran', 'Petugas Uji');
const dokter = actor('u-d', 'dokter', 'dr. Supervisor Uji');

describe('B13 · domain toko pengaduan', () => {
  it('alur berurutan; jawaban masuk INM-12', () => {
    const before = responseRate(complaintRecords(initialComplaints()), DEMO_NOW);
    const steps: Array<readonly [ComplaintEvent, ReturnType<typeof actor>]> = [
      [{ type: 'aduan.digrading', id: 'adu-24', grade: 'merah', when }, loket],
      [
        { type: 'aduan.ditindaklanjuti', id: 'adu-24', text: 'Kepala IGD menjelaskan alur triase', when },
        loket,
      ],
      [
        { type: 'aduan.dijawab', id: 'adu-24', answer: 'Mohon maaf atas penantian di IGD kami.', when },
        loket,
      ],
    ];
    expect(denied(complaintDomain, initialComplaints(), steps[2]?.[0] as ComplaintEvent, loket)).toMatch(
      /tahap/,
    );
    const s = applyAll(complaintDomain, steps);
    const after = responseRate(complaintRecords(s), DEMO_NOW);
    expect(after.total).toBe(before.total + 1);
    expect(s.complaints.find((c) => c.id === 'adu-24')?.log.at(-1)?.by).toBe('Petugas Uji');
  });
});

describe('B10 · domain toko pendidikan', () => {
  it('hanya Dokter memverifikasi; naik tingkat setelah syarat terpenuhi, satu per satu', () => {
    const t = TRAINEES[0];
    const waiting = LOGBOOK.find(
      (e) => e.traineeId === t?.id && e.status === 'menunggu' && e.role !== 'observasi',
    );
    if (!t || !waiting) throw new Error('fixture');
    expect(
      denied(
        educationDomain,
        initialEducation(),
        { type: 'logbook.diverifikasi', id: waiting.id, jam: '10.00' },
        loket,
      ),
    ).toMatch(/Dokter/);
    const s = applyAll(educationDomain, [
      [{ type: 'logbook.diverifikasi', id: waiting.id, jam: '10.00' }, dokter],
    ]);
    const up = {
      type: 'tingkat.dinaikkan' as const,
      traineeId: t.id,
      level: t.level + 2,
      reason: 'Lompat dua tingkat',
      jam: '10.01',
    };
    expect(denied(educationDomain, s, up, dokter)).toMatch(/satu per satu/);
  });
});
