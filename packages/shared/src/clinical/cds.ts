import { z } from 'zod';
import {
  CPOE_CDS_LEVELS,
  CPOE_ORDER_KINDS,
  type CpoeCdsFinding,
  type CpoeCdsLevel,
  type CpoeCdsRule,
  type CpoeCoverage,
  type CpoeOrderKind,
} from '../schemas/klinis';
import { type ForbiddenAbbreviation, findForbiddenAbbreviations } from './abbreviations';

/**
 * K09 · Clinical decision support CPOE (aturan murni). Basis pengetahuan (KB) adalah DATA per RS (`cds_rules`, berversi,
 * dikelola komite farmasi/PFT, keputusan fase 3 no. 10), bukan kode: mesin ini hanya menafsirkan jenis aturan yang
 * dikenal. API memakainya sebagai sumber kebenaran saat evaluasi dan kirim order (evaluasi ulang di server); web memakai
 * KB contoh yang sama untuk pratinjau dan mode presentasi. Gerbang keselamatan CLAUDE.md §4.9: temuan `block` menahan
 * pengiriman sampai item diganti/dihapus atau di-override dengan alasan klinis tertulis (≥ `CPOE_OVERRIDE_MIN_REASON`).
 *
 * Aturan bawaan (tanpa KB, selalu aktif): alergi zat sama, alergi golongan sama, perubahan dosis obat rutin, item di luar
 * paket penjamin, singkatan terlarang di aturan pakai/instruksi.
 */

/** Token zat/golongan: huruf kecil, angka, spasi, strip (`asam mefenamat`, `sefalosporin-1`). */
const token = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9 -]{0,59}$/, 'Huruf kecil, angka, spasi, atau strip');
const level = z.enum(CPOE_CDS_LEVELS);
const message = z.string().trim().min(10).max(300);

/** Sasaran aturan: satu zat aktif atau satu golongan obat. */
export const cdsTargetSchema = z.union([
  z.strictObject({ substance: token }),
  z.strictObject({ class: token }),
]);
export type CdsTarget = z.infer<typeof cdsTargetSchema>;

/** Jenis aturan KB yang dikenal mesin. Menambah jenis = perubahan kode + ADR-0030; isi aturan = data RS. */
export const CDS_RULE_KINDS = ['cross_reactivity', 'interaction', 'history', 'renal', 'duplicate'] as const;
export type CdsRuleKind = (typeof CDS_RULE_KINDS)[number];

export const cdsRuleDefinitionSchema = z.discriminatedUnion('kind', [
  /** Alergi golongan A → reaksi silang dengan golongan B. */
  z.strictObject({
    kind: z.literal('cross_reactivity'),
    allergenClass: token,
    itemClass: token,
    level,
    message: message.optional(),
  }),
  /** Interaksi obat–obat (urutan a/b tidak penting) terhadap obat rutin dan order lain di kiriman yang sama. */
  z.strictObject({ kind: z.literal('interaction'), a: cdsTargetSchema, b: cdsTargetSchema, level, message }),
  /** Riwayat/problem pasien (flag, mis. `hipoglikemia-berat`, `ckd`) × golongan obat. */
  z.strictObject({ kind: z.literal('history'), flag: token, itemClass: token, level, message }),
  /** Dosis ginjal: obat/golongan dengan eGFR pasien di bawah ambang (mL/menit/1,73 m²). */
  z.strictObject({
    kind: z.literal('renal'),
    target: cdsTargetSchema,
    egfrBelow: z.int().min(5).max(120),
    level,
    message,
  }),
  /** Duplikasi order sejenis (item katalog sama) dalam jendela waktu. */
  z.strictObject({
    kind: z.literal('duplicate'),
    orderKind: z.enum(CPOE_ORDER_KINDS),
    windowHours: z.int().min(1).max(720),
    level,
    message: message.optional(),
  }),
]);
export type CdsRuleDefinition = z.infer<typeof cdsRuleDefinitionSchema>;

/** Satu aturan KB RS: kode stabil (rujukan `cds_alerts`) + definisi. */
export const cdsRuleSchema = z.strictObject({
  code: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/, 'Kode aturan: huruf kecil, angka, strip'),
  definition: cdsRuleDefinitionSchema,
});
export type CdsRule = z.infer<typeof cdsRuleSchema>;

