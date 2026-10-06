import type { SupportPatient } from '@simrs/shared';

/**
 * S07 · Gizi (mode presentasi, ADR-0023): order diet dari DPJP → verifikasi ahli gizi, skrining gizi (MST), dan
 * distribusi makan per bangsal × jam makan dengan label. Gerbang keselamatan: alergi makanan (menu mengandung
 * alergen → ganti menu pengganti, atau lanjut dengan alasan tercatat), pasien puasa (tidak pernah diantar), dan
 * order diet yang belum diverifikasi. Rencana fase 4 §4.9.
 */

export type Texture = 'biasa' | 'lunak' | 'saring' | 'cair';
export type MealTime = 'pagi' | 'siang' | 'sore';

export const MEAL_TIMES: ReadonlyArray<{ id: MealTime; label: string; at: string }> = [
  { id: 'pagi', label: 'Makan pagi', at: '06.30' },
  { id: 'siang', label: 'Makan siang', at: '11.30' },
  { id: 'sore', label: 'Makan sore', at: '17.00' },
];

export interface Menu {
  name: string;
  /** Bahan utama (untuk pencocokan alergen). */
  ingredients: readonly string[];
}

export interface Screening {
  at: string;
  by: string;
  score: number;
}

export interface DietOrder {
  id: string;
  patient: SupportPatient;
  ward: string;
  bed: string;
  dpjp: string;
  diet: string;
  texture: Texture;
  route: 'oral' | 'sonde';
  notes: string;
  orderedAt: string;
  status: 'baru' | 'diverifikasi';
  verifiedBy: string | null;
  /** Puasa (mis. persiapan tindakan): makanan tidak pernah diantar selama aktif. */
  npo: { reason: string; until: string } | null;
  /** Alergi makanan dari asesmen gizi (di luar alergi obat di banner). */
  foodAllergies: readonly string[];
  screening: Screening | null;
  /** Menu per jam makan; `pengganti` dipakai saat menu utama mengandung alergen. */
  menus: Readonly<Record<MealTime, Menu>>;
  substitute: Menu;
}

// ─── Skrining gizi (MST) ────────────────────────────────────────────────────────────────────────────────────

export type WeightLoss = 'tidak' | 'tidak-yakin' | '1-5' | '6-10' | '11-15' | '>15';

export const WEIGHT_LOSS_OPTIONS: ReadonlyArray<{ id: WeightLoss; label: string; score: number }> = [
  { id: 'tidak', label: 'Tidak ada penurunan berat badan', score: 0 },
  { id: 'tidak-yakin', label: 'Tidak yakin', score: 2 },
  { id: '1-5', label: 'Turun 1–5 kg', score: 1 },
  { id: '6-10', label: 'Turun 6–10 kg', score: 2 },
  { id: '11-15', label: 'Turun 11–15 kg', score: 3 },
  { id: '>15', label: 'Turun > 15 kg', score: 4 },
];

/** Malnutrition Screening Tool: skor ≥ 2 = berisiko malnutrisi → asuhan gizi oleh ahli gizi ≤ 24 jam. */
export function mstScore(weightLoss: WeightLoss, poorAppetite: boolean): { score: number; atRisk: boolean } {
  const w = WEIGHT_LOSS_OPTIONS.find((o) => o.id === weightLoss)?.score ?? 0;
  const score = w + (poorAppetite ? 1 : 0);
  return { score, atRisk: score >= 2 };
}

// ─── Alergi dan distribusi ──────────────────────────────────────────────────────────────────────────────────

const norm = (s: string) => s.trim().toLowerCase();

/** Alergen yang ada di bahan menu (pencocokan kata, tidak peka huruf besar). */
export function allergyConflict(menu: Menu, allergies: readonly string[]): string[] {
  return allergies.filter((a) => menu.ingredients.some((i) => norm(i).includes(norm(a))));
}

export type DeliveryStatus = 'disiapkan' | 'diantar' | 'diterima';

export interface Delivery {
  status: DeliveryStatus;
  substituted: boolean;
  overrideReason: string | null;
  at: string | null;
  /** Sisa makanan (persen) setelah diterima. */
  leftover: number | null;
}

export type GiziGateCode = 'ORDER_UNVERIFIED' | 'NPO' | 'ALLERGY' | 'OVERRIDE_REASON';

export const GIZI_GATE_TEXT: Record<GiziGateCode, string> = {
  ORDER_UNVERIFIED: 'Order diet belum diverifikasi ahli gizi; makanan belum boleh disiapkan untuk diantar.',
  NPO: 'Pasien sedang puasa. Makanan tidak diantar sampai puasa dicabut DPJP.',
  ALLERGY: 'Menu mengandung alergen pasien. Ganti menu pengganti atau lanjut dengan alasan tercatat.',
  OVERRIDE_REASON: 'Alasan melanjutkan menu beralergen wajib diisi (minimal 10 karakter).',
};

/** Menu yang akan diantar (pengganti bila dipilih). */
export function mealOf(order: DietOrder, time: MealTime, substituted: boolean): Menu {
  return substituted ? order.substitute : order.menus[time];
}

/**
 * Gerbang antar makanan: order terverifikasi, tidak puasa (tanpa override), dan tidak mengandung alergen kecuali
 * menu diganti atau ada alasan override ≥ 10 karakter.
 */
export function deliveryGate(
  order: DietOrder,
  time: MealTime,
  opts: { substituted: boolean; overrideReason?: string | null },
): GiziGateCode | null {
  if (order.status !== 'diverifikasi') return 'ORDER_UNVERIFIED';
  if (order.npo) return 'NPO';
  const conflict = allergyConflict(mealOf(order, time, opts.substituted), order.foodAllergies);
  if (conflict.length === 0) return null;
  if (opts.overrideReason === undefined || opts.overrideReason === null) return 'ALLERGY';
  return opts.overrideReason.trim().length >= 10 ? null : 'OVERRIDE_REASON';
}

/** Label baki makanan: nama, RM, bangsal-bed, diet, tekstur, alergi. */
export function trayLabel(order: DietOrder, time: MealTime, substituted: boolean): string {
  const menu = mealOf(order, time, substituted);
  const allergy = order.foodAllergies.length
    ? ` · ALERGI ${order.foodAllergies.join(', ').toUpperCase()}`
    : '';
  return `${order.patient.name} · RM ${order.patient.rm} · ${order.ward} ${order.bed} · ${order.diet} (${order.texture}) · ${menu.name}${allergy}`;
}

/** Ringkasan bangsal untuk satu jam makan: jumlah baki, puasa, belum diverifikasi, konflik alergi. */
export function wardSummary(orders: readonly DietOrder[], time: MealTime) {
  return {
    trays: orders.filter((o) => !o.npo).length,
    npo: orders.filter((o) => o.npo).length,
    unverified: orders.filter((o) => o.status !== 'diverifikasi').length,
    allergy: orders.filter((o) => allergyConflict(o.menus[time], o.foodAllergies).length > 0).length,
  };
}

/** Rata-rata sisa makanan (persen) dari baki yang sudah diterima; null bila belum ada. */
export function averageLeftover(deliveries: readonly Pick<Delivery, 'leftover'>[]): number | null {
  const vals = deliveries.flatMap((d) => (d.leftover === null ? [] : [d.leftover]));
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}
