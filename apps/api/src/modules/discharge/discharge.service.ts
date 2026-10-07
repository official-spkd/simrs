import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ClinicalPdfInput } from '@simrs/pdf';
import type { Prisma } from '@simrs/db';
import {
  AppError,
  clinicalError,
  type ClinicalAuthor,
  type DischargeAddendum,
  type DischargeAddendumInput,
  type DischargeDisposition,
  type DischargeDocumentRef,
  type DischargeDraftInput,
  dischargeDraftInputSchema,
  type DischargeFinalizeInput,
  type DischargeMedicationLine,
  type DischargeSectionId,
  type DischargeSourceRef,
  type DischargeSummary,
  type DischargeSummaryKind,
  type DischargeSummaryView,
  DISPOSITION_LABEL,
  formatTanggalWaktu,
  newId,
  RESUME_CHECK_IDS,
  RESUME_CHECK_LABEL,
  resumeChecklist,
  resumeCompleteness,
  resumeRequiredChecks,
  type ResumeCheckId,
  type ResumeSection,
  type SignatureStatus,
} from '@simrs/shared';
import { clinicalEncounter, lockClinicalKey } from '../../infra/clinical/clinical-context';
import { ClinicalRecordService } from '../../infra/clinical/clinical-record.service';
import { ClinicalSigningService } from '../../infra/clinical/clinical-signing.service';
import { SatusehatRecorder } from '../../infra/clinical/staging';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { DischargeAuthority } from './discharge-authority';
import { type CompiledResume, DischargeSourcesService } from './discharge-sources';

/** Jenis draf resume di `clinical_drafts` (dicadangkan: tidak bisa ditulis lewat API draf generik). */
export const RESUME_DRAFT_KIND = 'resume';

const BODY_MAX = 1200;
const clip = (s: string, max = BODY_MAX) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const EMPTY_NOTES: DischargeDraftInput['notes'] = {
  anamnesis: null,
  fisik: null,
  penunjang: null,
  terapi: null,
};

interface StoredDraft {
  input: DischargeDraftInput;
  reconciliation: { confirmedAt: string; digest: string } | null;
}

/** Isi bagian resume yang tersimpan (`discharge_summaries.sections`, objek JSON beku saat TTE). */
interface StoredSections {
  facts: {
    admittedAt: string;
    dischargeAt: string;
    admissionVia: string;
    location: string;
    dpjp: string;
    dischargeMethod: string;
    reconciliationConfirmedAt: string | null;
  };
  sections: Array<ResumeSection>;
  codes: DischargeSummary['codes'];
  checklist: Array<{ id: ResumeCheckId; done: boolean }>;
  /** Isian DPJP saat TTE (untuk tanda tangan ulang bila TTE gagal, tanpa mengetik ulang). */
  input?: DischargeDraftInput;
  addendum?: string;
}

const DB_CHANGE = { 'ubah-dosis': 'ubah_dosis' } as const;
const fromDbChange = (c: string) =>
  (c === 'ubah_dosis' ? 'ubah-dosis' : c) as DischargeMedicationLine['change'];

function medsDigest(meds: readonly DischargeMedicationLine[]): string {
  return createHash('sha256').update(JSON.stringify(meds)).digest('hex');
}

/**
 * K13 · Resume medis pulang + rekonsiliasi obat + TTE (rencana fase 3 §3.6, EP 5c):
 * - draf per penulis (`clinical_drafts` jenis `resume`, keputusan fase 3 no. 1) berisi isian DPJP saja; bagian sumber
 *   (anamnesis, fisik, penunjang, terapi, diagnosis/prosedur berkode, surat kontrol) SELALU dihimpun ulang dari data
 *   sumber, tiap bagian membawa ref sumbernya (`discharge_summary_sources`);
 * - rekonsiliasi obat pulang dikonfirmasi DPJP (`clinical.sign` + tim DPJP); mengubah daftar obat membatalkannya;
 * - finalisasi: butir wajib diperiksa server (12 butir rawat inap; ringkas rawat jalan) → versi berversi
 *   (`ClinicalRecordService`) → PDF + TTE (`ClinicalSigningService`) → terkunci (`RECORD_LOCKED`); perubahan setelah
 *   itu hanya addendum (TTE sendiri); staging SATUSEHAT `held` Composition.
 */
