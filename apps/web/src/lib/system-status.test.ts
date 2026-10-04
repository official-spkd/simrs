import { describe, expect, it } from 'vitest';
import { readinessCheckLabel } from './system-status';

describe('label status sistem', () => {
  it('penyimpanan berkas mengikuti driver dari API', () => {
    expect(readinessCheckLabel('storage', 's3')).toBe('Penyimpanan berkas (S3/MinIO)');
    expect(readinessCheckLabel('storage', 'disk')).toBe('Penyimpanan berkas (disk lokal)');
    // API lama tanpa `driver`, atau driver tak dikenal: tidak mengklaim MinIO.
    expect(readinessCheckLabel('storage')).toBe('Penyimpanan berkas');
    expect(readinessCheckLabel('storage', 'lain')).toBe('Penyimpanan berkas');
  });

  it('pemeriksaan lain memakai nama layanannya', () => {
    expect(readinessCheckLabel('database')).toBe('PostgreSQL');
    expect(readinessCheckLabel('redis')).toBe('Redis');
    expect(readinessCheckLabel('antrean')).toBe('antrean');
  });
});
