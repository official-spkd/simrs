import { Inject, Injectable } from '@nestjs/common';
import { allocateNumber, dbDateFromIso, isoFromDbDate } from '@simrs/db';
import {
  AppError,
  BPJS_VISIT_KINDS,
  type Coverage,
  type CoverageInput,
  type Encounter,
  encounterClassToken,
  frontOfficeError,
  type GeneralConsentInput,
  isoDateJakarta,
  jakartaWallTime,
  maskIdentifier,
  newId,
  type OutpatientRegistrationInput,
  type PayerKind,
  type PrintableVisit,
  type RegistrationDesk,
  type RegistrationResult,
} from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { type IdempotencyClaim, IdempotencyService } from '../../common/idempotency';
import { API_ENV, type ApiEnv } from '../../config/env';
import { DomainEvents } from '../../infra/events/domain-events';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService } from '../authz/patient-access.service';
import { BookingService } from '../booking/booking.service';
import { QueueService } from '../queue/queue.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { SepService } from '../sep/sep.service';
import { ContactsService } from './contacts.service';
import { type CoverageRow, type EncounterRow, RegistrationRepository } from './registration.repository';

export const OUTPATIENT_SCOPE = 'registration.outpatient';

const invalid = (message: string, details?: unknown) =>
  new AppError('VALIDATION_FAILED', message, 422, details);

