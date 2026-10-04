/**
 * Kelas kontrol formulir layar Akses. Modul biasa (bukan 'use client') agar halaman server dan komponen klien sama-sama
 * menerima string-nya; konstanta yang diimpor dari modul klien hanya berupa referensi klien di server.
 */
export const selectClass =
  'h-10 rounded-control border border-line-strong bg-white px-2.5 font-[inherit] text-ink-900 disabled:bg-muted';
export const inputClass =
  'h-10 rounded-control border border-line-strong bg-white px-3 font-[inherit] text-ink-900';
