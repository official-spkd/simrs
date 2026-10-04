import type { DispenseStage, PharmacyCdsAlert, PharmacyItem, PharmacyPrescription } from '@simrs/shared';
import type { StatusTone } from './penunjang';

/**
 * S04/S05 · Fungsi murni tampilan farmasi (mode presentasi, ADR-0023): KFA, gerbang CDS telaah, daftar telaah,
 * penyiapan dengan cek ganda high alert oleh apoteker kedua, dan pengurangan stok depo saat diserahkan.
 */

export function kfaText(item: Pick<PharmacyItem, 'kfa'>): string {
  return item.kfa ? `KFA ${item.kfa}` : 'KFA belum dipetakan';
}

/** "KFA 93000387 · Fornas · high alert". */
export function itemSource(item: PharmacyItem): string {
  return [kfaText(item), item.fornas ? 'Fornas' : 'Non-Fornas', item.highAlert ? 'high alert' : null]
    .filter(Boolean)
    .join(' · ');
}

const qty = new Intl.NumberFormat('id-ID');
export function formatQty(n: number): string {
  return qty.format(n);
}

/** Tindak lanjut apoteker di layar (simulasi): usulan ke dokter, persetujuan dokter, konfirmasi dosis, override. */
export type AlertAction = 'diusulkan' | 'disetujui' | 'dikonfirmasi' | 'override';
export interface RxLocal {
  stage?: DispenseStage;
  hold?: string;
  partial?: string;
  alerts?: Record<string, { state: AlertAction; at: string; text: string }>;
  prep?: Record<number, boolean>;
  handover?: Record<number, boolean>;
  doubleCheck?: { by: string; at: string };
}

/**
 * Peringatan yang menahan telaah: mayor/sedang yang masih terbuka, dan override dokter atas peringatan mayor
 * (apoteker tetap wajib meninjau). Info tidak menahan.
 */
export function alertBlocks(a: Pick<PharmacyCdsAlert, 'status' | 'level'>): boolean {
  return (a.status === 'terbuka' && a.level !== 'info') || (a.status === 'override' && a.level === 'mayor');
}

/** Peringatan yang masih menahan setelah tindak lanjut di layar (usulan yang belum disetujui tetap menahan). */
export function blockingAlerts(rx: PharmacyPrescription, local: RxLocal | undefined): PharmacyCdsAlert[] {
  return rx.alerts.filter((a) => {
    const done = local?.alerts?.[a.id]?.state;
    return alertBlocks(a) && done !== 'disetujui' && done !== 'dikonfirmasi' && done !== 'override';
  });
}

/** Item pengganti saat dokter menyetujui usulan omeprazol → pantoprazol. */
export function swapToPantoprazole(item: PharmacyItem): PharmacyItem {
  return {
    ...item,
    id: item.id.replace('omeprazol', 'pantoprazol'),
    name: 'Pantoprazol 40 mg inj',
    kfa: null,
    dose: '40 mg',
    route: 'IV',
    stock: 64,
    note: 'pengganti omeprazol (disetujui dokter)',
  };
}

/** Gabungkan tindakan lokal: tahap, dan penggantian obat bila usulan interaksi disetujui dokter. */
export function applyRxLocal(rx: PharmacyPrescription, local: RxLocal | undefined): PharmacyPrescription {
  if (!local) return rx;
  const approved = rx.alerts.some(
    (a) => a.kind === 'interaksi' && local.alerts?.[a.id]?.state === 'disetujui',
  );
  return {
    ...rx,
    stage: local.stage ?? rx.stage,
    items: approved
      ? rx.items.map((i) => (i.name.startsWith('Omeprazol') ? swapToPantoprazole(i) : i))
      : rx.items,
  };
}

/** Label antrean (teks, bukan hanya warna). */
export function rxTag(
  rx: PharmacyPrescription,
  local: RxLocal | undefined,
): { label: string; tone: StatusTone } {
  if (rx.stage === 'serah') return { label: 'Siap diserahkan', tone: 'success' };
  if (rx.stage === 'siap') return { label: rx.cito ? 'Cito' : rx.tag, tone: rx.cito ? 'danger' : 'neutral' };
  if (local?.hold) return { label: 'Ditahan', tone: 'warning' };
  if (Object.values(local?.alerts ?? {}).some((a) => a.state === 'diusulkan')) {
    return { label: 'Menunggu dokter', tone: 'warning' };
  }
  const n = blockingAlerts(rx, local).length;
  if (n > 0) return { label: `${n} peringatan`, tone: 'warning' };
  if (rx.cito) return { label: 'Cito', tone: 'danger' };
  if (rx.items.some((i) => i.highAlert)) return { label: 'High alert', tone: 'warning' };
  return { label: rx.tag, tone: 'neutral' };
}

