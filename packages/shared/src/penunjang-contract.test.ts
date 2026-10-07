import { describe, expect, it } from 'vitest';
import {
  aboCompatible,
  bloodIssueBlock,
  buildAck,
  buildOru,
  catalogPermissionKeys,
  checklistConfirmBlock,
  criticalEscalationLevel,
  criticalReportBlock,
  criticalReportInputSchema,
  DEFAULT_ROLE_GRANTS,
  dispensePrepareInputSchema,
  egfrCkdEpi2021,
  ERROR_CODES,
  formatDocumentNumber,
  imagingStartBlock,
  INBOUND_STATUSES,
  isDeviceOnlyResource,
  isTenantSettingKey,
  LAB_NO_PATTERN,
  labFlag,
  manualBatchBlock,
  numberPeriod,
  parseDomainEvent,
  parseOru,
  pickFefo,
  pickReferenceRange,
  redactHl7,
  reviewBlock,
  rhCompatible,
  stockAdjustmentInputSchema,
  surgeryEventBlock,
  surgeryCaseInputSchema,
  supportError,
  technicalValidationBlock,
  TENANT_SETTINGS,
  unreconciledCountItems,
  westgardEvaluate,
} from './index';
import { lisSignature, verifyLisSignature } from './node';

/** Fase 4 §4.0a · kontrak bersama penunjang: izin, penomoran, pengaturan, event, aturan murni, HL7. Data fiktif. */

const uuid = '01a107db-b268-746d-92f7-10598bb1cc42';
const uuid2 = '01a107db-b268-746d-92f7-10598bb1cc43';

describe('izin dan matriks penunjang', () => {
  it('katalog memuat izin fase 4; izin analyzer khusus perangkat', () => {
    const keys = catalogPermissionKeys();
    for (const k of [
      'lab.worklist.read',
      'lab.specimen.reject',
      'lab.result.release',
      'lab.master.write',
      'critical_result.report',
      'radiology.sign',
      'pharmacy.dispense.double_check',
      'stock.adjust',
      'formulary.write',
      'surgery.override',
      'nutrition.write',
      'blood_bank.issue',
      'diagnostics.sign',
      'lab.analyzer.ingest',
    ]) {
      expect(keys, k).toContain(k);
    }
    expect(isDeviceOnlyResource('lab.analyzer')).toBe(true);
  });

  it('analis tidak merilis klinis; dokter merilis lingkup unit; perawat hanya ambil spesimen; kasir tanpa penunjang', () => {
    const has = (role: keyof typeof DEFAULT_ROLE_GRANTS, r: string, a: string) =>
      DEFAULT_ROLE_GRANTS[role].find(([gr, ga]) => gr === r && ga === a)?.[2] ?? null;
    expect(has('analis_lab', 'lab.result', 'verify')).toBe('unit');
    expect(has('analis_lab', 'lab.result', 'release')).toBeNull();
    expect(has('analis_lab', 'lab.master', 'write')).toBeNull();
    expect(has('dokter', 'lab.result', 'release')).toBe('unit');
    expect(has('dokter', 'lab.worklist', 'read')).toBe('unit');
    expect(has('dokter', 'surgery', 'override')).toBe('relationship');
    expect(has('radiografer', 'radiology', 'sign')).toBeNull();
    expect(has('perawat', 'lab.specimen', 'collect')).toBe('relationship');
    expect(has('perawat', 'lab.result', 'write')).toBeNull();
    expect(has('apoteker', 'pharmacy.dispense', 'double_check')).toBe('unit');
    expect(has('manajemen', 'critical_result', 'review')).toBe('all');
    expect(has('admin_tenant', 'lab.master', 'write')).toBe('all');
    expect(has('ahli_gizi', 'nutrition', 'write')).toBe('unit');
    expect(
      DEFAULT_ROLE_GRANTS.kasir.filter(([r]) => /^(lab|radiology|pharmacy|stock|surgery)/.test(r)),
    ).toEqual([]);
  });
});

