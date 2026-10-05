import { KIOSK_PURPOSE_LABEL, KIOSK_PURPOSES, printableTicketSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { kioskFailure, kioskNextStep, kioskPurposeOf, kioskTicketView, newKioskKey } from './kiosk';

const ticket = printableTicketSchema.parse({
  ticketId: '0199b000-0000-7000-8000-000000000001',
  tenantName: 'RS Fiktif',
  queueNo: 'A-031',
  destination: 'Loket Pendaftaran',
  location: 'Lantai 1 · Lobi Utama',
  issuedAt: '2026-10-05T01:00:00.000Z',
  estimatedWaitMinutes: 12,
  sepNo: null,
  bookingCode: '2610050031',
});

describe('anjungan mode api', () => {
  it('judul pilihan layar awal → tujuan kontrak', () => {
    expect(KIOSK_PURPOSES.map((p) => kioskPurposeOf(KIOSK_PURPOSE_LABEL[p]))).toEqual([...KIOSK_PURPOSES]);
    expect(kioskPurposeOf('Pasien BPJS')).toBe('bpjs');
    expect(kioskPurposeOf('tidak dikenal')).toBe('booking');
  });

  it('farmasi/kasir memilih antrean; booking hari ini → check-in; selain itu nomor loket', () => {
    expect(kioskNextStep('farmasi_kasir', { hasBookingToday: true })).toBe('farmasi-kasir');
    expect(kioskNextStep('booking', { hasBookingToday: true })).toBe('check-in');
    expect(kioskNextStep('umum', { hasBookingToday: true })).toBe('check-in');
    expect(kioskNextStep('farmasi_kasir', { hasBookingToday: false })).toBe('farmasi-kasir');
    expect(kioskNextStep('booking', { hasBookingToday: false })).toBe('loket');
    expect(kioskNextStep('bpjs', { hasBookingToday: false })).toBe('loket');
  });

  it('tiket: lokasi + jam perkiraan WIB, catatan check-in, tanpa SEP sebelum registrasi', () => {
    expect(kioskTicketView(ticket)).toEqual({
      no: 'A-031',
      tujuan: 'Loket Pendaftaran',
      lokasi: 'Lantai 1 · Lobi Utama · perkiraan dipanggil 08.12',
      sep: null,
      note: 'Check-in booking 2610050031 berhasil. SEP dan nomor antrean poli diterbitkan petugas loket.',
    });
    expect(kioskTicketView({ ...ticket, estimatedWaitMinutes: null, bookingCode: null })).toMatchObject({
      lokasi: 'Lantai 1 · Lobi Utama',
      note: null,
    });
  });

  it('galat API → layar berikutnya', () => {
    expect(kioskFailure('KIOSK_LOOKUP_EXPIRED').action).toBe('restart');
    const counter = kioskFailure('KIOSK_NEEDS_COUNTER', 'bukan_hari_layanan');
    expect(counter).toEqual({
      action: 'loket',
      message: 'Tidak ada booking untuk hari ini. Silakan ambil nomor antrean loket pendaftaran.',
    });
    expect(kioskFailure('RATE_LIMITED').message).toContain('Panggil petugas');
    expect(kioskFailure('SERVICE_UNAVAILABLE', undefined, 'API mati')).toEqual({
      action: 'retry',
      message: 'API mati',
    });
  });

  it('kunci idempotensi lolos pola API dan berbeda tiap tindakan', () => {
    const a = newKioskKey();
    expect(a).toMatch(/^[A-Za-z0-9_:.-]{8,100}$/);
    expect(newKioskKey()).not.toBe(a);
  });
});
