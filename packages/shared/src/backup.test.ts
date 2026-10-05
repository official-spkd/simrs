import { describe, expect, it } from 'vitest';
import { type BackupStatus, backupStatusItems, backupStatusSchema, integrationOverviewSchema } from './index';

const NOW = new Date('2026-10-05T03:30:00Z'); // 10.30 WIB

const empty: BackupStatus = {
  lastRunAt: null,
  lastRunStatus: null,
  lastSuccessAt: null,
  localOkAt: null,
  cloudOkAt: null,
  offsiteOkAt: null,
  failedLast24h: 0,
  lastRestoreTestAt: null,
  lastRestoreTestStatus: null,
  lastRestoreRtoSeconds: null,
};

describe('status backup untuk layar Integrasi (ADR-0071)', () => {
  it('semua lokasi berhasil hari ini, uji restore minggu ini', () => {
    const s = backupStatusSchema.parse({
      ...empty,
      lastRunAt: '2026-10-05T03:00:05Z',
      lastRunStatus: 'success',
      lastSuccessAt: '2026-10-05T03:00:05Z',
      localOkAt: '2026-10-05T03:00:05Z',
      cloudOkAt: '2026-10-05T03:00:05Z',
      offsiteOkAt: '2026-10-05T03:00:05Z',
      lastRestoreTestAt: '2026-09-28T20:10:00Z',
      lastRestoreTestStatus: 'success',
      lastRestoreRtoSeconds: 412,
    });
    expect(backupStatusItems(s, NOW)).toEqual([
      { id: 'edge', label: 'Lokal server edge', detail: '10.00 · berhasil' },
      { id: 'cloud', label: 'Cloud utama', detail: '10.00 · berhasil' },
      { id: 'offsite', label: 'Offsite terenkripsi', detail: '10.00 · berhasil · uji restore 29 Sep' },
    ]);
  });

  it('lokasi tertinggal, run terakhir gagal, uji restore gagal: tertulis, bukan hanya warna', () => {
    const items = backupStatusItems(
      {
        ...empty,
        lastRunAt: '2026-10-05T03:00:05Z',
        lastRunStatus: 'partial',
        localOkAt: '2026-10-05T03:00:05Z',
        cloudOkAt: '2026-10-04T19:00:00Z',
        failedLast24h: 1,
        lastRestoreTestAt: '2026-10-01T01:00:00Z',
        lastRestoreTestStatus: 'failed',
      },
      NOW,
    );
    expect(items.map((i) => i.detail)).toEqual([
      '10.00 · berhasil',
      '02.00 · terlambat · run terakhir gagal',
      'belum ada backup berhasil · uji restore GAGAL 1 Okt',
    ]);
  });

  it('cocok dengan kontrak backups di ringkasan integrasi', () => {
    const backups = backupStatusItems(empty, NOW);
    const shape = integrationOverviewSchema.shape.backups;
    expect(shape.parse(backups)).toHaveLength(3);
    expect(backups[2]?.detail).toBe('belum ada backup berhasil · uji restore belum pernah');
  });
});