describe('penomoran, pengaturan, galat', () => {
  it('nomor lab harian dan nomor bulanan penunjang', () => {
    const at = '2026-10-07T03:00:00Z';
    const lab = formatDocumentNumber('lab_no', 12n, numberPeriod('lab_no', at));
    expect(lab).toBe('L2610070012');
    expect(lab).toMatch(LAB_NO_PATTERN);
    expect(formatDocumentNumber('rad_accession', 7n, numberPeriod('rad_accession', at))).toBe(
      'RAD-2610-0007',
    );
    expect(formatDocumentNumber('prescription_no', 1n, '2610')).toBe('R-2610-0001');
    expect(formatDocumentNumber('surgery_case', 1n, '2610')).toBe('OK-2610-0001');
    expect(formatDocumentNumber('stock_receipt', 1n, '2610')).toBe('TRM-2610-0001');
    expect(formatDocumentNumber('stock_transfer', 1n, '2610')).toBe('MUT-2610-0001');
    expect(formatDocumentNumber('blood_request', 1n, '2610')).toBe('BD-2610-0001');
    expect(() => formatDocumentNumber('lab_no', 10_000n, '261007')).toThrow(RangeError);
  });

  it('pengaturan bawaan fase 4 dan kode galat stabil', () => {
    expect(TENANT_SETTINGS['critical.report_limit_minutes'].default).toBe(30);
    expect(TENANT_SETTINGS['surgery.override_reason_min'].default).toBe(15);
    expect(isTenantSettingKey('stock.expiry_warning_days')).toBe(true);
    for (const c of [
      'CRITICAL_OPEN',
      'CDS_UNRESOLVED',
      'ROOM_OVERLAP',
      'TIMEOUT_REQUIRED',
      'BATCH_EXPIRED',
    ]) {
      expect(ERROR_CODES).toContain(c);
    }
    expect(supportError('STOCK_INSUFFICIENT').status).toBe(409);
    expect(INBOUND_STATUSES).toEqual(['received', 'processing', 'processed', 'failed', 'dead']);
  });

  it('event penunjang tanpa PHI', () => {
    const ok = {
      labOrderId: uuid,
      serviceRequestIds: [uuid2],
      encounterId: uuid,
      patientId: uuid2,
      unitId: uuid,
      priority: 'cito',
    };
    expect(parseDomainEvent('lab.order_accepted', ok)).toEqual(ok);
    expect(() => parseDomainEvent('lab.order_accepted', { ...ok, patientName: 'Fiktif' })).toThrow();
  });
});

describe('aturan lab dan nilai kritis', () => {
  it('flag, rentang per usia/JK, eGFR', () => {
    expect(labFlag(6.8, { low: 3.5, high: 5.1 }, { low: 2.5, high: 6 })).toBe('KRITIS');
    expect(labFlag(5.1, { low: 3.5, high: 5.1 }, null)).toBe('N');
    const ranges = [
      { sex: 'any' as const, ageMinDays: 0, ageMaxDays: null, id: 'umum' },
      { sex: 'female' as const, ageMinDays: 6570, ageMaxDays: null, id: 'perempuan-dewasa' },
    ];
    expect(pickReferenceRange(ranges, 'female', 20_000)?.id).toBe('perempuan-dewasa');
    expect(pickReferenceRange(ranges, 'male', 20_000)?.id).toBe('umum');
    expect(pickReferenceRange(ranges, 'female', 30)?.id).toBe('umum');
    expect(egfrCkdEpi2021(1, 60, 'male')).toBe(86);
  });

  it('laporan kritis wajib penerima + read-back; validasi teknis terblokir kritis terbuka/QC', () => {
    expect(criticalReportBlock({ recipient: null, readBackConfirmed: true })).toBe(
      'CRITICAL_RECIPIENT_REQUIRED',
    );
    expect(criticalReportBlock({ recipient: { name: 'dr A', role: 'DPJP' }, readBackConfirmed: true })).toBe(
      'CRITICAL_RECIPIENT_REQUIRED',
    );
    expect(criticalReportBlock({ recipient: { userId: uuid }, readBackConfirmed: false })).toBe(
      'CRITICAL_READBACK_REQUIRED',
    );
    expect(
      criticalReportBlock({ recipient: { name: 'dr. Andi Fiktif', role: 'DPJP' }, readBackConfirmed: true }),
    ).toBeNull();
    expect(
      criticalReportInputSchema.safeParse({
        recipient: { userId: uuid },
        channel: 'telepon',
        readBackText: 'Kalium 6,8',
        readBackConfirmed: true,
      }).success,
    ).toBe(true);
    const base = { resultsComplete: true, criticalOpen: false, qcRejected: false, qcOverrideReason: null };
    expect(technicalValidationBlock(base)).toBeNull();
    expect(technicalValidationBlock({ ...base, criticalOpen: true })).toBe('CRITICAL_OPEN');
    expect(technicalValidationBlock({ ...base, qcRejected: true })).toBe('QC_REJECTED');
    expect(
      technicalValidationBlock({ ...base, qcRejected: true, qcOverrideReason: 'Kontrol baru sudah lolos' }),
    ).toBeNull();
    expect(criticalEscalationLevel(29, 30, 30)).toBe(0);
    expect(criticalEscalationLevel(30, 30, 30)).toBe(1);
    expect(criticalEscalationLevel(61, 30, 30)).toBe(2);
  });

  it('Westgard: 1-2s peringatan, 1-3s/2-2s/R-4s tolak', () => {
    expect(westgardEvaluate(1, [0.5])).toEqual({ outcome: 'ok', violations: [] });
    expect(westgardEvaluate(2.5, [0.5]).outcome).toBe('warn');
    expect(westgardEvaluate(3.2, []).violations).toContain('1-3s');
    expect(westgardEvaluate(2.3, [2.1]).violations).toContain('2-2s');
    expect(westgardEvaluate(2.2, [-2.1]).violations).toContain('R-4s');
  });
});

