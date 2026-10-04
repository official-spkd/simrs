import { describe, expect, it } from 'vitest';
import {
  admissionSchema,
  ANTREAN_JENIS_KUNJUNGAN,
  ANTREAN_TASK_IDS,
  AppError,
  bookingSchema,
  BPJS_VISIT_KINDS,
  bpjsParticipantLookupSchema,
  bpjsRejectedDetailsSchema,
  bpjsTaskIdSchema,
  bpjsTaskForEvent,
  callTicketSchema,
  classifyBpjsRejection,
  createBookingSchema,
  createControlLetterSchema,
  createOutgoingReferralSchema,
  defaultQuotaSplit,
  DOMAIN_EVENT_NAMES,
  type DomainEvent,
  emergencyRegistrationSchema,
  ERROR_CODES,
  errorBodySchema,
  FRONT_OFFICE_ERROR_CODES,
  FRONT_OFFICE_ERRORS,
  FRONT_OFFICE_OPERATIONS,
  frontOfficeError,
  generalConsentInputSchema,
  hfisDifferenceSchema,
  isDomainEventName,
  kioskBirthDayMonth,
  kioskIdentifyResultSchema,
  kioskIdentifySchema,
  kioskRegisterSchema,
  kioskTicketRequestSchema,
  maskNameForKiosk,
  newId,
  outboxEnvelopeSchema,
  outboxKey,
  outpatientRegistrationSchema,
  parseDomainEvent,
  parseFrontOfficePayload,
  patientWhatsappText,
  practitionerQuotaSchema,
  printableSepSchema,
  publicBookingStatusQuerySchema,
  queueDisplayEventSchema,
  QUEUE_NOTIFY_CHANNEL,
  recordIncomingReferralSchema,
  registrationDeskSchema,
  reviseSepSchema,
  scheduleCellId,
  scheduleSessionQuerySchema,
  scheduleSlotSchema,
  scheduleTemplateInputSchema,
  scheduleWeekQuerySchema,
  transferBookingsSchema,
  updateSessionQuotaSchema,
} from './index';

const uuid = () => newId();
const AT = '2026-10-05T07:10:00+07:00';

