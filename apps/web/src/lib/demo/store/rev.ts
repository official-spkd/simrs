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

/**
 * Revisi terakhir per domain yang dikembalikan aksi berhasil di halaman ini, bersama untuk semua komponen domain itu
 * (mis. tab Peminjaman lalu tab Retensi di RM administratif: tab kedua bisa terpasang dengan prop `rev` lama).
 * Revisi toko naik monoton (kejadian dan mulai ulang menambah `seq`), dan revisi yang dikembalikan aksi domain = revisi
 * proyeksi domain itu saat itu, jadi `max(prop, ingatan)` tidak pernah melebihi revisi server yang sebenarnya.
 */
export class DomainRevisions {
  private readonly seen = new Map<string, number>();

  /** Revisi yang dikirim: prop halaman atau revisi aksi terakhir domain ini, mana yang lebih baru. */
  toSend(domain: string, propRev: number): number {
    return Math.max(propRev, this.seen.get(domain) ?? propRev);
  }

  /** Catat hasil aksi: berhasil → ingat revisinya; basi → lupakan (halaman dimuat ulang jadi sumbernya). */
  record(domain: string, result: { ok: boolean; stale?: boolean; rev?: unknown }): void {
    if (result.ok) {
      const rev = revAfterAction(-1, result);
      if (rev >= 0) this.seen.set(domain, Math.max(rev, this.seen.get(domain) ?? rev));
    } else if (result.stale) {
      this.seen.delete(domain);
    }
  }
}