describe('aturan farmasi, stok, radiologi, OK, darah', () => {
  it('FEFO: ED terdekat dulu, batch kedaluwarsa tidak ditawarkan, stok kurang ditolak', () => {
    const batches = [
      { id: 'b-lama', expiryDate: '2026-10-01', quantity: 50 },
      { id: 'b-dekat', expiryDate: '2026-11-01', quantity: 3 },
      { id: 'b-jauh', expiryDate: '2027-06-01', quantity: 10 },
    ];
    expect(pickFefo(batches, 5, '2026-10-07')).toEqual({
      ok: true,
      picks: [
        { batchId: 'b-dekat', quantity: 3 },
        { batchId: 'b-jauh', quantity: 2 },
      ],
    });
    expect(pickFefo(batches, 14, '2026-10-07')).toEqual({ ok: false, code: 'STOCK_INSUFFICIENT' });
    expect(manualBatchBlock(batches[0] as (typeof batches)[number], 1, '2026-10-07')).toBe('BATCH_EXPIRED');
    expect(
      dispensePrepareInputSchema.safeParse({
        items: [{ medicationRequestId: uuid, quantity: 1, stockBatchId: uuid2, fefoOverrideReason: null }],
      }).success,
    ).toBe(false);
    expect(
      stockAdjustmentInputSchema.safeParse({
        stockLocationId: uuid,
        items: [{ stockBatchId: uuid2, quantityDelta: 0 }],
        reason: 'Selisih opname bulanan',
      }).success,
    ).toBe(false);
    expect(reviewBlock('setujui', [{ status: 'terbuka', level: 'mayor' }])).toBe('CDS_UNRESOLVED');
    expect(reviewBlock('setujui', [{ status: 'terbuka', level: 'info' }])).toBeNull();
  });

  it('radiologi: kontras butuh skrining + eGFR, override hanya dokter beralasan', () => {
    const s = {
      identityConfirmed: true,
      contrast: true,
      screening: { contrastAllergyAsked: true, pregnancy: 'tidak_hamil' as const, fasting: true },
      contrastAllergy: false,
      egfr: 25,
      egfrMin: 30,
      sex: 'female' as const,
      ageYears: 40,
      overrideReason: null,
      canOverride: false,
    };
    expect(imagingStartBlock(s)).toBe('CONTRAST_SCREENING_REQUIRED');
    expect(imagingStartBlock({ ...s, egfr: 60 })).toBeNull();
    expect(
      imagingStartBlock({ ...s, canOverride: true, overrideReason: 'Indikasi vital, hidrasi diberikan' }),
    ).toBeNull();
    expect(imagingStartBlock({ ...s, identityConfirmed: false })).toBe('IDENTITY_REQUIRED');
  });

  it('OK: urutan daftar tilik, insisi butuh time out kecuali override ≥ 15, hitung harus cocok', () => {
    const base = { confirmedPhases: [] as Array<'sign-in' | 'time-out' | 'sign-out'>, uncheckedItems: 0 };
    expect(
      checklistConfirmBlock({ ...base, phase: 'time-out', incisionRecorded: false, countsReconciled: true }),
    ).toBe('CHECKLIST_ORDER');
    expect(
      checklistConfirmBlock({
        ...base,
        phase: 'sign-in',
        uncheckedItems: 1,
        incisionRecorded: false,
        countsReconciled: true,
      }),
    ).toBe('CHECKLIST_INCOMPLETE');
    expect(
      checklistConfirmBlock({
        confirmedPhases: ['sign-in', 'time-out'],
        uncheckedItems: 0,
        phase: 'sign-out',
        incisionRecorded: true,
        countsReconciled: false,
      }),
    ).toBe('COUNT_MISMATCH');
    const ev = { kind: 'insisi' as const, confirmedPhases: ['sign-in' as const], canOverride: true };
    expect(surgeryEventBlock({ ...ev, overrideReason: 'darurat' })).toBe('TIMEOUT_REQUIRED');
    expect(surgeryEventBlock({ ...ev, overrideReason: 'Perdarahan aktif, operasi segera' })).toBeNull();
    expect(
      surgeryEventBlock({ ...ev, canOverride: false, overrideReason: 'Perdarahan aktif, operasi segera' }),
    ).toBe('TIMEOUT_REQUIRED');
    expect(
      unreconciledCountItems(
        [
          { itemCode: 'kasa', kind: 'awal', quantity: 10 },
          { itemCode: 'kasa', kind: 'tambahan', quantity: 5 },
          { itemCode: 'kasa', kind: 'akhir', quantity: 14 },
          { itemCode: 'jarum', kind: 'awal', quantity: 4 },
          { itemCode: 'jarum', kind: 'akhir', quantity: 4 },
        ],
        [],
      ),
    ).toEqual(['kasa']);
    expect(
      surgeryCaseInputSchema.safeParse({
        encounterId: uuid,
        roomId: uuid2,
        startsAt: '2026-10-08T01:00:00Z',
        endsAt: '2026-10-08T00:00:00Z',
        priority: 'elektif',
        procedureName: 'Apendektomi',
        procedureCode: '47.09',
        team: [{ userId: uuid, role: 'operator' }],
      }).success,
    ).toBe(false);
  });

  it('darah: ABO/Rh kompatibel, crossmatch wajib, darurat hanya golongan O', () => {
    expect(aboCompatible('AB', 'A')).toBe(true);
    expect(aboCompatible('O', 'A')).toBe(false);
    expect(rhCompatible('neg', 'pos')).toBe(false);
    const s = {
      patientAbo: 'A' as const,
      patientRh: 'pos' as const,
      unitAbo: 'A' as const,
      unitRh: 'pos' as const,
      unitExpired: false,
      crossmatchCompatible: true,
      emergencyReason: null,
    };
    expect(bloodIssueBlock(s)).toBeNull();
    expect(bloodIssueBlock({ ...s, unitAbo: 'B' })).toBe('BLOOD_INCOMPATIBLE');
    expect(bloodIssueBlock({ ...s, crossmatchCompatible: false })).toBe('CROSSMATCH_REQUIRED');
    expect(
      bloodIssueBlock({
        ...s,
        patientAbo: null,
        patientRh: null,
        unitAbo: 'O',
        unitRh: 'neg',
        crossmatchCompatible: false,
        emergencyReason: 'Syok hemoragik, tidak sempat crossmatch',
      }),
    ).toBeNull();
    expect(bloodIssueBlock({ ...s, unitExpired: true })).toBe('BATCH_EXPIRED');
  });
});