/** Kode aturan bawaan (bukan dari KB) di temuan dan `cds_alerts.rule_code`. */
export const CDS_BUILTIN_RULES = {
  alergi: 'bawaan:alergi-zat',
  alergiGolongan: 'bawaan:alergi-golongan',
  dosis: 'bawaan:dosis-obat-rutin',
  biaya: 'bawaan:di-luar-paket',
  singkatan: 'bawaan:singkatan-terlarang',
} as const;

export interface CdsFinding extends CpoeCdsFinding {
  /** Kode aturan KB, atau `bawaan:*`. */
  ruleCode: string;
}

/** Alergi pasien: zat terkode (dengan golongannya) atau teks bebas (dicocokkan dengan nama zat). */
export interface CdsAllergy {
  label: string;
  substance: string | null;
  classes: readonly string[];
}

export interface CdsPatientContext {
  allergies: readonly CdsAllergy[];
  /** Obat rutin/aktif pasien. `itemId` = item katalog yang sama persis (lanjutan); lain = perubahan dosis. */
  activeMeds: ReadonlyArray<{
    name: string;
    substance: string;
    classes?: readonly string[];
    itemId: string | null;
  }>;
  /** Flag riwayat/problem (kode token). */
  flags: readonly string[];
  egfr: number | null;
  /** Penjamin; null = belum diketahui (temuan biaya dilewati). */
  payer: 'BPJS' | 'Umum' | 'Asuransi' | null;
  /** Order sebelumnya (untuk duplikasi) beserta waktu order. */
  recentOrders?: ReadonlyArray<{ itemId: string; kind: CpoeOrderKind; orderedAt: string }>;
}

export interface CdsOrderItem {
  id: string;
  name: string;
  kind: CpoeOrderKind;
  substance: string | null;
  classes: readonly string[];
  coverage: CpoeCoverage;
  /** Aturan pakai/instruksi bebas (diperiksa singkatan terlarang). */
  instructions?: string | null;
}

export interface CdsOptions {
  /** Item lain di kiriman yang sama (interaksi antar-order). */
  others?: ReadonlyArray<{ substance: string | null; classes?: readonly string[] }>;
  abbreviations?: readonly ForbiddenAbbreviation[];
  /** Waktu evaluasi (duplikasi); bawaan sekarang. */
  now?: Date | string;
}

const RANK: Record<CpoeCdsLevel, number> = { block: 0, warn: 1, info: 2 };

/** "Kotrimoksazol (sulfa)" → "kotrimoksazol". */
export function normalizeAllergen(allergy: string): string {
  return allergy
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .trim();
}

const targetMatches = (t: CdsTarget, x: { substance: string | null; classes?: readonly string[] }) =>
  'substance' in t ? x.substance === t.substance : (x.classes ?? []).includes(t.class);

const targetLabel = (t: CdsTarget, x: { substance: string | null }) =>
  x.substance ?? ('class' in t ? t.class : t.substance);

/**
 * Semua temuan satu item terhadap pasien, KB, dan item lain, urut paling berat dulu (blok → peringatan → info).
 * Temuan di sini dicatat lengkap ke `cds_alerts`; layar menampilkan yang teratas (`topCdsFinding`).
 */
