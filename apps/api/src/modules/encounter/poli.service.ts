import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@simrs/db';
import {
  AppError,
  type EncounterLab,
  formatJam,
  formatTanggal,
  isoDateJakarta,
  maskIdentifier,
  MEDICATION_FREQUENCIES,
  type MedicationFrequency,
  POLI_VISIT_STAGES,
  type PoliQueueStatus,
  type PoliVisit,
  type PoliVital,
  type PoliWorklistApi,
  type PoliWorklistItemApi,
  poliSoapDraftSchema,
  type QueueTicketStatus,
  type SoapPlanRow,
} from '@simrs/shared';
import { PatientCrypto } from '@simrs/shared/node';
import { API_ENV, type ApiEnv } from '../../config/env';
import { ageYears, clinicalEncounter, patientGroupIds } from '../../infra/clinical/clinical-context';
import { TenantDb } from '../../infra/tenant-db';
import { PatientAccessService, patientAccessSql } from '../authz/patient-access.service';
import { DischargeAuthority } from '../discharge/discharge-authority';

const CURRENT = { supersededBy: { none: {} } } as const;
const PAYER: Record<string, 'BPJS' | 'Umum' | 'Asuransi'> = {
  bpjs: 'BPJS',
  umum: 'Umum',
  asuransi: 'Asuransi',
};
const SEX = (s: string | null): 'L' | 'P' | '–' => (s === 'male' ? 'L' : s === 'female' ? 'P' : '–');
const LAB_FLAG: Record<string, EncounterLab['flag']> = {
  tinggi: 'H',
  rendah: 'L',
  abnormal: 'A',
  kritis: 'K',
};
const PLAN_KIND: Record<string, SoapPlanRow['kind']> = {
  lab: 'LAB',
  radiologi: 'RAD',
  tindakan: 'TINDAKAN',
};

/** Awal hari ini WIB (UTC). */
function startOfTodayJakarta(now = new Date()): Date {
  return new Date(`${isoDateJakarta(now)}T00:00:00+07:00`);
}

function queueStatus(encStatus: string, ticket: QueueTicketStatus | null): PoliQueueStatus {
  if (encStatus === 'finished') return 'selesai';
  if (ticket === 'skipped') return 'dijeda';
  if (ticket === 'called' || ticket === 'serving' || encStatus === 'in_progress') return 'diperiksa';
  return 'menunggu';
}

/**
 * K01/K02 · Data layar Pemeriksaan poli mode api (W1, rencana fase 3): antrean poli hari ini untuk unit penugasan dan
 * kunjungan rawat jalan dalam bentuk kontrak layar (`poliWorklistApiSchema`, `poliVisitSchema`). Hanya membaca dan
 * menyusun dari sumber klinis (TTV, CPPT, diagnosis, order, hasil, resume); semua penulisan lewat endpoint domainnya.
 * ABAC: daftar disaring lingkup (unit = unit penugasan; relasi = pasien berelasi); kunjungan lewat `PatientAccess`.
 * Setiap pembukaan diaudit `read` per pasien.
 */
