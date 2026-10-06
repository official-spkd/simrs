import {
  CDS_RULE_LABEL,
  CPOE_OVERRIDE_MIN_REASON,
  type CpoeCatalogItem,
  type CpoeCdsFinding,
  evaluateCdsItem,
  normalizeAllergen,
  SAMPLE_CDS_RULES,
  SAMPLE_SUBSTANCE_CLASSES,
  topCdsFinding,
} from '@simrs/shared';

/**
 * K09 · Clinical decision support CPOE untuk pratinjau layar dan mode presentasi. Mesin aturan dan KB contoh ada di
 * `@simrs/shared` (`evaluateCdsItem`, `SAMPLE_CDS_RULES`; rencana fase 3 §3.0a), sama dengan yang dipakai API sebagai
 * sumber kebenaran. Gerbang keselamatan CLAUDE.md §4.9: temuan `block` menahan pengiriman sampai item diganti/dihapus
 * atau di-override dengan alasan klinis tertulis.
 */

export { normalizeAllergen };

export interface CdsPatient {
  allergies: readonly string[];
  activeMeds: ReadonlyArray<{ name: string; substance: string; catalogId: string | null }>;
  flags: readonly string[];
  /** eGFR terakhir (aturan dosis ginjal KB); null = belum ada hasil. */
  egfr: number | null;
  payer: 'BPJS' | 'Umum' | 'Asuransi';
}

export type CdsItem = Pick<
  CpoeCatalogItem,
  'id' | 'name' | 'kind' | 'substance' | 'classes' | 'note' | 'coverage'
>;

/**
 * Evaluasi satu item terhadap pasien dan zat aktif lain (obat rutin + order lain di daftar) dengan KB contoh. Urutan
 * prioritas: blok dulu, lalu peringatan (alergi → alergi silang → riwayat → interaksi → dosis ginjal → perubahan
 * dosis → biaya di luar paket), lalu aman.
 */
export function evaluateCds(
  item: CdsItem,
  patient: CdsPatient,
  otherSubstances: readonly string[] = [],
): CpoeCdsFinding {
  const substance = item.substance?.toLowerCase() ?? null;
  const findings = evaluateCdsItem(
    { ...item, instructions: null },
    {
      allergies: patient.allergies.map((label) => {
        const allergen = normalizeAllergen(label);
        return { label, substance: allergen, classes: SAMPLE_SUBSTANCE_CLASSES[allergen] ?? [] };
      }),
      activeMeds: patient.activeMeds.map((m) => ({
        name: m.name,
        substance: m.substance,
        itemId: m.catalogId,
      })),
      flags: patient.flags,
      egfr: patient.egfr,
      payer: patient.payer,
    },
    SAMPLE_CDS_RULES,
    { others: otherSubstances.map((s) => ({ substance: s })) },
  );
  const continuation = substance !== null && patient.activeMeds.some((m) => m.substance === substance);
  return topCdsFinding(findings, { note: item.note, continuation });
}

/** Override sah bila alasan klinis cukup panjang; temuan blok menjadi peringatan yang tercatat. */
export function validOverride(reason: string | null | undefined): reason is string {
  return (reason?.trim().length ?? 0) >= CPOE_OVERRIDE_MIN_REASON;
}

const RULE_LABEL = CDS_RULE_LABEL;

export interface OrderLine {
  /** Id baris (unik dalam daftar). */
  lineId: string;
  item: CpoeCatalogItem;
  status: 'draf' | 'terkirim';
  /** Alasan override CDS yang sudah disimpan, atau null. */
  override: string | null;
}

export interface EvaluatedLine extends OrderLine {
  cds: CpoeCdsFinding;
  /** Masih diblokir CDS (belum diganti/dihapus/di-override). */
  blocked: boolean;
  overridden: boolean;
}

/** CDS setiap baris terhadap pasien + baris lain di daftar; override sah menurunkan blok menjadi peringatan. */
export function evaluateOrders(
  lines: readonly OrderLine[],
  patient: CdsPatient,
  doctor: string,
): EvaluatedLine[] {
  return lines.map((line) => {
    const others = lines
      .filter((o) => o.lineId !== line.lineId)
      .flatMap((o) => (o.item.substance ? [o.item.substance.toLowerCase()] : []));
    const base = evaluateCds(line.item, patient, others);
    if (base.level === 'block' && validOverride(line.override)) {
      return {
        ...line,
        cds: {
          level: 'warn',
          rule: base.rule,
          message: `Override ${RULE_LABEL[base.rule]} oleh ${doctor} · alasan: ${line.override.trim()}`,
        },
        blocked: false,
        overridden: true,
      };
    }
    return { ...line, cds: base, blocked: base.level === 'block', overridden: false };
  });
}