describe('HL7 ORU^R01 dan tanda tangan perangkat', () => {
  const raw = [
    'MSH|^~\\&|ANALYZER-1|LAB|SIMRS|RS|20261007100000||ORU^R01|MSG-0001|P|2.5',
    'PID|1||00-00-00-01||FIKTIF^PASIEN||19600101|M',
    'NK1|1|FIKTIF^KELUARGA',
    'OBR|1||L2610070012|ELEK',
    'OBX|1|NM|2823-3^Kalium^LN||6,8|mmol/L|3.5-5.1|HH|||F',
    'NTE|1||Hemolisis \\T\\ dicek ulang',
    'OBX|2|ST|883-9^Golongan darah^LN||O||||||F',
  ].join('\r');

  it('parse barcode + observasi, redaksi PID/NK1', () => {
    const m = parseOru(raw);
    expect(m.controlId).toBe('MSG-0001');
    expect(m.orders).toHaveLength(1);
    expect(m.orders[0]?.specimenBarcode).toBe('L2610070012');
    expect(m.orders[0]?.observations[0]).toMatchObject({ code: '2823-3', numeric: 6.8, unit: 'mmol/L' });
    expect(m.orders[0]?.observations[0]?.notes).toEqual(['Hemolisis & dicek ulang']);
    expect(m.orders[0]?.observations[1]).toMatchObject({ valueType: 'ST', value: 'O', numeric: null });
    const red = redactHl7(raw);
    expect(red).not.toContain('FIKTIF');
    expect(red).toContain('PID|1');
    expect(parseOru(red).orders[0]?.observations).toHaveLength(2);
    expect(() => parseOru('MSH|^~\\&|A|B|C|D|x||ADT^A01|1|P|2.5')).toThrow(/ORU/);
    expect(() => parseOru('MSH|^~\\&|A|B|C|D|x||ORU^R01|1|P|2.5\rOBX|1|NM|x||1')).toThrow(/OBR/);
  });

  it('redaksi daftar izin: hanya MSH/SFT/ORC/OBR/OBX/NTE/SPM/TQ1 tersimpan; PD1/PV1/GT1/IN1/MRG/segmen Z dan PID berawalan spasi jadi SEG|1', () => {
    const msg = [
      'MSH|^~\\&|ALAT|LAB|SIMRS|RS|20261007100000||ORU^R01|MSG-9|P|2.5',
      '  PID|1||RM-777||WULANDARI^RINA||19900101|F',
      'pd1|||PUSKESMAS KENANGA',
      'PV1|1|I|MELATI^M-205||||9999^dr. Fiktif|||||||||||VN-00777',
      'GT1|1||WULANDARI^BUDI||Jl. Kenanga 12||081200001111',
      'IN1|1|BPJS|0001|BPJS||||||||||||WULANDARI^RINA|||19900101',
      'MRG|RM-111',
      'ZPI|1|WULANDARI',
      'ORC|RE|PL1|L2610070014',
      'OBR|1||L2610070014|ELEK',
      'obx|1|NM|2823-3^Kalium^LN||4,1|mmol/L|3.5-5.1|N|||F',
      'SPM|1|L2610070014',
    ].join('\r');
    const red = redactHl7(msg);
    expect(red).not.toMatch(/WULANDARI|RM-777|RM-111|KENANGA|Kenanga|081200001111|19900101|VN-00777|M-205/);
    expect(red.split('\r').map((s) => s.slice(0, 5))).toEqual([
      'MSH|^',
      'PID|1',
      'PD1|1',
      'PV1|1',
      'GT1|1',
      'IN1|1',
      'MRG|1',
      'ZPI|1',
      'ORC|R',
      'OBR|1',
      'OBX|1',
      'SPM|1',
    ]);
    // Segmen hasil tetap terbaca (id dinormalisasi huruf besar).
    expect(parseOru(red).orders[0]?.observations[0]).toMatchObject({ code: '2823-3', numeric: 4.1 });
  });

  it('bangun ORU/ACK bolak-balik', () => {
    const built = buildOru({
      controlId: 'MSG-2',
      sendingApplication: 'MOCK',
      sendingFacility: 'LAB',
      sentAt: '20261007100000',
      specimenBarcode: 'L2610070013',
      observations: [{ code: '2160-0', text: 'Kreatinin', value: '1.3', unit: 'mg/dL' }],
    });
    expect(parseOru(built).orders[0]?.observations[0]?.numeric).toBe(1.3);
    expect(buildAck('MSG-2', 'AA', '20261007100001')).toContain('MSA|AA|MSG-2');
  });

  it('HMAC perangkat: sah, salah, kedaluwarsa', () => {
    const now = new Date('2026-10-07T03:00:00Z');
    const ts = String(Math.floor(now.getTime() / 1000));
    const sig = lisSignature(ts, raw, 'kunci-uji');
    expect(
      verifyLisSignature({ timestamp: ts, signature: sig, rawBody: raw, secret: 'kunci-uji' }, now),
    ).toEqual({
      ok: true,
    });
    expect(
      verifyLisSignature({ timestamp: ts, signature: sig, rawBody: `${raw}x`, secret: 'kunci-uji' }, now).ok,
    ).toBe(false);
    expect(
      verifyLisSignature(
        { timestamp: ts, signature: sig, rawBody: raw, secret: 'kunci-uji' },
        new Date(now.getTime() + 6 * 60_000),
      ),
    ).toEqual({ ok: false, reason: 'TIMESTAMP_EXPIRED' });
  });
});
