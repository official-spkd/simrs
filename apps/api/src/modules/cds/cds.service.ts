import { Injectable, Logger } from '@nestjs/common';
import {
  AppError,
  type CdsAllergy,
  type CdsFinding,
  type CdsOrderItem,
  type CdsPatientContext,
  type CdsRule,
  type CpoeCdsFinding,
  type CpoeCoverage,
  type CpoeOrderKind,
  cdsRuleSchema,
  evaluateCdsItem,
  type ForbiddenAbbreviation,
  forbiddenAbbreviationSchema,
  type OrderLineInput,
  topCdsFinding,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

/**
 * Kode LOINC eGFR (laju filtrasi glomerulus terestimasi per 1,73 m²): CKD-EPI 2021 (98979-8), CKD-EPI (62238-1),
 * MDRD (33914-3). Nilai terakhir pasien (kelompok rekam medis) menjadi masukan aturan dosis ginjal KB (ADR-0030).
 */
export const EGFR_LOINC_CODES = ['98979-8', '62238-1', '33914-3'] as const;

/** Jendela riwayat order untuk aturan duplikasi (batas atas `windowHours` aturan KB = 720 jam). */
const DUPLICATE_LOOKBACK_HOURS = 720;

/** Item katalog yang sudah diselesaikan dari basis data untuk satu baris order. */
export type ResolvedLine =
  | {
      type: 'layanan';
      orderable: {
        id: string;
        kind: Exclude<CpoeOrderKind, 'obat'>;
        name: string;
        codeSystem: string | null;
        code: string | null;
        coverage: CpoeCoverage;
      };
    }
  | {
      type: 'obat';
      /** Obat tunggal, atau komponen racikan (≥ 2). */
      drugs: Array<{
        id: string;
        name: string;
        substance: string | null;
        classes: string[];
        codeSystem: string | null;
        code: string | null;
        coverage: CpoeCoverage;
        highAlert: boolean;
      }>;
      name: string;
    };

export interface EvaluatedFinding extends CdsFinding {
  /** Versi aturan KB yang menghasilkan temuan; null untuk aturan bawaan. */
  ruleVersion: number | null;
}

export interface EvaluatedLine {
  index: number;
  name: string;
  findings: EvaluatedFinding[];
  top: CpoeCdsFinding;
  blocked: boolean;
  overridden: boolean;
  override: string | null;
  resolved: ResolvedLine;
}

interface KbRow {
  code: string;
  version: number;
  status: string;
  definition: unknown;
}

const PAYER_KIND: Readonly<Record<string, CdsPatientContext['payer']>> = {
  bpjs: 'BPJS',
  umum: 'Umum',
  asuransi: 'Asuransi',
  perusahaan: 'Asuransi',
};

/** Token riwayat dari diagnosis ICD-10 aktif: kategori (`icd10-n18`) dan kode lengkap tanpa titik (`icd10-n183`). */
export function conditionFlags(codes: readonly string[]): string[] {
  const out = new Set<string>();
  for (const code of codes) {
    const c = code.toLowerCase();
    out.add(`icd10-${c.split('.')[0]}`);
    out.add(`icd10-${c.replace('.', '')}`);
  }
  return [...out];
}

/**
 * K09 · CDS server (ADR-0030): satu-satunya tempat API mengevaluasi order. Mesin aturan murni `evaluateCdsItem`
 * (@simrs/shared, sama dengan pratinjau web) + basis pengetahuan per RS (`cds_rules`, versi tertinggi per kode yang
 * aktif) + daftar singkatan terlarang RS + konteks pasien dari rekam medis (kelompok RM, ADR-0016): alergi terkode,
 * obat aktif, diagnosis aktif, eGFR terakhir, order 30 hari terakhir (duplikasi), dan penjamin kunjungan. Tidak
 * menyimpan apa pun; pemanggil (pratinjau atau kirim order) yang mencatat `cds_alerts`.
 */
@Injectable()
export class CdsService {
  private readonly log = new Logger(CdsService.name);

  constructor(private readonly db: TenantDb) {}

  /** KB aktif RS: versi tertinggi per kode, hanya yang berstatus aktif. KB rusak → gagal tertutup (500). */
  async knowledgeBase(): Promise<{ rules: CdsRule[]; versions: Map<string, number> }> {
    const rows = await this.db.tx().$queryRaw<KbRow[]>`
      SELECT DISTINCT ON (code) code, version, status, definition
      FROM cds_rules ORDER BY code, version DESC`;
    const rules: CdsRule[] = [];
    const versions = new Map<string, number>();
    for (const row of rows) {
      if (row.status !== 'aktif') continue;
      const parsed = cdsRuleSchema.safeParse({ code: row.code, definition: row.definition });
      if (!parsed.success) {
        // Definisi divalidasi saat impor; bila tetap rusak, order tidak boleh lolos tanpa pemeriksaan.
        this.log.error({ ruleCode: row.code, version: row.version }, 'Aturan CDS tidak valid di basis data');
        throw new AppError(
          'INTERNAL_ERROR',
          'Basis pengetahuan CDS RS tidak valid; order ditahan sampai komite farmasi memperbaikinya',
          500,
        );
      }
      rules.push(parsed.data);
      versions.set(row.code, row.version);
    }
    return { rules, versions };
  }

  async abbreviations(): Promise<ForbiddenAbbreviation[]> {
    const rows = await this.db.tx().abbreviation.findMany({
      where: { active: true },
      select: { kind: true, term: true, suggestion: true },
    });
    return rows.flatMap((r) => {
      const p = forbiddenAbbreviationSchema.safeParse(r);
      return p.success ? [p.data] : [];
    });
  }

  /** Konteks pasien untuk CDS dari rekam medis (kelompok RM gabungan) + penjamin kunjungan. */
  async patientContext(encounterId: string, patientId: string): Promise<CdsPatientContext> {
    const tx = this.db.tx();
    const group = (
      await tx.$queryRaw<Array<{ id: string }>>`SELECT app_patient_group(${patientId}::uuid)::text AS id`
    ).map((r) => r.id);
    const ids = group.length > 0 ? group : [patientId];
    const [allergies, meds, conditions, egfr, recent, coverage] = await Promise.all([
      tx.$queryRaw<
        Array<{ text: string | null; code: string | null; name: string | null; classes: string[] | null }>
      >`
        SELECT a.text, s.code, s.name, s.classes
        FROM allergy_intolerances_current a
        LEFT JOIN drug_substances s ON s.tenant_id = a.tenant_id AND s.id = a.substance_id
        WHERE a.patient_id = ANY(${ids}::uuid[]) AND a.status = 'final' AND a.kind = 'alergi'`,
      tx.$queryRaw<
        Array<{ name: string; drug_id: string; substance: string | null; classes: string[] | null }>
      >`
        SELECT d.name, d.id::text AS drug_id, s.code AS substance, s.classes
        FROM medication_requests m
        JOIN LATERAL (
          SELECT e.status FROM order_status_events e
          WHERE e.tenant_id = m.tenant_id AND e.medication_request_id = m.id
          ORDER BY e.changed_at DESC, e.id DESC LIMIT 1) st ON true
        JOIN drugs d ON d.tenant_id = m.tenant_id
          AND (d.id = m.drug_id OR d.id::text IN (
            SELECT c->>'drugId' FROM jsonb_array_elements(coalesce(m.compound->'components', '[]'::jsonb)) c))
        LEFT JOIN drug_substances s ON s.tenant_id = d.tenant_id AND s.id = d.substance_id
        WHERE m.patient_id = ANY(${ids}::uuid[]) AND st.status = 'aktif'`,
      tx.$queryRaw<Array<{ code: string }>>`
        SELECT c.code FROM conditions_current c
        WHERE c.patient_id = ANY(${ids}::uuid[]) AND c.status = 'final' AND c.clinical_status = 'active'`,
      tx.$queryRaw<Array<{ value: number | null }>>`
        SELECT o.value_numeric::float8 AS value FROM observations_current o
        WHERE o.patient_id = ANY(${ids}::uuid[]) AND o.status = 'final' AND o.code_system = 'loinc'
          AND o.code = ANY(${[...EGFR_LOINC_CODES]}::text[]) AND o.value_numeric IS NOT NULL
        ORDER BY o.occurred_at DESC LIMIT 1`,
      tx.$queryRaw<Array<{ item_id: string; kind: string; ordered_at: Date }>>`
        SELECT r.orderable_id::text AS item_id, o.kind, g.ordered_at
        FROM service_requests r
        JOIN order_groups g ON g.tenant_id = r.tenant_id AND g.id = r.order_group_id
        JOIN orderables o ON o.tenant_id = r.tenant_id AND o.id = r.orderable_id
        JOIN LATERAL (
          SELECT e.status FROM order_status_events e
          WHERE e.tenant_id = r.tenant_id AND e.service_request_id = r.id
          ORDER BY e.changed_at DESC, e.id DESC LIMIT 1) st ON true
        WHERE r.patient_id = ANY(${ids}::uuid[]) AND st.status <> 'dibatalkan'
          AND g.ordered_at > now() - make_interval(hours => ${DUPLICATE_LOOKBACK_HOURS})
        UNION ALL
        SELECT m.drug_id::text, 'obat', g.ordered_at
        FROM medication_requests m
        JOIN order_groups g ON g.tenant_id = m.tenant_id AND g.id = m.order_group_id
        JOIN LATERAL (
          SELECT e.status FROM order_status_events e
          WHERE e.tenant_id = m.tenant_id AND e.medication_request_id = m.id
          ORDER BY e.changed_at DESC, e.id DESC LIMIT 1) st ON true
        WHERE m.patient_id = ANY(${ids}::uuid[]) AND m.drug_id IS NOT NULL AND st.status <> 'dibatalkan'
          AND g.ordered_at > now() - make_interval(hours => ${DUPLICATE_LOOKBACK_HOURS})`,
      tx.coverage.findFirst({
        where: { encounterId, status: 'active' },
        orderBy: { priority: 'asc' },
        select: { payer: { select: { kind: true } } },
      }),
    ]);
    const cdsAllergies: CdsAllergy[] = allergies.map((a) => ({
      label: a.name ?? a.text ?? 'alergi tercatat',
      substance: a.code,
      classes: a.classes ?? [],
    }));
    return {
      allergies: cdsAllergies,
      activeMeds: meds.map((m) => ({
        name: m.name,
        substance: m.substance ?? m.name.toLowerCase(),
        classes: m.classes ?? [],
        itemId: m.drug_id,
      })),
      flags: conditionFlags(conditions.map((c) => c.code)),
      egfr: egfr[0]?.value ?? null,
      payer: coverage ? (PAYER_KIND[coverage.payer.kind] ?? null) : null,
      recentOrders: recent.map((r) => ({
        itemId: r.item_id,
        kind: r.kind as CpoeOrderKind,
        orderedAt: r.ordered_at.toISOString(),
      })),
    };
  }

  /** Selesaikan baris masukan ke item katalog aktif RS; item tak dikenal/nonaktif → 422. */
  async resolve(items: readonly OrderLineInput[]): Promise<ResolvedLine[]> {
    const tx = this.db.tx();
    const orderableIds = items.flatMap((l) => (l.type === 'layanan' ? [l.orderableId] : []));
    const drugIds = items.flatMap((l) =>
      l.type === 'obat' ? (l.drugId ? [l.drugId] : (l.compound?.components.map((c) => c.drugId) ?? [])) : [],
    );
    const [orderables, drugs] = await Promise.all([
      tx.orderable.findMany({
        where: { id: { in: orderableIds }, active: true },
        select: { id: true, kind: true, name: true, codeSystem: true, code: true, coverage: true },
      }),
      tx.drug.findMany({
        where: { id: { in: drugIds }, active: true },
        select: {
          id: true,
          name: true,
          codeSystem: true,
          code: true,
          coverage: true,
          highAlert: true,
          substance: { select: { code: true, classes: true } },
        },
      }),
    ]);
    const orderableById = new Map(orderables.map((o) => [o.id, o]));
    const drugById = new Map(drugs.map((d) => [d.id, d]));
    const unknown = (i: number) =>
      new AppError('VALIDATION_FAILED', `Item order baris ${i + 1} tidak dikenal atau nonaktif`, 422, {
        line: i,
      });
    return items.map((line, i): ResolvedLine => {
      if (line.type === 'layanan') {
        const o = orderableById.get(line.orderableId);
        if (!o) throw unknown(i);
        return {
          type: 'layanan',
          orderable: {
            id: o.id,
            kind: o.kind as Exclude<CpoeOrderKind, 'obat'>,
            name: o.name,
            codeSystem: o.codeSystem,
            code: o.code,
            coverage: o.coverage as CpoeCoverage,
          },
        };
      }
      const ids = line.drugId ? [line.drugId] : (line.compound?.components.map((c) => c.drugId) ?? []);
      const resolved = ids.map((id) => {
        const d = drugById.get(id);
        if (!d) throw unknown(i);
        return {
          id: d.id,
          name: d.name,
          substance: d.substance?.code ?? null,
          classes: d.substance?.classes ?? [],
          codeSystem: d.codeSystem,
          code: d.code,
          coverage: d.coverage as CpoeCoverage,
          highAlert: d.highAlert,
        };
      });
      return {
        type: 'obat',
        drugs: resolved,
        name: line.compound ? line.compound.name : (resolved[0]?.name ?? 'Obat'),
      };
    });
  }

  /**
   * Evaluasi semua baris kiriman terhadap pasien, KB RS, singkatan terlarang, dan baris lain di kiriman yang sama
   * (interaksi antar-order). Racikan dievaluasi per komponen. Temuan `block` lolos hanya dengan alasan override sah
   * (skema masukan: ≥ 10 karakter).
   */
  async evaluate(
    encounter: { id: string; patientId: string },
    items: readonly OrderLineInput[],
  ): Promise<{ lines: EvaluatedLine[]; patient: CdsPatientContext }> {
    const resolved = await this.resolve(items);
    const [patient, kb, abbreviations] = await Promise.all([
      this.patientContext(encounter.id, encounter.patientId),
      this.knowledgeBase(),
      this.abbreviations(),
    ]);
    const cdsItems = resolved.map((r, i): CdsOrderItem[] => {
      const line = items[i] as OrderLineInput;
      if (r.type === 'layanan') {
        return [
          {
            id: r.orderable.id,
            name: r.orderable.name,
            kind: r.orderable.kind,
            substance: null,
            classes: [],
            coverage: r.orderable.coverage,
            instructions: line.instructions,
          },
        ];
      }
      const text = line.type === 'obat' ? [line.dose, line.instructions].filter(Boolean).join(' ') : null;
      return r.drugs.map((d, k) => ({
        id: d.id,
        name: r.drugs.length > 1 ? `${r.name} · ${d.name}` : d.name,
        kind: 'obat' as const,
        substance: d.substance,
        classes: d.classes,
        coverage: d.coverage,
        // Singkatan diperiksa sekali per baris.
        instructions: k === 0 ? text : null,
      }));
    });
    const lines = resolved.map((r, i): EvaluatedLine => {
      const line = items[i] as OrderLineInput;
      const others = cdsItems
        .filter((_, j) => j !== i)
        .flat()
        .map((x) => ({ substance: x.substance, classes: x.classes }));
      const seen = new Set<string>();
      const findings: EvaluatedFinding[] = [];
      for (const item of cdsItems[i] ?? []) {
        for (const f of evaluateCdsItem(item, patient, kb.rules, { others, abbreviations })) {
          const key = `${f.ruleCode}|${f.message}`;
          if (seen.has(key)) continue;
          seen.add(key);
          findings.push({ ...f, ruleVersion: kb.versions.get(f.ruleCode) ?? null });
        }
      }
      const rank = { block: 0, warn: 1, info: 2 } as const;
      findings.sort((a, b) => rank[a.level] - rank[b.level]);
      const hasBlock = findings.some((f) => f.level === 'block');
      const override = line.override ?? null;
      const name = r.type === 'layanan' ? r.orderable.name : r.name;
      const continuation =
        r.type === 'obat' &&
        r.drugs.length === 1 &&
        patient.activeMeds.some((m) => m.itemId === r.drugs[0]?.id);
      return {
        index: i,
        name,
        findings,
        top: topCdsFinding(findings, { note: 'Tidak ada temuan CDS.', continuation }),
        blocked: hasBlock && !override,
        overridden: hasBlock && Boolean(override),
        override,
        resolved: r,
      };
    });
    return { lines, patient };
  }
}
