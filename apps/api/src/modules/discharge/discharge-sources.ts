import { Injectable } from '@nestjs/common';
import {
  AppError,
  type CodedDiagnosis,
  type DischargeMedicationLine,
  type DischargeSectionId,
  type DischargeSourceRef,
  type DischargeSummaryKind,
  formatTanggal,
  formatTanggalWaktu,
  MEDICATION_FREQUENCIES,
  type MedicationFrequency,
  type ResumeSection,
} from '@simrs/shared';
import { TenantDb } from '../../infra/tenant-db';

const CURRENT = { supersededBy: { none: {} } } as const;
const FINAL_CURRENT = { status: 'final', ...CURRENT } as const;

/** Bagian yang dihimpun dari data sumber (isi = data sumber; DPJP hanya menambah catatan). */
export interface CompiledSection {
  title: string;
  /** Isi dari sumber; kosong = belum ada datanya. */
  body: string;
  source: ResumeSection['source'];
  refs: DischargeSourceRef[];
}

export interface CompiledEncounter {
  id: string;
  number: string;
  encounterClass: 'AMB' | 'EMER' | 'IMP';
  status: string;
  patientId: string;
  patientName: string;
  mrn: string;
  unitName: string;
  location: string;
  admittedAt: Date | null;
  endedAt: Date | null;
  admissionVia: string;
  dpjp: string | null;
  disposition: string | null;
}

/**
 * Himpunan resume dari sumber terkini. Diagnosis/prosedur berkode → `codes`; bagian teks → `sections`. Dipakai untuk
 * pratinjau, draf, dan finalisasi (finalisasi selalu menghimpun ulang sehingga isi resume = data sumber saat TTE).
 */
export interface CompiledResume {
  kind: DischargeSummaryKind;
  encounter: CompiledEncounter;
  sections: Record<'anamnesis' | 'fisik' | 'penunjang' | 'terapi', CompiledSection>;
  /** Fisik masuk dan pulang (bukti butir `fisik`). */
  physical: { admission: string | null; discharge: string | null };
  codes: CodedDiagnosis[];
  diagnosisRefs: DischargeSourceRef[];
  procedureRefs: DischargeSourceRef[];
  primaryDiagnosisCoded: boolean;
  /** Surat kontrol kunjungan ini (F06), bila ada. */
  controlLetter: { text: string; ref: DischargeSourceRef } | null;
  /** Usulan rekonsiliasi: order obat aktif kunjungan ini (lanjut). */
  proposedMedications: DischargeMedicationLine[];
  identityComplete: boolean;
}

const CLASS_VIA: Record<string, string> = { AMB: 'Rawat jalan', EMER: 'IGD', IMP: 'Rawat inap' };

/** Teks satu panel tanda vital (`observations.components`). */
export function vitalText(c: Record<string, unknown>): string {
  const n = (k: string) => (typeof c[k] === 'number' ? (c[k] as number) : null);
  const parts: string[] = [];
  const sbp = n('sbp');
  const dbp = n('dbp');
  if (sbp !== null && dbp !== null) parts.push(`TD ${sbp}/${dbp} mmHg`);
  if (n('hr') !== null) parts.push(`N ${n('hr')} x/mnt`);
  if (n('rr') !== null) parts.push(`RR ${n('rr')} x/mnt`);
  if (n('temp') !== null) parts.push(`S ${String(n('temp')).replace('.', ',')} °C`);
  if (n('spo2') !== null) parts.push(`SpO2 ${n('spo2')}%${c.onOxygen === true ? ' (O2)' : ''}`);
  if (n('weightKg') !== null) parts.push(`BB ${String(n('weightKg')).replace('.', ',')} kg`);
  return parts.join(', ');
}

function soapPart(content: unknown, key: 's' | 'o' | 'a' | 'p'): string {
  if (!content || typeof content !== 'object') return '';
  const c = content as Record<string, unknown>;
  return c.format === 'soap' && typeof c[key] === 'string' ? (c[key] as string).trim() : '';
}

function frequencyLabel(code: string): string {
  return MEDICATION_FREQUENCIES[code as MedicationFrequency]?.label ?? code;
}

