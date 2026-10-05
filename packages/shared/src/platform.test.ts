import { describe, expect, it } from 'vitest';
import {
  bookingCodeServiceDate,
  CORE_MODULES,
  createLocationSchema,
  createUnitSchema,
  defaultModuleEnabled,
  formatDocumentNumber,
  formatQueueTicket,
  isScopedNumberKind,
  isTenantSettingKey,
  NUMBER_KINDS,
  numberPeriod,
  parseTenantSetting,
  periodYYMMDD,
  QUEUE_NO_PATTERN,
  TENANT_SETTINGS,
} from './index';

describe('penomoran (docs/04 §5)', () => {
  it('memformat sesuai contoh dokumen', () => {
    expect(formatDocumentNumber('mrn', 412788n, '')).toBe('00-41-27-88');
    expect(formatDocumentNumber('encounter_rj', 123n, '2610')).toBe('RJ-2610-000123');
    expect(formatDocumentNumber('invoice', 2217n, '2610')).toBe('INV-2610-02217');
    expect(formatDocumentNumber('journal', 388n, '2610')).toBe('JU-26100388');
    expect(formatDocumentNumber('payment_bill', 412n, '2610')).toBe('INV-DP-2610-0412');
  });

  it('menolak nilai di luar kapasitas (bukan dipotong diam-diam)', () => {
    expect(() => formatDocumentNumber('mrn', 100_000_000n, '')).toThrow(RangeError);
    expect(() => formatDocumentNumber('invoice', 0n, '2610')).toThrow(RangeError);
  });

  it('periode bulanan mengikuti WIB; No. RM tanpa periode', () => {
    expect(numberPeriod('encounter_rj', new Date('2026-10-31T18:00:00Z'))).toBe('2611');
    expect(numberPeriod('mrn', new Date())).toBe('');
  });

  it('periode harian WIB: instan waktu digeser ke WIB, tanggal kalender dipakai apa adanya', () => {
    // 17.30 UTC = 00.30 WIB hari berikutnya
    expect(periodYYMMDD(new Date('2026-10-04T17:30:00Z'))).toBe('261005');
    expect(periodYYMMDD('2026-10-05')).toBe('261005');
    expect(periodYYMMDD('2026-10-05T23:59:00+07:00')).toBe('261005');
    expect(() => periodYYMMDD('2026-02-30')).toThrow(RangeError);
    expect(numberPeriod('booking_code', '2026-10-05')).toBe('261005');
    expect(numberPeriod('queue_ticket', new Date('2026-10-05T00:10:00Z'))).toBe('261005');
  });

  it('kode booking 10 digit = YYMMDD tanggal layanan + 4 digit urut', () => {
    expect(formatDocumentNumber('booking_code', 117n, '261005')).toBe('2610050117');
    expect(formatDocumentNumber('booking_code', 9_999n, '261005')).toMatch(/^\d{10}$/);
    expect(() => formatDocumentNumber('booking_code', 10_000n, '261005')).toThrow(RangeError);
    expect(bookingCodeServiceDate('2610050117')).toBe('2026-10-05');
    expect(bookingCodeServiceDate('2613050117')).toBeNull();
    expect(bookingCodeServiceDate('261005011')).toBeNull();
  });

  it('nomor antrean <awalan>-<3 digit> per layanan per hari; lingkup wajib dan sah', () => {
    expect(isScopedNumberKind('queue_ticket')).toBe(true);
    expect(isScopedNumberKind('booking_code')).toBe(false);
    expect(formatDocumentNumber('queue_ticket', 27n, '261005', 'PD')).toBe('PD-027');
    expect(formatQueueTicket('A', 31)).toBe('A-031');
    expect(formatQueueTicket('F', 21n)).toMatch(QUEUE_NO_PATTERN);
    expect(() => formatQueueTicket('PD', 1000)).toThrow(RangeError);
    // Tanpa lingkup (mis. dialokasikan lewat allocateNumber biasa) → ditolak, bukan satu urutan untuk semua layanan.
    expect(() => formatDocumentNumber('queue_ticket', 1n, '261005')).toThrow(RangeError);
    expect(() => formatQueueTicket('pd', 1)).toThrow(RangeError);
    expect(() => formatQueueTicket('ABC', 1)).toThrow(RangeError);
    // Jenis tanpa lingkup tidak menerima lingkup.
    expect(() => formatDocumentNumber('invoice', 1n, '2610', 'PD')).toThrow(RangeError);
  });

  it('kode jenis nomor lolos CHECK database (number_sequences_kind_format)', () => {
    for (const kind of Object.keys(NUMBER_KINDS)) expect(kind).toMatch(/^[a-z][a-z0-9_]{1,40}$/);
  });
});

