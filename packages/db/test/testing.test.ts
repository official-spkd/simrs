/** Pengaman persiapan tes (ADR-0009): hanya database tes yang boleh dimigrasi dan di-seed otomatis. */
import { describe, expect, it } from 'vitest';
import { assertTestDatabase } from '../src/testing';

const url = (db: string) => `postgresql://simrs_migrator:x@localhost:5432/${db}?schema=public`;

describe('assertTestDatabase', () => {
  it('menerima simrs_test dan database tes per worktree simrs_test_<nama>', () => {
    for (const db of ['simrs_test', 'simrs_test_tinjau', 'simrs_test_pin_2']) {
      expect(() => assertTestDatabase(url(db))).not.toThrow();
    }
  });

  it('menolak database pengembangan dan nama yang hanya mirip', () => {
    for (const db of ['simrs', 'postgres', 'simrs_testing', 'simrs_test_', 'simrs_test-x', 'SIMRS_TEST']) {
      expect(() => assertTestDatabase(url(db))).toThrow(/menolak database/);
    }
  });
});
