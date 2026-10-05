import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { generateBackupKeyPair } from '../src/crypto';
import { pickBackup } from '../src/restore';
import { hostForDocker, redact } from '../src/tools';

const ROOT = '/srv/simrs';

describe('konfigurasi backup', () => {
  it('bawaan lokal: tiga lokasi, retensi, path dari root repo', () => {
    const cfg = loadConfig({}, ROOT);
    expect(cfg.localDir).toBe('/srv/simrs/.local/backup');
    expect(cfg.primary.bucket).toBe('simrs-backups');
    expect(cfg.offsite.bucket).toBe('simrs-backups-offsite');
    expect(cfg.documentsRoot).toBe('/srv/simrs/.local/storage');
    expect(cfg.retention).toMatchObject({ hourly: 48, daily: 35, monthly: 12 });
    expect(cfg.ensureBuckets).toBe(false);
  });

  it('offsite tidak boleh sama dengan bucket utama', () => {
    expect(() => loadConfig({ BACKUP_OFFSITE_BUCKET: 'simrs-backups' }, ROOT)).toThrow(/offsite/);
  });

  it('awalan dan nama bucket divalidasi', () => {
    expect(() => loadConfig({ BACKUP_PREFIX: '../x/' }, ROOT)).toThrow(/BACKUP_PREFIX/);
    expect(() => loadConfig({ BACKUP_PREFIX: 'tanpa-garis-miring' }, ROOT)).toThrow(/BACKUP_PREFIX/);
    expect(() => loadConfig({ BACKUP_S3_BUCKET: 'Bucket_Salah' }, ROOT)).toThrow(/BACKUP_S3_BUCKET/);
    expect(loadConfig({ BACKUP_PREFIX: 'edge-rscm/' }, ROOT).prefix).toBe('edge-rscm/');
  });

  it('kunci publik dari env', () => {
    const { publicKey } = generateBackupKeyPair();
    expect(loadConfig({ BACKUP_PUBLIC_KEY: publicKey }, ROOT).publicKeyText).toBe(publicKey);
  });
});

describe('alat', () => {
  it('kredensial disamarkan di pesan galat', () => {
    expect(redact('gagal http://akses:rahasia@minio:9000/x')).toBe('gagal http://***:***@minio:9000/x');
    expect(redact('password rahasia123 salah', ['rahasia123'])).toBe('password *** salah');
  });

  it('localhost dilihat kontainer sebagai host.docker.internal', () => {
    expect(hostForDocker('localhost')).toBe('host.docker.internal');
    expect(hostForDocker('127.0.0.1')).toBe('host.docker.internal');
    expect(hostForDocker('db.internal')).toBe('db.internal');
  });
});

describe('pilih backup untuk uji restore', () => {
  const runs = [
    { key: '20261005T010000Z-hourly', complete: true },
    { key: '20261005T020000Z-hourly', complete: false },
    { key: '20261004T190000Z-daily', complete: true },
  ];

  it('terbaru yang lengkap', () => {
    expect(pickBackup(runs)).toBe('20261005T010000Z-hourly');
  });

  it('yang diminta harus ada dan lengkap', () => {
    expect(pickBackup(runs, '20261004T190000Z-daily')).toBe('20261004T190000Z-daily');
    expect(() => pickBackup(runs, '20261005T020000Z-hourly')).toThrow(/tidak lengkap/);
    expect(() => pickBackup([])).toThrow(/tidak ada backup/);
  });
});
