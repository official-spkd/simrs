/**
 * Hari presentasi tetap (ADR-0023): selaras naskah Simulasi rawat jalan (Senin, 5 Okt 2026). Semua fixture
 * ditulis relatif terhadap tanggal ini agar layar-layar saling konsisten.
 */
export const DEMO_TODAY = '2026-10-05';
/** Jam "data per" di layar ringkasan (WIB). */
export const DEMO_NOW = '2026-10-05T10:45:00+07:00';

/** Saat modul dimuat (di browser: saat halaman dibuka). */
const DEMO_CLOCK_START = Date.now();

/**
 * Jam demo yang berjalan: mulai dari `DEMO_NOW` saat halaman dibuka lalu maju mengikuti jam dinding, sehingga cap
 * waktu catatan lokal (mis. "Dimulai Sen, 5 Okt 2026 · 10.52") tetap di hari presentasi. Panggil hanya di penangan
 * aksi/efek (bukan saat render) agar tidak memicu hidrasi yang tidak cocok.
 */
export function demoNow(): Date {
  return new Date(Date.parse(DEMO_NOW) + (Date.now() - DEMO_CLOCK_START));
}

/** Tanggal ISO `YYYY-MM-DD` digeser `days` hari dari `iso` (kalender, tanpa zona). */
export function shiftDate(iso: string, days: number): string {
  const [y = 2026, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
