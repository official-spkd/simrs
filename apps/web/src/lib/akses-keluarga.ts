/**
 * I07 · Persetujuan akses keluarga di aplikasi pasien (fase 9, celah alur): anggota keluarga meminta akses, pasien
 * memilih lingkup (data minimal) dan masa berlaku, lalu menyetujui dengan pernyataan; akses bisa dicabut kapan saja.
 * Data medis hanya bila lingkupnya dipilih eksplisit (UU PDP). Fungsi murni (ADR-0023).
 */

export const FAMILY_SCOPES = [
  { id: 'jadwal', label: 'Jadwal dan posisi antrean', medical: false },
  { id: 'tagihan', label: 'Tagihan dan pembayaran', medical: false },
  { id: 'lab', label: 'Hasil laboratorium', medical: true },
  { id: 'resume', label: 'Resume medis dan obat', medical: true },
] as const;

export type FamilyScope = (typeof FAMILY_SCOPES)[number]['id'];

export const DURATIONS = [
  { id: '30', label: '30 hari', days: 30 },
  { id: '180', label: '6 bulan', days: 180 },
  { id: 'cabut', label: 'Sampai saya cabut', days: null },
] as const;

export function grantBlock(scopes: readonly FamilyScope[], duration: string, agreed: boolean): string | null {
  if (scopes.length === 0) return 'Pilih minimal satu jenis data.';
  if (!DURATIONS.some((d) => d.id === duration)) return 'Pilih masa berlaku.';
  if (!agreed) return 'Centang pernyataan persetujuan dulu.';
  return null;
}

/** Ada data medis di lingkup → pernyataan khusus data kesehatan wajib ditampilkan. */
export function includesMedical(scopes: readonly FamilyScope[]): boolean {
  return FAMILY_SCOPES.some((s) => s.medical && scopes.includes(s.id));
}

/** Tanggal akhir akses `YYYY-MM-DD`, atau null bila sampai dicabut. */
export function accessUntil(today: string, duration: string): string | null {
  const d = DURATIONS.find((x) => x.id === duration);
  if (!d || d.days === null) return null;
  const [y = 2026, m = 1, day = 1] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day + d.days)).toISOString().slice(0, 10);
}