@Injectable()
export class DischargeService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
    private readonly records: ClinicalRecordService,
    private readonly signing: ClinicalSigningService,
    private readonly satusehat: SatusehatRecorder,
    private readonly events: DomainEvents,
    private readonly sources: DischargeSourcesService,
    private readonly authority: DischargeAuthority,
  ) {}

  // ------------------------------------------------------------------------------------------------------------
  // Baca
  // ------------------------------------------------------------------------------------------------------------

  async view(encounterId: string): Promise<DischargeSummaryView> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    this.assertResumeClass(enc.encounterClass);
    this.db.audit({
      action: 'read',
      resourceType: 'discharge_summary',
      resourceId: enc.id,
      patientId: enc.patientId,
    });
    return this.build(enc.id);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Draf
  // ------------------------------------------------------------------------------------------------------------

  /** Himpun draf dari sumber (sekali per penulis; panggilan ulang mengembalikan draf yang ada). */
  async createDraft(encounterId: string): Promise<DischargeSummaryView> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'write');
    this.assertResumeClass(enc.encounterClass);
    this.records.author();
    const final = await this.currentFinal(enc.id);
    if (final && (await this.records.lockedIds('discharge_summaries', [final.id])).has(final.id)) {
      throw clinicalError('RECORD_LOCKED');
    }
    if (!(await this.loadDraft(enc.id))) {
      const compiled = await this.sources.compile(enc.id);
      await this.storeDraft(enc.id, enc.patientId, {
        input: {
          dischargeAt: null,
          disposition: compiled.kind === 'rawat_jalan' ? 'pulang' : null,
          dischargeCondition: null,
          notes: { ...EMPTY_NOTES },
          education: null,
          instructions: null,
          followUp: null,
          medications: compiled.proposedMedications,
        },
        reconciliation: null,
      });
    }
    return this.build(enc.id);
  }

  async saveDraft(encounterId: string, input: DischargeDraftInput): Promise<DischargeSummaryView> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'write');
    this.assertResumeClass(enc.encounterClass);
    this.records.author();
    const prev = await this.loadDraft(enc.id);
    const keep =
      prev?.reconciliation && prev.reconciliation.digest === medsDigest(input.medications)
        ? prev.reconciliation
        : null;
    await this.storeDraft(enc.id, enc.patientId, { input, reconciliation: keep });
    return this.build(enc.id);
  }

  /** Konfirmasi rekonsiliasi obat pulang oleh DPJP atas daftar obat draf saat ini (atau batalkan). */
  async reconcile(encounterId: string, confirmed: boolean): Promise<DischargeSummaryView> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'write');
    this.assertResumeClass(enc.encounterClass);
    await this.assertSigner(enc.id, 'Rekonsiliasi obat pulang dikonfirmasi DPJP pasien ini');
    const draft = await this.loadDraft(enc.id);
    if (!draft) throw new AppError('CONFLICT', 'Himpun draf resume dulu', 409);
    await this.storeDraft(enc.id, enc.patientId, {
      input: draft.input,
      reconciliation: confirmed
        ? { confirmedAt: new Date().toISOString(), digest: medsDigest(draft.input.medications) }
        : null,
    });
    this.db.audit({
      action: 'update',
      resourceType: 'discharge_reconciliation',
      resourceId: enc.id,
      patientId: enc.patientId,
      details: { confirmed, medications: draft.input.medications.length },
    });
    return this.build(enc.id);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Finalisasi + TTE
  // ------------------------------------------------------------------------------------------------------------

  async finalize(encounterId: string, input: DischargeFinalizeInput): Promise<DischargeSummaryView> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'write');
    this.assertResumeClass(enc.encounterClass);
    await this.assertSigner(enc.id, 'Resume ditandatangani DPJP pasien ini');
    await lockClinicalKey(this.db, `discharge:${enc.id}`);
    // Versi ber-TTE tidak bisa digantikan (diperiksa sebelum draf: setelah TTE draf sudah dibersihkan).
    if (input.revision.kind === 'koreksi') {
      const target = input.revision.supersedesId;
      if ((await this.records.lockedIds('discharge_summaries', [target])).has(target)) {
        throw clinicalError('RECORD_LOCKED');
      }
    }
    // Tanda tangan ulang (TTE versi sebelumnya gagal): isian DPJP diambil dari versi itu bila draf sudah dibersihkan.
    const draft =
      (await this.loadDraft(enc.id)) ??
      (input.revision.kind === 'koreksi'
        ? await this.draftFromFinal(input.revision.supersedesId, enc.id)
        : null);
    if (!draft) throw new AppError('CONFLICT', 'Himpun dan simpan draf resume dulu', 409);
    if (input.revision.kind === 'baru' && (await this.currentFinal(enc.id))) {
      const final = (await this.currentFinal(enc.id)) as { id: string };
      if ((await this.records.lockedIds('discharge_summaries', [final.id])).has(final.id)) {
        throw clinicalError('RECORD_LOCKED');
      }
      throw new AppError(
        'CONFLICT',
        'Resume final sudah ada; TTE-nya gagal, tanda tangani ulang sebagai koreksi beralasan',
        409,
      );
    }
    const compiled = await this.sources.compile(enc.id);
    const now = new Date();
    const content = this.assemble(compiled, draft, now);
    const required = resumeRequiredChecks(compiled.kind);
    const completeness = resumeCompleteness(content.checklist, required);
    if (!completeness.complete) {
      throw clinicalError(
        'RESUME_INCOMPLETE',
        { missing: completeness.missingIds },
        `Resume belum lengkap: ${completeness.missing.join(', ')}`,
      );
    }
    const disposition = draft.input.disposition as DischargeDisposition;
    const fields = await this.records.prepare('discharge_summaries', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: now,
      revision: input.revision,
    });
    const stored: StoredSections = {
      facts: content.facts,
      sections: content.sections,
      codes: compiled.codes,
      checklist: content.checklist,
      input: draft.input,
    };
    const tx = this.db.tx();
    await this.records.insert(() =>
      tx.dischargeSummary.create({
        data: {
          ...fields,
          encounterId: enc.id,
          kind: compiled.kind,
          sections: stored as unknown as Prisma.InputJsonValue,
          disposition,
          dischargeCondition: draft.input.dischargeCondition as string,
          followUp: content.followUp,
          reconciliationConfirmed: content.reconciliationConfirmed,
        },
      }),
    );
    if (draft.input.medications.length > 0) {
      await tx.dischargeMedication.createMany({
        data: draft.input.medications.map((m, i) => ({
          id: newId(),
          tenantId: this.db.tenantId(),
          summaryId: fields.id,
          drugId: null,
          name: m.name,
          sig: m.sig,
          change: m.change === 'ubah-dosis' ? DB_CHANGE['ubah-dosis'] : m.change,
          sortOrder: i,
        })),
      });
    }
    const refs = this.sectionRefs(compiled);
    const sourceRows = Object.entries(refs).flatMap(([section, list]) =>
      dedupe(list).map((r) => ({
        id: newId(),
        tenantId: this.db.tenantId(),
        summaryId: fields.id,
        section,
        sourceType: r.type,
        sourceId: r.id,
      })),
    );
    if (sourceRows.length > 0) await tx.dischargeSummarySource.createMany({ data: sourceRows });

    await this.signing.issueSigned('discharge_summaries', fields.id, {
      patientId: enc.patientId,
      kind: 'resume',
      title: compiled.kind === 'rawat_inap' ? 'Resume medis pulang' : 'Resume medis rawat jalan',
      fileName: `resume ${compiled.encounter.number} v${fields.version}`,
      issuedAt: now,
      patientExtra: [
        { label: 'Kunjungan', value: compiled.encounter.number },
        { label: 'Ruang', value: content.facts.location },
        { label: 'DPJP', value: content.facts.dpjp },
      ],
      sections: summaryPdfSections(stored, draft.input, disposition),
      tte: { role: 'Dokter penanggung jawab pelayanan (DPJP)', caption: null },
    });
    await this.satusehat.record('Composition', fields.id, fields.version);
    await this.events.publish('discharge.signed', {
      dischargeSummaryId: fields.id,
      encounterId: enc.id,
      patientId: enc.patientId,
    });
    await tx.clinicalDraft.deleteMany({
      where: { encounterId: enc.id, kind: RESUME_DRAFT_KIND, authorUserId: fields.authorUserId },
    });
    this.db.audit({
      action: input.revision.kind === 'koreksi' ? 'correct' : 'create',
      resourceType: 'discharge_summary',
      resourceId: fields.id,
      patientId: enc.patientId,
      reason: input.revision.kind === 'koreksi' ? input.revision.correctionReason : null,
      details: { encounterId: enc.id, kind: compiled.kind, version: fields.version, disposition },
    });
    return this.build(enc.id);
  }

  /** Addendum atas resume final (versi ber-TTE tetap utuh); addendum ber-TTE sendiri. */
  async addendum(summaryId: string, input: DischargeAddendumInput): Promise<DischargeSummaryView> {
    const target = await this.db.tx().dischargeSummary.findUnique({
      where: { id: summaryId },
      select: {
        id: true,
        encounterId: true,
        patientId: true,
        kind: true,
        disposition: true,
        dischargeCondition: true,
        addendumOf: true,
      },
    });
    if (!target) throw new AppError('NOT_FOUND', 'Resume tidak ditemukan', 404);
    const enc = await clinicalEncounter(this.db, this.access, target.encounterId, 'write');
    if (target.addendumOf) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Addendum ditambahkan pada resume, bukan pada addendum lain',
        422,
      );
    }
    await this.assertSigner(enc.id, 'Addendum resume ber-TTE ditandatangani DPJP pasien ini');
    const now = new Date();
    const fields = await this.records.prepare('discharge_summaries', {
      patientId: enc.patientId,
      encounterId: enc.id,
      occurredAt: now,
      revision: { kind: 'addendum', addendumOf: target.id },
    });
    const stored = { addendum: input.text } as Prisma.InputJsonValue;
    await this.records.insert(() =>
      this.db.tx().dischargeSummary.create({
        data: {
          ...fields,
          encounterId: enc.id,
          kind: target.kind,
          sections: stored,
          disposition: target.disposition,
          dischargeCondition: target.dischargeCondition,
          followUp: null,
          reconciliationConfirmed: false,
        },
      }),
    );
    const encRow = await this.db.tx().encounter.findUniqueOrThrow({
      where: { id: enc.id },
      select: { number: true },
    });
    await this.signing.issueSigned('discharge_summaries', fields.id, {
      patientId: enc.patientId,
      kind: 'resume',
      title: 'Addendum resume medis',
      fileName: `addendum resume ${encRow.number}`,
      issuedAt: now,
      patientExtra: [{ label: 'Kunjungan', value: encRow.number }],
      sections: [
        {
          title: 'Addendum',
          blocks: [
            {
              kind: 'fields',
              rows: [{ label: 'Atas resume', value: `versi final ${target.id.slice(0, 8)}` }],
            },
            { kind: 'paragraph', text: input.text },
          ],
        },
      ],
      tte: { role: 'Dokter', caption: null },
    });
    await this.satusehat.record('Composition', fields.id, 1);
    this.db.audit({
      action: 'create',
      resourceType: 'discharge_summary',
      resourceId: fields.id,
      patientId: enc.patientId,
      details: { addendumOf: target.id },
    });
    return this.build(enc.id);
  }

  // ------------------------------------------------------------------------------------------------------------
  // Bantu
  // ------------------------------------------------------------------------------------------------------------

  private assertResumeClass(encounterClass: string): void {
    if (encounterClass === 'EMER') {
      throw new AppError(
        'VALIDATION_FAILED',
        'Resume medis dibuat di kunjungan rawat inap atau rawat jalan; IGD ditutup lewat disposisi',
        422,
      );
    }
  }

  private async assertSigner(encounterId: string, message: string): Promise<void> {
    if (!(await this.authority.canSign()) || !(await this.authority.isAttendingTeam(encounterId))) {
      throw new AppError('FORBIDDEN', message, 403);
    }
  }

  private async loadDraft(encounterId: string): Promise<StoredDraft | null> {
    const { userId } = this.records.author();
    const row = await this.db.tx().clinicalDraft.findUnique({
      where: {
        tenantId_encounterId_kind_authorUserId: {
          tenantId: this.db.tenantId(),
          encounterId,
          kind: RESUME_DRAFT_KIND,
          authorUserId: userId,
        },
      },
      select: { content: true },
    });
    if (!row) return null;
    const c = row.content as { input?: unknown; reconciliation?: unknown };
    const parsed = dischargeDraftInputSchema.safeParse(c.input);
    if (!parsed.success) return null;
    const r = c.reconciliation as StoredDraft['reconciliation'];
    return {
      input: parsed.data,
      reconciliation:
        r && typeof r.confirmedAt === 'string' && typeof r.digest === 'string'
          ? { confirmedAt: r.confirmedAt, digest: r.digest }
          : null,
    };
  }

  private async storeDraft(encounterId: string, patientId: string, draft: StoredDraft): Promise<void> {
    const { userId } = this.records.author();
    const tenantId = this.db.tenantId();
    const content = draft as unknown as Prisma.InputJsonValue;
    await this.db.tx().clinicalDraft.upsert({
      where: {
        tenantId_encounterId_kind_authorUserId: {
          tenantId,
          encounterId,
          kind: RESUME_DRAFT_KIND,
          authorUserId: userId,
        },
      },
      update: { content },
      create: {
        id: newId(),
        tenantId,
        encounterId,
        patientId,
        authorUserId: userId,
        kind: RESUME_DRAFT_KIND,
        content,
      },
    });
    this.db.audit({
      action: 'update',
      resourceType: 'clinical_draft',
      resourceId: encounterId,
      patientId,
      details: { kind: RESUME_DRAFT_KIND },
    });
  }

  /**
   * Isian DPJP dari versi final (tanda tangan ulang setelah TTE gagal). Konfirmasi rekonsiliasi versi itu ikut berlaku
   * karena daftar obatnya sama persis (hash), dan penanda tangan ulang wajib penulis yang sama (`prepare` koreksi).
   */
  private async draftFromFinal(summaryId: string, encounterId: string): Promise<StoredDraft | null> {
    const row = await this.db.tx().dischargeSummary.findUnique({
      where: { id: summaryId },
      select: { encounterId: true, sections: true },
    });
    if (!row || row.encounterId !== encounterId) return null;
    const stored = row.sections as unknown as StoredSections;
    const parsed = dischargeDraftInputSchema.safeParse(stored.input);
    if (!parsed.success) return null;
    const confirmedAt = stored.facts?.reconciliationConfirmedAt ?? null;
    return {
      input: parsed.data,
      reconciliation: confirmedAt ? { confirmedAt, digest: medsDigest(parsed.data.medications) } : null,
    };
  }

  /** Resume final terkini (bukan addendum, bukan salah entri). */
  private async currentFinal(encounterId: string) {
    return this.db.tx().dischargeSummary.findFirst({
      where: { encounterId, addendumOf: null, status: 'final', supersededBy: { none: {} } },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      include: { medications: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  /** Isi resume dari himpunan sumber + isian DPJP (draf). */
  private assemble(compiled: CompiledResume, draft: StoredDraft | null, now: Date) {
    const input = draft?.input ?? null;
    const notes = input?.notes ?? EMPTY_NOTES;
    const reconOk =
      compiled.kind === 'rawat_inap'
        ? !!draft?.reconciliation && draft.reconciliation.digest === medsDigest(input?.medications ?? [])
        : false;
    const withNote = (id: keyof typeof notes) => {
      const s = compiled.sections[id];
      const note = notes[id]?.trim();
      return clip([s.body, note ? `Catatan DPJP: ${note}` : ''].filter(Boolean).join('\n'));
    };
    const meds = input?.medications ?? [];
    const followUp =
      [compiled.controlLetter?.text, input?.followUp?.trim()].filter(Boolean).join('\n') || null;
    const sections: ResumeSection[] = [
      {
        id: 'anamnesis',
        title: compiled.sections.anamnesis.title,
        body: withNote('anamnesis'),
        source: compiled.encounter.encounterClass === 'IMP' ? 'asesmen-igd' : 'cppt',
      },
      { id: 'fisik', title: compiled.sections.fisik.title, body: withNote('fisik'), source: 'observasi' },
      {
        id: 'penunjang',
        title: compiled.sections.penunjang.title,
        body: withNote('penunjang'),
        source: 'hasil',
      },
      {
        id: 'terapi',
        title: compiled.sections.terapi.title,
        body: withNote('terapi'),
        source: compiled.sections.terapi.source,
      },
      {
        id: 'obat-pulang',
        title: 'Obat pulang (hasil rekonsiliasi)',
        body: clip(meds.map((m) => `${m.change}: ${m.name} · ${m.sig}`).join('\n')),
        source: 'rekonsiliasi',
      },
      {
        id: 'edukasi',
        title: 'Edukasi pasien dan keluarga',
        body: clip(input?.education?.trim() ?? ''),
        source: 'dpjp',
      },
      {
        id: 'instruksi',
        title: 'Instruksi pulang dan tanda bahaya',
        body: clip(input?.instructions?.trim() ?? ''),
        source: 'dpjp',
      },
      {
        id: 'tindak-lanjut',
        title: 'Tindak lanjut',
        body: clip(followUp ?? ''),
        source: compiled.controlLetter ? 'surat-kontrol' : 'dpjp',
      },
    ];
    const physicalNote = notes.fisik?.trim() || null;
    const checklist = resumeChecklist({
      identityComplete: compiled.identityComplete,
      anamnesis: sections[0]?.body ?? null,
      physicalOnAdmission: compiled.physical.admission ?? physicalNote,
      physicalOnDischarge: compiled.physical.discharge ?? physicalNote,
      importantResults: sections[2]?.body ?? null,
      primaryDiagnosisCoded: compiled.primaryDiagnosisCoded,
      uncodedSecondaryDiagnoses: 0,
      uncodedProcedures: 0,
      therapySummary: sections[3]?.body ?? null,
      reconciliationConfirmed: reconOk,
      education: input?.education ?? null,
      dischargeInstructions: input?.instructions ?? null,
      followUp,
      dischargeCondition: input?.dischargeCondition ?? null,
      dischargeMethod: input?.disposition ? DISPOSITION_LABEL[input.disposition] : null,
    });
    const dischargeAt = input?.dischargeAt ?? compiled.encounter.endedAt?.toISOString() ?? now.toISOString();
    return {
      sections,
      checklist,
      followUp,
      reconciliationConfirmed: reconOk,
      facts: {
        admittedAt: (compiled.encounter.admittedAt ?? now).toISOString(),
        dischargeAt,
        admissionVia: compiled.encounter.admissionVia,
        location: compiled.encounter.location.slice(0, 60),
        dpjp: (compiled.encounter.dpjp ?? 'Belum ditetapkan').slice(0, 80),
        dischargeMethod: input?.disposition ? DISPOSITION_LABEL[input.disposition] : 'Belum ditentukan',
        reconciliationConfirmedAt: reconOk ? (draft?.reconciliation?.confirmedAt ?? null) : null,
      },
    };
  }

  private sectionRefs(
    compiled: CompiledResume,
  ): Partial<Record<DischargeSectionId | 'diagnosis' | 'prosedur', DischargeSourceRef[]>> {
    return {
      anamnesis: compiled.sections.anamnesis.refs,
      fisik: compiled.sections.fisik.refs,
      penunjang: compiled.sections.penunjang.refs,
      terapi: compiled.sections.terapi.refs,
      'tindak-lanjut': compiled.controlLetter ? [compiled.controlLetter.ref] : [],
      diagnosis: compiled.diagnosisRefs,
      prosedur: compiled.procedureRefs,
    };
  }

  /** Susun jawaban: final (beku) bila ada, selain itu draf/pratinjau dari sumber terkini. */
  private async build(encounterId: string): Promise<DischargeSummaryView> {
    const tx = this.db.tx();
    const enc = await tx.encounter.findUniqueOrThrow({
      where: { id: encounterId },
      select: { id: true, patientId: true, number: true, encounterClass: true, status: true },
    });
    const [final, draft, canSign] = await Promise.all([
      this.currentFinal(encounterId),
      this.loadDraft(encounterId),
      this.authority.canSign().then(async (ok) => ok && (await this.authority.isAttendingTeam(encounterId))),
    ]);
    const kind: DischargeSummaryKind = enc.encounterClass === 'IMP' ? 'rawat_inap' : 'rawat_jalan';
    const required = [...resumeRequiredChecks(kind)];
    const addenda = await this.addenda(final?.id ?? null);

    if (final) {
      const stored = final.sections as unknown as StoredSections;
      const [meta] = (await this.records.meta('discharge_summaries', [final])).values();
      const doc = await this.documentRef(final.id);
      const refs = await tx.dischargeSummarySource.findMany({
        where: { summaryId: final.id },
        select: { section: true, sourceType: true, sourceId: true },
      });
      const medications = final.medications.map((m) => ({
        medicationRequestId: null,
        name: m.name,
        sig: m.sig,
        change: fromDbChange(m.change),
      }));
      return {
        encounterId: enc.id,
        patientId: enc.patientId,
        encounterNumber: enc.number,
        encounterClass: enc.encounterClass as DischargeSummaryView['encounterClass'],
        encounterStatus: enc.status,
        kind: final.kind as DischargeSummaryKind,
        state: 'final',
        summary: {
          encounterId: enc.id,
          patientId: enc.patientId,
          ...pickFacts(stored.facts),
          condition: final.dischargeCondition.slice(0, 40),
          sections: stored.sections,
          medications: medications.map((m) => ({ name: m.name, sig: m.sig, change: m.change })),
          reconciliationConfirmedAt: stored.facts.reconciliationConfirmedAt,
          codes: stored.codes,
          checklist: labelled(stored.checklist),
          signedAt: final.recordedAt.toISOString(),
          signedBy: (meta?.author.nama ?? 'DPJP').slice(0, 80),
        },
        requiredChecks: required,
        sectionRefs: groupRefs(refs),
        notes: { ...EMPTY_NOTES },
        draft: null,
        disposition: final.disposition as DischargeDisposition,
        medications,
        reconciliation: stored.facts.reconciliationConfirmedAt
          ? { confirmedAt: stored.facts.reconciliationConfirmedAt, confirmedBy: meta?.author.nama ?? 'DPJP' }
          : null,
        final: {
          id: final.id,
          rootId: final.rootId,
          version: final.version,
          recordedAt: final.recordedAt.toISOString(),
          author: meta?.author as ClinicalAuthor,
          document: doc,
          locked: meta?.locked ?? false,
        },
        addenda,
        canSign,
      };
    }

    const compiled = await this.sources.compile(encounterId);
    const content = this.assemble(compiled, draft, new Date());
    const me = this.records.author();
    const myName = (await this.records.userNames([me.userId])).get(me.userId) ?? 'DPJP';
    const meds = draft?.input.medications ?? compiled.proposedMedications;
    return {
      encounterId: enc.id,
      patientId: enc.patientId,
      encounterNumber: enc.number,
      encounterClass: enc.encounterClass as DischargeSummaryView['encounterClass'],
      encounterStatus: enc.status,
      kind,
      state: draft ? 'draf' : 'belum',
      summary: {
        encounterId: enc.id,
        patientId: enc.patientId,
        ...pickFacts(content.facts),
        condition: (draft?.input.dischargeCondition ?? 'Belum diisi').slice(0, 40) || 'Belum diisi',
        sections: content.sections,
        medications: meds.map((m) => ({ name: m.name, sig: m.sig, change: m.change })),
        reconciliationConfirmedAt: content.facts.reconciliationConfirmedAt,
        codes: compiled.codes,
        checklist: labelled(content.checklist),
        signedAt: null,
        signedBy: null,
      },
      requiredChecks: required,
      sectionRefs: Object.fromEntries(
        Object.entries(this.sectionRefs(compiled)).map(([k, v]) => [k, dedupe(v ?? [])]),
      ),
      notes: draft?.input.notes ?? { ...EMPTY_NOTES },
      draft: draft?.input ?? null,
      disposition: draft?.input.disposition ?? null,
      medications: meds,
      reconciliation: content.facts.reconciliationConfirmedAt
        ? { confirmedAt: content.facts.reconciliationConfirmedAt, confirmedBy: myName }
        : null,
      final: null,
      addenda,
      canSign,
    };
  }

  private async addenda(finalId: string | null): Promise<DischargeAddendum[]> {
    if (!finalId) return [];
    const rows = await this.db.tx().dischargeSummary.findMany({
      where: { addendumOf: finalId, status: 'final', supersededBy: { none: {} } },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
    if (rows.length === 0) return [];
    const meta = await this.records.meta('discharge_summaries', rows);
    const out: DischargeAddendum[] = [];
    for (const r of rows) {
      const s = r.sections as { addendum?: unknown };
      out.push({
        id: r.id,
        text: typeof s.addendum === 'string' ? s.addendum : '',
        author: meta.get(r.id)?.author as ClinicalAuthor,
        recordedAt: r.recordedAt.toISOString(),
        document: await this.documentRef(r.id),
      });
    }
    return out;
  }

  private async documentRef(sourceId: string): Promise<DischargeDocumentRef | null> {
    const doc = await this.db.tx().document.findFirst({
      where: { sourceType: 'discharge_summaries', sourceId, voidedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        title: true,
        signatures: { orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], take: 1, select: { status: true } },
      },
    });
    if (!doc) return null;
    return {
      id: doc.id,
      title: doc.title,
      signatureStatus: (doc.signatures[0]?.status as SignatureStatus | undefined) ?? null,
    };
  }
}

function dedupe(refs: readonly DischargeSourceRef[]): DischargeSourceRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const k = `${r.type}:${r.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function groupRefs(rows: Array<{ section: string; sourceType: string; sourceId: string }>) {
  const out: Record<string, DischargeSourceRef[]> = {};
  for (const r of rows) {
    (out[r.section] ??= []).push({ type: r.sourceType as DischargeSourceRef['type'], id: r.sourceId });
  }
  return out;
}

function labelled(list: Array<{ id: ResumeCheckId; done: boolean }>): DischargeSummary['checklist'] {
  const byId = new Map(list.map((c) => [c.id, c.done]));
  return RESUME_CHECK_IDS.map((id) => ({ id, label: RESUME_CHECK_LABEL[id], done: byId.get(id) ?? false }));
}

function pickFacts(f: StoredSections['facts']) {
  return {
    admittedAt: f.admittedAt,
    dischargeAt: f.dischargeAt,
    admissionVia: f.admissionVia.slice(0, 40),
    dischargeMethod: f.dischargeMethod.slice(0, 60),
    location: f.location.slice(0, 60) || '-',
    dpjp: f.dpjp.slice(0, 80) || 'Belum ditetapkan',
  };
}

const CHANGE_LABEL: Record<DischargeMedicationLine['change'], string> = {
  baru: 'Baru',
  lanjut: 'Lanjut',
  'ubah-dosis': 'Ubah dosis',
  dihentikan: 'Dihentikan',
};

/** Isi PDF resume dari isi beku (sama persis dengan yang disimpan; tanpa jam render). */
function summaryPdfSections(
  stored: StoredSections,
  input: DischargeDraftInput,
  disposition: DischargeDisposition,
): ClinicalPdfInput['sections'] {
  const f = stored.facts;
  return [
    {
      title: 'Data kunjungan',
      blocks: [
        {
          kind: 'fields',
          rows: [
            { label: 'Masuk', value: `${formatTanggalWaktu(f.admittedAt)} · via ${f.admissionVia}` },
            { label: 'Pulang', value: formatTanggalWaktu(f.dischargeAt) },
            { label: 'Cara pulang', value: DISPOSITION_LABEL[disposition] },
            { label: 'Kondisi pulang', value: input.dischargeCondition ?? '-' },
          ],
        },
      ],
    },
    ...stored.sections
      .filter((s) => s.id !== 'obat-pulang')
      .map((s) => ({ title: s.title, blocks: [{ kind: 'paragraph' as const, text: s.body || '—' }] })),
    {
      title: 'Diagnosis dan prosedur (berkode)',
      blocks: [
        {
          kind: 'table' as const,
          columns: ['Sistem', 'Kode', 'Uraian', 'Keterangan'],
          widths: [1.2, 1, 5, 1.5],
          rows: stored.codes.map((c) => [c.system, c.code, c.label, c.primary ? 'Utama' : '']),
        },
      ],
    },
    {
      title: 'Obat pulang (rekonsiliasi)',
      blocks: [
        {
          kind: 'table' as const,
          columns: ['Status', 'Obat', 'Aturan pakai'],
          widths: [1.3, 3, 3],
          rows: input.medications.map((m) => [CHANGE_LABEL[m.change], m.name, m.sig]),
        },
        {
          kind: 'paragraph' as const,
          text: f.reconciliationConfirmedAt
            ? `Rekonsiliasi dikonfirmasi DPJP ${formatTanggalWaktu(f.reconciliationConfirmedAt)}.`
            : 'Rekonsiliasi obat pulang tidak dipersyaratkan untuk resume rawat jalan.',
        },
      ],
    },
  ];
}