/**
 * F03 · Registrasi rawat jalan (rencana fase 2 potongan 5a). Satu transaksi permintaan, idempoten per header
 * `Idempotency-Key`:
 * - pasien MPI aktif + sesi DPJP HARI INI (poli aktif, bukan cuti tanpa pengganti);
 * - booking: yang dibawa (`appointmentId`), booking aktif hari ini di poli itu, atau booking walk-in baru kanal loket
 *   (kuota + Antrean BPJS untuk JKN) lewat `BookingService`; booking `booked` → `checked_in` (tiket loket yang
 *   dibawa ditautkan ke booking: task 1–2 diisi mesin task ID dari tiket itu);
 * - kunjungan `RJ-YYMM-NNNNNN` (`arrived`) + riwayat status, nomor poli cadangan dilepas ke antrean berurutan;
 * - persetujuan umum rawat jalan (sampai dicabut, keputusan #9): wajib ada, atau dibuat dari isian petugas;
 * - penanggung jawab (kontak ada atau baru, terenkripsi), penjaminan, relasi akses DPJP (`access_relationships`);
 * - BPJS: rujukan/surat kontrol dicatat di `referrals`, SEP v1 `pending` + outbox (BPJS tidak dihubungi di sini,
 *   jadi gangguan BPJS tidak menggagalkan registrasi);
 * - event `encounter.registered` → task 3 (mesin task ID antrean).
 */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly db: TenantDb,
    private readonly repo: RegistrationRepository,
    private readonly idempotency: IdempotencyService,
    private readonly booking: BookingService,
    private readonly queue: QueueService,
    private readonly scheduling: SchedulingService,
    private readonly sep: SepService,
    private readonly contacts: ContactsService,
    private readonly access: PatientAccessService,
    private readonly events: DomainEvents,
  ) {}

  private crypto(): PatientCrypto {
    return new PatientCrypto(this.env.fieldKeys, this.db.tenantId());
  }

  async registerOutpatient(
    input: OutpatientRegistrationInput,
    idempotencyKey: unknown,
  ): Promise<RegistrationResult> {
    const claim = await this.idempotency.claim(OUTPATIENT_SCOPE, idempotencyKey, input);
    if (claim.existingResourceId) return this.result(claim.existingResourceId, { replay: true });
    const encounterId = await this.createOutpatient(input, claim);
    return this.result(encounterId, { replay: false });
  }

  private async createOutpatient(
    input: OutpatientRegistrationInput,
    claim: IdempotencyClaim,
  ): Promise<string> {
    const today = isoDateJakarta(new Date());
    const patient = await this.repo.findPatient(input.patientId);
    if (!patient) throw new AppError('NOT_FOUND', 'Pasien tidak ditemukan', 404);
    if (patient.status !== 'active') {
      throw new AppError('CONFLICT', 'Rekam medis ini sudah digabung; pakai rekam medis tujuan', 409, {
        mergedInto: patient.mergedIntoId,
      });
    }
    const coverage = input.coverage;
    const bpjsIdentifier = patient.identifiers.find((i) => i.system === 'bpjs');
    if (coverage.payer === 'bpjs') {
      const systems = new Set(patient.identifiers.map((i) => i.system));
      if (!bpjsIdentifier || !systems.has('nik')) {
        throw invalid('Penjamin BPJS butuh no. kartu BPJS dan NIK pasien yang aktif');
      }
    }

    // Sesi DPJP hari ini.
    const session = await this.repo.findSession(input.sessionId);
    if (!session) throw new AppError('NOT_FOUND', 'Sesi praktik tidak ditemukan', 404);
    if (session.service.kind !== 'poli' || !session.service.active) {
      throw frontOfficeError('SESSION_CLOSED', undefined, 'Layanan sesi ini bukan poli yang aktif');
    }
    if (isoFromDbDate(session.sessionDate) !== today) {
      throw frontOfficeError('SESSION_CLOSED', undefined, 'Registrasi rawat jalan hanya untuk sesi hari ini');
    }
    if (session.kind === 'cuti' && !session.substituteId) throw frontOfficeError('SESSION_CLOSED');
    const unitId = session.service.unitId;
    if (!unitId) throw invalid('Layanan poli belum terhubung ke unit; atur di master layanan antrean');

    // Persetujuan umum rawat jalan.
    const consent = await this.repo.activeOutpatientConsent(patient.id);
    if (!consent && !input.generalConsent) throw frontOfficeError('GENERAL_CONSENT_REQUIRED');

    // Booking.
    const quotaBucket = coverage.payer === 'bpjs' ? 'jkn' : 'non_jkn';
    const appointmentId = await this.resolveAppointment(input, session, today, quotaBucket);
    if (await this.repo.activeEncounterForAppointment(appointmentId)) {
      throw frontOfficeError('ENCOUNTER_DUPLICATE');
    }
    if (input.counterTicketId) await this.queue.attachAppointment(input.counterTicketId, appointmentId);
    await this.booking.markArrived(appointmentId, { publishEvent: !input.counterTicketId });
    const appointment = await this.repo.findAppointment(appointmentId);
    if (!appointment) throw frontOfficeError('BOOKING_NOT_FOUND');

    // Kunjungan.
    const ticket = await this.repo.reservedPoliTicket(appointmentId, session.serviceId);
    if (ticket?.reserved) await this.repo.releaseTicketReservation(ticket.id);
    const number = await allocateNumber(this.db.tx(), this.db.tenantId(), 'encounter_rj');
    const encounterId = newId();
    const now = new Date();
    await this.repo.createEncounter({
      id: encounterId,
      number: number.number,
      patientId: patient.id,
      encounterClass: 'AMB',
      status: 'arrived',
      unitId,
      serviceId: session.serviceId,
      practitionerId: appointment.practitionerId,
      appointmentId,
      queueTicketId: ticket?.id ?? null,
      arrivedAt: now,
    });
    await this.repo.addStatusHistory(encounterId, null, 'arrived');

    if (!consent && input.generalConsent) await this.createConsent(patient.id, input.generalConsent);
    if (input.guarantor) await this.contacts.resolveGuarantor(patient.id, input.guarantor);

    const coverageId = await this.createCoverage(encounterId, coverage, bpjsIdentifier?.id ?? null);
    await this.grantDpjpAccess(appointment.practitionerId, patient.id, encounterId, today);

    if (coverage.payer === 'bpjs') {
      const referralId = await this.resolveReferral(patient.id, coverage, session.serviceId, today);
      const poli = await this.repo.bpjsPoliCode(session.serviceId);
      await this.sep.createPending({
        encounterId,
        coverageId,
        referralId,
        poliCode: poli?.value ?? null,
        diagnosis: coverage.initialDiagnosis,
        note: coverage.note ?? null,
      });
    }

    await this.events.publish('encounter.registered', {
      encounterId,
      patientId: patient.id,
      encounterClass: encounterClassToken('AMB'),
      unitId,
      appointmentId,
      payer: coverage.payer,
    });
    await this.idempotency.record(claim, 'encounter', encounterId);
    return encounterId;
  }

  /** Booking yang dipakai kunjungan: yang dibawa, yang aktif hari ini di poli itu, atau walk-in baru. */
  private async resolveAppointment(
    input: OutpatientRegistrationInput,
    session: { id: string; serviceId: string; sessionDate: Date },
    today: string,
    quotaBucket: 'jkn' | 'non_jkn',
  ): Promise<string> {
    let id = input.appointmentId;
    if (!id) {
      const active = await this.repo.activeAppointment(
        input.patientId,
        session.serviceId,
        dbDateFromIso(today),
      );
      id = active?.id;
    }
    if (!id) {
      const c = input.coverage;
      return this.booking.createForVisit(
        c.payer === 'bpjs'
          ? {
              patientId: input.patientId,
              sessionId: session.id,
              quotaBucket: 'jkn',
              jkn: { visitKind: c.visitKind, referenceNumber: c.referenceNumber },
            }
          : { patientId: input.patientId, sessionId: session.id, quotaBucket: 'non_jkn' },
      );
    }
    const a = await this.repo.findAppointment(id);
    if (!a || a.patientId !== input.patientId) throw frontOfficeError('BOOKING_NOT_FOUND');
    if (a.status !== 'booked' && a.status !== 'checked_in') {
      throw frontOfficeError('BOOKING_STATE_INVALID', undefined, `Booking berstatus ${a.status}`);
    }
    if (isoFromDbDate(a.appointmentDate) !== today) {
      throw frontOfficeError('BOOKING_STATE_INVALID', undefined, 'Booking bukan untuk hari ini');
    }
    if (a.sessionId !== session.id) {
      throw frontOfficeError(
        'BOOKING_DUPLICATE',
        { appointmentId: a.id },
        'Pasien sudah punya booking di poli ini hari ini pada sesi lain; daftarkan lewat booking itu atau jadwal ulang',
      );
    }
    if (a.quotaBucket !== quotaBucket) {
      throw invalid(
        quotaBucket === 'jkn'
          ? 'Booking ini non-JKN; penjamin BPJS butuh booking JKN (jadwal ulang dengan rujukan)'
          : 'Booking ini JKN; pilih penjamin BPJS atau batalkan booking lebih dulu',
      );
    }
    return a.id;
  }

  private async createConsent(patientId: string, consent: GeneralConsentInput): Promise<void> {
    if (consent.evidenceDocumentId) {
      const doc = await this.repo.documentPatient(consent.evidenceDocumentId);
      if (!doc || doc.patientId !== patientId) throw invalid('Dokumen bukti persetujuan tidak ditemukan');
    }
    await this.repo.createConsent({
      patientId,
      // Penanda tangan wali dicatat di catatan persetujuan (bukan di audit).
      note:
        consent.signer === 'wali'
          ? `Persetujuan umum rawat jalan, ditandatangani wali: ${consent.signerName}`
          : 'Persetujuan umum rawat jalan, ditandatangani pasien',
      evidenceDocumentId: consent.evidenceDocumentId ?? null,
    });
  }

  private async createCoverage(
    encounterId: string,
    coverage: CoverageInput,
    bpjsIdentifierId: string | null,
  ): Promise<string> {
    let payerId: string;
    let memberNoEnc: string | null = null;
    let guaranteeLetterNo: string | null = null;
    if (coverage.payer === 'bpjs' || coverage.payer === 'umum') {
      const payer = await this.repo.payerByKind(coverage.payer);
      if (!payer) throw invalid(`Master penjamin ${coverage.payer.toUpperCase()} belum ada`);
      payerId = payer.id;
    } else {
      const payer = await this.repo.payerById(coverage.payerId);
      if (!payer || !payer.active || payer.kind !== coverage.payer) {
        throw invalid('Penjamin tidak ditemukan atau jenisnya tidak sesuai');
      }
      payerId = payer.id;
      const member = coverage.payer === 'asuransi' ? coverage.memberNo : coverage.employeeNo;
      memberNoEnc = member ? this.crypto().encryptContact(member) : null;
      guaranteeLetterNo = coverage.payer === 'asuransi' ? (coverage.guaranteeLetterNo ?? null) : null;
    }
    const created = await this.repo.createCoverage({
      id: newId(),
      encounterId,
      payerId,
      patientIdentifierId: coverage.payer === 'bpjs' ? bpjsIdentifierId : null,
      priority: 1,
      status: 'active',
      memberNoEnc,
      guaranteeLetterNo,
    });
    return created.id;
  }

  /**
   * Relasi akses DPJP (ABAC P03): dokter yang punya akun boleh membuka pasien ini sampai akhir hari berikutnya
   * (dokumentasi kunjungan); relasi diperpanjang/diakhiri modul klinis (fase 3).
   */
  private async grantDpjpAccess(
    practitionerId: string,
    patientId: string,
    encounterId: string,
    today: string,
  ) {
    const p = await this.repo.practitionerUser(practitionerId);
    if (!p?.userId) return;
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    await this.repo.createAccessRelationship({
      userId: p.userId,
      patientId,
      encounterId,
      validUntil: jakartaWallTime(y, m, d + 2),
    });
  }

  /** Rujukan/surat kontrol dasar SEP: baris `referrals` yang ada (hasil lookup VClaim) atau baris baru. */
  private async resolveReferral(
    patientId: string,
    coverage: Extract<CoverageInput, { payer: 'bpjs' }>,
    serviceId: string,
    today: string,
  ): Promise<string> {
    const kind = BPJS_VISIT_KINDS[coverage.visitKind].referralKind;
    const existing = await this.repo.findReferral(kind, coverage.referenceNumber);
    if (existing) {
      if (existing.patientId !== patientId) throw invalid('Nomor rujukan/surat kontrol milik pasien lain');
      if (
        existing.status === 'expired' ||
        (existing.validUntil && isoFromDbDate(existing.validUntil) < today)
      ) {
        throw frontOfficeError('REFERRAL_EXPIRED');
      }
      if (existing.status !== 'active') throw frontOfficeError('REFERRAL_STATE_INVALID');
      return existing.id;
    }
    // Belum pernah dicek (mis. surat kontrol dari RS lain): dicatat apa adanya; BPJS memeriksanya saat SEP dikirim.
    const created = await this.repo.createReferral({
      patientId,
      kind,
      number: coverage.referenceNumber,
      facilityName: 'Belum diverifikasi BPJS',
      targetServiceId: serviceId,
      diagnosisCode: coverage.initialDiagnosis.code,
      diagnosisDisplay: coverage.initialDiagnosis.display,
      issuedOn: dbDateFromIso(today),
      status: 'active',
    });
    return created.id;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Baca
  // ------------------------------------------------------------------------------------------------------------

  /** Kunjungan + penjaminan + SEP terbaru + tiket poli + booking. ABAC: lingkup relasi butuh relasi aktif. */
  async getEncounter(id: string): Promise<RegistrationResult> {
    const row = await this.repo.findEncounter(id);
    if (!row) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    if (this.db.permissionScope() !== 'all') await this.access.assert(row.patientId);
    return this.present(row);
  }

  /**
   * Lembar cetak loket (tiket poli + ringkasan SEP, HTML 80 mm). Diaudit `print` per pasien di transaksi yang sama;
   * no. kartu tetap tersamar.
   */
  async printable(id: string): Promise<PrintableVisit> {
    const r = await this.getEncounter(id);
    const d = await this.repo.printDetails(id, r.sep?.referralId ?? null);
    if (!d.encounter || !d.tenant) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    const sep = r.sep;
    const now = new Date();
    this.db.audit({
      action: 'print',
      resourceType: 'encounter',
      resourceId: id,
      patientId: r.encounter.patientId,
      details: { document: 'registration_slip', sep: sep !== null },
    });
    return {
      tenantName: d.tenant.name,
      encounterNumber: r.encounter.number,
      serviceDate: isoDateJakarta(new Date(r.encounter.arrivedAt ?? r.encounter.createdAt)),
      arrivedAt: r.encounter.arrivedAt,
      patient: { name: d.encounter.patient.name, mrn: d.encounter.patient.mrn },
      poliName: d.encounter.service?.name ?? d.encounter.unit.name,
      room: d.encounter.service?.room ?? null,
      practitionerName: d.encounter.practitioner?.name ?? null,
      queueNo: r.queueTicket?.queueNo ?? null,
      estimatedCallAt: r.queueTicket?.estimatedCallAt ?? null,
      bookingCode: r.appointment?.bookingCode ?? null,
      payerKind: r.coverage?.payerKind ?? null,
      payerName: r.coverage?.payerName ?? null,
      sep: sep
        ? {
            status: sep.status,
            sepNo: sep.sepNo,
            cardNoMasked: r.coverage?.memberNoMasked ?? null,
            classEntitlement: sep.careClass ?? r.coverage?.classEntitlement ?? null,
            referenceNumber: d.referral?.number ?? null,
            referrerName: d.referral?.kind === 'rujukan-fktp' ? d.referral.facilityName : null,
            initialDiagnosis: sep.initialDiagnosis,
            issuedAt: sep.issuedAt,
          }
        : null,
      printedAt: now.toISOString(),
    };
  }

  private async result(encounterId: string, opts: { replay: boolean }): Promise<RegistrationResult> {
    const row = await this.repo.findEncounter(encounterId);
    if (!row) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    this.db.audit({
      action: opts.replay ? 'read' : 'create',
      resourceType: 'encounter',
      resourceId: row.id,
      patientId: row.patientId,
      details: opts.replay ? { idempotentReplay: true } : { class: 'AMB' },
    });
    return this.present(row);
  }

  private async present(row: EncounterRow): Promise<RegistrationResult> {
    const coverage = await this.repo.primaryCoverage(row.id);
    return {
      encounter: toEncounter(row),
      coverage: coverage ? this.toCoverage(coverage) : null,
      sep: await this.sep.latestForEncounter(row.id),
      queueTicket: row.queueTicketId ? await this.queue.getTicket(row.queueTicketId) : null,
      appointment: row.appointment
        ? { id: row.appointment.id, bookingCode: row.appointment.bookingCode }
        : null,
    };
  }

  private toCoverage(c: CoverageRow): Coverage {
    let memberNoMasked: string | null = null;
    if (c.patientIdentifier?.system === 'bpjs') {
      memberNoMasked = maskIdentifier('bpjs', this.crypto().decryptIdentifier(c.patientIdentifier.valueEnc));
    } else if (c.memberNoEnc) {
      const v = this.crypto().decryptContact(c.memberNoEnc);
      memberNoMasked = v.length <= 4 ? '****' : `${'*'.repeat(Math.min(v.length - 4, 12))}${v.slice(-4)}`;
    }
    return {
      id: c.id,
      encounterId: c.encounterId,
      payerId: c.payerId,
      payerKind: c.payer.kind as PayerKind,
      payerName: c.payer.name,
      priority: c.priority,
      memberNoMasked,
      classEntitlement: c.classEntitlement as Coverage['classEntitlement'],
      careClass: c.careClass as Coverage['careClass'],
      status: c.status as Coverage['status'],
      locked: c.lockedAt !== null,
    };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Meja pendaftaran
  // ------------------------------------------------------------------------------------------------------------

  /** Antrean loket admisi + kuota dokter hari ini (tanpa daftar pasien pra-muat). */
  async desk(): Promise<RegistrationDesk> {
    const counter = await this.repo.counterService();
    const tickets = counter ? await this.queue.waitingTickets(counter.id) : [];
    return {
      date: isoDateJakarta(new Date()),
      counter: {
        name: counter?.name ?? 'Loket pendaftaran',
        waiting: tickets.length,
        tickets: tickets.map((t) => ({ ticket: t.queueNo, patientId: t.patientId })),
      },
      quotas: await this.scheduling.todayQuotas({}),
    };
  }
}

function toEncounter(row: EncounterRow): Encounter {
  return {
    id: row.id,
    number: row.number,
    class: row.encounterClass as Encounter['class'],
    status: row.status as Encounter['status'],
    patientId: row.patientId,
    unitId: row.unitId,
    serviceId: row.serviceId,
    poliCode: row.service?.code ?? null,
    practitionerId: row.practitionerId,
    appointmentId: row.appointmentId,
    queueTicketId: row.queueTicketId,
    arrivedAt: row.arrivedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
  };
}
