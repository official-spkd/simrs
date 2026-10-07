import type { TenantTx } from '@simrs/db';
import {
  BLOOD_ISSUE_CHECK_VALID_MINUTES,
  type BloodAboRule,
  type BloodComponentOption,
  type BloodRequestRecord,
  type BloodUnitRecord,
  type SupportPatientLite,
  type TransfusionRecord,
} from '@simrs/shared';
import { userNames } from '../../infra/clinical/support-access';

/** Pemuat rekaman bank darah bersama (permintaan lengkap + transfusi) untuk service permintaan dan transfusi. */

export const COMPONENT_SELECT = { id: true, code: true, name: true, aboRule: true } as const;

export const toComponent = (c: {
  id: string;
  code: string;
  name: string;
  aboRule: string;
}): BloodComponentOption => ({
  ...c,
  aboRule: c.aboRule as BloodAboRule,
});

export function toUnit(
  u: {
    id: string;
    bagNo: string;
    abo: string;
    rh: string;
    collectedAt: Date;
    expiresAt: Date;
    status: string;
    component: { id: string; code: string; name: string; aboRule: string };
  },
  now: Date,
): BloodUnitRecord {
  return {
    id: u.id,
    bagNo: u.bagNo,
    component: toComponent(u.component),
    abo: u.abo as BloodUnitRecord['abo'],
    rh: u.rh as BloodUnitRecord['rh'],
    collectedAt: u.collectedAt.toISOString(),
    expiresAt: u.expiresAt.toISOString(),
    status: u.status as BloodUnitRecord['status'],
    expired: u.expiresAt.getTime() <= now.getTime(),
  };
}

const TRANSFUSION_INCLUDE = {
  vitals: { orderBy: [{ recordedAt: 'asc' as const }, { id: 'asc' as const }] },
};

type TransfusionRow = {
  id: string;
  bloodIssueId: string;
  status: string;
  startedBy: string;
  startedAt: Date;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  endedAt: Date | null;
  stopReason: string | null;
  vitals: Array<{
    id: string;
    label: string;
    tempC: { toNumber(): number } | number;
    systolic: number;
    diastolic: number;
    pulse: number;
    signs: string[];
    recordedBy: string;
    recordedAt: Date;
  }>;
};

export function transfusionUserIds(t: TransfusionRow): string[] {
  return [t.startedBy, t.verifiedBy ?? '', ...t.vitals.map((v) => v.recordedBy)].filter(Boolean);
}

export function toTransfusion(t: TransfusionRow, names: Map<string, string>): TransfusionRecord {
  const person = (id: string) => ({ id, name: names.get(id) ?? '–' });
  return {
    id: t.id,
    bloodIssueId: t.bloodIssueId,
    status: t.status as TransfusionRecord['status'],
    startedBy: person(t.startedBy),
    startedAt: t.startedAt.toISOString(),
    verifiedBy: t.verifiedBy ? person(t.verifiedBy) : null,
    verifiedAt: t.verifiedAt?.toISOString() ?? null,
    endedAt: t.endedAt?.toISOString() ?? null,
    stopReason: t.stopReason,
    vitals: t.vitals.map((v) => ({
      id: v.id,
      label: v.label as TransfusionRecord['vitals'][number]['label'],
      tempC: typeof v.tempC === 'number' ? v.tempC : v.tempC.toNumber(),
      systolic: v.systolic,
      diastolic: v.diastolic,
      pulse: v.pulse,
      signs: v.signs,
      recordedBy: person(v.recordedBy),
      recordedAt: v.recordedAt.toISOString(),
    })),
  };
}

export async function loadTransfusion(tx: TenantTx, id: string): Promise<TransfusionRecord> {
  const t = await tx.transfusion.findUniqueOrThrow({ where: { id }, include: TRANSFUSION_INCLUDE });
  return toTransfusion(t, await userNames(tx, transfusionUserIds(t)));
}

