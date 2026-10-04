/**
 * Tab rekam rawat inap. Modul biasa (bukan 'use client'): halaman server membaca daftarnya untuk memvalidasi
 * `?tab=`; nilai yang diimpor dari modul klien hanya berupa referensi klien di server (bukan array).
 */
export const INPATIENT_TABS = ['ringkasan', 'cppt', 'obs', 'askep', 'hasil'] as const;
export type InpatientTab = (typeof INPATIENT_TABS)[number];
