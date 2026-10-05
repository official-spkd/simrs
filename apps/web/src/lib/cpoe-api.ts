import {
  type CpoeOrderKind,
  MEDICATION_FREQUENCIES,
  type MedicationFrequency,
  type OrderEvaluation,
  type OrderLineInput,
  type OrderStatus,
  type OrderSubmitInput,
} from '@simrs/shared';

/**
 * Logika murni layar CPOE mode api (W2): baris order yang sedang disusun, masukan pratinjau CDS dan kirim order,
 * kelengkapan baris, dan label status. Terpisah dari komponen agar bisa diuji. Tarif tidak pernah ditampilkan di mode
 * api sampai master tarif U01 (keputusan fase 3 no. 14).
 */

export interface DraftItem {
  id: string;
  kind: CpoeOrderKind;
  name: string;
  highAlert?: boolean;
}

export interface DraftLine {
  /** Id lokal baris (bukan id order). */
  key: string;
  item: DraftItem;
  /** Penunjang/tindakan. */
  priority: 'rutin' | 'cito';
  /** Obat. */
  dose: string;
  route: string;
  frequency: MedicationFrequency | '';
  durationDays: number | null;
  instructions: string;
  /** Alasan override CDS (≥ 10 karakter) bila baris diblokir; null = belum. */
  override: string | null;
}

export const FREQUENCY_OPTIONS = (Object.keys(MEDICATION_FREQUENCIES) as MedicationFrequency[]).map(
  (code) => ({
    code,
    label: MEDICATION_FREQUENCIES[code].label,
  }),
);

export const ROUTE_OPTIONS = [
  'oral',
  'intravena',
  'intramuskular',
  'subkutan',
  'sublingual',
  'inhalasi',
  'topikal',
];

export function newDraftLine(item: DraftItem, key: string): DraftLine {
  return {
    key,
    item,
    priority: 'rutin',
    dose: '',
    route: item.kind === 'obat' ? 'oral' : '',
    frequency: '',
    durationDays: null,
    instructions: '',
    override: null,
  };
}

/** Kekurangan isian baris (obat: dosis, rute, frekuensi); kosong = siap dikirim. */
export function lineProblems(line: DraftLine): string[] {
  if (line.item.kind !== 'obat') return [];
  return [
    ...(line.dose.trim() ? [] : ['dosis']),
    ...(line.route.trim() ? [] : ['rute']),
    ...(line.frequency ? [] : ['aturan pakai']),
  ];
}

function toLine(line: DraftLine, preview: boolean): OrderLineInput {
  const instructions = line.instructions.trim() || null;
  if (line.item.kind !== 'obat') {
    return {
      type: 'layanan',
      orderableId: line.item.id,
      priority: line.priority,
      instructions,
      override: line.override,
    };
  }
  return {
    type: 'obat',
    drugId: line.item.id,
    compound: null,
    // Pratinjau CDS boleh dijalankan sebelum isian lengkap: zat aktif yang dinilai, bukan dosis.
    dose: line.dose.trim() || (preview ? '-' : ''),
    route: line.route.trim() || (preview ? 'oral' : ''),
    frequency: line.frequency || (preview ? 'stat' : ('' as MedicationFrequency)),
    customTimes: null,
    durationDays: line.durationDays,
    instructions,
    override: line.override,
  };
}

/** Masukan pratinjau CDS (`/orders/evaluate`): isian obat yang belum lengkap diberi nilai sementara. */
export function evaluateInput(
  encounterId: string,
  lines: readonly DraftLine[],
  orderSetId: string | null,
): OrderSubmitInput {
  return { encounterId, orderSetId, items: lines.map((l) => toLine(l, true)) };
}

/** Masukan kirim order; null bila masih ada baris yang belum lengkap. */
export function submitInput(
  encounterId: string,
  lines: readonly DraftLine[],
  orderSetId: string | null,
): OrderSubmitInput | null {
  if (lines.length === 0 || lines.some((l) => lineProblems(l).length > 0)) return null;
  return { encounterId, orderSetId, items: lines.map((l) => toLine(l, false)) };
}

/** Sidik daftar order: Idempotency-Key dipakai ulang selama sidiknya sama (kirim ulang = kiriman yang sama). */
export function draftFingerprint(lines: readonly DraftLine[], orderSetId: string | null): string {
  return JSON.stringify([orderSetId, lines.map((l) => toLine(l, false))]);
}

/** Alasan tombol kirim nonaktif, atau null bila boleh dikirim. */
export function sendBlocker(
  lines: readonly DraftLine[],
  evaluation: OrderEvaluation | null,
  evaluating: boolean,
): string | null {
  if (lines.length === 0) return 'Belum ada order baru. Cari katalog atau terapkan order set.';
  const incomplete = lines.filter((l) => lineProblems(l).length > 0);
  if (incomplete.length > 0) {
    return `Lengkapi ${incomplete.map((l) => `${l.item.name} (${lineProblems(l).join(', ')})`).join('; ')}.`;
  }
  if (evaluating || !evaluation || evaluation.lines.length !== lines.length)
    return 'Menunggu pemeriksaan CDS server…';
  const blocked = evaluation.lines.filter((l) => l.blocked);
  if (blocked.length > 0) {
    return `${blocked.length} order diblokir CDS (${blocked.map((l) => l.name).join(', ')}). Hapus atau isi alasan override.`;
  }
  return null;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  aktif: 'Aktif',
  dibatalkan: 'Dibatalkan',
  selesai: 'Selesai',
};

export const TTE_STATUS_LABEL = {
  pending: 'Resep · TTE diproses',
  signed: 'Resep · TTE sah',
  failed: 'Resep · TTE gagal',
} as const;

export const KIND_TITLE: Record<CpoeOrderKind, string> = {
  lab: 'Laboratorium',
  radiologi: 'Radiologi',
  obat: 'Obat',
  tindakan: 'Tindakan',
  kontrol: 'Tindak lanjut',
};
