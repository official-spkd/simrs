/**
 * Revisi toko demo yang dipakai aksi berikutnya (ADR-0085). Aksi yang berhasil mengembalikan revisi barunya; klien
 * langsung memakainya, tanpa menunggu halaman yang dimuat ulang `revalidatePath` membawa prop `rev` baru. Tanpa ini,
 * aksi kedua yang dikirim cepat (sebelum muatan RSC baru diterapkan) memakai revisi lama dan ditolak "basi", walau
 * tidak ada perubahan di tempat lain (mis. buka NIK tepat setelah simpan SIP di layar SDM).
 */
export function revAfterAction(current: number, result: { ok: boolean; rev?: unknown }): number {
  return result.ok && typeof result.rev === 'number' && Number.isSafeInteger(result.rev)
    ? result.rev
    : current;
}