export function evaluateCdsItem(
  item: CdsOrderItem,
  patient: CdsPatientContext,
  rules: readonly CdsRule[],
  opts: CdsOptions = {},
): CdsFinding[] {
  const findings: CdsFinding[] = [];
  const substance = item.substance?.toLowerCase() ?? null;
  const defs = rules.map((r) => ({ code: r.code, d: r.definition }));

  for (const allergy of patient.allergies) {
    const allergen = allergy.substance ?? normalizeAllergen(allergy.label);
    const raw = allergy.label.toLowerCase();
    if (substance && substance === allergen) {
      findings.push({
        level: 'block',
        rule: 'alergi',
        ruleCode: CDS_BUILTIN_RULES.alergi,
        message: `Diblokir: pasien alergi ${raw}. Pilih alternatif atau isi alasan klinis.`,
      });
      continue;
    }
    if (substance && item.classes.some((c) => allergy.classes.includes(c))) {
      findings.push({
        level: 'block',
        rule: 'alergi',
        ruleCode: CDS_BUILTIN_RULES.alergiGolongan,
        message: `Diblokir: ${item.name} satu golongan dengan alergi ${raw}. Pilih alternatif atau isi alasan klinis.`,
      });
    }
    for (const { code, d } of defs) {
      if (d.kind !== 'cross_reactivity') continue;
      if (allergy.classes.includes(d.allergenClass) && item.classes.includes(d.itemClass)) {
        findings.push({
          level: d.level,
          rule: 'alergi-silang',
          ruleCode: code,
          message:
            d.message ??
            (d.level === 'block'
              ? `Diblokir: reaksi silang mungkin dengan alergi ${raw} (beta-laktam). Pilih alternatif atau isi alasan klinis.`
              : `Reaksi silang dengan alergi ${raw} rendah. Pantau reaksi pada dosis pertama.`),
        });
      }
    }
  }

  for (const { code, d } of defs) {
    if (d.kind === 'history' && patient.flags.includes(d.flag) && item.classes.includes(d.itemClass)) {
      findings.push({ level: d.level, rule: 'riwayat', ruleCode: code, message: d.message });
    }
  }

  if (substance) {
    const self = { substance, classes: item.classes };
    const others = [
      ...patient.activeMeds.map((m) => ({ substance: m.substance, classes: m.classes ?? [] })),
      ...(opts.others ?? []).map((o) => ({
        substance: o.substance?.toLowerCase() ?? null,
        classes: o.classes ?? [],
      })),
    ];
    for (const { code, d } of defs) {
      if (d.kind !== 'interaction') continue;
      const pairs: Array<[CdsTarget, CdsTarget]> = [
        [d.a, d.b],
        [d.b, d.a],
      ];
      for (const [mine, theirs] of pairs) {
        if (!targetMatches(mine, self)) continue;
        const partner = others.find((o) => targetMatches(theirs, o));
        if (!partner) continue;
        findings.push({
          level: d.level,
          rule: 'interaksi',
          ruleCode: code,
          message: `${d.level === 'block' ? 'Diblokir: interaksi' : 'Interaksi'} dengan ${targetLabel(theirs, partner)}: ${d.message}`,
        });
        break;
      }
    }
    for (const { code, d } of defs) {
      if (
        d.kind === 'renal' &&
        patient.egfr !== null &&
        patient.egfr < d.egfrBelow &&
        targetMatches(d.target, self)
      ) {
        findings.push({
          level: d.level,
          rule: 'ginjal',
          ruleCode: code,
          message: `eGFR ${patient.egfr} (< ${d.egfrBelow}): ${d.message}`,
        });
      }
    }
  }

  const now = new Date(opts.now ?? Date.now()).getTime();
  for (const { code, d } of defs) {
    if (d.kind !== 'duplicate' || d.orderKind !== item.kind) continue;
    const prior = (patient.recentOrders ?? []).find(
      (o) =>
        o.itemId === item.id &&
        o.kind === item.kind &&
        now - new Date(o.orderedAt).getTime() <= d.windowHours * 3_600_000,
    );
    if (prior) {
      findings.push({
        level: d.level,
        rule: 'duplikasi',
        ruleCode: code,
        message:
          d.message ??
          `${item.name} sudah diorder dalam ${d.windowHours} jam terakhir. Pastikan tidak ganda.`,
      });
    }
  }

  const current = substance ? patient.activeMeds.find((m) => m.substance === substance) : undefined;
  if (current && current.itemId !== item.id) {
    findings.push({
      level: 'warn',
      rule: 'dosis',
      ruleCode: CDS_BUILTIN_RULES.dosis,
      message: `Dosis berubah dari obat rutin ${current.name}. Pantau respons dan efek samping 2 minggu.`,
    });
  }
  if (item.coverage === 'tidak-ditanggung' && patient.payer !== null && patient.payer !== 'Umum') {
    findings.push({
      level: 'warn',
      rule: 'biaya',
      ruleCode: CDS_BUILTIN_RULES.biaya,
      message: 'Di luar paket penjamin: biaya ditanggung pasien, perlu persetujuan pasien.',
    });
  }
  if (item.instructions && opts.abbreviations?.length) {
    for (const m of findForbiddenAbbreviations(item.instructions, opts.abbreviations)) {
      findings.push({
        level: 'warn',
        rule: 'singkatan',
        ruleCode: CDS_BUILTIN_RULES.singkatan,
        message: `Singkatan terlarang "${m.found}": ${m.suggestion}`,
      });
    }
  }
  // Urutan stabil: tingkat, lalu urutan aturan di atas (alergi → riwayat → interaksi → …).
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => RANK[a.f.level] - RANK[b.f.level] || a.i - b.i)
    .map(({ f }) => f);
}

/**
 * Temuan yang ditampilkan untuk satu item: yang paling berat, atau info "aman" berisi catatan katalog (lanjutan obat
 * rutin diberi awalan).
 */