/**
 * Estimasi biaya pasien (bigint rupiah): pasien umum membayar seluruh tarif; pasien BPJS/asuransi hanya item di
 * luar paket penjamin. `items` = jumlah baris yang dibayar pasien.
 */
export function costEstimate(
  lines: ReadonlyArray<Pick<OrderLine, 'item'>>,
  payer: CdsPatient['payer'],
): { total: bigint; items: number } {
  let total = 0n;
  let items = 0;
  for (const l of lines) {
    // Tarif null (mode api sampai U01): tidak masuk estimasi.
    if (l.item.tariff === null) continue;
    const tariff = BigInt(l.item.tariff);
    if (tariff > 0n && (payer === 'Umum' || l.item.coverage === 'tidak-ditanggung')) {
      total += tariff;
      items += 1;
    }
  }
  return { total, items };
}

export interface PreSendCheck {
  tone: 'ok' | 'warn' | 'block';
  text: string;
}

/** Daftar "Pemeriksaan sebelum kirim" (mockup CPOE). */
export function preSendChecks(
  lines: readonly EvaluatedLine[],
  doctor: string,
  payer: CdsPatient['payer'],
): PreSendCheck[] {
  const count = (pred: (l: EvaluatedLine) => boolean) => lines.filter(pred).length;
  const nBlock = count((l) => l.blocked);
  const nDose = count((l) => l.cds.rule === 'dosis');
  const nOther = count(
    (l) =>
      !l.overridden &&
      l.cds.level === 'warn' &&
      (l.cds.rule === 'interaksi' || l.cds.rule === 'riwayat' || l.cds.rule === 'alergi-silang'),
  );
  const nCost = payer === 'Umum' ? 0 : costEstimate(lines, payer).items;
  const nOv = count((l) => l.overridden);
  const checks: PreSendCheck[] = [
    { tone: 'ok', text: `Kewenangan klinis ${doctor} sesuai untuk semua order` },
    { tone: 'ok', text: 'Diagnosis ICD-10 terhubung ke setiap order' },
    nDose
      ? { tone: 'warn', text: `${nDose} perubahan dosis perlu perhatian` }
      : { tone: 'ok', text: 'Tidak ada perubahan dosis yang perlu dipantau' },
  ];
  if (nOther) checks.push({ tone: 'warn', text: `${nOther} peringatan CDS lain perlu perhatian` });
  if (nCost)
    checks.push({ tone: 'warn', text: `${nCost} item di luar paket, perlu persetujuan biaya pasien` });
  checks.push(
    nBlock
      ? { tone: 'block', text: `${nBlock} order diblokir CDS; ganti, hapus, atau beri alasan` }
      : { tone: 'ok', text: 'Tidak ada order yang diblokir' },
  );
  if (nOv) checks.push({ tone: 'warn', text: `${nOv} override CDS tercatat dengan alasan` });
  checks.push({ tone: 'ok', text: 'Tidak ada duplikasi pemeriksaan' });
  return checks;
}

/**
 * Tombol kirim CPOE: jumlah order draf dan alasan tertulis bila belum bisa dikirim. Seperti mockup, surat kontrol
 * (tindak lanjut otomatis) tidak dihitung sebagai order bila ada order lain.
 */
export function sendGate(lines: readonly EvaluatedLine[]): { count: number; reason: string | null } {
  const drafts = lines.filter((l) => l.status === 'draf');
  const orders = drafts.filter((l) => l.item.kind !== 'kontrol').length || drafts.length;
  const blocked = drafts.filter((l) => l.blocked);
  if (blocked.length > 0) {
    const names = blocked.map((l) => (l.item.substance ?? l.item.name).toLowerCase()).join(', ');
    return {
      count: orders,
      reason: `Belum bisa dikirim: ${blocked.length} order diblokir CDS (${names}). Ganti alternatif, hapus, atau override dengan alasan.`,
    };
  }
  if (drafts.length === 0) return { count: 0, reason: 'Belum ada order baru untuk dikirim.' };
  return { count: orders, reason: null };
}

/** Catatan CPOE pasien simulasi: katalog/order set nonaktif, order hanya lewat tugas langkah skenario. */
export const SCENARIO_ORDER_NOTE = 'Pasien simulasi: order mengikuti langkah skenario';

export interface CpoeSendView {
  label: string;
  canSend: boolean;
  /** Alasan tertulis bila tombol kirim nonaktif. */
  reason: string | null;
}

/**
 * Tombol kirim CPOE. Kunjungan milik skenario Simulasi hanya bisa dikirim lewat tugas kirim (TTE) langkah aktif
 * setelah gerbang CDS selesai, sehingga yang ditandatangani persis daftar order di layar; tanpa tugas kirim tombol
 * nonaktif dengan alasan (order skenario terkirim lewat tugas lain). Kunjungan biasa: kirim draf tanpa blok CDS.
 */
