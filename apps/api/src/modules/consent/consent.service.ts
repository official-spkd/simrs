import { Injectable } from '@nestjs/common';
import { Prisma, raisedDbCode } from '@simrs/db';
import {
  allFields,
  AppError,
  type ClinicalEntryMeta,
  clinicalError,
  CONSENT_INFORMATION_ITEMS,
  CONSENT_EDUCATION_FORM,
  CONSENT_EDUCATION_TOPIC,
  CONSENT_INFORMATION_KEYS,
  CONSENT_WITNESS_VALID_MINUTES,
  type ConsentDecision,
  consentEducationReady,
  educationFormSupportsConsent,
  type EncounterEducation,
  type ConsentDraft,
  type ConsentDraftCancelInput,
  type ConsentDraftCreateInput,
  type ConsentDraftRefuseInput,
  type ConsentDraftSignaturesInput,
  type ConsentDraftStatus,
  type ConsentDraftUpdateInput,
  type ConsentRecord,
  type ConsentRevokeInput,
  type ConsentSignatureInput,
  type ConsentSignerKind,
  type ConsentTemplate,
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
import { DocumentsService } from '../documents/documents.service';

const CURRENT = { supersededBy: { none: {} } } as const;
const WITNESS_MS = CONSENT_WITNESS_VALID_MINUTES * 60_000;

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

const DRAFT_SELECT = {
  id: true,
  patientId: true,
  encounterId: true,
  formDefinitionId: true,
  procedure: true,
  signerKind: true,
  information: true,
  explainedAt: true,
  signer: true,
  familyWitness: true,
  signedAt: true,
  staffWitnessUserId: true,
  staffWitnessedAt: true,
  status: true,
  consentId: true,
  cancelReason: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true,
  closedBy: true,
  formDefinition: { select: { code: true, title: true } },
} as const;
type DraftRow = Prisma.ConsentDraftGetPayload<{ select: typeof DRAFT_SELECT }>;

type InformationItem = { key: string; title: string; body: string };

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
 * K11 · Persetujuan/penolakan tindakan di tablet (rencana fase 3 §3.7, keputusan no. 2 dan 20, ADR-0058):
 * - draf (`consent_drafts`, bukan rekam medis) dibuat pemegang `consent.write` (dokter, perawat, bidan) dari templat P07
 *   terbit yang memuat tujuh butir informasi; isi bisa diganti selama `draf` (tanda tangan + atestasi ikut dihapus);
 * - tanda tangan pasien/wali + saksi keluarga di tablet (PNG lewat unggahan biner ADR-0020 atau ketik nama), setelah
 *   ketujuh butir dinyatakan dipahami; saksi petugas beratestasi dengan sesinya sendiri sesudahnya;
 * - final hanya `consent.sign` (dokter, lingkup relasi): entri `consents` + tanda tangan + PDF + TTE dokter pemberi
 *   penjelasan (`ClinicalSigningService`, versi langsung terkunci `RECORD_LOCKED`); saksi petugas harus orang lain dan
 *   atestasinya ≤ 30 menit;
 * - penolakan beralasan ≥ 10 juga menjadi entri `consents` + PDF + TTE;
 * - pencabutan = entri baru `dicabut` (addendum) atas persetujuan final, ber-PDF + TTE.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly db: TenantDb,
    private readonly records: ClinicalRecordService,
    private readonly access: PatientAccessService,
    private readonly signing: ClinicalSigningService,
    private readonly events: DomainEvents,
    private readonly documents: DocumentsService,
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

  // ---------------------------------------------------------------------------------------------------------------
  // Draf (tablet)
  // ---------------------------------------------------------------------------------------------------------------

  async createDraft(encounterId: string, input: ConsentDraftCreateInput): Promise<ConsentDraft> {
    const me = this.records.author();
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'write');
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
    assertNotFuture(input.explainedAt);
    const id = newId();
    await tx.consentDraft.create({
      data: {
        id,
        tenantId: this.db.tenantId(),
        patientId: enc.patientId,
        encounterId: enc.id,
        formDefinitionId: template.id,
        procedure: input.procedure,
        signerKind: input.signerKind,
        information: buildInformation(schema.data, input.information),
        explainedAt: input.explainedAt ? new Date(input.explainedAt) : null,
        createdBy: me.userId,
        updatedBy: me.userId,
      },
    });
    this.db.audit({
      action: 'create',
      resourceType: 'consent_draft',
      resourceId: id,
      patientId: enc.patientId,
      details: { template: input.templateCode },
    });
    return this.draftView(id);
  }

  async listDrafts(encounterId: string): Promise<ConsentDraft[]> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const rows = await this.db.tx().consentDraft.findMany({
      where: { encounterId: enc.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: DRAFT_SELECT,
    });
    this.db.audit({
      action: 'read',
      resourceType: 'consent_draft',
      patientId: enc.patientId,
      details: { encounterId: enc.id, count: rows.length },
    });
    return this.presentDrafts(rows);
  }

  async getDraft(id: string): Promise<ConsentDraft> {
    const { row } = await this.loadDraft(id, 'read');
    this.db.audit({
      action: 'read',
      resourceType: 'consent_draft',
      resourceId: id,
      patientId: row.patientId,
    });
    return (await this.presentDrafts([row]))[0] as ConsentDraft;
  }

  /** Ganti isi draf; tanda tangan dan atestasi yang sudah ada dihapus (isi yang ditandatangani berubah). */
  async updateDraft(id: string, input: ConsentDraftUpdateInput): Promise<ConsentDraft> {
    const me = this.records.author();
    const { row } = await this.loadDraft(id, 'write', { lock: true, open: true });
    const def = await this.db.tx().formDefinition.findUniqueOrThrow({
      where: { id: row.formDefinitionId },
      select: { schema: true },
    });
    const schema = formSchemaSchema.parse(def.schema);
    assertNotFuture(input.explainedAt);
    await this.writeDraft(id, {
      procedure: input.procedure,
      signerKind: input.signerKind,
      information: buildInformation(schema, input.information),
      explainedAt: input.explainedAt ? new Date(input.explainedAt) : null,
      signer: dbNull(),
      familyWitness: dbNull(),
      signedAt: null,
      staffWitnessUserId: null,
      staffWitnessedAt: null,
      updatedBy: me.userId,
    });
    this.db.audit({
      action: 'update',
      resourceType: 'consent_draft',
      resourceId: id,
      patientId: row.patientId,
    });
    return this.draftView(id);
  }

  /** Tanda tangan pasien/wali (+ saksi keluarga) di tablet; atestasi saksi petugas sebelumnya dihapus. */
  async setSignatures(id: string, input: ConsentDraftSignaturesInput): Promise<ConsentDraft> {
    const me = this.records.author();
    const { row } = await this.loadDraft(id, 'write', { lock: true, open: true });
    assertGuardianRelation(row.signerKind as ConsentSignerKind, input.signer);
    await this.assertSignatureImages(row.patientId, [input.signer, input.familyWitness]);
    await this.writeDraft(id, {
      signer: input.signer,
      familyWitness: input.familyWitness ?? dbNull(),
      // Jam server diisi trigger saat isi tanda tangan berubah; nilai ini hanya memenuhi CHECK bila isi sama.
      signedAt: row.signedAt ?? new Date(),
      staffWitnessUserId: null,
      staffWitnessedAt: null,
      updatedBy: me.userId,
    });
    this.db.audit({
      action: 'update',
      resourceType: 'consent_draft',
      resourceId: id,
      patientId: row.patientId,
      details: {
        step: 'signatures',
        method: input.signer.method,
        familyWitness: input.familyWitness !== null,
      },
    });
    return this.draftView(id);
  }

  /**
   * Gambar tanda tangan (PNG, unggahan biner ADR-0020) untuk slot `signer`/`familyWitness` draf ini: disimpan sebagai
   * dokumen pasien (P08) lalu dirujuk lewat `imageDocumentId` saat menyimpan tanda tangan.
   */
  async uploadSignatureImage(
    id: string,
    slot: 'signer' | 'familyWitness',
    bytes: Buffer,
  ): Promise<{ imageDocumentId: string }> {
    const { row } = await this.loadDraft(id, 'write', { open: true });
    if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Tanda tangan harus gambar PNG', 415);
    }
    const doc = await this.documents.upload(
      row.patientId,
      {
        kind: 'consent',
        title: slot === 'signer' ? 'Tanda tangan pemberi persetujuan' : 'Tanda tangan saksi keluarga',
        fileName: `ttd-${slot === 'signer' ? 'pasien' : 'saksi'}`,
      },
      bytes,
    );
    this.db.audit({
      action: 'create',
      resourceType: 'document',
      resourceId: doc.id,
      patientId: row.patientId,
      details: { consentDraftId: id, slot },
    });
    return { imageDocumentId: doc.id };
  }

  /** Atestasi saksi petugas: sesi petugas itu sendiri menyatakan hadir saat penjelasan dan penandatanganan. */
  async attestWitness(id: string): Promise<ConsentDraft> {
    const me = this.records.author();
    const { row } = await this.loadDraft(id, 'write', { lock: true, open: true });
    if (!row.signer) {
      throw clinicalError(
        'CONSENT_SIGNATURES_REQUIRED',
        { missing: ['tanda_tangan'] },
        'Saksi petugas beratestasi setelah pasien/wali menandatangani',
      );
    }
    await this.writeDraft(id, {
      staffWitnessUserId: me.userId,
      staffWitnessedAt: new Date(),
      updatedBy: me.userId,
    });
    this.db.audit({
      action: 'verify',
      resourceType: 'consent_witness',
      resourceId: id,
      patientId: row.patientId,
    });
    return this.draftView(id);
  }

  /** Final (`consent.sign`): entri `consents` + tanda tangan + PDF + TTE dokter pemberi penjelasan. */
  async finalize(id: string): Promise<ConsentRecord> {
    const me = this.records.author();
    const { row, enc } = await this.loadDraft(id, 'write', { lock: true, open: true });
    // Sama dengan layar Edukasi mode demo: edukasi tindakan terkini kunjungan ini terverifikasi paham (P07).
    if (!(await this.educationReady([enc.id])).has(enc.id)) {
      throw clinicalError('CONSENT_EDUCATION_REQUIRED', {
        formCode: CONSENT_EDUCATION_FORM,
        topic: CONSENT_EDUCATION_TOPIC,
      });
    }
    const missing = draftMissing(row, new Date());
    const signer = row.signer as ConsentSignatureInput | null;
    if (missing.length > 0 || !signer || !row.staffWitnessUserId) {
      throw clinicalError('CONSENT_SIGNATURES_REQUIRED', { missing });
    }
    if (row.staffWitnessUserId === me.userId) {
      throw clinicalError(
        'CONSENT_SIGNATURES_REQUIRED',
        { missing: ['saksi_petugas'] },
        'Saksi petugas harus orang lain dari dokter yang memfinalkan',
      );
    }
    const witness = await this.activeUser(row.staffWitnessUserId);
    const familyWitness = row.familyWitness as ConsentSignatureInput | null;
    assertGuardianRelation(row.signerKind as ConsentSignerKind, signer);
    await this.assertSignatureImages(row.patientId, [signer, familyWitness]);
    const consentId = await this.issueConsent(row, enc, {
      decision: 'setuju',
      reason: null,
      signer,
      familyWitness,
      witness,
    });
    await this.closeDraft(id, { status: 'final', consentId, closedBy: me.userId });
    return this.one(consentId);
  }

  /** Penolakan beralasan (`consent.sign`): entri `consents` `tolak` + PDF + TTE; tanda tangan yang ada ikut. */
  async refuse(id: string, input: ConsentDraftRefuseInput): Promise<ConsentRecord> {
    const me = this.records.author();
    const { row, enc } = await this.loadDraft(id, 'write', { lock: true, open: true });
    const signer = row.signer as ConsentSignatureInput | null;
    const familyWitness = row.familyWitness as ConsentSignatureInput | null;
    if (signer) await this.assertSignatureImages(row.patientId, [signer, familyWitness]);
    // Penolakan tidak menunggu saksi: atestasi yang ada (orang lain, masih aktif) ikut dicantumkan, selain itu tidak.
    const witness =
      row.staffWitnessUserId && row.staffWitnessUserId !== me.userId
        ? await this.witnessIfActive(row.staffWitnessUserId)
        : null;
    const consentId = await this.issueConsent(row, enc, {
      decision: 'tolak',
      reason: input.reason,
      signer,
      familyWitness: signer ? familyWitness : null,
      witness,
    });
    await this.closeDraft(id, { status: 'ditolak', consentId, closedBy: me.userId });
    return this.one(consentId);
  }

  /** Batalkan draf beralasan (`consent.write`); draf tidak menjadi rekam medis. */
  async cancel(id: string, input: ConsentDraftCancelInput): Promise<ConsentDraft> {
    const me = this.records.author();
    const { row } = await this.loadDraft(id, 'write', { lock: true, open: true });
    await this.closeDraft(id, { status: 'batal', cancelReason: input.reason, closedBy: me.userId });
    this.db.audit({
      action: 'update',
      resourceType: 'consent_draft',
      resourceId: id,
      patientId: row.patientId,
      reason: input.reason,
      details: { status: 'batal' },
    });
    return this.draftView(id);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Entri final
  // ---------------------------------------------------------------------------------------------------------------

  /** Pencabutan: addendum `dicabut` atas persetujuan final terkini (versi ber-TTE tidak bisa digantikan). */
  async revoke(id: string, input: ConsentRevokeInput): Promise<ConsentRecord> {
    const me = this.records.author();
    const tx = this.db.tx();
    const target = await tx.consent.findUnique({
      where: { id },
      select: {
        id: true,
        encounterId: true,
        decision: true,
        status: true,
        procedure: true,
        information: true,
        formDefinitionId: true,
        supersededBy: { select: { id: true } },
      },
    });
    if (!target) throw new AppError('NOT_FOUND', 'Persetujuan tidak ditemukan', 404);
    const enc = await clinicalEncounter(this.db, this.access, target.encounterId, 'write');
    // Pencabutan serentak atas persetujuan yang sama: berurutan di bawah kunci versi.
    await this.records.lockVersion('consents', target.id);
    if (target.decision !== 'setuju' || target.status !== 'final' || target.supersededBy.length > 0) {
      throw new AppError('CONFLICT', 'Hanya persetujuan final yang bisa dicabut', 409);
    }
    const revoked = await tx.consent.count({
      where: { addendumOf: target.id, decision: 'dicabut', status: 'final', ...CURRENT },
    });
    if (revoked > 0) throw new AppError('CONFLICT', 'Persetujuan ini sudah dicabut', 409);
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
    await this.insertSignatures(f.id, input.signerKind, input.signer, input.familyWitness, null);
    await this.issuePdf(f.id, enc);
    await this.events.publish('consent.signed', {
      consentId: f.id,
      encounterId: enc.id,
      patientId: enc.patientId,
      outcome: 'dicabut',
    });
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

  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Draf + kunjungannya (ABAC lewat `clinicalEncounter`, tenant lain → 404). `lock` = `FOR UPDATE` (langkah yang
   * mengubah draf berjalan bergantian); `open` = harus masih `draf` (selain itu 409 `CONSENT_CLOSED`).
   */
  private async loadDraft(
    id: string,
    mode: 'read' | 'write',
    opts: { lock?: boolean; open?: boolean } = {},
  ): Promise<{ row: DraftRow; enc: ClinicalEncounter }> {
    const tx = this.db.tx();
    if (opts.lock) await tx.$queryRaw`SELECT id FROM consent_drafts WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.consentDraft.findUnique({ where: { id }, select: DRAFT_SELECT });
    if (!row) throw new AppError('NOT_FOUND', 'Draf persetujuan tidak ditemukan', 404);
    const enc = await clinicalEncounter(this.db, this.access, row.encounterId, mode);
    if (opts.open && row.status !== 'draf') throw clinicalError('CONSENT_CLOSED', { status: row.status });
    return { row, enc };
  }

  private async writeDraft(id: string, data: Prisma.ConsentDraftUncheckedUpdateInput): Promise<void> {
    try {
      await this.db.tx().consentDraft.update({ where: { id }, data });
    } catch (err) {
      if (raisedDbCode(err) === 'CONSENT_CLOSED') throw clinicalError('CONSENT_CLOSED');
      throw err;
    }
  }

  private closeDraft(
    id: string,
    close: {
      status: Exclude<ConsentDraftStatus, 'draf'>;
      consentId?: string;
      cancelReason?: string;
      closedBy: string;
    },
  ): Promise<void> {
    return this.writeDraft(id, {
      status: close.status,
      consentId: close.consentId ?? null,
      cancelReason: close.cancelReason ?? null,
      // Jam server diisi trigger; nilai ini hanya memenuhi CHECK.
      closedAt: new Date(),
      closedBy: close.closedBy,
      updatedBy: close.closedBy,
    });
  }

  /** Entri `consents` (setuju/tolak) dari draf + tanda tangan + PDF + TTE + event + audit. */
  private async issueConsent(
    row: DraftRow,
    enc: ClinicalEncounter,
    o: {
      decision: 'setuju' | 'tolak';
      reason: string | null;
      signer: ConsentSignatureInput | null;
      familyWitness: ConsentSignatureInput | null;
      witness: { userId: string; name: string } | null;
    },
  ): Promise<string> {
    const me = this.records.author();
    const explainedAt = row.explainedAt ?? row.signedAt ?? new Date();
    const f = await this.records.prepare('consents', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: explainedAt,
      revision: { kind: 'baru' },
    });
    await this.records.insert(() =>
      this.db.tx().consent.create({
        data: {
          ...f,
          encounterId: enc.id,
          formDefinitionId: row.formDefinitionId,
          procedure: row.procedure,
          decision: o.decision,
          refusalReason: o.reason,
          information: row.information as Prisma.InputJsonValue,
          informerUserId: me.userId,
          explainedAt,
        },
      }),
    );
    await this.insertSignatures(
      f.id,
      row.signerKind as ConsentSignerKind,
      o.signer,
      o.familyWitness,
      o.witness,
    );
    await this.issuePdf(f.id, enc);
    await this.events.publish('consent.signed', {
      consentId: f.id,
      encounterId: enc.id,
      patientId: enc.patientId,
      outcome: o.decision,
    });
    this.db.audit({
      action: 'sign',
      resourceType: 'consent',
      resourceId: f.id,
      patientId: enc.patientId,
      reason: o.reason,
      details: { decision: o.decision, template: row.formDefinition.code, draftId: row.id },
    });
    return f.id;
  }

  private async activeUser(userId: string): Promise<{ userId: string; name: string }> {
    const user = await this.db.tx().user.findUnique({
      where: { id: userId },
      select: { displayName: true, status: true },
    });
    if (user?.status !== 'active') {
      throw clinicalError(
        'CONSENT_SIGNATURES_REQUIRED',
        { missing: ['saksi_petugas'] },
        'Saksi petugas tidak aktif; minta petugas lain beratestasi',
      );
    }
    return { userId, name: user.displayName };
  }

  private async witnessIfActive(userId: string): Promise<{ userId: string; name: string } | null> {
    const user = await this.db.tx().user.findUnique({
      where: { id: userId },
      select: { displayName: true, status: true },
    });
    return user?.status === 'active' ? { userId, name: user.displayName } : null;
  }

  private async one(id: string): Promise<ConsentRecord> {
    const row = await this.db.tx().consent.findUniqueOrThrow({ where: { id }, select: CONSENT_SELECT });
    return (await this.present([row]))[0] as ConsentRecord;
  }

  private async draftView(id: string): Promise<ConsentDraft> {
    const row = await this.db.tx().consentDraft.findUniqueOrThrow({ where: { id }, select: DRAFT_SELECT });
    return (await this.presentDrafts([row]))[0] as ConsentDraft;
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
    signerKind: ConsentSignerKind,
    signer: ConsentSignatureInput | null,
    familyWitness: ConsentSignatureInput | null,
    witness: { userId: string; name: string } | null,
  ): Promise<void> {
    const base = { tenantId: this.db.tenantId(), consentId };
    const sig = (kind: string, s: ConsentSignatureInput): Prisma.ConsentSignatureCreateManyInput => ({
      ...base,
      id: newId(),
      signerKind: kind,
      signerName: s.name,
      relation: s.relation,
      method: s.method,
      imageDocumentId: s.imageDocumentId,
    });
    const rows: Prisma.ConsentSignatureCreateManyInput[] = [
      ...(signer ? [sig(signerKind, signer)] : []),
      ...(signer && familyWitness ? [sig('saksi_keluarga', familyWitness)] : []),
      ...(witness
        ? [
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
          ]
        : []),
    ];
    if (rows.length > 0) await this.db.tx().consentSignature.createMany({ data: rows });
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
    const information = c.information as InformationItem[];
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

  /**
   * Kunjungan yang edukasi tindakannya terkini terverifikasi paham: isian final terkini `edukasi_terintegrasi` per
   * kunjungan, urut waktu, dievaluasi `consentEducationReady` (aturan bersama dengan layar demo).
   */
  private async educationReady(encounterIds: string[]): Promise<Set<string>> {
    const rows = await this.db.tx().formResponse.findMany({
      where: {
        encounterId: { in: encounterIds },
        formCode: CONSENT_EDUCATION_FORM,
        status: 'final',
        supersededBy: { none: {} },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { encounterId: true, answers: true },
    });
    return new Set(
      encounterIds.filter((e) => consentEducationReady(rows.filter((r) => r.encounterId === e))),
    );
  }

  /** Edukasi terintegrasi kunjungan (layar Edukasi mode api): formulir terbit, status syarat persetujuan, riwayat. */
  async education(encounterId: string): Promise<EncounterEducation> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const tx = this.db.tx();
    const [def, rows] = await Promise.all([
      tx.formDefinition.findFirst({
        where: { code: CONSENT_EDUCATION_FORM, status: 'published' },
        select: { code: true, title: true, version: true, schema: true },
      }),
      tx.formResponse.findMany({
        where: {
          encounterId: enc.id,
          formCode: CONSENT_EDUCATION_FORM,
          status: 'final',
          supersededBy: { none: {} },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, version: true, createdAt: true, createdBy: true, answers: true },
      }),
    ]);
    const schema = def ? formSchemaSchema.safeParse(def.schema) : null;
    const names = await this.records.userNames(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])));
    this.db.audit({
      action: 'read',
      resourceType: 'form_response',
      patientId: enc.patientId,
      details: { encounterId: enc.id, form: CONSENT_EDUCATION_FORM, count: rows.length },
    });
    return {
      encounterId: enc.id,
      patientId: enc.patientId,
      form:
        def && schema?.success
          ? { code: def.code, title: def.title, version: def.version, schema: schema.data }
          : null,
      supportsConsent: schema?.success ? educationFormSupportsConsent(schema.data) : false,
      ready: consentEducationReady(rows),
      records: rows.map((r) => ({
        id: r.id,
        version: r.version,
        createdAt: r.createdAt.toISOString(),
        author: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
        answers: r.answers as FormAnswers,
      })),
    };
  }

  private async presentDrafts(rows: DraftRow[]): Promise<ConsentDraft[]> {
    if (rows.length === 0) return [];
    const educated = await this.educationReady([...new Set(rows.map((r) => r.encounterId))]);
    const names = await this.records.userNames(
      rows.flatMap((r) => [
        r.createdBy,
        ...(r.staffWitnessUserId ? [r.staffWitnessUserId] : []),
        ...(r.closedBy ? [r.closedBy] : []),
      ]),
    );
    const person = (userId: string) => ({ userId, nama: names.get(userId) ?? 'Pengguna' });
    const now = new Date();
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      encounterId: r.encounterId,
      templateCode: r.formDefinition.code,
      templateTitle: r.formDefinition.title,
      procedure: r.procedure,
      signerKind: r.signerKind as ConsentSignerKind,
      information: r.information as InformationItem[],
      explainedAt: r.explainedAt?.toISOString() ?? null,
      signer: (r.signer as ConsentSignatureInput | null) ?? null,
      familyWitness: (r.familyWitness as ConsentSignatureInput | null) ?? null,
      signedAt: r.signedAt?.toISOString() ?? null,
      staffWitness:
        r.staffWitnessUserId && r.staffWitnessedAt
          ? {
              ...person(r.staffWitnessUserId),
              attestedAt: r.staffWitnessedAt.toISOString(),
              expiresAt: new Date(r.staffWitnessedAt.getTime() + WITNESS_MS).toISOString(),
            }
          : null,
      status: r.status as ConsentDraftStatus,
      missing:
        r.status === 'draf'
          ? [...(educated.has(r.encounterId) ? [] : (['edukasi_tindakan'] as const)), ...draftMissing(r, now)]
          : [],
      consentId: r.consentId,
      cancelReason: r.cancelReason,
      createdBy: person(r.createdBy),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      closedAt: r.closedAt?.toISOString() ?? null,
      closedBy: r.closedBy ? person(r.closedBy) : null,
    }));
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

/** Isian templat → tujuh butir berjudul (urutan baku); isian divalidasi skema templat, ketujuh kunci wajib terisi. */
function buildInformation(schema: FormSchema, information: Record<string, string>): InformationItem[] {
  const errors = validateAnswers(schema, information as FormAnswers);
  const missing = CONSENT_INFORMATION_KEYS.filter((k) => !information[k]?.trim());
  if (Object.keys(errors).length > 0 || missing.length > 0) {
    throw new AppError('VALIDATION_FAILED', 'Ketujuh butir informasi wajib diisi', 422, {
      fields: { ...errors, ...Object.fromEntries(missing.map((k) => [k, 'Wajib diisi'])) },
    });
  }
  return CONSENT_INFORMATION_ITEMS.map((i) => ({
    key: i.key,
    title: allFields(schema).find((f) => f.key === i.key)?.label || i.label,
    body: (information[i.key] ?? '').trim(),
  }));
}

/** Syarat final yang belum terpenuhi. */
function draftMissing(
  r: Pick<DraftRow, 'signer' | 'staffWitnessUserId' | 'staffWitnessedAt'>,
  now: Date,
): ConsentDraft['missing'] {
  const out: ConsentDraft['missing'] = [];
  if (!r.signer) out.push('tanda_tangan');
  if (!r.staffWitnessUserId || !r.staffWitnessedAt) out.push('saksi_petugas');
  else if (now.getTime() - r.staffWitnessedAt.getTime() > WITNESS_MS) out.push('saksi_kedaluwarsa');
  return out;
}

function assertGuardianRelation(kind: ConsentSignerKind, signer: ConsentSignatureInput): void {
  if (kind === 'wali' && !signer.relation) {
    throw new AppError('VALIDATION_FAILED', 'Hubungan wali dengan pasien wajib diisi', 422, {
      fields: ['signer.relation'],
    });
  }
}

function assertNotFuture(at: string | null): void {
  if (at && new Date(at).getTime() > Date.now() + 60_000) {
    throw new AppError('VALIDATION_FAILED', 'Waktu penjelasan tidak boleh di masa depan', 422);
  }
}

/** JSON null (SQL NULL) untuk kolom `Json?`. */
function dbNull(): typeof Prisma.DbNull {
  return Prisma.DbNull;
}
