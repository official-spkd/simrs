import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, AUDIT_ACTION_GROUPS } from './audit';
import {
  BPJS_APLICARE_UPDATE_OPERATION,
  CLINICAL_OPERATIONS,
  clinicalOutboxKey,
  isClinicalOperation,
  parseClinicalOperationPayload,
  SATUSEHAT_RESOURCES,
  satusehatUpsertOperation,
} from './clinical-outbox';
import { bpjsTaskForEvent, DOMAIN_EVENT_NAMES, parseDomainEvent } from './domain-events';
import { CLINICAL_ERROR_CODES, CLINICAL_ERRORS, clinicalError, ERROR_CODES, errorBodySchema } from './errors';
import { FRONT_OFFICE_OPERATIONS } from './front-office-outbox';
import { newId } from './ids';
import {
  allergyInputSchema,
  CLINICAL_DRAFT_MAX_BYTES,
  clinicalDraftInputSchema,
  clinicalEntryMetaSchema,
  clinicalRevisionSchema,
  conditionInputSchema,
  cpoeCatalogItemSchema,
  medicationOrderLineSchema,
  orderSubmitInputSchema,
  vitalSignsInputSchema,
} from './schemas/klinis';
import {
  cpptCreateInputSchema,
  emarMedicationSchema,
  medicationAdministrationInputSchema,
  triageAssessmentInputSchema,
  wristbandScanInputSchema,
} from './schemas/rawat-inap';
import { parseTenantSetting, TENANT_SETTINGS } from './settings';

const at = '2026-10-05T08:00:00+07:00';