describe('galat front office', () => {
  it('setiap kode punya status + pesan, ikut ERROR_CODES, dan lolos errorBodySchema (web)', () => {
    expect([...FRONT_OFFICE_ERROR_CODES].sort()).toEqual(Object.keys(FRONT_OFFICE_ERRORS).sort());
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const code of FRONT_OFFICE_ERROR_CODES) {
      expect(ERROR_CODES).toContain(code);
      const { status, message } = FRONT_OFFICE_ERRORS[code];
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(message.length, code).toBeGreaterThan(5);
      expect(errorBodySchema.safeParse({ code, message }).success, code).toBe(true);
    }
    for (const code of [
      'QUOTA_FULL',
      'QUOTA_BELOW_BOOKED',
      'BOOKING_NOT_FOUND',
      'SEP_DUPLICATE',
      'BPJS_UNAVAILABLE',
      'DEVICE_NOT_ALLOWED',
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('selaras kontrak kawat BPJS: jenis kunjungan, task ID, alasan penolakan', () => {
    expect(Object.values(BPJS_VISIT_KINDS).map((v) => v.code)).toEqual(
      Object.values(ANTREAN_JENIS_KUNJUNGAN),
    );
    for (const id of ANTREAN_TASK_IDS) expect(bpjsTaskIdSchema.safeParse(id).success, String(id)).toBe(true);
    expect(bpjsTaskIdSchema.safeParse(8).success).toBe(false);
    const reason = classifyBpjsRejection('Status peserta tidak aktif');
    expect(reason).toBe('BPJS_PESERTA_TIDAK_AKTIF');
    expect(
      bpjsRejectedDetailsSchema.safeParse({ reason, bpjsMessage: 'Status peserta tidak aktif' }).success,
    ).toBe(true);
    expect(
      bpjsRejectedDetailsSchema.safeParse({ reason: classifyBpjsRejection('pesan baru'), bpjsMessage: 'x' })
        .success,
    ).toBe(true);
    expect(bpjsRejectedDetailsSchema.safeParse({ reason: 'BPJS_KARANGAN', bpjsMessage: 'x' }).success).toBe(
      false,
    );
    expect(frontOfficeError('BPJS_REJECTED').status).toBe(422);
  });

  it('frontOfficeError: status bawaan, pesan bisa dipertajam', () => {
    const e = frontOfficeError('BPJS_UNAVAILABLE', { target: 'vclaim' });
    expect(e).toBeInstanceOf(AppError);
    expect([e.code, e.status]).toEqual(['BPJS_UNAVAILABLE', 503]);
    expect(e.details).toEqual({ target: 'vclaim' });
    expect(frontOfficeError('QUOTA_FULL', undefined, 'Kuota JKN penuh').message).toBe('Kuota JKN penuh');
    expect(frontOfficeError('DEVICE_NOT_ALLOWED').status).toBe(403);
    expect(frontOfficeError('BOOKING_NOT_FOUND').status).toBe(404);
  });
});

describe('operasi outbox front office', () => {
  it('nama operasi sesuai rencana; target benar; payload hanya ID (tanpa PHI)', () => {
    expect(Object.keys(FRONT_OFFICE_OPERATIONS).sort()).toEqual(
      [
        'bpjs.antrean.add',
        'bpjs.antrean.batal',
        'bpjs.antrean.updatewaktu',
        'bpjs.hfis.update',
        'bpjs.vclaim.rencanakontrol.insert',
        'bpjs.vclaim.rujukan.insert',
        'bpjs.vclaim.sep.delete',
        'bpjs.vclaim.sep.insert',
        'bpjs.vclaim.sep.update',
        'bpjs.vclaim.spri.insert',
        'patient.whatsapp.booking_reminder',
        'patient.whatsapp.schedule_changed',
      ].sort(),
    );
    for (const [op, def] of Object.entries(FRONT_OFFICE_OPERATIONS)) {
      expect(def.target, op).toBe(op.startsWith('bpjs.') ? 'bpjs' : 'whatsapp');
      const keys = Object.keys(def.payload.shape);
      expect(
        keys.every((k) => /Id$|^revision$/.test(k)),
        `${op}: ${keys.join(',')}`,
      ).toBe(true);
    }
  });

  it('payload ketat: field tambahan (mis. NIK) ditolak; amplop outbox menerima payload sah', () => {
    const sepId = uuid();
    expect(parseFrontOfficePayload('bpjs.vclaim.sep.insert', { sepId })).toEqual({ sepId });
    expect(() =>
      parseFrontOfficePayload('bpjs.vclaim.sep.insert', { sepId, nik: '3174000000000001' }),
    ).toThrow();
    expect(() =>
      parseFrontOfficePayload('bpjs.hfis.update', { practitionerId: uuid(), unitId: uuid() }),
    ).toThrow();
    const env = outboxEnvelopeSchema.parse({
      target: FRONT_OFFICE_OPERATIONS['bpjs.vclaim.sep.insert'].target,
      operation: 'bpjs.vclaim.sep.insert',
      idempotencyKey: outboxKey('bpjs.vclaim.sep.insert', sepId),
      payload: { sepId },
    });
    expect(env.idempotencyKey).toBe(`bpjs.vclaim.sep.insert:${sepId}`);
    expect(outboxKey('bpjs.hfis.update', sepId, 3)).toBe(`bpjs.hfis.update:${sepId}:3`);
  });

  it('teks WhatsApp pasien tanpa isi klinis (tanpa poli/dokter/diagnosis)', () => {
    const v = {
      hospitalName: 'RS Fiktif',
      dateLabel: 'Sel, 6 Okt 2026',
      time: '08.00',
      bookingCode: '2610060117',
    };
    for (const kind of ['booking_reminder', 'schedule_changed'] as const) {
      const text = patientWhatsappText(kind, v);
      expect(text).toContain('2610060117');
      expect(text).toContain('RS Fiktif');
      expect(text).not.toMatch(/poli|dokter|dr\.|diagnos/i);
    }
  });
});

describe('event domain', () => {
  const appointmentId = uuid();
  const patientId = uuid();
  const ticket = { ticketId: uuid(), queueServiceId: uuid(), appointmentId, encounterId: null };
  /** Amplop minimal: waktu kejadian dari publisher API (Date), muatan dari skema shared. */
  const ev = (e: Omit<DomainEvent, 'occurredAt'>) =>
    bpjsTaskForEvent({ ...e, occurredAt: new Date(AT) } as DomainEvent)?.taskId ?? null;

  it('daftar nama event sesuai rencana fase 2 (+ booking.cancelled untuk task 99)', () => {
    expect([...DOMAIN_EVENT_NAMES].sort()).toEqual(
      [
        'booking.cancelled',
        'booking.checked_in',
        'encounter.cancelled',
        'encounter.registered',
        'queue.ticket_called',
        'queue.ticket_finished',
        'queue.ticket_started',
        'sep.issued',
      ].sort(),
    );
    expect(isDomainEventName('queue.ticket_called')).toBe(true);
    expect(isDomainEventName('toString')).toBe(false);
  });

  it('muatan ketat tanpa PHI; tenant dan waktu milik amplop, bukan muatan', () => {
    const ok = { appointmentId, patientId };
    expect(parseDomainEvent('booking.checked_in', ok)).toEqual(ok);
    expect(() => parseDomainEvent('booking.checked_in', { ...ok, patientName: 'Fiktif' })).toThrow();
    expect(() => parseDomainEvent('booking.checked_in', { ...ok, tenantId: uuid() })).toThrow();
    expect(() =>
      parseDomainEvent('queue.ticket_called', {
        ...ticket,
        serviceKind: 'poli',
        callId: uuid(),
        recall: false,
        x: 1,
      }),
    ).toThrow();
  });

  it('task ID dari event: check-in 1, panggil loket 2, terdaftar 3, poli mulai/selesai 4/5, batal 99', () => {
    expect(ev({ name: 'booking.checked_in', payload: { appointmentId, patientId } })).toBe(1);
    const called = { ...ticket, callId: uuid(), recall: false };
    expect(ev({ name: 'queue.ticket_called', payload: { ...called, serviceKind: 'admisi' } })).toBe(2);
    expect(
      ev({ name: 'queue.ticket_called', payload: { ...called, serviceKind: 'admisi', recall: true } }),
    ).toBeNull();
    expect(ev({ name: 'queue.ticket_called', payload: { ...called, serviceKind: 'poli' } })).toBeNull();
    const registered = {
      encounterId: uuid(),
      patientId,
      unitId: uuid(),
      appointmentId,
      payer: 'bpjs' as const,
    };
    expect(ev({ name: 'encounter.registered', payload: { ...registered, class: 'rawat_jalan' } })).toBe(3);
    expect(ev({ name: 'encounter.registered', payload: { ...registered, class: 'igd' } })).toBeNull();
    expect(ev({ name: 'queue.ticket_started', payload: { ...ticket, serviceKind: 'poli' } })).toBe(4);
    expect(ev({ name: 'queue.ticket_finished', payload: { ...ticket, serviceKind: 'poli' } })).toBe(5);
    expect(ev({ name: 'queue.ticket_started', payload: { ...ticket, serviceKind: 'farmasi' } })).toBe(6);
    expect(ev({ name: 'queue.ticket_finished', payload: { ...ticket, serviceKind: 'farmasi' } })).toBe(7);
    expect(ev({ name: 'queue.ticket_started', payload: { ...ticket, serviceKind: 'kasir' } })).toBeNull();
    expect(ev({ name: 'booking.cancelled', payload: { appointmentId, patientId } })).toBe(99);
    expect(
      ev({ name: 'encounter.cancelled', payload: { encounterId: uuid(), patientId, appointmentId } }),
    ).toBe(99);
    // Tanpa booking (walk-in non-JKN, tiket tanpa appointment) tidak ada task.
    expect(
      ev({ name: 'queue.ticket_started', payload: { ...ticket, appointmentId: null, serviceKind: 'poli' } }),
    ).toBeNull();
    expect(ev({ name: 'sep.issued', payload: { sepId: uuid(), encounterId: uuid() } })).toBeNull();
    // Waktu task = waktu kejadian amplop, ISO 8601 (Date atau string).
    expect(
      bpjsTaskForEvent({
        name: 'booking.checked_in',
        payload: { appointmentId, patientId },
        occurredAt: AT,
      }),
    ).toEqual({ appointmentId, taskId: 1, at: new Date(AT).toISOString() });
  });
});

describe('model tampilan front office (revisi)', () => {
  const slot = {
    id: scheduleCellId('dr-andini', '2026-10-05'),
    sessionId: uuid(),
    date: '2026-10-05',
    kind: 'praktik',
    start: '08.00',
    end: '12.00',
    quota: { jkn: 24, nonJkn: 6, bookedJkn: 17, bookedNonJkn: 5 },
    relatedDoctorId: null,
    affectedPatients: null,
    hfisSynced: true,
  };

  it('ID sel jadwal = UUID deterministik; slot libur tanpa sesi, slot praktik bersesi', () => {
    expect(scheduleCellId('dr-andini', '2026-10-05')).toBe(scheduleCellId('dr-andini', '2026-10-05'));
    expect(scheduleCellId('dr-andini', '2026-10-05')).not.toBe(scheduleCellId('dr-andini', '2026-10-06'));
    expect(scheduleSlotSchema.safeParse(slot).success).toBe(true);
    expect(scheduleSlotSchema.safeParse({ ...slot, id: 'dr-andini.2026-10-05' }).success).toBe(false);
    expect(scheduleSlotSchema.safeParse({ ...slot, sessionId: null }).success).toBe(false);
    const libur = { ...slot, kind: 'libur', start: null, end: null, quota: null };
    expect(scheduleSlotSchema.safeParse({ ...libur, sessionId: null }).success).toBe(true);
    expect(scheduleSlotSchema.safeParse(libur).success).toBe(false);
    expect(hfisDifferenceSchema.safeParse({ slotId: 'dr-bagus.2026-10-07', text: 'x' }).success).toBe(false);
  });

  it('meja pendaftaran tanpa daftar pasien pra-muat dan tanpa latensi VClaim', () => {
    const quota = {
      sessionId: uuid(),
      doctorId: 'dr-andini',
      doctorName: 'dr. Fiktif, Sp.PD',
      poliCode: 'PD',
      poliName: 'Penyakit Dalam',
      room: 'Ruang 2',
      start: '08.00',
      end: '12.00',
      jkn: { booked: 17, total: 24 },
      nonJkn: { booked: 5, total: 6 },
      nextQueueNo: 'PD-032',
      eta: '11.20',
    };
    expect(practitionerQuotaSchema.safeParse(quota).success).toBe(true);
    const desk = {
      date: '2026-10-05',
      counter: { name: 'Loket 3', waiting: 14, tickets: [{ ticket: 'A-028', patientId: null }] },
      quotas: [quota],
    };
    expect(registrationDeskSchema.safeParse(desk).success).toBe(true);
    expect(registrationDeskSchema.safeParse({ ...desk, patients: [] }).success).toBe(false);
    expect(registrationDeskSchema.safeParse({ ...desk, vclaimLatencyMs: 320 }).success).toBe(false);
  });
});

describe('kontrak API jadwal (F01)', () => {
  it('pembagian kuota bawaan 80% JKN mengikuti mockup Jadwal', () => {
    expect(defaultQuotaSplit(30, 80)).toEqual({ jkn: 24, nonJkn: 6 });
    expect(defaultQuotaSplit(25, 80)).toEqual({ jkn: 20, nonJkn: 5 });
    expect(defaultQuotaSplit(7, 80)).toEqual({ jkn: 6, nonJkn: 1 });
    expect(defaultQuotaSplit(10, 0)).toEqual({ jkn: 0, nonJkn: 10 });
    expect(() => defaultQuotaSplit(-1, 80)).toThrow(RangeError);
    expect(() => defaultQuotaSplit(10, 120)).toThrow(RangeError);
  });

  it('templat: jam berurutan, kuota bulat, field asing ditolak', () => {
    const t = {
      practitionerId: uuid(),
      unitId: uuid(),
      weekday: 1,
      start: '08:00',
      end: '12:00',
      quotaJkn: 24,
      quotaNonJkn: 6,
      validFrom: '2026-10-05',
    };
    expect(scheduleTemplateInputSchema.safeParse(t).success).toBe(true);
    expect(scheduleTemplateInputSchema.safeParse({ ...t, end: '07:00' }).success).toBe(false);
    expect(scheduleTemplateInputSchema.safeParse({ ...t, start: '08.00' }).success).toBe(false);
    expect(scheduleTemplateInputSchema.safeParse({ ...t, weekday: 8 }).success).toBe(false);
    expect(scheduleTemplateInputSchema.safeParse({ ...t, validUntil: '2026-10-01' }).success).toBe(false);
    expect(scheduleTemplateInputSchema.safeParse({ ...t, tenantId: uuid() }).success).toBe(false);
    expect(updateSessionQuotaSchema.safeParse({ quotaJkn: 1.5, quotaNonJkn: 0 }).success).toBe(false);
  });

  it('minggu dimulai Senin; rentang sesi maks. 31 hari; alih booking berjenis', () => {
    expect(scheduleWeekQuerySchema.safeParse({ weekStart: '2026-10-05' }).success).toBe(true);
    expect(scheduleWeekQuerySchema.safeParse({ weekStart: '2026-10-06' }).success).toBe(false);
    expect(scheduleSessionQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    expect(scheduleSessionQuerySchema.safeParse({ from: '2026-10-01', to: '2026-11-02' }).success).toBe(
      false,
    );
    expect(transferBookingsSchema.parse({ target: { kind: 'substitute' } }).notifyPatients).toBe(true);
    expect(transferBookingsSchema.safeParse({ target: { kind: 'session' } }).success).toBe(false);
  });
});

describe('kontrak API booking (F02)', () => {
  it('JKN wajib rujukan/surat kontrol; non-JKN tanpa rujukan; kanal staf dibatasi', () => {
    const base = { patientId: uuid(), sessionId: uuid() };
    const jkn = { visitKind: 'kontrol', referenceNumber: '0301r0011025k000117' };
    const parsed = createBookingSchema.parse({ ...base, payer: 'jkn', jkn });
    expect(parsed.source).toBe('loket');
    expect(parsed.jkn?.referenceNumber).toBe('0301R0011025K000117');
    expect(createBookingSchema.safeParse({ ...base, payer: 'jkn' }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...base, payer: 'non_jkn', jkn }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...base, payer: 'non_jkn', source: 'mobile_jkn' }).success).toBe(
      false,
    );
  });

  it('booking keluaran: kode 10 digit, nomor antrean poli', () => {
    const b = {
      id: uuid(),
      bookingCode: '2610050117',
      status: 'booked',
      source: 'aplikasi',
      payer: 'jkn',
      patientId: uuid(),
      sessionId: uuid(),
      serviceDate: '2026-10-05',
      start: '08:00',
      end: '12:00',
      practitionerId: uuid(),
      practitionerName: 'dr. Fiktif, Sp.PD',
      unitId: uuid(),
      poliCode: 'PD',
      poliName: 'Penyakit Dalam',
      queueNo: 'PD-027',
      estimatedAt: AT,
      jkn: { visitKind: 'kontrol', referenceNumber: '0301R0011025K000117' },
      checkedInAt: null,
      cancelledAt: null,
      cancelReason: null,
      rescheduledToId: null,
      bpjs: { status: 'pending', sentAt: null, error: null },
      createdAt: AT,
    };
    expect(bookingSchema.safeParse(b).success).toBe(true);
    expect(bookingSchema.safeParse({ ...b, bookingCode: '261005011' }).success).toBe(false);
  });
});

describe('kontrak API antrean (F04)', () => {
  it('panggil butuh loket/ruang; event SSE call/board tanpa PHI; kanal notify sesuai ADR-0026', () => {
    expect(callTicketSchema.safeParse({ counter: 'Loket 3' }).success).toBe(true);
    expect(callTicketSchema.safeParse({}).success).toBe(false);
    const call = {
      type: 'call',
      callId: uuid(),
      queueNo: 'PD-027',
      serviceCode: 'PD',
      counter: 'Ruang Periksa 2',
      recall: false,
      at: AT,
    };
    expect(queueDisplayEventSchema.safeParse(call).success).toBe(true);
    expect(queueDisplayEventSchema.safeParse({ ...call, patientName: 'Fiktif' }).success).toBe(false);
    // ADR-0026: kanal = nama tabel (huruf kecil/angka/garis bawah, maks 63), muatan { tenant_id, id }.
    expect(QUEUE_NOTIFY_CHANNEL).toBe('queue_calls');
    expect(QUEUE_NOTIFY_CHANNEL).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
  });
});

describe('kontrak API registrasi + SEP (F03/F06)', () => {
  const consent = { confirmedByStaff: true, signer: 'pasien' };
  const bpjs = {
    payer: 'bpjs',
    visitKind: 'kontrol',
    referenceNumber: '0301R0011025K000117',
    initialDiagnosis: { code: 'E11.9', display: 'Diabetes melitus tipe 2 tanpa komplikasi' },
  };

  it('rawat jalan: penjamin berjenis; diagnosa awal ICD-10; persetujuan umum opsional (berlaku sampai dicabut)', () => {
    const reg = { patientId: uuid(), sessionId: uuid(), coverage: bpjs };
    expect(outpatientRegistrationSchema.safeParse(reg).success).toBe(true);
    expect(outpatientRegistrationSchema.safeParse({ ...reg, coverage: { payer: 'umum' } }).success).toBe(
      true,
    );
    expect(
      outpatientRegistrationSchema.safeParse({
        ...reg,
        coverage: { ...bpjs, initialDiagnosis: { code: 'diabetes', display: 'x' } },
      }).success,
    ).toBe(false);
    expect(outpatientRegistrationSchema.safeParse({ ...reg, coverage: { payer: 'asuransi' } }).success).toBe(
      false,
    );
    expect(
      outpatientRegistrationSchema.safeParse({
        ...reg,
        guarantor: { name: 'Wati', relationship: 'istri', phone: '0812-3456-7890' },
      }).success,
    ).toBe(true);
    expect(
      outpatientRegistrationSchema.safeParse({
        ...reg,
        guarantor: { name: 'Wati', relationship: 'tetangga' },
      }).success,
    ).toBe(false);
  });

  it('persetujuan umum: centang petugas wajib; wali wajib bernama', () => {
    expect(generalConsentInputSchema.safeParse(consent).success).toBe(true);
    expect(generalConsentInputSchema.safeParse({ ...consent, confirmedByStaff: false }).success).toBe(false);
    expect(generalConsentInputSchema.safeParse({ ...consent, signer: 'wali' }).success).toBe(false);
    expect(
      generalConsentInputSchema.safeParse({ ...consent, signer: 'wali', signerName: 'Andi' }).success,
    ).toBe(true);
  });

  it('IGD boleh tanpa identitas; admisi BPJS wajib SPRI/kunjungan asal dan persetujuan umum', () => {
    expect(
      emergencyRegistrationSchema.safeParse({
        patient: { kind: 'unidentified', sex: 'male', description: 'Laki-laki, kaos biru, tanpa KTP' },
        unitId: uuid(),
        arrivalMode: 'ambulans',
      }).success,
    ).toBe(true);
    const adm = {
      patientId: uuid(),
      unitId: uuid(),
      practitionerId: uuid(),
      careClass: 'kelas_2',
      plannedAt: AT,
      coverage: bpjs,
      generalConsent: consent,
    };
    expect(admissionSchema.safeParse(adm).success).toBe(false);
    expect(admissionSchema.safeParse({ ...adm, spriReferralId: uuid() }).success).toBe(true);
    expect(admissionSchema.safeParse({ ...adm, coverage: { payer: 'umum' } }).success).toBe(true);
    const { generalConsent: _omit, ...noConsent } = adm;
    expect(admissionSchema.safeParse({ ...noConsent, spriReferralId: uuid() }).success).toBe(false);
  });

  it('lembar SEP cetak: nomor SEP 19 karakter, kartu 13 digit, diagnosa ICD-10', () => {
    const sep = {
      tenantName: 'RS Fiktif',
      sepNo: '0301R0011026V005102',
      serviceDate: '2026-10-05',
      serviceType: 'rawat_jalan',
      participant: {
        cardNo: '0001234567890',
        name: 'Tn. Fiktif',
        birthDate: '1960-01-01',
        mrn: '00-41-27-88',
        segment: 'PBPU',
        classRight: 'kelas_2',
      },
      poliName: 'Penyakit Dalam',
      practitionerName: 'dr. Fiktif, Sp.PD',
      visitKind: 'kontrol',
      referenceNumber: '0301R0011025K000117',
      referrerName: null,
      initialDiagnosis: { code: 'E11.9', display: 'Diabetes melitus tipe 2 tanpa komplikasi' },
      note: null,
      issuedAt: AT,
    };
    expect(printableSepSchema.safeParse(sep).success).toBe(true);
    expect(printableSepSchema.safeParse({ ...sep, sepNo: '0301R0011026V00510' }).success).toBe(false);
  });

  it('revisi SEP minimal satu perubahan + alasan; lookup BPJS lewat body dengan panjang digit tetap', () => {
    expect(reviseSepSchema.safeParse({ reason: 'salah diagnosa' }).success).toBe(false);
    expect(
      reviseSepSchema.safeParse({
        reason: 'salah diagnosa',
        initialDiagnosis: { code: 'I10', display: 'Hipertensi' },
      }).success,
    ).toBe(true);
    expect(bpjsParticipantLookupSchema.safeParse({ by: 'nik', value: '3174000000000001' }).success).toBe(
      true,
    );
    expect(bpjsParticipantLookupSchema.safeParse({ by: 'nik', value: '0001234567890' }).success).toBe(false);
    expect(bpjsParticipantLookupSchema.safeParse({ by: 'kartu', value: '0001234567890' }).success).toBe(true);
  });
});

describe('kontrak API rujukan (F07) dan surat (F06)', () => {
  it('rujukan keluar rawat jalan wajib poli tujuan; rujukan masuk berlaku setelah terbit', () => {
    const out = {
      encounterId: uuid(),
      destination: { ppkCode: '0301R002', name: 'RS Rujukan Fiktif' },
      serviceType: 'rawat_jalan',
      diagnosis: { code: 'I10', display: 'Hipertensi esensial (primer)' },
      plannedDate: '2026-10-07',
    };
    expect(createOutgoingReferralSchema.safeParse(out).success).toBe(false);
    expect(createOutgoingReferralSchema.parse({ ...out, bpjsPoliCode: 'JAN' }).kind).toBe('rujukan_keluar');
    expect(createOutgoingReferralSchema.safeParse({ ...out, serviceType: 'rawat_inap' }).success).toBe(true);
    expect(
      recordIncomingReferralSchema.safeParse({
        patientId: uuid(),
        number: '0301U0420926P001234',
        originName: 'Puskesmas Fiktif',
        diagnosis: { code: 'I10', display: 'Hipertensi esensial (primer)' },
        issuedAt: '2026-09-28',
        validUntil: '2026-09-01',
      }).success,
    ).toBe(false);
    expect(
      createControlLetterSchema.safeParse({
        kind: 'spri',
        encounterId: uuid(),
        plannedDate: '2026-10-06',
        practitionerId: uuid(),
        unitId: uuid(),
      }).success,
    ).toBe(true);
  });
});

describe('kontrak anjungan (F05)', () => {
  it('identifikasi: digit sesuai metode; hasil hanya nama tersamar + tanggal tanpa tahun', () => {
    expect(
      kioskIdentifySchema.safeParse({ purpose: 'booking', method: 'booking', value: '2610050117' }).success,
    ).toBe(true);
    expect(
      kioskIdentifySchema.safeParse({ purpose: 'booking', method: 'nik', value: '2610050117' }).success,
    ).toBe(false);
    expect(
      kioskIdentifySchema.safeParse({ purpose: 'bpjs', method: 'bpjs', value: '00012345678x9' }).success,
    ).toBe(false);
    expect(maskNameForKiosk('Siti Rahmawati')).toBe('Si•• Ra•••••••');
    expect(maskNameForKiosk('  Tn. Suryo  ')).toBe('Tn. Su•••');
    expect(kioskBirthDayMonth('1972-03-14')).toBe('14 Mar');
    const found = {
      found: true,
      lookupToken: `kl1.${'a'.repeat(43)}`,
      expiresAt: AT,
      nameMasked: maskNameForKiosk('Siti Rahmawati'),
      birthDayMonth: kioskBirthDayMonth('1972-03-14'),
      hasBookingToday: false,
    };
    expect(kioskIdentifyResultSchema.safeParse(found).success).toBe(true);
    expect(kioskIdentifyResultSchema.safeParse({ ...found, patientId: uuid() }).success).toBe(false);
    expect(kioskIdentifyResultSchema.safeParse({ ...found, birthDayMonth: '14 Mar 1972' }).success).toBe(
      false,
    );
  });

  it('registrasi umum wajib sesi; tiket farmasi/kasir wajib identifikasi', () => {
    const token = `kl1.${'b'.repeat(43)}`;
    expect(kioskRegisterSchema.safeParse({ payer: 'bpjs', lookupToken: token }).success).toBe(true);
    expect(kioskRegisterSchema.safeParse({ payer: 'umum', lookupToken: token }).success).toBe(false);
    expect(kioskTicketRequestSchema.safeParse({ serviceKind: 'admisi' }).success).toBe(true);
    expect(kioskTicketRequestSchema.safeParse({ serviceKind: 'farmasi' }).success).toBe(false);
    expect(
      kioskTicketRequestSchema.safeParse({ serviceKind: 'farmasi', lookupToken: 'kl1.pendek' }).success,
    ).toBe(false);
  });
});

describe('gateway publik (F08)', () => {
  it('status booking butuh kode + tanggal lahir yang sah', () => {
    expect(
      publicBookingStatusQuerySchema.safeParse({ bookingCode: '2610050117', birthDate: '1972-03-14' })
        .success,
    ).toBe(true);
    expect(publicBookingStatusQuerySchema.safeParse({ bookingCode: '2610050117' }).success).toBe(false);
    expect(
      publicBookingStatusQuerySchema.safeParse({ bookingCode: '2610050117', birthDate: '2999-01-01' })
        .success,
    ).toBe(false);
  });
});