/** Rekaman permintaan lengkap (crossmatch, cek ganda, pengeluaran + transfusi + reaksi), urutan masukan dipertahankan. */
export async function loadRequests(
  tx: TenantTx,
  ids: readonly string[],
  patients: Map<string, SupportPatientLite>,
  now: Date,
): Promise<BloodRequestRecord[]> {
  if (ids.length === 0) return [];
  const rows = await tx.bloodRequest.findMany({
    where: { id: { in: [...ids] } },
    include: {
      component: { select: COMPONENT_SELECT },
      crossmatches: {
        orderBy: [{ testedAt: 'asc' }, { id: 'asc' }],
        include: { bloodUnit: { select: { bagNo: true } } },
      },
      issueChecks: {
        orderBy: [{ checkedAt: 'asc' }, { id: 'asc' }],
        include: { bloodUnit: { select: { bagNo: true } }, issue: { select: { id: true } } },
      },
      issues: {
        orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
        include: {
          bloodUnit: { select: { bagNo: true, abo: true, rh: true, expiresAt: true } },
          issueCheck: { select: { checkedBy: true } },
          transfusion: { include: TRANSFUSION_INCLUDE },
          reactions: { orderBy: [{ reportedAt: 'asc' }, { id: 'asc' }] },
        },
      },
    },
  });
  const userIds: string[] = [];
  for (const r of rows) {
    userIds.push(
      r.requestedBy,
      ...r.crossmatches.map((c) => c.testedBy),
      ...r.issueChecks.map((c) => c.checkedBy),
    );
    for (const i of r.issues) {
      userIds.push(i.issuedBy, i.issueCheck?.checkedBy ?? '', ...i.reactions.map((x) => x.reportedBy));
      if (i.transfusion) userIds.push(...transfusionUserIds(i.transfusion));
    }
  }
  const names = await userNames(tx, userIds);
  const person = (id: string) => ({ id, name: names.get(id) ?? '–' });
  const staleBefore = now.getTime() - BLOOD_ISSUE_CHECK_VALID_MINUTES * 60_000;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: BloodRequestRecord[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    const patient = r ? patients.get(r.encounterId) : undefined;
    if (!r || !patient) continue;
    out.push({
      id: r.id,
      requestNo: r.requestNo,
      encounterId: r.encounterId,
      patient,
      component: toComponent(r.component),
      units: r.units,
      urgency: r.urgency as BloodRequestRecord['urgency'],
      indication: r.indication,
      patientAbo: r.patientAbo as BloodRequestRecord['patientAbo'],
      patientRh: r.patientRh as BloodRequestRecord['patientRh'],
      status: r.status as BloodRequestRecord['status'],
      requestedBy: person(r.requestedBy),
      requestedAt: r.requestedAt.toISOString(),
      crossmatches: r.crossmatches.map((c) => ({
        id: c.id,
        bloodUnitId: c.bloodUnitId,
        bagNo: c.bloodUnit.bagNo,
        result: c.result as 'cocok' | 'tidak_cocok',
        method: c.method,
        testedBy: person(c.testedBy),
        testedAt: c.testedAt.toISOString(),
      })),
      issueChecks: r.issueChecks.map((c) => ({
        id: c.id,
        bloodUnitId: c.bloodUnitId,
        bagNo: c.bloodUnit.bagNo,
        checkedBy: person(c.checkedBy),
        checkedAt: c.checkedAt.toISOString(),
        emergencyReason: c.emergencyReason,
        used: c.issue !== null,
        expired: c.checkedAt.getTime() < staleBefore,
      })),
      issues: r.issues.map((i) => ({
        id: i.id,
        bloodUnitId: i.bloodUnitId,
        bagNo: i.bloodUnit.bagNo,
        abo: i.bloodUnit.abo as 'A' | 'B' | 'AB' | 'O',
        rh: i.bloodUnit.rh as 'pos' | 'neg',
        expiresAt: i.bloodUnit.expiresAt.toISOString(),
        checkedBy: i.issueCheck ? person(i.issueCheck.checkedBy) : null,
        issuedBy: person(i.issuedBy),
        issuedAt: i.issuedAt.toISOString(),
        emergencyReason: i.emergencyReason,
        transfusion: i.transfusion ? toTransfusion(i.transfusion, names) : null,
        reactions: i.reactions.map((x) => ({
          id: x.id,
          occurredAt: x.occurredAt.toISOString(),
          severity: x.severity as 'ringan' | 'sedang' | 'berat',
          description: x.description,
          reportedBy: person(x.reportedBy),
          reportedAt: x.reportedAt.toISOString(),
        })),
      })),
    });
  }
  return out;
}
