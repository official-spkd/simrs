import {
  DISPENSE_STAGES,
  type DispenseStage,
  type PharmacyCdsAlert,
  type PharmacyItem,
  type PharmacyPrescription,
} from '@simrs/shared';
import { z } from 'zod';
import type { GateDenial, StatusTone } from './penunjang';

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
/** Penerima obat saat serah terima. */
export type RxReceiver = 'pasien' | 'keluarga' | 'perawat';
export interface RxLocal {
  stage?: DispenseStage;
  hold?: string;
  partial?: string;
  alerts?: Record<string, { state: AlertAction; at: string; text: string }>;
  prep?: Record<number, boolean>;
  handover?: Record<number, boolean>;
  doubleCheck?: { by: string; at: string };
  receiver?: RxReceiver;
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

/*
 * Gerbang Server Action farmasi atas resep yang dicari server di antrean sesi (klien hanya mengirim id). Kemajuan
 * lokal (tahap, usulan, centang) tidak tersimpan sehingga tidak diperiksa.
 */

export const RX_UNKNOWN = 'Resep tidak ditemukan di antrean farmasi.';

export function rxGate(rx: Pick<PharmacyPrescription, 'id'> | undefined): GateDenial | null {
  return rx ? null : { message: RX_UNKNOWN };
}

/**
 * Tindak lanjut peringatan CDS: peringatan harus milik resep itu dan memang menahan telaah; override hanya dengan
 * alasan klinis tertulis (≥ 10 karakter).
 */
export function cdsFollowUpGate(
  rx: Pick<PharmacyPrescription, 'alerts'> | undefined,
  alertId: string,
  action: 'usul' | 'setuju' | 'konfirmasi' | 'override',
  reason: string | undefined,
): GateDenial | null {
  if (!rx) return { message: RX_UNKNOWN };
  const alert = rx.alerts.find((a) => a.id === alertId);
  if (!alert) return { message: 'Peringatan CDS tidak ditemukan pada resep ini.' };
  if (!alertBlocks(alert)) return { message: 'Peringatan CDS ini tidak memerlukan tindak lanjut.' };
  if (action === 'override' && (reason ?? '').trim().length < 10) {
    return { message: 'Alasan klinis wajib diisi, minimal 10 karakter.', field: 'reason' };
  }
  return null;
}

/** Cek ganda hanya untuk resep yang memuat obat high alert, oleh apoteker kedua yang bertugas (bukan penyiap). */
export function doubleCheckGate(
  rx: Pick<PharmacyPrescription, 'items'> | undefined,
  second: string,
  current: string,
  pharmacists: readonly string[],
): GateDenial | null {
  if (!rx) return { message: RX_UNKNOWN };
  if (!requiresDoubleCheck(rx)) {
    return { message: 'Resep ini tidak memuat obat high alert, cek ganda tidak diperlukan.' };
  }
  const err = secondPharmacistError(second, current, pharmacists);
  return err ? { message: err, field: 'second' } : null;
}

/*
 * Kemajuan lokal per resep disimpan di sessionStorage (kenyamanan) bersama tahap server resep saat dicatat, agar
 * bertahan bila halaman dimuat ulang atau di-mount ulang oleh router (mis. setelah simulasi maju), dan dibuang bila
 * resep hilang dari antrean atau tahap server-nya berubah (mis. simulasi diulang).
 */

export type StoredRxLocal = Record<string, { stage: DispenseStage; local: RxLocal }>;

const isoSchema = z.iso.datetime();
const flagsSchema = z.record(z.string().regex(/^\d{1,2}$/), z.boolean());
const rxLocalSchema = z.strictObject({
  stage: z.enum(DISPENSE_STAGES).optional(),
  hold: isoSchema.optional(),
  partial: isoSchema.optional(),
  alerts: z
    .record(
      z.string().max(60),
      z.strictObject({
        state: z.enum(['diusulkan', 'disetujui', 'dikonfirmasi', 'override']),
        at: isoSchema,
        text: z.string().max(600),
      }),
    )
    .optional(),
  prep: flagsSchema.optional(),
  handover: flagsSchema.optional(),
  doubleCheck: z.strictObject({ by: z.string().max(120), at: isoSchema }).optional(),
  receiver: z.enum(['pasien', 'keluarga', 'perawat']).optional(),
});
const storedSchema = z.record(
  z.string().max(60),
  z.strictObject({ stage: z.enum(DISPENSE_STAGES), local: rxLocalSchema }),
);

/** Isi sessionStorage → kemajuan tersimpan; isi rusak atau asing diabaikan (penyimpanan hanya kenyamanan). */
export function parseStoredRxLocal(raw: string | null): StoredRxLocal {
  if (!raw) return {};
  try {
    const p = storedSchema.safeParse(JSON.parse(raw));
    return p.success ? p.data : {};
  } catch {
    return {};
  }
}

type RxStage = Pick<PharmacyPrescription, 'id' | 'stage'>;

/** Kemajuan yang masih berlaku: resepnya masih di antrean dengan tahap server yang sama seperti saat dicatat. */
export function liveRxLocal(stored: StoredRxLocal, rxs: readonly RxStage[]): StoredRxLocal {
  const out: StoredRxLocal = {};
  for (const rx of rxs) {
    const e = stored[rx.id];
    if (e && e.stage === rx.stage) out[rx.id] = e;
  }
  return out;
}

/** Catat perubahan satu resep, berangkat dari kemajuannya yang masih berlaku; entri basi ikut dibuang. */
export function patchStoredRxLocal(
  stored: StoredRxLocal,
  rxs: readonly RxStage[],
  id: string,
  fn: (cur: RxLocal) => RxLocal,
): StoredRxLocal {
  const live = liveRxLocal(stored, rxs);
  const rx = rxs.find((r) => r.id === id);
  if (!rx) return live;
  return { ...live, [id]: { stage: rx.stage, local: fn(live[id]?.local ?? {}) } };
}
