import { describe, expect, it } from 'vitest';
import {
  backoffDelayMs,
  COMPONENTS,
  envSchemas,
  formatRupiah,
  formatTanggalWaktu,
  isUuidV7,
  newId,
  parseEnv,
  parseRupiah,
  periodYYMM,
  rupiahFromNumber,
  sumRupiah,
} from './index';

describe('uang (bigint rupiah)', () => {
  it('memformat sesuai pedoman UI', () => {
    expect(formatRupiah(1250400n)).toBe('Rp 1.250.400');
    expect(formatRupiah(0n)).toBe('Rp 0');
    expect(formatRupiah(999n)).toBe('Rp 999');
    expect(formatRupiah(-1000n)).toBe('−Rp 1.000');
  });

  it('parse bolak-balik dan menolak pecahan', () => {
    expect(parseRupiah('Rp 1.250.400')).toBe(1250400n);
    expect(parseRupiah('1250400')).toBe(1250400n);
    expect(parseRupiah('−Rp 1.000')).toBe(-1000n);
    expect(() => parseRupiah('1.250,50')).toThrow(RangeError);
    expect(() => parseRupiah('12.34')).toThrow(RangeError);
  });

  it('menolak float dari number', () => {
    expect(rupiahFromNumber(15000)).toBe(15000n);
    expect(() => rupiahFromNumber(1500.5)).toThrow(RangeError);
  });

  it('menjumlah tanpa kehilangan presisi di atas 2^53', () => {
    expect(sumRupiah([9007199254740993n, 2n])).toBe(9007199254740995n);
  });
});

describe('tanggal (Asia/Jakarta)', () => {
  it('memformat "Sen, 5 Okt 2026 · 07.10"', () => {
    // 07.10 WIB = 00.10 UTC
    expect(formatTanggalWaktu('2026-10-05T00:10:00Z')).toBe('Sen, 5 Okt 2026 · 07.10');
  });

  it('melewati tengah malam UTC ke hari berikutnya di WIB', () => {
    expect(formatTanggalWaktu('2026-10-31T18:30:00Z')).toBe('Min, 1 Nov 2026 · 01.30');
    expect(periodYYMM('2026-10-31T18:30:00Z')).toBe('2611');
  });
});

describe('id', () => {
  it('membangkitkan UUID v7 berurutan waktu', () => {
    const a = newId();
    const b = newId();
    expect(isUuidV7(a)).toBe(true);
    expect(a < b).toBe(true);
  });
});

describe('katalog komponen', () => {
  it('memuat 81 komponen dalam 7 lapisan', () => {
    const codes = Object.keys(COMPONENTS);
    expect(codes).toHaveLength(81);
    expect(new Set(codes.map((c) => c[0]))).toEqual(new Set(['P', 'F', 'K', 'S', 'U', 'B', 'I']));
  });
});

describe('outbox backoff', () => {
  it('tumbuh eksponensial dan dibatasi', () => {
    const fixed = () => 1;
    expect(backoffDelayMs(1, 1000, 60_000, fixed)).toBe(1000);
    expect(backoffDelayMs(4, 1000, 60_000, fixed)).toBe(8000);
    expect(backoffDelayMs(20, 1000, 60_000, fixed)).toBe(60_000);
    expect(backoffDelayMs(4, 1000, 60_000, () => 0)).toBe(4000);
  });
});

describe('env', () => {
  it('gagal cepat tanpa membocorkan nilai', () => {
    const schema = envSchemas.database;
    expect(() => parseEnv(schema, { DATABASE_URL: 'bukan-url-rahasia' })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv(schema, { DATABASE_URL: 'bukan-url-rahasia' })).not.toThrow(/bukan-url-rahasia/);
  });
});