export function topCdsFinding(
  findings: readonly CdsFinding[],
  safe: { note: string; continuation: boolean },
): CpoeCdsFinding {
  const top = findings[0];
  if (top) return { level: top.level, rule: top.rule, message: top.message };
  return {
    level: 'info',
    rule: 'aman',
    message: safe.continuation ? `Lanjutan obat rutin. ${safe.note}` : safe.note,
  };
}

/** Item masih diblokir: ada temuan `block`. */
export function cdsBlocked(findings: readonly CdsFinding[]): boolean {
  return findings.some((f) => f.level === 'block');
}

/** Kategori temuan yang ditampilkan di label override (`Override <label> oleh …`). */
export const CDS_RULE_LABEL: Readonly<Record<CpoeCdsRule, string>> = {
  aman: 'CDS',
  alergi: 'alergi',
  'alergi-silang': 'alergi',
  interaksi: 'interaksi',
  riwayat: 'peringatan riwayat',
  dosis: 'dosis',
  biaya: 'biaya',
  ginjal: 'dosis ginjal',
  duplikasi: 'duplikasi',
  singkatan: 'singkatan',
};

// ---------------------------------------------------------------------------------------------------------------
// KB contoh (seed RS dan mode presentasi). Bukan basis pengetahuan klinis tervalidasi (rencana §5).
// ---------------------------------------------------------------------------------------------------------------

/** Golongan zat untuk alergi tercatat (dasar alergi golongan dan reaksi silang); di DB: `drug_substances.classes`. */
export const SAMPLE_SUBSTANCE_CLASSES: Readonly<Record<string, readonly string[]>> = {
  amoksisilin: ['penisilin'],
  ampisilin: ['penisilin'],
  ibuprofen: ['ains'],
  'asam mefenamat': ['ains'],
  kotrimoksazol: ['sulfonamid'],
};

/** KB CDS contoh (rencana 3.0c: seed per RS). */
export const SAMPLE_CDS_RULES: readonly CdsRule[] = [
  {
    code: 'alergi-silang-penisilin-sefalosporin-1',
    definition: {
      kind: 'cross_reactivity',
      allergenClass: 'penisilin',
      itemClass: 'sefalosporin-1',
      level: 'block',
    },
  },
  {
    code: 'alergi-silang-penisilin-sefalosporin-3',
    definition: {
      kind: 'cross_reactivity',
      allergenClass: 'penisilin',
      itemClass: 'sefalosporin-3',
      level: 'warn',
    },
  },
  {
    code: 'interaksi-klopidogrel-omeprazol',
    definition: {
      kind: 'interaction',
      a: { substance: 'klopidogrel' },
      b: { substance: 'omeprazol' },
      level: 'block',
      message:
        'omeprazol menurunkan efek antiplatelet klopidogrel. Ganti PPI ke pantoprazol atau isi alasan klinis.',
    },
  },
  {
    code: 'interaksi-glimepirid-metformin',
    definition: {
      kind: 'interaction',
      a: { substance: 'glimepirid' },
      b: { substance: 'metformin' },
      level: 'warn',
      message: 'kombinasi dengan metformin meningkatkan risiko hipoglikemia. Edukasi pasien.',
    },
  },
  {
    code: 'riwayat-hipoglikemia-sulfonilurea',
    definition: {
      kind: 'history',
      flag: 'hipoglikemia-berat',
      itemClass: 'sulfonilurea',
      level: 'block',
      message:
        'Diblokir: sulfonilurea pada pasien dengan riwayat hipoglikemia berat (risiko hipoglikemia berulang). Hapus atau isi alasan klinis.',
    },
  },
  {
    code: 'riwayat-ckd-ains',
    definition: {
      kind: 'history',
      flag: 'ckd',
      itemClass: 'ains',
      level: 'warn',
      message:
        'AINS pada penyakit ginjal kronik: risiko perburukan fungsi ginjal. Pertimbangkan parasetamol.',
    },
  },
  {
    code: 'ginjal-metformin-egfr-30',
    definition: {
      kind: 'renal',
      target: { substance: 'metformin' },
      egfrBelow: 30,
      level: 'block',
      message: 'metformin dikontraindikasikan (risiko asidosis laktat). Hentikan atau isi alasan klinis.',
    },
  },
  {
    code: 'duplikasi-lab-24-jam',
    definition: { kind: 'duplicate', orderKind: 'lab', windowHours: 24, level: 'warn' },
  },
];