export function medicationSig(m: { dose: string; route: string; frequency: string }): string {
  return `${m.dose} ${m.route} · ${frequencyLabel(m.frequency)}`.slice(0, 80);
}

/**
 * K13 · Penghimpun sumber resume (rencana §3.6): asesmen/CPPT, observasi, hasil, kondisi, prosedur, order obat +
 * eMAR, surat kontrol. Rawat inap ikut membaca kunjungan IGD/RJ asalnya (`source_encounter_id`, keputusan fase 3 no.
 * 7) agar asesmen awal IGD masuk resume. Hanya membaca versi final terkini (`supersededBy: none`).
 */
@Injectable()
export class DischargeSourcesService {
  constructor(private readonly db: TenantDb) {}

  async compile(encounterId: string): Promise<CompiledResume> {
    const tx = this.db.tx();
    const enc = await tx.encounter.findUnique({
      where: { id: encounterId },
      select: {
        id: true,
        number: true,
        encounterClass: true,
        status: true,
        patientId: true,
        sourceEncounterId: true,
        arrivedAt: true,
        startedAt: true,
        createdAt: true,
        endedAt: true,
        disposition: true,
        unit: { select: { name: true } },
        practitioner: { select: { name: true } },
        patient: { select: { name: true, mrn: true } },
        sourceEncounter: { select: { encounterClass: true } },
      },
    });
    if (!enc) throw new AppError('NOT_FOUND', 'Kunjungan tidak ditemukan', 404);
    const kind: DischargeSummaryKind = enc.encounterClass === 'IMP' ? 'rawat_inap' : 'rawat_jalan';
    const ids = [enc.id, ...(kind === 'rawat_inap' && enc.sourceEncounterId ? [enc.sourceEncounterId] : [])];

    const [dpjp, bed, cppt, vitals, results, reports, conditions, procedures, meds, given, letter] =
      await Promise.all([
        tx.encounterParticipant.findFirst({
          where: { encounterId: enc.id, role: 'dpjp_utama' },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          select: { user: { select: { displayName: true } } },
        }),
        tx.bedAssignment.findFirst({
          where: { encounterId: enc.id },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          select: { location: { select: { name: true } } },
        }),
        tx.cpptEntry.findMany({
          where: { encounterId: { in: ids }, ppa: { in: ['dpjp', 'residen'] }, ...FINAL_CURRENT },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: { id: true, content: true, occurredAt: true },
        }),
        tx.observation.findMany({
          where: { encounterId: { in: ids }, category: 'vital', ...FINAL_CURRENT },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: { id: true, components: true, occurredAt: true },
        }),
        tx.observation.findMany({
          where: { encounterId: { in: ids }, category: { in: ['lab', 'imaging'] }, ...FINAL_CURRENT },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          take: 30,
          select: {
            id: true,
            display: true,
            valueNumeric: true,
            valueUnit: true,
            valueText: true,
            interpretation: true,
            occurredAt: true,
          },
        }),
        tx.diagnosticReport.findMany({
          where: { encounterId: { in: ids }, ...FINAL_CURRENT, conclusion: { not: null } },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          take: 10,
          select: { id: true, display: true, conclusion: true },
        }),
        tx.condition.findMany({
          where: { encounterId: enc.id, kind: 'encounter', ...FINAL_CURRENT },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: { id: true, code: true, display: true, role: true },
        }),
        tx.procedure.findMany({
          where: { encounterId: enc.id, ...FINAL_CURRENT },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: { id: true, code: true, display: true },
        }),
        tx.medicationRequest.findMany({
          where: { encounterId: enc.id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            dose: true,
            route: true,
            frequency: true,
            statusEvents: {
              orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { status: true },
            },
          },
        }),
        kind === 'rawat_inap'
          ? tx.medicationAdministration.findMany({
              where: { encounterId: { in: ids }, status: 'given' },
              orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
              select: { id: true, medicationRequestId: true, occurredAt: true },
            })
          : Promise.resolve([]),
        tx.referral.findFirst({
          where: { encounterId: enc.id, kind: 'surat-kontrol', status: { not: 'cancelled' } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            number: true,
            plannedDate: true,
            facilityName: true,
            targetService: { select: { name: true } },
          },
        }),
      ]);

    // --- Anamnesis (S dari CPPT dokter pertama) ---------------------------------------------------------------
    const firstS = cppt.find((c) => soapPart(c.content, 's'));
    const anamnesis: CompiledSection = {
      title: 'Alasan masuk dan anamnesis singkat',
      body: firstS ? soapPart(firstS.content, 's') : '',
      source: 'cppt',
      refs: firstS ? [{ type: 'cppt_entries', id: firstS.id }] : [],
    };

    // --- Pemeriksaan fisik (TTV masuk dan pulang + O CPPT dokter) ---------------------------------------------
    const first = vitals[0];
    const last = vitals.length > 1 ? vitals[vitals.length - 1] : undefined;
    const vText = (v: { components: unknown; occurredAt: Date }) =>
      `${formatTanggalWaktu(v.occurredAt)}: ${vitalText((v.components ?? {}) as Record<string, unknown>)}`;
    const firstO = cppt.find((c) => soapPart(c.content, 'o'));
    const lastO = [...cppt].reverse().find((c) => soapPart(c.content, 'o'));
    const admissionPhys = [first ? vText(first) : null, firstO ? soapPart(firstO.content, 'o') : null]
      .filter(Boolean)
      .join('\n');
    const dischargePhys =
      kind === 'rawat_inap'
        ? [last ? vText(last) : null, lastO && lastO !== firstO ? soapPart(lastO.content, 'o') : null]
            .filter(Boolean)
            .join('\n')
        : admissionPhys;
    const fisikLines =
      kind === 'rawat_inap'
        ? [admissionPhys && `Masuk · ${admissionPhys}`, dischargePhys && `Pulang · ${dischargePhys}`]
        : [admissionPhys];
    const fisik: CompiledSection = {
      title: 'Pemeriksaan fisik penting',
      body: fisikLines.filter(Boolean).join('\n'),
      source: 'observasi',
      refs: [
        ...[first, last].flatMap((v) => (v ? [{ type: 'observations' as const, id: v.id }] : [])),
        ...[...new Set([firstO, lastO].filter((c) => !!c))].map((c) => ({
          type: 'cppt_entries' as const,
          id: (c as { id: string }).id,
        })),
      ],
    };

    // --- Penunjang ----------------------------------------------------------------------------------------------
    const resultLines = results.map((r) => {
      const value =
        r.valueNumeric !== null
          ? `${r.valueNumeric.toString().replace('.', ',')}${r.valueUnit ? ` ${r.valueUnit}` : ''}`
          : (r.valueText ?? '');
      const flag = r.interpretation && r.interpretation !== 'normal' ? ` (${r.interpretation})` : '';
      return `${r.display}: ${value}${flag}`;
    });
    const reportLines = reports.map((r) => `${r.display}: ${r.conclusion ?? ''}`);
    const penunjang: CompiledSection = {
      title: 'Pemeriksaan penunjang',
      body: [...reportLines, ...resultLines].join('\n'),
      source: 'hasil',
      refs: [
        ...reports.map((r) => ({ type: 'diagnostic_reports' as const, id: r.id })),
        ...results.map((r) => ({ type: 'observations' as const, id: r.id })),
      ],
    };

    // --- Terapi (rawat inap: eMAR diberikan; rawat jalan: order obat kunjungan) -------------------------------
    const activeMeds = meds.filter((m) => m.statusEvents[0]?.status !== 'dibatalkan');
    let terapi: CompiledSection;
    if (kind === 'rawat_inap') {
      const byReq = new Map<string, number>();
      for (const g of given) byReq.set(g.medicationRequestId, (byReq.get(g.medicationRequestId) ?? 0) + 1);
      const lines = meds
        .filter((m) => byReq.has(m.id))
        .map((m) => `${m.name} ${m.dose} ${m.route} · ${byReq.get(m.id)}× diberikan`);
      terapi = {
        title: 'Terapi selama dirawat',
        body: lines.join('\n'),
        source: 'emar',
        refs: given.map((g) => ({ type: 'medication_administrations' as const, id: g.id })),
      };
    } else {
      terapi = {
        title: 'Terapi dan tindakan',
        body: activeMeds.map((m) => `${m.name} ${medicationSig(m)}`).join('\n'),
        source: 'cppt',
        refs: activeMeds.map((m) => ({ type: 'medication_requests' as const, id: m.id })),
      };
    }
    // Rencana (P) CPPT dokter terakhir melengkapi terapi rawat jalan.
    if (kind === 'rawat_jalan') {
      const lastP = [...cppt].reverse().find((c) => soapPart(c.content, 'p'));
      if (lastP) {
        terapi.body = [terapi.body, `Rencana: ${soapPart(lastP.content, 'p')}`].filter(Boolean).join('\n');
        terapi.refs.push({ type: 'cppt_entries', id: lastP.id });
      }
    }

    // --- Diagnosis dan prosedur berkode ---------------------------------------------------------------------------
    const ROLE_ORDER: Record<string, number> = { utama: 0, sekunder: 1, komplikasi: 2 };
    const sortedConditions = [...conditions].sort(
      (a, b) => (ROLE_ORDER[a.role ?? ''] ?? 9) - (ROLE_ORDER[b.role ?? ''] ?? 9),
    );
    const codes: CodedDiagnosis[] = [
      ...sortedConditions.map((c) => ({
        system: 'ICD-10' as const,
        code: c.code,
        label: c.display.slice(0, 80),
        primary: c.role === 'utama',
      })),
      ...procedures.map((p) => ({
        system: 'ICD-9-CM' as const,
        code: p.code,
        label: p.display.slice(0, 80),
        primary: false,
      })),
    ];

    const controlLetter = letter
      ? {
          text: [
            'Surat kontrol',
            letter.number ? `no. ${letter.number}` : '(nomor menunggu BPJS)',
            letter.targetService?.name ?? letter.facilityName,
            letter.plannedDate ? formatTanggal(letter.plannedDate) : null,
          ]
            .filter(Boolean)
            .join(' · '),
          ref: { type: 'referrals' as const, id: letter.id },
        }
      : null;

    const dpjpName = dpjp?.user.displayName ?? enc.practitioner?.name ?? null;
    const admittedAt = enc.startedAt ?? enc.arrivedAt ?? enc.createdAt;
    return {
      kind,
      encounter: {
        id: enc.id,
        number: enc.number,
        encounterClass: enc.encounterClass as CompiledEncounter['encounterClass'],
        status: enc.status,
        patientId: enc.patientId,
        patientName: enc.patient.name,
        mrn: enc.patient.mrn,
        unitName: enc.unit.name,
        location: bed?.location.name ? `${enc.unit.name} ${bed.location.name}` : enc.unit.name,
        admittedAt,
        endedAt: enc.endedAt,
        admissionVia: enc.sourceEncounter
          ? (CLASS_VIA[enc.sourceEncounter.encounterClass] ?? 'Rujukan')
          : (CLASS_VIA[enc.encounterClass] ?? 'Rawat jalan'),
        dpjp: dpjpName,
        disposition: enc.disposition,
      },
      sections: { anamnesis, fisik, penunjang, terapi },
      physical: { admission: admissionPhys || null, discharge: dischargePhys || null },
      codes,
      diagnosisRefs: sortedConditions.map((c) => ({ type: 'conditions' as const, id: c.id })),
      procedureRefs: procedures.map((p) => ({ type: 'procedures' as const, id: p.id })),
      primaryDiagnosisCoded: conditions.some((c) => c.role === 'utama'),
      controlLetter,
      proposedMedications: activeMeds.map((m) => ({
        medicationRequestId: m.id,
        name: m.name.slice(0, 80),
        sig: medicationSig(m),
        change: 'lanjut' as const,
      })),
      identityComplete: !!(enc.patient.name && enc.patient.mrn && admittedAt && dpjpName),
    };
  }
}

export type CompiledSectionId = Extract<DischargeSectionId, keyof CompiledResume['sections']>;
