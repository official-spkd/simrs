import { describe, expect, it } from 'vitest';
import {
  actionTone,
  auditHref,
  type ChainCheck,
  chainCheckSummary,
  deviceLabel,
  formatWaktuServer,
  formatWaktuSingkat,
  objectLabel,
  rangeStart,
  type ReviewHistoryItem,
  reviewHistoryRows,
  roleLabel,
  tanggalWib,
} from './audit';

describe('rentang dan format waktu (WIB)', () => {
  const now = new Date('2026-10-03T21:30:00Z'); // Min, 4 Okt 2026 04.30 WIB
  it('"hari ini" mulai 00.00 WIB, bukan 00.00 UTC', () => {
    expect(rangeStart('hari-ini', now).toISOString()).toBe('2026-10-03T17:00:00.000Z');
    expect(rangeStart('7-hari', now).toISOString()).toBe('2026-09-26T21:30:00.000Z');
    expect(tanggalWib(now)).toBe('2026-10-04');
  });

  it('format ringkas dan waktu server dengan detik', () => {
    expect(formatWaktuSingkat('2026-10-03T01:51:07.000Z')).toBe('3 Okt 08.51');
    expect(formatWaktuServer('2026-10-03T01:51:07.123Z')).toBe('Sab, 3 Okt 2026 · 08.51.07');
  });
});

describe('label baris audit', () => {
  it('nama peran, bukan kode', () => {
    expect(roleLabel('admin_tenant')).toBe('Admin SIM RS');
    expect(roleLabel('superadmin_platform')).toBe('Superadmin platform');
    expect(roleLabel('peran_khusus')).toBe('peran_khusus');
    expect(roleLabel(null)).toBe('—');
  });

  it('nada chip: penolakan merah, tinjauan hijau, baca netral, darurat merah', () => {
    expect(actionTone('access_denied')).toBe('danger');
    expect(actionTone('read', 'denied')).toBe('danger');
    expect(actionTone('review')).toBe('success');
    expect(actionTone('read')).toBe('neutral');
    expect(actionTone('break_glass')).toBe('danger');
    expect(actionTone('update')).toBe('info');
  });

  it('objek tanpa PHI: label + potongan id', () => {
    expect(
      objectLabel({
        resourceType: 'patient',
        resourceId: 'x',
        patientId: '0199a1b2-1111-7000-8000-000000000001',
      }),
    ).toBe('Pasien · 0199a1b2');
    expect(objectLabel({ resourceType: 'audit_chain', resourceId: null, patientId: null })).toBe(
      'Rantai audit',
    );
    expect(objectLabel({ resourceType: 'tak_dikenal', resourceId: null, patientId: null })).toBe(
      'tak_dikenal',
    );
  });

  it('perangkat ringkas dari user agent', () => {
    const edge =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 Edg/140';
    expect(deviceLabel('10.12.4.21', edge)).toBe('10.12.4.21 · Edge · Windows');
    expect(deviceLabel(null, null)).toBe('—');
    expect(deviceLabel('::1', 'node')).toBe('::1 · perangkat lain');
  });

  it('auditHref mempertahankan filter', () => {
    expect(auditHref({ rentang: '7-hari', jenis: 'baca' }, { kejadian: '42' })).toBe(
      '/sistem/audit?rentang=7-hari&jenis=baca&kejadian=42',
    );
    expect(auditHref({ kursor: '9' }, { kursor: undefined })).toBe('/sistem/audit');
  });
});