describe('kontrak API klinis fase 3', () => {
  it('revisi: baru, koreksi (alasan ≥ 10), addendum; bentuk lain ditolak', () => {
    expect(clinicalRevisionSchema.safeParse({ kind: 'baru' }).success).toBe(true);
    const id = newId();
    expect(
      clinicalRevisionSchema.safeParse({
        kind: 'koreksi',
        supersedesId: id,
        correctionReason: 'Salah tulis dosis',
      }).success,
    ).toBe(true);
    expect(
      clinicalRevisionSchema.safeParse({ kind: 'koreksi', supersedesId: id, correctionReason: 'typo' })
        .success,
    ).toBe(false);
    expect(clinicalRevisionSchema.safeParse({ kind: 'addendum', addendumOf: id }).success).toBe(true);
    expect(clinicalRevisionSchema.safeParse({ kind: 'addendum', addendumOf: 'cppt-1' }).success).toBe(false);
  });

  it('penulis tidak pernah dari klien: field penulis/waktu catat di body ditolak (strict)', () => {
    const base = {
      encounterId: newId(),
      occurredAt: at,
      content: { format: 'soap', s: 'Sesak berkurang', o: '', a: 'Pneumonia membaik', p: '' },
      instruction: null,
      revision: { kind: 'baru' },
    };
    expect(cpptCreateInputSchema.safeParse(base).success).toBe(true);
    for (const extra of [
      { author: 'dr. X' },
      { authorUserId: newId() },
      { recordedAt: at },
      { role: 'dpjp' },
      { status: 'final' },
    ]) {
      expect(cpptCreateInputSchema.safeParse({ ...base, ...extra }).success, Object.keys(extra)[0]).toBe(
        false,
      );
    }
    expect(cpptCreateInputSchema.safeParse({ ...base, encounterId: 'kj-suryo' }).success).toBe(false);
  });

  it('meta entri membawa dua stempel waktu dan penulis {userId, nama, peran}', () => {
    const meta = {
      id: newId(),
      rootId: newId(),
      version: 2,
      supersedesId: newId(),
      addendumOf: null,
      status: 'final',
      correctionReason: 'Koreksi hasil ukur',
      occurredAt: at,
      recordedAt: at,
      lateEntry: false,
      author: { userId: newId(), nama: 'dr. Rina Kusuma', peran: 'dokter_residen' },
      locked: false,
    };
    expect(clinicalEntryMetaSchema.safeParse(meta).success).toBe(true);
    expect(clinicalEntryMetaSchema.safeParse({ ...meta, author: 'dr. Rina' }).success).toBe(false);
    expect(clinicalEntryMetaSchema.safeParse({ ...meta, status: 'draft' }).success).toBe(false);
  });

  it('biaya null diterima (sampai U01); ID katalog demo tetap sah untuk jalur presentasi', () => {
    const item = {
      id: 'sefadroksil-500',
      kind: 'obat',
      name: 'Sefadroksil 500 mg kapsul',
      meta: 'sefalosporin gen. 1',
      detail: '2 × 1',
      code: null,
      coverage: 'fornas',
      priority: 'rutin',
      tariff: null,
      keywords: '',
      substance: 'sefadroksil',
      classes: ['sefalosporin-1'],
      note: 'Aman.',
    };
    expect(cpoeCatalogItemSchema.safeParse(item).success).toBe(true);
    expect(cpoeCatalogItemSchema.safeParse({ ...item, id: newId(), tariff: '12000' }).success).toBe(true);
  });

  it('order api: ID UUID, satu obat ATAU satu racikan, frekuensi baku, override beralasan', () => {
    const med = {
      type: 'obat',
      drugId: newId(),
      compound: null,
      dose: '500 mg',
      route: 'oral',
      frequency: '3x1',
      customTimes: null,
      durationDays: 5,
      instructions: null,
      override: null,
    };
    expect(medicationOrderLineSchema.safeParse(med).success).toBe(true);
    expect(medicationOrderLineSchema.safeParse({ ...med, drugId: null }).success).toBe(false);
    const racikan = {
      ...med,
      drugId: null,
      compound: {
        name: 'Puyer batuk anak',
        dosageForm: 'puyer',
        quantity: 10,
        components: [
          { drugId: newId(), amount: '1/4 tablet' },
          { drugId: newId(), amount: '1/2 tablet' },
        ],
      },
    };
    expect(medicationOrderLineSchema.safeParse(racikan).success).toBe(true);
    expect(medicationOrderLineSchema.safeParse({ ...med, frequency: '5x1' }).success).toBe(false);
    expect(medicationOrderLineSchema.safeParse({ ...med, customTimes: ['22.00'] }).success).toBe(true);
    expect(medicationOrderLineSchema.safeParse({ ...med, override: 'singkat' }).success).toBe(false);
    expect(
      orderSubmitInputSchema.safeParse({ encounterId: newId(), orderSetId: null, items: [med] }).success,
    ).toBe(true);
    expect(
      orderSubmitInputSchema.safeParse({
        encounterId: newId(),
        orderSetId: null,
        items: [
          {
            type: 'layanan',
            orderableId: 'darah-lengkap',
            priority: 'rutin',
            instructions: null,
            override: null,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('diagnosis kunjungan wajib berperan; problem list tanpa peran; kode ICD-10 berformat', () => {
    const c = {
      encounterId: newId(),
      kind: 'encounter',
      role: 'utama',
      code: 'J18.9',
      clinicalStatus: 'active',
      note: null,
      occurredAt: at,
      revision: { kind: 'baru' },
    };
    expect(conditionInputSchema.safeParse(c).success).toBe(true);
    expect(conditionInputSchema.safeParse({ ...c, role: null }).success).toBe(false);
    expect(conditionInputSchema.safeParse({ ...c, kind: 'problem_list', role: null }).success).toBe(true);
    expect(conditionInputSchema.safeParse({ ...c, code: 'j18' }).success).toBe(false);
  });

  it('alergi: zat terkode atau teks; NKDA eksplisit tanpa isi', () => {
    const a = {
      patientId: newId(),
      encounterId: null,
      kind: 'alergi',
      substanceId: null,
      text: 'Amoksisilin',
      category: 'obat',
      criticality: 'tinggi',
      reaction: 'Urtikaria',
      occurredAt: at,
      revision: { kind: 'baru' },
    };
    expect(allergyInputSchema.safeParse(a).success).toBe(true);
    expect(allergyInputSchema.safeParse({ ...a, text: null }).success).toBe(false);
    const nkda = { ...a, kind: 'nkda', text: null, category: null, criticality: null, reaction: null };
    expect(allergyInputSchema.safeParse(nkda).success).toBe(true);
    expect(allergyInputSchema.safeParse({ ...nkda, text: 'Amoksisilin' }).success).toBe(false);
  });

  it('tanda vital: skor tidak diterima dari klien; triase: diskriminator baku', () => {
    const vs = {
      encounterId: newId(),
      occurredAt: at,
      temp: 37.6,
      hr: 92,
      rr: 22,
      sbp: 128,
      dbp: 80,
      spo2: 95,
      onOxygen: false,
      consciousness: 'A',
      weightKg: null,
    };
    expect(vitalSignsInputSchema.safeParse(vs).success).toBe(true);
    expect(vitalSignsInputSchema.safeParse({ ...vs, score: 0 }).success).toBe(false);
    const tri = {
      encounterId: newId(),
      occurredAt: at,
      vitals: { sbp: 158, dbp: 94, hr: 112, rr: 24, spo2: 94, temp: null, gcs: 15 },
      discriminators: ['nyeri_dada_kardiak'],
      chosenLevel: 2,
      overrideReason: null,
      revision: { kind: 'baru' },
    };
    expect(triageAssessmentInputSchema.safeParse(tri).success).toBe(true);
    expect(triageAssessmentInputSchema.safeParse({ ...tri, suggestedLevel: 3 }).success).toBe(false);
    expect(triageAssessmentInputSchema.safeParse({ ...tri, discriminators: ['bebas'] }).success).toBe(false);
  });

  it('eMAR: jam dinamis HH.MM; pemberian wajib scanId; ditunda/ditolak wajib alasan; tanpa jalur override gelang', () => {
    const slot = (time: string) => ({ time, state: 'jadwal', label: 'Sekarang' });
    const med = {
      id: 'obat-1',
      name: 'Insulin',
      sig: 'SC',
      kfa: null,
      highAlert: true,
      slots: [slot('22.00')],
    };
    expect(emarMedicationSchema.safeParse(med).success).toBe(true);
    expect(emarMedicationSchema.safeParse({ ...med, slots: [slot('14.00'), slot('02.30')] }).success).toBe(
      true,
    );
    expect(emarMedicationSchema.safeParse({ ...med, slots: [slot('24.00')] }).success).toBe(false);
    const adm = {
      medicationRequestId: newId(),
      scheduleId: newId(),
      scanId: newId(),
      labelCode: 'LBL-1',
      status: 'given',
      occurredAt: at,
      reason: null,
      doubleCheckUserId: null,
    };
    expect(medicationAdministrationInputSchema.safeParse(adm).success).toBe(true);
    expect(medicationAdministrationInputSchema.safeParse({ ...adm, scanId: null }).success).toBe(false);
    expect(medicationAdministrationInputSchema.safeParse({ ...adm, status: 'held' }).success).toBe(false);
    expect(
      medicationAdministrationInputSchema.safeParse({ ...adm, status: 'held', reason: 'Pasien mual muntah' })
        .success,
    ).toBe(true);
    expect(wristbandScanInputSchema.safeParse({ encounterId: newId(), code: 'GL-7Q2X' }).success).toBe(true);
    expect(
      wristbandScanInputSchema.safeParse({
        encounterId: newId(),
        code: null,
        overrideReason: 'Gelang rusak sekali',
      }).success,
    ).toBe(false);
  });
});

describe('registri bersama fase 3', () => {
  it('pengaturan klinis + nilai bawaan rencana §3.0a', () => {
    expect(TENANT_SETTINGS['clinical.late_entry_hours'].default).toBe(24);
    expect(TENANT_SETTINGS['cppt.verify_hours'].default).toBe(24);
    expect(TENANT_SETTINGS['triage.scale'].default).toBe('ATS');
    expect(TENANT_SETTINGS['emar.scan_valid_minutes'].default).toBe(10);
    expect(TENANT_SETTINGS['emar.late_minutes'].default).toBe(60);
    expect(TENANT_SETTINGS['emar.require_pharmacy_review'].default).toBe(false);
    expect(TENANT_SETTINGS['ews.escalation_score'].default).toBe(5);
    expect(TENANT_SETTINGS['bed.boarding_alert_hours'].default).toBe(4);
    expect(() => parseTenantSetting('triage.scale', 'MTS')).toThrow();
    expect(() => parseTenantSetting('emar.scan_valid_minutes', 60)).toThrow();
  });

  it('aksi audit co-sign masuk kelompok ubah', () => {
    expect(AUDIT_ACTIONS).toContain('cosign');
    expect(AUDIT_ACTION_GROUPS.ubah.actions).toContain('cosign');
  });

  it('event domain klinis: muatan datar tanpa PHI, tidak membentuk task BPJS', () => {
    for (const name of [
      'encounter.started',
      'encounter.finished',
      'cppt.finalized',
      'order.activated',
      'order.cancelled',
      'medication.administered',
      'adt.admitted',
      'adt.transferred',
      'adt.discharged',
      'bed.status_changed',
      'discharge.signed',
      'consent.signed',
    ]) {
      expect(DOMAIN_EVENT_NAMES, name).toContain(name);
    }
    const payload = parseDomainEvent('bed.status_changed', {
      bedId: newId(),
      unitId: newId(),
      fromStatus: 'terisi',
      toStatus: 'kotor',
      version: 3,
    });
    expect(bpjsTaskForEvent({ name: 'bed.status_changed', payload, occurredAt: at })).toBeNull();
    expect(() =>
      parseDomainEvent('cppt.finalized', {
        cpptId: newId(),
        encounterId: newId(),
        patientId: newId(),
        cosignRequired: true,
        text: 'isi catatan',
      }),
    ).toThrow();
  });

  it('operasi outbox klinis: Aplicare + SATUSEHAT per resource, payload ID saja, nama unik lintas registri', () => {
    expect(BPJS_APLICARE_UPDATE_OPERATION).toBe('bpjs.aplicare.update');
    expect(satusehatUpsertOperation('AllergyIntolerance')).toBe('satusehat.allergyintolerance.upsert');
    for (const r of SATUSEHAT_RESOURCES) {
      const op = satusehatUpsertOperation(r);
      expect(isClinicalOperation(op), op).toBe(true);
      expect(CLINICAL_OPERATIONS[op].target).toBe('satusehat');
    }
    const id = newId();
    expect(
      parseClinicalOperationPayload('satusehat.encounter.upsert', { sourceId: id, revision: 1 }),
    ).toEqual({
      sourceId: id,
      revision: 1,
    });
    expect(() =>
      parseClinicalOperationPayload('satusehat.condition.upsert', {
        sourceId: id,
        revision: 1,
        code: 'J18.9',
      }),
    ).toThrow();
    expect(clinicalOutboxKey('bpjs.aplicare.update', id, 4)).toBe(`bpjs.aplicare.update:${id}:4`);
    const frontOffice = new Set(Object.keys(FRONT_OFFICE_OPERATIONS));
    expect(Object.keys(CLINICAL_OPERATIONS).filter((k) => frontOffice.has(k))).toEqual([]);
  });

  it('kode galat klinis: status + pesan, ikut ERROR_CODES, lolos errorBodySchema', () => {
    expect([...CLINICAL_ERROR_CODES].sort()).toEqual(Object.keys(CLINICAL_ERRORS).sort());
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const code of CLINICAL_ERROR_CODES) {
      expect(ERROR_CODES).toContain(code);
      const e = clinicalError(code);
      expect(e.status).toBe(CLINICAL_ERRORS[code].status);
      expect(errorBodySchema.safeParse({ code, message: e.message }).success).toBe(true);
    }
    expect(clinicalError('RECORD_LOCKED').status).toBe(409);
    expect(clinicalError('TRIAGE_REASON_REQUIRED').status).toBe(422);
    expect(clinicalError('PRIMARY_DIAGNOSIS_EXISTS').status).toBe(409);
    expect(clinicalError('PRIMARY_DPJP_EXISTS').status).toBe(409);
  });
});

describe('draf klinis: batas ukuran dalam byte UTF-8', () => {
  it('teks multi-byte dihitung per byte, bukan per karakter', () => {
    const ascii = 'a'.repeat(CLINICAL_DRAFT_MAX_BYTES - 20);
    expect(clinicalDraftInputSchema.safeParse({ content: { s: ascii } }).success).toBe(true);
    // Karakter 3 byte: jumlah karakter di bawah batas, ukuran byte jauh di atasnya.
    const multi = '\u2603'.repeat(Math.floor(CLINICAL_DRAFT_MAX_BYTES / 2));
    expect(clinicalDraftInputSchema.safeParse({ content: { s: multi } }).success).toBe(false);
  });
});
