import {
  CPOE_OVERRIDE_MIN_REASON,
  type CpoeCatalogItem,
  type CpoeCdsFinding,
  type CpoeCdsLevel,
} from '@simrs/shared';

/**
 * K09 · Clinical decision support CPOE (aturan murni, dipakai server dan klien). Gerbang keselamatan CLAUDE.md §4.9:
 * temuan `block` menahan pengiriman sampai item diganti/dihapus atau di-override dengan alasan klinis tertulis.
 * Aturan contoh untuk mode presentasi; basis pengetahuan obat sungguhan menyusul (fase 3).
 */

export interface CdsPatient {
  allergies: readonly string[];
  activeMeds: ReadonlyArray<{ name: string; substance: string; catalogId: string | null }>;
  flags: readonly string[];
  payer: 'BPJS' | 'Umum' | 'Asuransi';
}

export type CdsItem = Pick<
  CpoeCatalogItem,
  'id' | 'name' | 'kind' | 'substance' | 'classes' | 'note' | 'coverage'
>;

/** Golongan zat yang tercatat sebagai alergi (dasar reaksi silang). */
const ALLERGEN_CLASSES: Readonly<Record<string, readonly string[]>> = {
  amoksisilin: ['penisilin'],
  ampisilin: ['penisilin'],
  ibuprofen: ['ains'],
  'asam mefenamat': ['ains'],
  kotrimoksazol: ['sulfonamid'],
};

const CROSS_REACTIVITY: ReadonlyArray<{ allergenClass: string; itemClass: string; level: CpoeCdsLevel }> = [
  { allergenClass: 'penisilin', itemClass: 'sefalosporin-1', level: 'block' },
  { allergenClass: 'penisilin', itemClass: 'sefalosporin-3', level: 'warn' },
];

/** Interaksi obat–obat berdasarkan zat aktif (urutan tidak penting). */
export const INTERACTIONS: ReadonlyArray<{ a: string; b: string; level: CpoeCdsLevel; message: string }> = [
  {
    a: 'klopidogrel',
    b: 'omeprazol',
    level: 'block',
    message:
      'omeprazol menurunkan efek antiplatelet klopidogrel. Ganti PPI ke pantoprazol atau isi alasan klinis.',
  },
  {
    a: 'glimepirid',
    b: 'metformin',
    level: 'warn',
    message: 'kombinasi dengan metformin meningkatkan risiko hipoglikemia. Edukasi pasien.',
  },
];

const HISTORY_RULES: ReadonlyArray<{
  flag: string;
  itemClass: string;
  level: CpoeCdsLevel;
  message: string;
}> = [
  {
    flag: 'hipoglikemia-berat',
    itemClass: 'sulfonilurea',
    level: 'block',
    message:
      'Diblokir: sulfonilurea pada pasien dengan riwayat hipoglikemia berat (risiko hipoglikemia berulang). Hapus atau isi alasan klinis.',
  },
  {
    flag: 'ckd',
    itemClass: 'ains',
    level: 'warn',
    message: 'AINS pada penyakit ginjal kronik: risiko perburukan fungsi ginjal. Pertimbangkan parasetamol.',
  },
];

/** "Kotrimoksazol (sulfa)" → "kotrimoksazol". */
export function normalizeAllergen(allergy: string): string {
  return allergy
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .trim();
}

/**
 * Evaluasi satu item terhadap pasien dan zat aktif lain (obat rutin + order lain di daftar). Urutan prioritas:
 * alergi → alergi silang → riwayat → interaksi → perubahan dosis → biaya di luar paket → aman.
 */