describe('pengaturan tenant', () => {
  it('hanya kunci terdaftar; nilai divalidasi', () => {
    expect(isTenantSettingKey('session.idle_minutes')).toBe(true);
    expect(isTenantSettingKey('constructor')).toBe(false);
    expect(isTenantSettingKey('tidak.ada')).toBe(false);
    expect(parseTenantSetting('session.idle_minutes', 20)).toBe(20);
    expect(() => parseTenantSetting('password.min_length', 8)).toThrow();
    expect(() => parseTenantSetting('service.hours', { open: '21:00', close: '07:00' })).toThrow();
    expect(() => parseTenantSetting('service.hours', { open: '07:00', close: '21:00', x: 1 })).toThrow();
  });

  it('setiap bawaan lolos skemanya sendiri', () => {
    for (const [key, d] of Object.entries(TENANT_SETTINGS)) {
      expect(() => d.schema.parse(d.default), key).not.toThrow();
    }
  });

  it('pengaturan front office: bawaan dan batas', () => {
    expect(TENANT_SETTINGS['schedule.jkn_share_percent'].default).toBe(80);
    expect(TENANT_SETTINGS['queue.avg_service_minutes'].default).toBe(10);
    expect(TENANT_SETTINGS['booking.max_days_ahead'].default).toBe(30);
    expect(TENANT_SETTINGS['kiosk.lookup_rate_per_min'].default).toBe(10);
    expect(TENANT_SETTINGS['kiosk.lookup_rate_per_tenant_per_min'].default).toBe(60);
    expect(() => parseTenantSetting('kiosk.lookup_rate_per_tenant_per_min', 0)).toThrow();
    expect(parseTenantSetting('schedule.jkn_share_percent', 100)).toBe(100);
    expect(() => parseTenantSetting('schedule.jkn_share_percent', 101)).toThrow();
    expect(() => parseTenantSetting('schedule.jkn_share_percent', 79.5)).toThrow();
    expect(() => parseTenantSetting('booking.max_days_ahead', 0)).toThrow();
    expect(() => parseTenantSetting('kiosk.lookup_rate_per_min', 0)).toThrow();
    expect(() => parseTenantSetting('queue.avg_service_minutes', 0)).toThrow();
    expect(TENANT_SETTINGS['bpjs.contact_phone'].default).toBe('');
    expect(parseTenantSetting('bpjs.contact_phone', '0215550123')).toBe('0215550123');
    expect(() => parseTenantSetting('bpjs.contact_phone', '62215550123')).toThrow();
    expect(() => parseTenantSetting('bpjs.contact_phone', '0215')).toThrow();
  });
});

describe('modul', () => {
  it('modul inti aktif secara bawaan; modul "Lanjut" mati', () => {
    for (const code of CORE_MODULES) expect(defaultModuleEnabled(code)).toBe(true);
    expect(defaultModuleEnabled('B02')).toBe(false);
  });
});

describe('skema faskes', () => {
  it('kode dinormalisasi kapital; field tak dikenal ditolak', () => {
    const u = createUnitSchema.parse({
      facilityId: '0199a000-0000-7000-8000-000000000001',
      code: ' poli-dalam ',
      name: 'Poli Penyakit Dalam',
      kind: 'poli',
    });
    expect(u.code).toBe('POLI-DALAM');
    expect(() =>
      createLocationSchema.parse({
        unitId: '0199a000-0000-7000-8000-000000000001',
        kind: 'bed',
        code: 'B1',
        name: 'Bed 1',
        tenantId: 'x',
      }),
    ).toThrow();
  });
});
