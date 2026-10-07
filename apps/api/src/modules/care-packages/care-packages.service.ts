import { Injectable } from '@nestjs/common';
import {
  AppError,
  CARE_SETTING_OF_CLASS,
  type CarePackageItem,
  type CarePackageItemInput,
  type CareSetting,
  type EncounterCompleteness,
  newId,
} from '@simrs/shared';
import { clinicalEncounter } from '../../infra/clinical/clinical-context';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';

/**
 * K15 · Paket formulir per setting (rawat jalan, IGD, rawat inap) dan kelengkapan asesmen kunjungan (EP 6b/7a,
 * rencana fase 3 §3.8, ADR-0059; keputusan no. 18: hanya mekanisme). Paket = master `form_packages` (diubah, tidak dihapus);
 * kelengkapan = setiap formulir wajib paket punya isian final terkini dengan `encounterId` kunjungan itu.
 */
@Injectable()
export class CarePackagesService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
  ) {}

  async list(setting: CareSetting): Promise<CarePackageItem[]> {
    const rows = await this.db.tx().formPackage.findMany({
      where: { setting },
      orderBy: [{ sortOrder: 'asc' }, { formCode: 'asc' }],
    });
    const titles = await this.titles(rows.map((r) => r.formCode));
    return rows.map((r) => ({
      formCode: r.formCode,
      formTitle: titles.get(r.formCode) ?? null,
      required: r.required,
      sortOrder: r.sortOrder,
      active: r.active,
    }));
  }

  /** Pasang atau ubah satu butir paket (master; perubahan diaudit). Formulir harus sudah ada di RS ini. */
  async upsert(
    setting: CareSetting,
    formCode: string,
    input: CarePackageItemInput,
  ): Promise<CarePackageItem> {
    const tx = this.db.tx();
    const def = await tx.formDefinition.findFirst({ where: { code: formCode }, select: { id: true } });
    if (!def) throw new AppError('NOT_FOUND', 'Formulir tidak ditemukan', 404);
    const tenantId = this.db.tenantId();
    const actor = this.db.actorUserId();
    const row = await tx.formPackage.upsert({
      where: { tenantId_setting_formCode: { tenantId, setting, formCode } },
      update: { ...input, updatedBy: actor },
      create: { id: newId(), tenantId, setting, formCode, ...input, createdBy: actor, updatedBy: actor },
    });
    this.db.audit({
      action: 'update',
      resourceType: 'form_package',
      resourceId: row.id,
      details: { setting, formCode, ...input },
    });
    const titles = await this.titles([formCode]);
    return {
      formCode: row.formCode,
      formTitle: titles.get(formCode) ?? null,
      required: row.required,
      sortOrder: row.sortOrder,
      active: row.active,
    };
  }

  async completeness(encounterId: string): Promise<EncounterCompleteness> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    const setting = CARE_SETTING_OF_CLASS[enc.encounterClass as keyof typeof CARE_SETTING_OF_CLASS];
    if (!setting) throw new AppError('VALIDATION_FAILED', 'Kelas kunjungan tanpa paket formulir', 422);
    const tx = this.db.tx();
    const items = await tx.formPackage.findMany({
      where: { setting, active: true },
      orderBy: [{ sortOrder: 'asc' }, { formCode: 'asc' }],
    });
    const responses = await tx.formResponse.findMany({
      where: {
        encounterId: enc.id,
        formCode: { in: items.map((i) => i.formCode) },
        status: 'final',
        supersededBy: { none: {} },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, formCode: true, createdAt: true },
    });
    const titles = await this.titles(items.map((i) => i.formCode));
    const out = items.map((i) => {
      const r = responses.find((x) => x.formCode === i.formCode);
      return {
        formCode: i.formCode,
        formTitle: titles.get(i.formCode) ?? null,
        required: i.required,
        filled: !!r,
        responseId: r?.id ?? null,
        filledAt: r?.createdAt.toISOString() ?? null,
      };
    });
    this.db.audit({
      action: 'read',
      resourceType: 'encounter_completeness',
      resourceId: enc.id,
      patientId: enc.patientId,
    });
    const required = out.filter((i) => i.required);
    return {
      encounterId: enc.id,
      setting,
      complete: required.every((i) => i.filled),
      requiredFilled: required.filter((i) => i.filled).length,
      requiredTotal: required.length,
      items: out,
    };
  }

  /** Judul versi terbit terakhir per kode formulir. */
  private async titles(codes: string[]): Promise<Map<string, string>> {
    if (codes.length === 0) return new Map();
    const defs = await this.db.tx().formDefinition.findMany({
      where: { code: { in: codes }, status: 'published' },
      orderBy: { version: 'desc' },
      select: { code: true, title: true },
    });
    const map = new Map<string, string>();
    for (const d of defs) if (!map.has(d.code)) map.set(d.code, d.title);
    return map;
  }
}
