import { Injectable } from '@nestjs/common';
import type { Prisma } from '@simrs/db';
import {
  allFields,
  AppError,
  type ClinicalEntryMeta,
  CONSENT_INFORMATION_ITEMS,
  CONSENT_INFORMATION_KEYS,
  CONSENT_WITNESS_VALID_MINUTES,
  type ConsentCreateInput,
  type ConsentDecision,
  type ConsentRecord,
  type ConsentRevokeInput,
  type ConsentSignatureInput,
  type ConsentTemplate,
  type ConsentWitnessInput,
  type FormAnswers,
  type FormSchema,
  formSchemaSchema,
  formatTanggalWaktu,
  newId,
  validateAnswers,
} from '@simrs/shared';
import { type ClinicalEncounter, clinicalEncounter } from '../../infra/clinical/clinical-context';
import { ClinicalRecordService, type ClinicalRowLike } from '../../infra/clinical/clinical-record.service';
import { ClinicalSigningService } from '../../infra/clinical/clinical-signing.service';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';

/** Jenis draf klinis tempat atestasi saksi petugas disimpan sampai dipakai (dibuang setelah dipakai). */
export const CONSENT_WITNESS_DRAFT_KIND = 'consent_witness';

const CURRENT = { supersededBy: { none: {} } } as const;

type ConsentRow = ClinicalRowLike & {
  patientId: string;
  encounterId: string;
  procedure: string;
  decision: string;
  refusalReason: string | null;
  information: Prisma.JsonValue;
  informerUserId: string;
  explainedAt: Date;
  formDefinition: { code: string } | null;
  signatures: Array<{
    signerKind: string;
    signerName: string;
    relation: string | null;
    method: string;
    imageDocumentId: string | null;
    staffUserId: string | null;
    signedAt: Date;
  }>;
};

const CONSENT_SELECT = {
  id: true,
  rootId: true,
  version: true,
  supersedesId: true,
  addendumOf: true,
  status: true,
  correctionReason: true,
  occurredAt: true,
  recordedAt: true,
  authorUserId: true,
  authorRole: true,
  patientId: true,
  encounterId: true,
  procedure: true,
  decision: true,
  refusalReason: true,
  information: true,
  informerUserId: true,
  explainedAt: true,
  formDefinition: { select: { code: true } },
  signatures: {
    orderBy: { signedAt: 'asc' },
    select: {
      signerKind: true,
      signerName: true,
      relation: true,
      method: true,
      imageDocumentId: true,
      staffUserId: true,
      signedAt: true,
    },
  },
} as const;

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

const TITLE: Record<ConsentDecision, string> = {
  setuju: 'Persetujuan tindakan kedokteran',
  tolak: 'Penolakan tindakan kedokteran',
  dicabut: 'Pencabutan persetujuan tindakan kedokteran',
};
const STATEMENT: Record<ConsentDecision, string> = {
  setuju:
    'Saya telah menerima dan memahami penjelasan di atas, termasuk kesempatan bertanya, dan dengan ini MENYETUJUI tindakan tersebut.',
  tolak:
    'Saya telah menerima dan memahami penjelasan di atas beserta akibat penolakan, dan dengan ini MENOLAK tindakan tersebut.',
  dicabut:
    'Saya mencabut persetujuan yang telah saya berikan sebelumnya atas tindakan tersebut dan memahami akibatnya.',
};