export function evaluateCds(
  item: CdsItem,
  patient: CdsPatient,
  otherSubstances: readonly string[] = [],
): CpoeCdsFinding {
  const findings: CpoeCdsFinding[] = [];
  const substance = item.substance?.toLowerCase() ?? null;
  for (const raw of patient.allergies) {
    const allergen = normalizeAllergen(raw);
    if (substance && substance === allergen) {
      findings.push({
        level: 'block',
        rule: 'alergi',
        message: `Diblokir: pasien alergi ${raw.toLowerCase()}. Pilih alternatif atau isi alasan klinis.`,
      });
      continue;
    }
    const allergenClasses = ALLERGEN_CLASSES[allergen] ?? [];
    if (substance && item.classes.some((c) => allergenClasses.includes(c))) {
      findings.push({
        level: 'block',
        rule: 'alergi',
        message: `Diblokir: ${item.name} satu golongan dengan alergi ${raw.toLowerCase()}. Pilih alternatif atau isi alasan klinis.`,
      });
    }
    for (const x of CROSS_REACTIVITY) {
      if (allergenClasses.includes(x.allergenClass) && item.classes.includes(x.itemClass)) {
        findings.push({
          level: x.level,
          rule: 'alergi-silang',
          message:
            x.level === 'block'
              ? `Diblokir: reaksi silang mungkin dengan alergi ${raw.toLowerCase()} (beta-laktam). Pilih alternatif atau isi alasan klinis.`
              : `Reaksi silang dengan alergi ${raw.toLowerCase()} rendah. Pantau reaksi pada dosis pertama.`,
        });
      }
    }
  }
  for (const r of HISTORY_RULES) {
    if (patient.flags.includes(r.flag) && item.classes.includes(r.itemClass)) {
      findings.push({ level: r.level, rule: 'riwayat', message: r.message });
    }
  }
  if (substance) {
    const others = new Set([...patient.activeMeds.map((m) => m.substance), ...otherSubstances]);
    for (const x of INTERACTIONS) {
      const partner = x.a === substance ? x.b : x.b === substance ? x.a : null;
      if (partner && others.has(partner)) {
        findings.push({
          level: x.level,
          rule: 'interaksi',
          message: `${x.level === 'block' ? 'Diblokir: interaksi' : 'Interaksi'} dengan ${partner}: ${x.message}`,
        });
      }
    }
  }
  const current = substance ? patient.activeMeds.find((m) => m.substance === substance) : undefined;
  if (current && current.catalogId !== item.id) {
    findings.push({
      level: 'warn',
      rule: 'dosis',
      message: `Dosis berubah dari obat rutin ${current.name}. Pantau respons dan efek samping 2 minggu.`,
    });
  }
  if (item.coverage === 'tidak-ditanggung' && patient.payer !== 'Umum') {
    findings.push({
      level: 'warn',
      rule: 'biaya',
      message: 'Di luar paket penjamin: biaya ditanggung pasien, perlu persetujuan pasien.',
    });
  }
  const rank: Record<CpoeCdsLevel, number> = { block: 0, warn: 1, info: 2 };
  findings.sort((a, b) => rank[a.level] - rank[b.level]);
  return (
    findings[0] ?? {
      level: 'info',
      rule: 'aman',
      message: current ? `Lanjutan obat rutin. ${item.note}` : item.note,
    }
  );
}

/** Override sah bila alasan klinis cukup panjang; temuan blok menjadi peringatan yang tercatat. */
export function validOverride(reason: string | null | undefined): reason is string {
  return (reason?.trim().length ?? 0) >= CPOE_OVERRIDE_MIN_REASON;
}

const RULE_LABEL: Record<CpoeCdsFinding['rule'], string> = {
  aman: 'CDS',
  alergi: 'alergi',
  'alergi-silang': 'alergi',
  interaksi: 'interaksi',
  riwayat: 'peringatan riwayat',
  dosis: 'dosis',
  biaya: 'biaya',
};

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

/** Tombol "Kirim order (TTE)": jumlah order draf dan alasan tertulis bila belum bisa dikirim. */
export function sendGate(lines: readonly EvaluatedLine[]): { count: number; reason: string | null } {
  const drafts = lines.filter((l) => l.status === 'draf');
  const blocked = drafts.filter((l) => l.blocked);
  if (blocked.length > 0) {
    const names = blocked.map((l) => (l.item.substance ?? l.item.name).toLowerCase()).join(', ');
    return {
      count: drafts.length,
      reason: `Belum bisa dikirim: ${blocked.length} order diblokir CDS (${names}). Ganti alternatif, hapus, atau override dengan alasan.`,
    };
  }
  if (drafts.length === 0) return { count: 0, reason: 'Belum ada order baru untuk dikirim.' };
  return { count: drafts.length, reason: null };
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