export function cpoeSendView(o: {
  scenarioOwned: boolean;
  /** Tugas kirim (TTE) di langkah skenario aktif; null bila langkah aktif tidak punya tugas kirim. */
  sendTask: { done: boolean; enabled: boolean } | null;
  /** Langkah skenario pasien ini sedang dibawakan di layar CPOE. */
  stepActive: boolean;
  gate: { count: number; reason: string | null };
  sent: boolean;
  /** Jam kirim terakhir (label "Order terkirim · 10.41"). */
  sentAt?: string | null;
}): CpoeSendView {
  if (!o.scenarioOwned) {
    return {
      label: o.sent
        ? `Order terkirim${o.sentAt ? ` · ${o.sentAt}` : ''}`
        : `Tanda tangani dan kirim ${o.gate.count} order`,
      canSend: o.gate.reason === null && !o.sent,
      reason: o.gate.reason,
    };
  }
  if (o.sendTask) {
    const t = o.sendTask;
    return {
      label: 'Kirim resep (TTE)',
      canSend: t.enabled && !t.done && o.gate.reason === null,
      reason:
        o.gate.reason ??
        (t.done || t.enabled
          ? null
          : 'Belum bisa dikirim: selesaikan rencana terapi, gerbang CDS, dan PRB lebih dulu.'),
    };
  }
  return {
    label: 'Kirim order (TTE)',
    canSend: false,
    reason: o.stepActive
      ? `${SCENARIO_ORDER_NOTE}. Order terkirim saat tugas langkah aktif dijalankan di layar ini.`
      : `${SCENARIO_ORDER_NOTE}. Tidak ada langkah order yang aktif untuk pasien ini.`,
  };
}

/** Alternatif aman per golongan yang diblokir (formularium contoh). */
const ALTERNATIVES: Readonly<Record<string, readonly string[]>> = {
  penisilin: ['klindamisin-300', 'azitromisin-500'],
  'sefalosporin-1': ['klindamisin-300', 'azitromisin-500'],
  'sefalosporin-3': ['azitromisin-500', 'klindamisin-300'],
  ains: ['parasetamol-500'],
  ppi: ['pantoprazol-40'],
};

export type CdsFix =
  | { kind: 'swap'; lineId: string; toId: string; label: string }
  | { kind: 'remove'; lineId: string; label: string };

/** "Klindamisin 300 mg kapsul" → "klindamisin 300 mg" (label tombol). */
export function shortDrugName(name: string): string {
  return name
    .replace(/\s+(kapsul|tablet kunyah|tablet|injeksi|sublingual|suspensi)$/i, '')
    .replace(/^./, (c) => c.toLowerCase());
}

/**
 * Tindak lanjut yang disarankan untuk baris yang diblokir CDS (pertama = rekomendasi utama SafetyGate): ganti ke
 * alternatif aman, ganti obat pasangan interaksi (PPI → pantoprazol), atau hapus item.
 */
export function cdsFixes(
  line: EvaluatedLine,
  lines: readonly EvaluatedLine[],
  catalog: readonly CpoeCatalogItem[],
): CdsFix[] {
  const fixes: CdsFix[] = [];
  const swap = (lineId: string, toId: string, from?: string) => {
    const to = catalog.find((c) => c.id === toId);
    if (!to || lines.some((l) => l.item.id === toId)) return;
    fixes.push({
      kind: 'swap',
      lineId,
      toId,
      label: from ? `Ganti ${from} ke ${shortDrugName(to.name)}` : `Ganti ${shortDrugName(to.name)}`,
    });
  };
  if (line.cds.rule === 'interaksi') {
    if (line.item.classes.includes('ppi'))
      swap(line.lineId, 'pantoprazol-40', line.item.substance ?? undefined);
    const partner = lines.find(
      (l) =>
        l.lineId !== line.lineId &&
        l.status === 'draf' &&
        l.item.classes.includes('ppi') &&
        l.item.substance !== 'pantoprazol',
    );
    if (partner) swap(partner.lineId, 'pantoprazol-40', partner.item.substance ?? undefined);
  } else if (line.cds.rule === 'alergi' || line.cds.rule === 'alergi-silang') {
    for (const c of line.item.classes) for (const id of ALTERNATIVES[c] ?? []) swap(line.lineId, id);
  }
  fixes.push({
    kind: 'remove',
    lineId: line.lineId,
    label: `Hapus ${line.item.substance ?? shortDrugName(line.item.name)}`,
  });
  return fixes;
}