/**
 * K11 · Persetujuan/penolakan tindakan di tablet (rencana fase 3 §3.7, keputusan no. 2 dan 20):
 * - draf pengisian = draf klinis (`/drafts/:encounterId/consent…`), bukan rekam medis;
 * - saksi petugas beratestasi dengan sesinya sendiri (`attestWitness`, berlaku 30 menit, sekali pakai);
 * - final (`consent.sign`, hanya dokter) = baris `consents` + tanda tangan + PDF + TTE dokter pemberi penjelasan
 *   (`ClinicalSigningService`, versi itu langsung terkunci `RECORD_LOCKED`);
 * - tujuh butir informasi wajib diambil dari templat P07 yang terbit (isian divalidasi skema templat);
 * - penolakan wajib alasan ≥ 10 dan juga ber-PDF + TTE;
 * - pencabutan = addendum `dicabut` atas persetujuan final, ber-PDF + TTE.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly db: TenantDb,
    private readonly records: ClinicalRecordService,
    private readonly access: PatientAccessService,
    private readonly signing: ClinicalSigningService,
    private readonly events: DomainEvents,
  ) {}

  /** Templat persetujuan = formulir P07 terbit (versi terakhir per kode) yang memuat ketujuh butir informasi. */
  async templates(): Promise<ConsentTemplate[]> {
    const rows = await this.db.tx().formDefinition.findMany({
      where: { status: 'published' },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
      select: { code: true, title: true, version: true, schema: true },
    });
    const seen = new Set<string>();
    const out: ConsentTemplate[] = [];
    for (const r of rows) {
      if (seen.has(r.code)) continue;
      seen.add(r.code);
      const schema = formSchemaSchema.safeParse(r.schema);
      if (!schema.success || !isConsentTemplate(schema.data)) continue;
      out.push({
        code: r.code,
        title: r.title,
        version: r.version,
        items: CONSENT_INFORMATION_ITEMS.map((i) => ({
          key: i.key,
          label: allFields(schema.data).find((f) => f.key === i.key)?.label || i.label,
        })),
      });
    }
    return out;
  }

  /** Atestasi saksi petugas: sesi petugas itu sendiri menyatakan hadir saat penjelasan (berlaku 30 menit). */
  async attestWitness(encounterId: string, input: ConsentWitnessInput) {
    const { userId } = this.records.author();
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'write');
    const tenantId = this.db.tenantId();
    const content = { procedure: input.procedure } as Prisma.InputJsonValue;
    const row = await this.db.tx().clinicalDraft.upsert({
      where: {
        tenantId_encounterId_kind_authorUserId: {
          tenantId,
          encounterId: enc.id,
          kind: CONSENT_WITNESS_DRAFT_KIND,
          authorUserId: userId,
        },
      },
      update: { content },
      create: {
        id: newId(),
        tenantId,
        encounterId: enc.id,
        patientId: enc.patientId,
        authorUserId: userId,
        kind: CONSENT_WITNESS_DRAFT_KIND,
        content,
      },
    });
    this.db.audit({
      action: 'create',
      resourceType: 'consent_witness',
      resourceId: row.id,
      patientId: enc.patientId,
    });
    return {
      witnessUserId: userId,
      procedure: input.procedure,
      attestedAt: row.updatedAt.toISOString(),
      expiresAt: new Date(row.updatedAt.getTime() + CONSENT_WITNESS_VALID_MINUTES * 60_000).toISOString(),
    };
  }

  async create(input: ConsentCreateInput): Promise<ConsentRecord> {
    const me = this.records.author();
    const enc = await clinicalEncounter(this.db, this.access, input.encounterId, 'write');
    const tx = this.db.tx();
    const template = await tx.formDefinition.findFirst({
      where: { code: input.templateCode, status: 'published' },
      orderBy: { version: 'desc' },
      select: { id: true, schema: true },
    });
    const schema = template ? formSchemaSchema.safeParse(template.schema) : null;
    if (!template || !schema?.success || !isConsentTemplate(schema.data)) {
      throw new AppError('NOT_FOUND', 'Templat persetujuan tidak ditemukan atau belum terbit', 404);
    }
    const errors = validateAnswers(schema.data, input.information as FormAnswers);
    const missing = CONSENT_INFORMATION_KEYS.filter((k) => !input.information[k]?.trim());
    if (Object.keys(errors).length > 0 || missing.length > 0) {
      throw new AppError('VALIDATION_FAILED', 'Ketujuh butir informasi wajib diisi', 422, {
        fields: { ...errors, ...Object.fromEntries(missing.map((k) => [k, 'Wajib diisi'])) },
      });
    }
    const information = CONSENT_INFORMATION_ITEMS.map((i) => ({
      key: i.key,
      title: allFields(schema.data).find((f) => f.key === i.key)?.label || i.label,
      body: (input.information[i.key] ?? '').trim(),
    }));
    const witness = await this.consumeWitness(enc, input.staffWitnessUserId, input.procedure, me.userId);
    await this.assertSignatureImages(enc.patientId, [input.signer, input.familyWitness]);
    const f = await this.records.prepare('consents', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: input.explainedAt,
      revision: { kind: 'baru' },
    });
    await this.records.insert(() =>
      tx.consent.create({
        data: {
          ...f,
          encounterId: enc.id,
          formDefinitionId: template.id,
          procedure: input.procedure,
          decision: input.decision,
          refusalReason: input.decision === 'tolak' ? input.refusalReason : null,
          information,
          informerUserId: me.userId,
          explainedAt: new Date(input.explainedAt),
        },
      }),
    );
    await this.insertSignatures(f.id, input, witness);
    await this.issuePdf(f.id, enc);
    await this.events.publish('consent.signed', {
      consentId: f.id,
      encounterId: enc.id,
      patientId: enc.patientId,
      outcome: input.decision,
    });
    this.db.audit({
      action: 'sign',
      resourceType: 'consent',
      resourceId: f.id,
      patientId: enc.patientId,
      reason: input.decision === 'tolak' ? input.refusalReason : null,
      details: { decision: input.decision, template: input.templateCode },
    });
    return this.one(f.id);
  }

  /** Pencabutan: addendum `dicabut` atas persetujuan final terkini (versi ber-TTE tidak bisa digantikan). */
  async revoke(id: string, input: ConsentRevokeInput): Promise<ConsentRecord> {
    const me = this.records.author();
    const tx = this.db.tx();
    const target = await tx.consent.findUnique({
      where: { id },
      select: {
        id: true,
        encounterId: true,
        patientId: true,
        decision: true,
        status: true,
        procedure: true,
        information: true,
        formDefinitionId: true,
        addenda: { where: { decision: 'dicabut', status: 'final', ...CURRENT }, select: { id: true } },
      },
    });
    if (!target) throw new AppError('NOT_FOUND', 'Persetujuan tidak ditemukan', 404);
    const enc = await clinicalEncounter(this.db, this.access, target.encounterId, 'write');
    if (target.decision !== 'setuju' || target.status !== 'final') {
      throw new AppError('CONFLICT', 'Hanya persetujuan final yang bisa dicabut', 409);
    }
    if (target.addenda.length > 0) throw new AppError('CONFLICT', 'Persetujuan ini sudah dicabut', 409);
    const witness = await this.consumeWitness(enc, input.staffWitnessUserId, target.procedure, me.userId);
    await this.assertSignatureImages(enc.patientId, [input.signer, input.familyWitness]);
    const f = await this.records.prepare('consents', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: new Date(),
      revision: { kind: 'addendum', addendumOf: target.id },
    });
    await this.records.insert(() =>
      tx.consent.create({
        data: {
          ...f,
          encounterId: enc.id,
          formDefinitionId: target.formDefinitionId,
          procedure: target.procedure,
          decision: 'dicabut',
          refusalReason: input.reason,
          information: target.information as Prisma.InputJsonValue,
          informerUserId: me.userId,
          explainedAt: f.occurredAt,
        },
      }),
    );
    await this.insertSignatures(f.id, input, witness);
    await this.issuePdf(f.id, enc);
    this.db.audit({
      action: 'sign',
      resourceType: 'consent',
      resourceId: f.id,
      patientId: enc.patientId,
      reason: input.reason,
      details: { decision: 'dicabut', revokes: target.id },
    });
    return this.one(f.id);
  }

  async list(encounterId: string): Promise<ConsentRecord[]> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const rows = await this.db.tx().consent.findMany({
      where: { encounterId: enc.id, status: 'final', ...CURRENT },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      select: CONSENT_SELECT,
    });
    this.db.audit({
      action: 'read',
      resourceType: 'consent',
      patientId: enc.patientId,
      details: { encounterId: enc.id, count: rows.length },
    });
    return this.present(rows);
  }

  // ------------------------------------------------------------------------------------------------------------

  private async one(id: string): Promise<ConsentRecord> {
    const row = await this.db.tx().consent.findUniqueOrThrow({ where: { id }, select: CONSENT_SELECT });
    return (await this.present([row]))[0] as ConsentRecord;
  }

  /**
   * Saksi petugas: orang lain dari dokter yang memfinalkan, aktif, beratestasi untuk kunjungan + tindakan yang sama
   * dalam 30 menit terakhir. Atestasi dibuang setelah dipakai (sekali pakai).
   */
  private async consumeWitness(
    enc: ClinicalEncounter,
    witnessUserId: string,
    procedure: string,
    me: string,
  ): Promise<{ userId: string; name: string }> {
    if (witnessUserId === me) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Saksi petugas harus orang lain dari dokter pemberi penjelasan',
        422,
        {
          fields: ['staffWitnessUserId'],
        },
      );
    }
    const tx = this.db.tx();
    const draft = await tx.clinicalDraft.findUnique({
      where: {
        tenantId_encounterId_kind_authorUserId: {
          tenantId: this.db.tenantId(),
          encounterId: enc.id,
          kind: CONSENT_WITNESS_DRAFT_KIND,
          authorUserId: witnessUserId,
        },
      },
      select: { id: true, content: true, updatedAt: true },
    });
    const attested = (draft?.content as { procedure?: unknown } | undefined)?.procedure;
    const fresh = draft && Date.now() - draft.updatedAt.getTime() <= CONSENT_WITNESS_VALID_MINUTES * 60_000;
    if (!draft || !fresh || typeof attested !== 'string' || norm(attested) !== norm(procedure)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Saksi petugas belum beratestasi untuk tindakan ini (berlaku ${CONSENT_WITNESS_VALID_MINUTES} menit)`,
        422,
        { fields: ['staffWitnessUserId'] },
      );
    }
    const user = await tx.user.findUnique({
      where: { id: witnessUserId },
      select: { displayName: true, status: true },
    });
    if (user?.status !== 'active') {
      throw new AppError('VALIDATION_FAILED', 'Saksi petugas tidak aktif', 422, {
        fields: ['staffWitnessUserId'],
      });
    }
    await tx.clinicalDraft.delete({ where: { id: draft.id } });
    return { userId: witnessUserId, name: user.displayName };
  }

  /** Gambar tanda tangan: dokumen PNG milik pasien yang sama, tidak dibatalkan (unggahan biner ADR-0020). */
  private async assertSignatureImages(
    patientId: string,
    signatures: Array<ConsentSignatureInput | null>,
  ): Promise<void> {
    for (const s of signatures) {
      if (!s?.imageDocumentId) continue;
      const doc = await this.db.tx().document.findUnique({
        where: { id: s.imageDocumentId },
        select: { patientId: true, mimeType: true, voidedAt: true },
      });
      if (!doc || doc.patientId !== patientId || doc.mimeType !== 'image/png' || doc.voidedAt) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Berkas tanda tangan harus gambar PNG milik pasien ini',
          422,
          {
            fields: ['imageDocumentId'],
          },
        );
      }
    }
  }

  private async insertSignatures(
    consentId: string,
    input: Pick<ConsentCreateInput, 'signerKind' | 'signer' | 'familyWitness'>,
    witness: { userId: string; name: string },
  ): Promise<void> {
    const base = { tenantId: this.db.tenantId(), consentId };
    const rows: Prisma.ConsentSignatureCreateManyInput[] = [
      {
        ...base,
        id: newId(),
        signerKind: input.signerKind,
        signerName: input.signer.name,
        relation: input.signer.relation,
        method: input.signer.method,
        imageDocumentId: input.signer.imageDocumentId,
      },
      ...(input.familyWitness
        ? [
            {
              ...base,
              id: newId(),
              signerKind: 'saksi_keluarga',
              signerName: input.familyWitness.name,
              relation: input.familyWitness.relation,
              method: input.familyWitness.method,
              imageDocumentId: input.familyWitness.imageDocumentId,
            },
          ]
        : []),
      {
        ...base,
        id: newId(),
        signerKind: 'saksi_petugas',
        signerName: witness.name,
        relation: null,
        method: 'nama',
        imageDocumentId: null,
        staffUserId: witness.userId,
      },
    ];
    await this.db.tx().consentSignature.createMany({ data: rows });
  }

  /** PDF bertanda tangan + TTE dokter pemberi penjelasan, di bawah kunci versi (ADR-0028/0029). */
  private async issuePdf(consentId: string, enc: ClinicalEncounter): Promise<void> {
    const tx = this.db.tx();
    const c = await tx.consent.findUniqueOrThrow({ where: { id: consentId }, select: CONSENT_SELECT });
    const encounter = await tx.encounter.findUniqueOrThrow({
      where: { id: enc.id },
      select: { number: true, unit: { select: { name: true } } },
    });
    const informer = (await this.records.userNames([c.informerUserId])).get(c.informerUserId) ?? 'Dokter';
    const decision = c.decision as ConsentDecision;
    const information = c.information as Array<{ title: string; body: string }>;
    const signerRole = (kind: string, relation: string | null) =>
      kind === 'pasien'
        ? 'Pasien'
        : kind === 'wali'
          ? `Wali${relation ? ` (${relation})` : ''}`
          : kind === 'saksi_keluarga'
            ? `Saksi keluarga${relation ? ` (${relation})` : ''}`
            : 'Saksi petugas';
    await this.signing.issueSigned('consents', c.id, {
      patientId: c.patientId,
      kind: 'consent',
      title: TITLE[decision],
      fileName:
        decision === 'dicabut'
          ? 'pencabutan-persetujuan'
          : decision === 'tolak'
            ? 'penolakan-tindakan'
            : 'persetujuan-tindakan',
      issuedAt: c.recordedAt,
      patientExtra: [
        { label: 'Kunjungan', value: encounter.number },
        { label: 'Unit', value: encounter.unit.name },
      ],
      sections: [
        {
          title: 'Tindakan',
          blocks: [
            {
              kind: 'fields',
              rows: [
                { label: 'Tindakan', value: c.procedure },
                { label: 'Dijelaskan oleh', value: informer },
                { label: 'Waktu penjelasan', value: formatTanggalWaktu(c.explainedAt) },
              ],
            },
          ],
        },
        {
          title: 'Informasi yang dijelaskan',
          blocks: [{ kind: 'fields', rows: information.map((i) => ({ label: i.title, value: i.body })) }],
        },
        ...(c.refusalReason
          ? [
              {
                title: decision === 'dicabut' ? 'Alasan pencabutan' : 'Alasan penolakan',
                blocks: [{ kind: 'paragraph' as const, text: c.refusalReason }],
              },
            ]
          : []),
        { title: 'Pernyataan', blocks: [{ kind: 'paragraph', text: STATEMENT[decision] }] },
      ],
      tte: { role: 'Dokter pemberi penjelasan', caption: null },
      otherSigners: c.signatures.map((s) => ({
        role: signerRole(s.signerKind, s.relation),
        name: s.signerName,
        caption:
          s.signerKind === 'saksi_petugas'
            ? 'Atestasi elektronik sesi petugas'
            : s.method === 'goresan'
              ? 'Tanda tangan goresan (berkas terlampir)'
              : 'Ketik nama',
      })),
    });
  }

  private async present(rows: ConsentRow[]): Promise<ConsentRecord[]> {
    if (rows.length === 0) return [];
    const tx = this.db.tx();
    const ids = rows.map((r) => r.id);
    const [meta, names, revocations, docs] = await Promise.all([
      this.records.meta('consents', rows),
      this.records.userNames(rows.map((r) => r.informerUserId)),
      tx.consent.findMany({
        where: { addendumOf: { in: ids }, decision: 'dicabut', status: 'final', ...CURRENT },
        select: { addendumOf: true },
      }),
      tx.document.findMany({
        where: { sourceType: 'consents', sourceId: { in: ids }, voidedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, sourceId: true, signatures: { select: { status: true }, take: 1 } },
      }),
    ]);
    const revoked = new Set(revocations.map((r) => r.addendumOf));
    return rows.map((r) => {
      const doc = docs.find((d) => d.sourceId === r.id);
      const decision = r.decision as ConsentDecision;
      return {
        ...(meta.get(r.id) as ClinicalEntryMeta),
        patientId: r.patientId,
        encounterId: r.encounterId,
        templateCode: r.formDefinition?.code ?? null,
        procedure: r.procedure,
        decision,
        effectiveDecision: revoked.has(r.id) ? 'dicabut' : decision,
        refusalReason: r.refusalReason,
        information: r.information as ConsentRecord['information'],
        informer: { userId: r.informerUserId, nama: names.get(r.informerUserId) ?? 'Pengguna' },
        explainedAt: r.explainedAt.toISOString(),
        signatures: r.signatures.map((s) => ({
          signerKind: s.signerKind as ConsentRecord['signatures'][number]['signerKind'],
          signerName: s.signerName,
          relation: s.relation,
          method: s.method as 'goresan' | 'nama',
          imageDocumentId: s.imageDocumentId,
          staffUserId: s.staffUserId,
          signedAt: s.signedAt.toISOString(),
        })),
        document: doc
          ? {
              id: doc.id,
              signatureStatus: (doc.signatures[0]?.status ?? null) as 'pending' | 'signed' | 'failed' | null,
            }
          : null,
      };
    });
  }
}

/** Formulir terbit yang memuat ketujuh butir informasi wajib sebagai isian. */
function isConsentTemplate(schema: FormSchema): boolean {
  const keys = new Set(allFields(schema).map((f) => f.key));
  return CONSENT_INFORMATION_KEYS.every((k) => keys.has(k));
}