describe('riwayat tinjauan temuan', () => {
  const lestari = { id: '0199a1b2-1111-7000-8000-0000000000a1', displayName: 'Lestari Ayu' };
  const item = (over: Partial<ReviewHistoryItem>): ReviewHistoryItem => ({
    seq: '1',
    outcome: 'sah',
    note: null,
    reviewedAt: '2026-10-05T03:42:07.000Z',
    reviewer: lestari,
    reviewerRole: 'petugas_privasi',
    effective: false,
    ...over,
  });

  it('terbaru dulu menurut seq (angka, bukan teks); penanda berlaku dari API', () => {
    const rows = reviewHistoryRows([
      item({ seq: '9', outcome: 'perlu_klarifikasi', note: 'Tanya kasir' }),
      item({ seq: '10', outcome: 'sah', effective: true, reviewedAt: '2026-10-05T04:10:00.000Z' }),
      item({ seq: '1000000000000000001', outcome: 'sah', reviewer: null, reviewerRole: null }),
    ]);
    expect(rows.map((r) => r.seq)).toEqual(['1000000000000000001', '10', '9']);
    expect(rows.map((r) => r.status)).toEqual(['Digantikan', 'Berlaku', 'Digantikan']);
    expect(rows[1]).toMatchObject({
      effective: true,
      decision: 'Akses sah',
      when: 'Sen, 5 Okt 2026 · 11.10.00',
      who: 'Lestari Ayu · Petugas privasi',
      note: null,
    });
    expect(rows[2]).toMatchObject({ decision: 'Perlu klarifikasi', note: 'Tanya kasir' });
    expect(rows[0]?.who).toBe('Pengguna tidak dikenal · —');
  });

  it('keputusan tak dikenal tampil apa adanya; daftar kosong tetap kosong', () => {
    expect(reviewHistoryRows([item({ outcome: 'lainnya' })])[0]?.decision).toBe('Lainnya');
    expect(reviewHistoryRows([])).toEqual([]);
  });
});

describe('ringkasan pemeriksaan keutuhan (ADR-0072)', () => {
  const jam = () => '11.10';
  const base: ChainCheck = {
    intact: true,
    mode: 'checkpoint',
    checked: 1234,
    firstBrokenSeq: null,
    checkpoint: { seq: '1200', anchoredAt: '2026-10-05T03:00:00.000Z' },
    anchors: { total: 3, verified: 3, keyConfigured: true },
    issues: [],
    issueCount: 0,
    verifiedAt: '2026-10-05T04:10:00.000Z',
  };

  it('utuh: menyebut titik periksa dan jangkar yang cocok; penuh tanpa titik periksa', () => {
    const s = chainCheckSummary(base, jam);
    expect(s).toMatchObject({ level: 'success', title: 'Rantai utuh', lines: [] });
    expect(s.text).toBe(
      '1.234 entri diperiksa pukul 11.10 sejak titik periksa #1200 (jangkar Sen, 5 Okt 2026 · 10.00); ' +
        'tidak ada yang diubah atau dihapus. 3 jangkar cocok.',
    );
    expect(chainCheckSummary({ ...base, mode: 'full', checkpoint: null }, jam).text).toContain(
      '(pemeriksaan penuh)',
    );
    expect(
      chainCheckSummary({ ...base, anchors: { total: 0, verified: 0, keyConfigured: false } }, jam).text,
    ).toContain('Kunci jangkar belum dipasang');
  });

  it('rusak: satu baris per temuan, termasuk pemotongan ekor; sisa temuan disebut jumlahnya', () => {
    const s = chainCheckSummary(
      {
        ...base,
        intact: false,
        checkpoint: null,
        mode: 'full',
        issues: [
          { code: 'CHAIN_BROKEN', seq: '7', anchoredAt: null },
          { code: 'TRUNCATION_DETECTED', seq: '1300', anchoredAt: '2026-10-05T04:00:00.000Z' },
          { code: 'ANCHOR_TAMPERED', seq: '1301', anchoredAt: '2026-10-05T04:00:00.000Z' },
        ],
        issueCount: 5,
      },
      jam,
    );
    expect(s).toMatchObject({ level: 'critical', title: 'Rantai rusak' });
    expect(s.lines).toEqual([
      'Ketidakcocokan hash mulai entri #7: entri diubah, disisipkan, atau dihapus.',
      'Entri #1300 yang sudah dijangkar (Sen, 5 Okt 2026 · 11.00) hilang: ujung jejak dipotong.',
      'Jangkar #1301 tidak sah (tanda tangan tidak cocok): catatan jangkar diubah.',
      '… dan 2 temuan lain.',
    ]);
  });
});