/** Kolom CDS per item. */
export function itemCds(
  item: PharmacyItem,
  alerts: readonly PharmacyCdsAlert[],
  blocking: readonly PharmacyCdsAlert[],
): { label: string; tone: StatusTone } {
  const open = blocking.find((a) => a.itemIds.includes(item.id));
  if (open) {
    const label = {
      interaksi: 'Interaksi mayor',
      'dosis-ginjal': 'Dosis ginjal',
      alergi: 'Alergi',
      kontraindikasi: 'Kontraindikasi',
      'high-alert': 'High alert',
    }[open.kind];
    return { label, tone: open.level === 'mayor' ? 'danger' : 'warning' };
  }
  if (item.highAlert) return { label: 'High alert', tone: 'warning' };
  if (alerts.some((a) => a.itemIds.includes(item.id))) return { label: 'Dicek', tone: 'success' };
  return { label: 'Aman', tone: 'success' };
}

/** Daftar telaah administratif, farmasetik, klinis (mockup Farmasi). */
export function telaahChecklist(blocking: readonly PharmacyCdsAlert[]): Array<{ text: string; ok: boolean }> {
  const open = (...kinds: string[]) => blocking.some((a) => kinds.includes(a.kind));
  return [
    { text: 'Identitas pasien dan dokter lengkap', ok: true },
    { text: 'SIP dokter valid', ok: true },
    { text: 'Bentuk sediaan dan kekuatan sesuai', ok: true },
    { text: 'Stabilitas dan kompatibilitas', ok: true },
    { text: 'Interaksi obat', ok: !open('interaksi') },
    { text: 'Dosis sesuai fungsi ginjal', ok: !open('dosis-ginjal') },
    { text: 'Duplikasi terapi tidak ada', ok: true },
    { text: 'Kontraindikasi dan alergi', ok: !open('alergi', 'kontraindikasi') },
  ];
}

/** Alasan "Setujui dan siapkan" ditahan; null = boleh. */
export function telaahBlock(blocking: readonly PharmacyCdsAlert[], hold: boolean): string | null {
  if (hold) return 'Resep ditahan. Lepas tahanan untuk melanjutkan.';
  if (blocking.length > 0) {
    return `Tindak lanjuti ${blocking.length} peringatan CDS lebih dulu (ikuti saran atau lanjut dengan alasan).`;
  }
  return null;
}

/** Baris centang penyiapan: tiap obat diambil, dihitung, dan diberi etiket. */
export function prepChecklist(rx: PharmacyPrescription): string[] {
  return rx.items.map(
    (i) => `${i.name} · ${i.dose} ${i.route} · ${i.frequency} · ${formatQty(i.quantity)} ${i.unit}`,
  );
}

export const HANDOVER_CHECKS = [
  'Identitas dicek dengan 2 penanda (nama dan tanggal lahir)',
  'Obat dicocokkan dengan resep dan etiket',
  'Edukasi aturan pakai, penyimpanan, dan efek samping',
  'Penerima menandatangani bukti serah terima',
] as const;

export function requiresDoubleCheck(rx: Pick<PharmacyPrescription, 'items'>): boolean {
  return rx.items.some((i) => i.highAlert);
}

/** Alasan "Selesai disiapkan"/"Serahkan obat" belum boleh; null = boleh. */
export function workBlock(opts: {
  total: number;
  checked: number;
  doubleCheckRequired: boolean;
  doubleCheckDone: boolean;
}): string | null {
  const left = opts.total - opts.checked;
  if (left > 0) return `Lengkapi ${left} centang lagi.`;
  if (opts.doubleCheckRequired && !opts.doubleCheckDone) {
    return 'Cek ganda obat high alert oleh apoteker kedua belum dilakukan.';
  }
  return null;
}

/** Cek ganda high alert: apoteker kedua yang bertugas, bukan penyiap. */
export function secondPharmacistError(
  second: string,
  current: string,
  pharmacists: readonly string[],
): string | null {
  if (!second) return 'Pilih apoteker kedua.';
  if (!pharmacists.includes(second)) return 'Apoteker kedua tidak terdaftar bertugas hari ini.';
  if (second === current) return 'Cek ganda harus oleh apoteker lain, bukan apoteker yang menyiapkan.';
  return null;
}

export function stockAfter(item: Pick<PharmacyItem, 'stock' | 'quantity'>): number {
  return Math.max(0, item.stock - item.quantity);
}

export function stockLow(item: Pick<PharmacyItem, 'stockMin'>, value: number): boolean {
  return value < item.stockMin;
}

/** Pengurangan stok depo saat obat diserahkan: "Metformin 1000 mg tab 900 → 840 tab". */
export function dispenseLines(rx: Pick<PharmacyPrescription, 'items'>): string[] {
  return rx.items.map((i) => {
    const after = stockAfter(i);
    const low = stockLow(i, after) ? ' (di bawah stok minimum)' : '';
    return `${i.name} ${formatQty(i.stock)} → ${formatQty(after)} ${i.unit}${low}`;
  });
}