@Injectable()
export class PoliService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly db: TenantDb,
    private readonly access: PatientAccessService,
    private readonly authority: DischargeAuthority,
  ) {}

  /**
   * Antrean poli hari ini. Tanpa `serviceId` (bawaan dokter): gabungan antrean layanan poli unit penugasan + kunjungan
   * rawat jalan hari ini yang DPJP-nya praktisi terikat akun saya (dokter "Semua unit" dan dokter yang berpraktik di
   * poli lain tetap melihat pasiennya). Dengan `serviceId`: satu layanan saja. `options` = pilihan poli/sesi untuk
   * layar: layanan poli unit + sesi praktik saya hari ini.
   */
  async worklist(serviceId?: string): Promise<PoliWorklistApi> {
    const tx = this.db.tx();
    const actor = this.db.actor();
    const today = isoDateJakarta();
    const me = this.db.actorUserId();
    const [unitServices, mySessions, meRow] = await Promise.all([
      actor.unitId
        ? tx.queueService.findMany({
            where: { kind: 'poli', unitId: actor.unitId, active: true },
            orderBy: { code: 'asc' },
            include: { unit: true },
          })
        : Promise.resolve([]),
      me
        ? tx.scheduleSession.findMany({
            where: {
              sessionDate: new Date(`${today}T00:00:00.000Z`),
              service: { kind: 'poli', active: true },
              // Praktik sendiri, atau sesi dokter cuti yang saya gantikan.
              OR: [{ practitioner: { userId: me }, kind: { not: 'cuti' } }, { substitute: { userId: me } }],
            },
            orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
            select: { startTime: true, endTime: true, service: { include: { unit: true } } },
          })
        : Promise.resolve([]),
      me ? tx.user.findUnique({ where: { id: me }, select: { displayName: true } }) : Promise.resolve(null),
    ]);
    const hhmm = (d: Date) => d.toISOString().slice(11, 16).replace(':', '.');
    const options: PoliWorklistApi['options'] = [];
    for (const svc of unitServices) {
      options.push({ serviceId: svc.id, label: `${svc.name} · unit Anda` });
    }
    for (const s of mySessions) {
      if (options.some((o) => o.serviceId === s.service.id)) continue;
      options.push({
        serviceId: s.service.id,
        label: `${s.service.name} · praktik ${hhmm(s.startTime)}–${hhmm(s.endTime)}`,
      });
    }
    const chosen = serviceId
      ? await tx.queueService.findUnique({ where: { id: serviceId }, include: { unit: true } })
      : null;
    if (serviceId && (!chosen || chosen.kind !== 'poli')) {
      throw new AppError('NOT_FOUND', 'Layanan poli tidak ditemukan', 404);
    }
    const head = chosen ?? unitServices[0] ?? mySessions[0]?.service ?? null;
    const unit =
      head?.unit ?? (actor.unitId ? await tx.unit.findUnique({ where: { id: actor.unitId } }) : null);
    const base: PoliWorklistApi = {
      poli: {
        code: head?.code ?? unit?.code ?? '-',
        name: chosen ? chosen.name : head && options.length <= 1 ? head.name : 'Poli saya',
        room: unit?.name ?? '-',
      },
      doctor: meRow?.displayName ?? '-',
      date: today,
      serviceId: head?.id ?? null,
      options,
      items: [],
    };

    const scope = this.db.permissionScope();
    const scoped = this.access.scopedActor();
    const filter =
      scope === 'all' || !scoped
        ? Prisma.empty
        : scope === 'unit' && scoped.unitId
          ? Prisma.sql`AND (e.unit_id = ${scoped.unitId}::uuid OR ${patientAccessSql(scoped, new Date())})`
          : Prisma.sql`AND ${patientAccessSql(scoped, new Date())}`;
    const unitServiceIds = unitServices.map((s) => s.id);
    const where = chosen
      ? Prisma.sql`e.service_id = ${chosen.id}::uuid`
      : Prisma.sql`(${
          unitServiceIds.length > 0
            ? Prisma.sql`e.service_id = ANY(${unitServiceIds}::uuid[])`
            : actor.unitId
              ? Prisma.sql`e.unit_id = ${actor.unitId}::uuid`
              : Prisma.sql`FALSE`
        } OR EXISTS (SELECT 1 FROM practitioners pr WHERE pr.id = e.practitioner_id AND pr.user_id = ${me}::uuid))`;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT e.id::text FROM encounters e JOIN patients p ON p.id = e.patient_id
      WHERE e.class = 'AMB' AND ${where} AND e.status IN ('arrived', 'in_progress', 'finished')
        AND coalesce(e.arrived_at, e.created_at) >= ${startOfTodayJakarta()} ${filter}
      LIMIT 200`;
    if (rows.length === 0) return base;
    const encounters = await tx.encounter.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: {
        id: true,
        status: true,
        arrivedAt: true,
        startedAt: true,
        endedAt: true,
        createdAt: true,
        patient: { select: { id: true, name: true, mrn: true, sex: true, birthDate: true } },
        queueTicket: {
          select: {
            id: true,
            ticketNo: true,
            seq: true,
            status: true,
            calls: { orderBy: [{ calledAt: 'desc' }, { id: 'desc' }], take: 1, select: { calledAt: true } },
          },
        },
        coverages: {
          where: { status: 'active' },
          orderBy: { priority: 'asc' },
          take: 1,
          select: { payer: { select: { kind: true } } },
        },
      },
    });
    const now = new Date();
    const items: Array<PoliWorklistItemApi & { sortKey: number }> = encounters.map((e) => {
      const ticket = (e.queueTicket?.status as QueueTicketStatus | undefined) ?? null;
      const status = queueStatus(e.status, ticket);
      const arrived = e.arrivedAt ?? e.createdAt;
      const lastCall = e.queueTicket?.calls[0]?.calledAt ?? null;
      const waitNote =
        status === 'selesai'
          ? `selesai ${formatJam(e.endedAt ?? now)}`
          : status === 'diperiksa'
            ? `mulai ${formatJam(lastCall ?? e.startedAt ?? arrived)}`
            : status === 'dijeda'
              ? 'dilewati'
              : `tunggu ${Math.max(0, Math.round((now.getTime() - arrived.getTime()) / 60_000))} mnt`;
      return {
        patientId: e.patient.id,
        encounterId: e.id,
        queueNo: e.queueTicket?.ticketNo ?? '—',
        name: e.patient.name,
        rm: e.patient.mrn,
        sex: SEX(e.patient.sex),
        ageYears: ageYears(e.patient.birthDate, today) ?? 0,
        payer: PAYER[e.coverages[0]?.payer.kind ?? 'umum'] ?? 'Umum',
        status,
        waitNote,
        scenario: null,
        queueTicketId: e.queueTicket?.id ?? null,
        ticketStatus: ticket,
        encounterStatus: e.status as PoliWorklistItemApi['encounterStatus'],
        sortKey: e.queueTicket?.seq ?? 10_000 + (Math.floor(arrived.getTime() / 60_000) % 10_000),
      };
    });
    items.sort((a, b) => a.sortKey - b.sortKey);
    // Daftar berisi PHI: audit per pasien yang tampil (docs/05 §5), seperti census/worklist/papan IGD.
    for (const i of items) {
      this.db.audit({
        action: 'read',
        resourceType: 'poli_worklist',
        resourceId: chosen?.id ?? head?.id ?? unit?.id ?? null,
        patientId: i.patientId,
      });
    }
    return { ...base, items: items.map(({ sortKey: _s, ...i }) => i) };
  }

  async visit(encounterId: string): Promise<PoliVisit> {
    const enc = await clinicalEncounter(this.db, this.access, encounterId, 'read');
    if (enc.encounterClass !== 'AMB') {
      throw new AppError('VALIDATION_FAILED', 'Layar poli hanya untuk kunjungan rawat jalan', 422);
    }
    const tx = this.db.tx();
    const me = this.db.actorUserId();
    const row = await tx.encounter.findUniqueOrThrow({
      where: { id: enc.id },
      select: {
        id: true,
        status: true,
        arrivedAt: true,
        createdAt: true,
        unit: { select: { name: true } },
        service: { select: { name: true } },
        practitioner: { select: { name: true } },
        queueTicket: { select: { id: true, ticketNo: true, status: true } },
        patient: {
          select: {
            id: true,
            name: true,
            mrn: true,
            sex: true,
            birthDate: true,
            identifiers: {
              where: { system: 'nik', active: true },
              take: 1,
              select: { valueEnc: true },
            },
          },
        },
        coverages: {
          where: { status: 'active' },
          orderBy: { priority: 'asc' },
          take: 1,
          select: {
            payer: { select: { kind: true, name: true } },
            careClass: true,
            seps: { where: { sepNo: { not: null } }, take: 1, select: { sepNo: true } },
          },
        },
      },
    });
    const group = await patientGroupIds(tx, enc.patientId);
    const [allergies, vitals, cppt, conditions, services, meds, labs, history, letter, docs, draft, canSign] =
      await Promise.all([
        tx.allergyIntolerance.findMany({
          where: { patientId: { in: group }, status: 'final', ...CURRENT },
          select: { kind: true, text: true, substance: { select: { name: true } } },
        }),
        tx.observation.findMany({
          where: { encounterId: enc.id, category: 'vital', status: 'final', ...CURRENT },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 2,
          select: { components: true, occurredAt: true },
        }),
        tx.cpptEntry.findFirst({
          where: { encounterId: enc.id, ppa: { in: ['dpjp', 'residen'] }, ...CURRENT },
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            status: true,
            cosignRequired: true,
            content: true,
            authorUserId: true,
            recordedAt: true,
            occurredAt: true,
            version: true,
            author: { select: { displayName: true } },
          },
        }),
        tx.condition.findMany({
          where: { encounterId: enc.id, kind: 'encounter', status: 'final', ...CURRENT },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: { code: true, display: true, role: true },
        }),
        tx.serviceRequest.findMany({
          where: { encounterId: enc.id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            name: true,
            orderable: { select: { kind: true } },
            statusEvents: {
              orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { status: true },
            },
          },
        }),
        tx.medicationRequest.findMany({
          where: { patientId: { in: group } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 30,
          select: {
            encounterId: true,
            name: true,
            dose: true,
            route: true,
            frequency: true,
            createdAt: true,
            statusEvents: {
              orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { status: true },
            },
          },
        }),
        tx.observation.findMany({
          where: { patientId: { in: group }, category: 'lab', status: 'final', ...CURRENT },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 6,
          select: {
            display: true,
            code: true,
            valueNumeric: true,
            valueUnit: true,
            valueText: true,
            interpretation: true,
            referenceRange: true,
            occurredAt: true,
          },
        }),
        tx.encounter.findMany({
          where: { patientId: { in: group }, id: { not: enc.id }, status: { not: 'cancelled' } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 5,
          select: {
            createdAt: true,
            encounterClass: true,
            unit: { select: { name: true } },
            conditions: {
              where: { kind: 'encounter', role: 'utama', status: 'final', ...CURRENT },
              take: 1,
              select: { code: true, display: true },
            },
          },
        }),
        tx.referral.findFirst({
          where: { encounterId: enc.id, kind: 'surat-kontrol', status: { not: 'cancelled' } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { number: true, plannedDate: true },
        }),
        tx.document.findMany({
          where: {
            sourceType: 'discharge_summaries',
            voidedAt: null,
            sourceId: {
              in: (
                await tx.dischargeSummary.findMany({
                  where: { encounterId: enc.id, addendumOf: null, status: 'final', ...CURRENT },
                  select: { id: true },
                })
              ).map((s) => s.id),
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            signatures: {
              orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { status: true },
            },
          },
        }),
        me
          ? tx.clinicalDraft.findUnique({
              where: {
                tenantId_encounterId_kind_authorUserId: {
                  tenantId: this.db.tenantId(),
                  encounterId: enc.id,
                  kind: 'soap',
                  authorUserId: me,
                },
              },
              select: { content: true, updatedAt: true },
            })
          : Promise.resolve(null),
        this.authority.canSign().then(async (ok) => ok && (await this.authority.isAttendingTeam(enc.id))),
      ]);
    const resumeDraft = me
      ? await tx.clinicalDraft.findFirst({
          where: { encounterId: enc.id, kind: 'resume', authorUserId: me },
          select: { id: true },
        })
      : null;

    const parsedDraft = draft ? poliSoapDraftSchema.safeParse(draft.content) : null;
    const draftParsed = parsedDraft?.success ? parsedDraft.data : null;
    const draftCodes = (draftParsed?.diagnosisCodes ?? []).filter(
      (c) => !conditions.some((x) => x.code === c),
    );
    const draftConcepts = draftCodes.length
      ? await tx.$queryRaw<Array<{ code: string; display: string }>>`
          SELECT code, display FROM ref.concepts WHERE system = 'icd10' AND code = ANY(${draftCodes}::text[])`
      : [];
    const draftDx = draftCodes.flatMap((code) => {
      const c = draftConcepts.find((x) => x.code === code);
      return c ? [{ code, display: c.display, role: null as string | null }] : [];
    });
    const today = isoDateJakarta();
    const nikEnc = row.patient.identifiers[0]?.valueEnc ?? null;
    let nikMasked = 'tidak tercatat';
    if (nikEnc) {
      try {
        nikMasked = maskIdentifier(
          'nik',
          new PatientCrypto(this.env.fieldKeys, this.db.tenantId()).decryptIdentifier(nikEnc),
        );
      } catch {
        nikMasked = 'tersamar';
      }
    }
    const cov = row.coverages[0];
    const payer = PAYER[cov?.payer.kind ?? 'umum'] ?? 'Umum';
    const allergyLabels = allergies
      .filter((a) => a.kind === 'alergi')
      .map((a) => a.substance?.name ?? a.text ?? 'Alergi')
      .slice(0, 6);

    // --- TTV (terbaru + pembanding sebelumnya) ---------------------------------------------------------------
    const [latest, prev] = vitals;
    const c = (latest?.components ?? {}) as Record<string, unknown>;
    const p = (prev?.components ?? {}) as Record<string, unknown>;
    const num = (o: Record<string, unknown>, k: string) =>
      typeof o[k] === 'number' ? (o[k] as number) : null;
    const vital = (
      id: PoliVital['id'],
      label: string,
      unit: string,
      value: string | null,
      flag: PoliVital['flag'],
      note = '',
    ): PoliVital => ({ id, label, unit, value: value ?? '—', note, flag: value === null ? 'belum' : flag });
    const sbp = num(c, 'sbp');
    const dbp = num(c, 'dbp');
    const hr = num(c, 'hr');
    const temp = num(c, 'temp');
    const rr = num(c, 'rr');
    const spo2 = num(c, 'spo2');
    const weight = num(c, 'weightKg');
    const prevTd = num(p, 'sbp') !== null ? `${num(p, 'sbp')}/${num(p, 'dbp')}` : null;
    const vitalsOut: PoliVital[] = [
      vital(
        'td',
        'Tekanan darah',
        'mmHg',
        sbp !== null && dbp !== null ? `${sbp}/${dbp}` : null,
        sbp !== null && (sbp >= 140 || (dbp ?? 0) >= 90)
          ? 'tinggi'
          : sbp !== null && sbp < 90
            ? 'rendah'
            : 'normal',
        prevTd ? `sebelumnya ${prevTd}` : '',
      ),
      vital(
        'nadi',
        'Nadi',
        'x/mnt',
        hr !== null ? String(hr) : null,
        hr !== null && hr > 100 ? 'tinggi' : hr !== null && hr < 60 ? 'rendah' : 'normal',
      ),
      vital(
        'suhu',
        'Suhu',
        '°C',
        temp !== null ? String(temp).replace('.', ',') : null,
        temp !== null && temp >= 37.5 ? 'tinggi' : 'normal',
      ),
      vital(
        'napas',
        'Napas',
        'x/mnt',
        rr !== null ? String(rr) : null,
        rr !== null && rr > 20 ? 'tinggi' : 'normal',
      ),
      vital(
        'spo2',
        'SpO2',
        '%',
        spo2 !== null ? String(spo2) : null,
        spo2 !== null && spo2 < 95 ? 'rendah' : 'normal',
      ),
      vital(
        'berat',
        'Berat badan',
        'kg',
        weight !== null ? String(weight).replace('.', ',') : null,
        'normal',
      ),
    ];

    // --- SOAP: draf milik saya, atau CPPT terkini ------------------------------------------------------------
    const draftContent = (draft?.content ?? {}) as { subjective?: unknown; objective?: unknown };
    const s = (cppt?.content ?? {}) as Record<string, unknown>;
    const fromCppt = cppt && s.format === 'soap';
    // CPPT residen final setelah co-sign DPJP (atestasi `cosign`, keputusan fase 3 no. 4).
    const cosigned =
      cppt?.cosignRequired && cppt.status === 'final'
        ? !!(await tx.clinicalAttestation.findFirst({
            where: { targetType: 'cppt_entries', targetId: cppt.id, kind: 'cosign' },
            select: { id: true },
          }))
        : false;
    const awaitingCosign = !!cppt && cppt.status === 'final' && cppt.cosignRequired && !cosigned;
    const signedFinal = !!cppt && cppt.status === 'final' && !awaitingCosign;
    const soap = {
      subjective:
        typeof draftContent.subjective === 'string' && !signedFinal
          ? draftContent.subjective
          : fromCppt
            ? String(s.s ?? '')
            : '',
      objective:
        typeof draftContent.objective === 'string' && !signedFinal
          ? draftContent.objective
          : fromCppt
            ? String(s.o ?? '')
            : '',
      author: cppt?.author.displayName ?? (me ? 'Anda' : '-'),
      createdAt: cppt ? formatJam(cppt.occurredAt) : draft ? formatJam(draft.updatedAt) : null,
      savedAt: draft ? formatJam(draft.updatedAt) : null,
      signedAt: signedFinal && cppt ? formatJam(cppt.recordedAt) : null,
      version: cppt?.version ?? 1,
    };

    // --- Rencana (order + surat kontrol) -------------------------------------------------------------------
    const plan: SoapPlanRow[] = [
      ...services
        .filter((r) => r.statusEvents[0]?.status !== 'dibatalkan')
        .map((r) => ({
          kind:
            r.orderable.kind === 'kontrol'
              ? ('KONTROL' as const)
              : (PLAN_KIND[r.orderable.kind] ?? 'TINDAKAN'),
          text: r.name,
          note: r.statusEvents[0]?.status === 'selesai' ? 'selesai' : 'dikirim',
          attention: false,
        })),
      ...meds
        .filter((m) => m.encounterId === enc.id && m.statusEvents[0]?.status !== 'dibatalkan')
        .map((m) => ({
          kind: 'OBAT' as const,
          text: m.name,
          note: `${m.dose} ${m.route} · ${MEDICATION_FREQUENCIES[m.frequency as MedicationFrequency]?.label ?? m.frequency}`,
          attention: false,
        })),
      ...(letter
        ? [
            {
              kind: 'KONTROL' as const,
              text: `Surat kontrol${letter.plannedDate ? ` ${formatTanggal(letter.plannedDate)}` : ''}`,
              note: letter.number ?? 'menunggu nomor BPJS',
              attention: false,
            },
          ]
        : []),
    ];

    const labsOut: EncounterLab[] = labs.map((l) => ({
      name: l.display.slice(0, 60),
      value:
        l.valueNumeric !== null
          ? `${l.valueNumeric.toString().replace('.', ',')}${l.valueUnit ? ` ${l.valueUnit}` : ''}`
          : (l.valueText ?? '—'),
      flag: LAB_FLAG[l.interpretation ?? ''] ?? '',
      reference: l.referenceRange ?? '',
      loinc: l.code,
    }));
    const activeMeds = meds
      .filter((m) => m.encounterId !== enc.id && m.statusEvents[0]?.status === 'aktif')
      .slice(0, 6)
      .map((m) => ({ name: `${m.name} ${m.dose}`, since: `sejak ${formatTanggal(m.createdAt)}` }));
    const resumeState: PoliVisit['api']['resume']['state'] = docs[0]
      ? 'final'
      : resumeDraft
        ? 'draf'
        : 'belum';
    const finished = row.status === 'finished';
    const stage = finished ? 5 : plan.length > 0 ? 3 : cppt || draft ? 2 : latest ? 1 : 0;

    this.db.audit({
      action: 'read',
      resourceType: 'poli_visit',
      resourceId: enc.id,
      patientId: enc.patientId,
    });
    return {
      encounter: {
        encounterId: enc.id,
        queueNo: row.queueTicket?.ticketNo ?? '—',
        poliName: row.service?.name ?? row.unit.name,
        doctor: row.practitioner?.name ?? '-',
        patient: {
          id: row.patient.id,
          name: row.patient.name,
          sex: SEX(row.patient.sex),
          ageYears: ageYears(row.patient.birthDate, today) ?? 0,
          birthDate: row.patient.birthDate ? row.patient.birthDate.toISOString().slice(0, 10) : null,
          rm: row.patient.mrn,
          nikMasked,
          allergies: allergyLabels,
          payer,
          payerLabel: cov ? `${cov.payer.name}${cov.careClass ? ` Kelas ${cov.careClass}` : ''}` : 'Umum',
          sep: cov?.seps[0]?.sepNo ?? null,
          fallRisk: 'Risiko jatuh: lihat asesmen',
          history: history.length > 0 ? `${history.length} kunjungan sebelumnya` : 'Kunjungan pertama',
        },
        stage: Math.min(stage, POLI_VISIT_STAGES.length - 1),
        vitalsAt: latest ? formatJam(latest.occurredAt) : null,
        vitals: vitalsOut,
        cdsNote:
          allergyLabels.length > 0
            ? `Alergi tercatat: ${allergyLabels.join(', ')}. CDS memeriksa ulang setiap resep di CPOE.`
            : 'Tidak ada alergi tercatat. CDS memeriksa interaksi dan dosis setiap resep di CPOE.',
        soap,
        diagnoses: [
          ...conditions.map((d) => ({ code: d.code, display: d.display, role: d.role })),
          ...draftDx.filter((d) => !conditions.some((c) => c.code === d.code)),
        ].map((d, i, all) => ({
          system: 'ICD-10' as const,
          code: d.code,
          display: d.display,
          primary: d.role === 'utama' || (i === 0 && !all.some((x) => x.role === 'utama')),
        })),
        plan,
        labDate: labs[0] ? formatTanggal(labs[0].occurredAt) : null,
        labs: labsOut,
        meds: activeMeds,
        history: history.map((h) => ({
          when: formatTanggal(h.createdAt),
          what: `${h.unit.name}${h.conditions[0] ? ` · ${h.conditions[0].code} ${h.conditions[0].display}` : ''}`,
        })),
        documents: [
          {
            name: 'Resume rawat jalan',
            value: resumeState === 'final' ? 'TTE diminta' : resumeState === 'draf' ? 'Draf' : 'Menunggu',
            done: resumeState === 'final',
          },
          {
            name: 'Surat kontrol',
            value: letter ? (letter.number ?? 'Menunggu nomor') : 'Belum dibuat',
            done: !!letter,
          },
        ],
      },
      api: {
        patientId: enc.patientId,
        encounterStatus: row.status as PoliVisit['api']['encounterStatus'],
        queueTicketId: row.queueTicket?.id ?? null,
        ticketStatus: (row.queueTicket?.status as QueueTicketStatus | undefined) ?? null,
        cppt: cppt
          ? {
              id: cppt.id,
              status: awaitingCosign ? 'menunggu_cosign' : (cppt.status as 'final' | 'entered_in_error'),
              authorUserId: cppt.authorUserId,
              authorName: cppt.author.displayName,
              recordedAt: cppt.recordedAt.toISOString(),
            }
          : null,
        draftSavedAt: draft ? draft.updatedAt.toISOString() : null,
        draft: draftParsed,
        resume: {
          state: resumeState,
          signatureStatus:
            (docs[0]?.signatures[0]?.status as PoliVisit['api']['resume']['signatureStatus'] | undefined) ??
            null,
        },
        canSign,
      },
    };
  }
}
