import type { InterfaceId } from '@simrs/shared';
import {
  clinicalOrderSource,
  clinicalConsentSource,
  receiveClinicalOrder,
  receiveClinicalConsent,
} from './penunjang-klinis';
import { defineDomain, on, type DomainEvent } from './demo/store/define';
import { demoSatusehatVisits } from './demo/fixtures/integrasi-satusehat';
import { APLICARE_LAST_SYNC, demoBookings, demoBedClasses, demoHfis } from './demo/fixtures/integrasi-bpjs';
import { demoKemenkesReports } from './demo/fixtures/integrasi-kemenkes';
import { demoApiClients, demoAccessLog } from './demo/fixtures/integrasi-api-publik';
import { PROCESSED_TODAY, DEVICES } from './demo/fixtures/integrasi-perangkat';
import { DEAD_LETTERS, INTERFACES } from './demo/fixtures/manajemen';
import { criticalDomain } from './penunjang-kritis';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import {
  effectiveStatus,
  resendGate,
  resend,
  type FixState,
  type AuditEntry,
  type Visit,
} from './integrasi-satusehat';
import { resendInOrder, downtimeGate, syncOrder, type PendingTx } from './integrasi-bpjs';
import { applyFix, sendGate, SEND_BLOCK_TEXT, receiptNo } from './integrasi-kemenkes';
import { registerGate, suspendGate, nextKeySuffix, addDays } from './integrasi-api-publik';
import { redactPid, type InboundResult } from './integrasi-perangkat';
import { dlqNeedsFix } from './manajemen';
import {
  initialSupportState,
  reduceSupport,
  supportDomain,
  receiveGateway,
  supportReadBack,
} from './penunjang-demo';
import { integrationEventSchema, type IntegrationEvent } from './integrasi-event-schemas';

export function initialIntegrationState() {
  return {
    visits: demoSatusehatVisits(),
    fixed: {} as Record<string, FixState>,
    audit: [] as AuditEntry[],
    bookings: demoBookings(),
    beds: demoBedClasses(),
    hfis: demoHfis(),
    aplicareLastSync: APLICARE_LAST_SYNC,
    down: null as { since: string; reason: string } | null,
    backlog: [] as PendingTx[],
    synchronized: [] as PendingTx[],
    reports: demoKemenkesReports(),
    clients: demoApiClients(),
    apiLog: demoAccessLog(),
    processed: [...PROCESSED_TODAY],
    devices: DEVICES.map((d) => ({ ...d })),
    gatewayLog: [] as { at: string; result: InboundResult; redacted: string }[],
    hub: {
      down: null as { at: string; reason: string } | null,
      queued: {} as Partial<Record<InterfaceId, number>>,
      synced: {} as Partial<Record<InterfaceId, number>>,
      restored: null as string | null,
      gone: [] as string[],
      ticks: 0,
    },
    support: initialSupportState(),
  };
}
export type IntegrationState = ReturnType<typeof initialIntegrationState>;
function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function found<T>(row: T | undefined, message: string): T {
  must(row, message);
  return row;
}
const update = <T extends { id: string }>(rows: T[], next: T) =>
  rows.map((r) => (r.id === next.id ? next : r));
export function reduceIntegration(s: IntegrationState, ev: DomainEvent<IntegrationEvent>): IntegrationState {
  must(
    ['manajemen', 'admin_tenant', 'admin_platform', 'it'].includes(ev.actor.role ?? ''),
    'Posisi aktif tidak berhak mengelola integrasi.',
  );
  const a = ev.data;
  const at = ev.at;
  const audit = (action: string) => [{ at, by: ev.actor.name, action }, ...s.audit];
  switch (a.type) {
    case 'satusehat.aksi': {
      const p = a.input;
      const v = found(
        s.visits.find((v) => v.id === p.visitId),
        'Kunjungan tidak ditemukan.',
      );
      const fix = s.fixed[v.id] ?? { ihs: !!v.patient.ihs, loinc: false, kfa: false };
      if (p.kind === 'ihs') {
        must(!v.patient.ihs, 'IHS pasien sudah terverifikasi.');
        return {
          ...s,
          visits: update(s.visits, { ...v, patient: { ...v.patient, ihs: v.patient.ihsFound } }),
          fixed: { ...s.fixed, [v.id]: { ...fix, ihs: true } },
          audit: audit(`Lookup IHS ${v.encounterNo}`),
        };
      }
      const r = found(
        v.resources.find((r) => r.id === p.resourceId),
        'Resource tidak ditemukan.',
      );
      if (p.kind === 'kirim') {
        must(!s.hub.down, 'Pengiriman ditahan selama downtime.');
        must(
          v.patient.ihs && effectiveStatus(v)[r.id] === 'antre',
          'Verifikasi IHS dan tunggu urutan resource sebelum kirim.',
        );
        const out = resend(v, r.id, (type) => `${type.split(' ')[0]}/demo-${ev.seq}-${r.id}`);
        return {
          ...s,
          visits: update(s.visits, {
            ...out.visit,
            resources: out.visit.resources.map((x) =>
              x.sent && !v.resources.find((prev) => prev.id === x.id)?.sent ? { ...x, at } : x,
            ),
          }),
          audit: audit(`Kirim ${r.type} ${v.encounterNo}`),
        };
      }
      must(r.error, 'Resource tidak ada di DLQ.');
      if (p.kind === 'petakan') {
        must(r.error.fix === 'loinc' && !r.error.blockedReason, 'Pemetaan tidak tersedia dari layar ini.');
        return {
          ...s,
          fixed: { ...s.fixed, [v.id]: { ...fix, loinc: true } },
          audit: audit(`Pemetaan ${r.error.fixLabel}`),
        };
      }
      must(!s.hub.down, 'Pengiriman ditahan selama downtime.');
      const g = resendGate(r, fix);
      must(
        !g,
        g === 'FIX_BLOCKED'
          ? (r.error.blockedReason ?? 'Perbaikan tertahan.')
          : 'Perbaiki data di server sebelum kirim ulang.',
      );
      const out = resend(v, r.id, (type) => `${type.split(' ')[0]}/demo-${ev.seq}-${r.id}`);
      const visit = {
        ...out.visit,
        resources: out.visit.resources.map((x) =>
          x.sent && !v.resources.find((prev) => prev.id === x.id)?.sent ? { ...x, at } : x,
        ),
      };
      return {
        ...s,
        visits: update(s.visits, visit),
        audit: audit(`Kirim ulang ${r.type} ${v.encounterNo}`),
        hub: { ...s.hub, gone: [...new Set([...s.hub.gone, r.error.dlqId])] },
      };
    }
    case 'bpjs.aksi': {
      const p = a.input;
      if (p.kind === 'downtime-mulai') {
        must(!s.down, 'Mode downtime sudah aktif.');
        const g = downtimeGate(p.reason);
        must(!g, g ?? 'Alasan wajib.');
        return { ...s, down: { since: at, reason: p.reason.trim() }, audit: audit('Downtime BPJS dimulai') };
      }
      if (p.kind === 'downtime-akhiri') {
        must(s.down, 'Mode downtime belum aktif.');
        return {
          ...s,
          down: null,
          backlog: [],
          synchronized: [...s.synchronized, ...syncOrder(s.backlog)],
          audit: audit(`Downtime BPJS dipulihkan · ${s.backlog.length} transaksi disinkronkan`),
        };
      }
      must(!s.down, 'Kirim ditahan selama mode downtime BPJS.');
      if (p.kind === 'task') {
        const b = found(
          s.bookings.find((b) => b.bookingCode === p.bookingCode),
          'Booking tidak ditemukan.',
        );
        const out = resendInOrder(b, at);
        must(out.sent.length, 'Tidak ada task gagal yang perlu dikirim ulang.');
        return {
          ...s,
          bookings: s.bookings.map((x) => (x.bookingCode === b.bookingCode ? out.next : x)),
          audit: audit(`Task ${out.sent.join(' lalu ')} booking ${b.bookingCode} dikirim`),
        };
      }
      if (p.kind === 'aplicare')
        return {
          ...s,
          beds: s.beds.map((b) => ({ ...b, reported: b.available })),
          aplicareLastSync: at,
          audit: audit('Aplicare disinkronkan'),
        };
      const row = found(
        s.hfis.find((x) => x.doctor === p.doctor),
        'Dokter tidak terdaftar di HFIS.',
      );
      return {
        ...s,
        hfis: s.hfis.map((x) => (x.doctor === row.doctor ? { ...x, hfis: x.simrs } : x)),
        audit: audit(`Jadwal HFIS ${row.doctor} dikirim`),
      };
    }
    case 'bpjs.tunda':
      must(s.down, 'Pencatatan tertunda hanya selama downtime.');
      return {
        ...s,
        backlog: [...s.backlog, { at, kind: a.kind, label: a.label }],
        audit: audit(`${a.kind} ditunda`),
      };
    case 'kemenkes.aksi': {
      const p = a.input;
      const r = found(
        s.reports.find((r) => r.id === p.reportId),
        'Laporan tidak ditemukan.',
      );
      if (p.kind === 'perbaiki') {
        must(!r.sent && r.status !== 'belum-tersedia', 'Laporan terkunci atau belum tersedia.');
        const c = found(
          r.checks.find((c) => c.id === p.checkId),
          'Pemeriksaan tidak dikenal.',
        );
        must(!c.ok && c.fix, 'Pemeriksaan sudah lengkap atau tidak dapat diperbaiki.');
        return {
          ...s,
          reports: update(s.reports, applyFix(r, c.id)),
          audit: audit(`Data sumber dilengkapi: ${c.label}`),
        };
      }
      const g = sendGate(r);
      must(!g, g ? SEND_BLOCK_TEXT[g] : 'Laporan ditolak.');
      return {
        ...s,
        reports: update(s.reports, { ...r, status: 'terkirim', sent: { at, receipt: receiptNo(r, ev.seq) } }),
        audit: audit(`${r.name} periode ${r.period} dikirim`),
      };
    }
    case 'api.aksi': {
      const p = a.input;
      if (p.kind === 'daftar') {
        const errors = registerGate(p);
        must(!errors.length, errors.join(' '));
        must(
          !s.clients.some((c) => c.name.toLowerCase() === p.name.trim().toLowerCase()),
          'Nama klien sudah terdaftar.',
        );
        const id = `cl-demo-${ev.seq}`;
        return {
          ...s,
          clients: [
            ...s.clients,
            {
              id,
              name: p.name.trim(),
              purpose: p.purpose.trim(),
              scopes: [...new Set(p.scopes)],
              status: 'aktif',
              keySuffix: nextKeySuffix(id, ev.seq),
              keyCreated: DEMO_TODAY,
              keyExpires: addDays(DEMO_TODAY, 365),
              lastUsed: null,
              basis: p.basis.trim() || null,
              suspendedReason: null,
            },
          ],
          audit: audit(`Klien ${p.name.trim()} didaftarkan`),
        };
      }
      const c = found(
        s.clients.find((c) => c.id === p.clientId),
        'Klien tidak terdaftar.',
      );
      if (p.kind === 'rotasi') {
        must(c.status === 'aktif', 'Aktifkan klien sebelum rotasi.');
        return {
          ...s,
          clients: update(s.clients, {
            ...c,
            keySuffix: nextKeySuffix(c.id, ev.seq),
            keyCreated: DEMO_TODAY,
            keyExpires: addDays(DEMO_TODAY, 365),
          }),
          audit: audit(`Kunci ${c.name} dirotasi`),
        };
      }
      if (p.kind === 'tangguhkan') {
        const g = suspendGate(p.reason);
        must(!g, g ?? 'Alasan wajib.');
        must(c.status === 'aktif', 'Klien sudah ditangguhkan.');
        return {
          ...s,
          clients: update(s.clients, { ...c, status: 'ditangguhkan', suspendedReason: p.reason.trim() }),
          audit: audit(`Klien ${c.name} ditangguhkan`),
        };
      }
      must(c.status === 'ditangguhkan', 'Klien sudah aktif.');
      return {
        ...s,
        clients: update(s.clients, { ...c, status: 'aktif', suspendedReason: null }),
        audit: audit(`Klien ${c.name} diaktifkan`),
      };
    }
    case 'gateway.terima': {
      const { state: support, result } = receiveGateway(s.support, a.raw, at);
      return {
        ...s,
        support,
        processed: support.gatewayProcessed,
        gatewayLog: [{ at, result, redacted: redactPid(a.raw) }, ...s.gatewayLog],
        audit: audit(`Gateway ACK ${result.ack} ${result.controlId ?? ''}`),
      };
    }
    case 'hub.kirim-ulang': {
      must(!s.hub.down, 'Kirim ulang ditahan selama downtime.');
      const ids = [...new Set(a.input.ids)];
      const rows = ids.map((id) =>
        found(
          DEAD_LETTERS.find((r) => r.id === id && !s.hub.gone.includes(id)),
          'Pesan tidak ada di antrean.',
        ),
      );
      must(
        rows.every((r) => !dlqNeedsFix(r)),
        'Perbaiki data pesan permanen sebelum kirim ulang.',
      );
      return {
        ...s,
        hub: { ...s.hub, gone: [...s.hub.gone, ...ids] },
        audit: audit(`${ids.length} pesan dikirim ulang lewat outbox demo`),
      };
    }
    case 'hub.mulai':
      must(!s.hub.down, 'Uji downtime sudah aktif.');
      return {
        ...s,
        hub: {
          ...s.hub,
          down: { at, reason: 'Uji mode downtime terkendali' },
          restored: null,
          queued: {},
          ticks: 0,
        },
        audit: audit('Uji downtime dimulai'),
      };
    case 'hub.detak': {
      must(s.hub.down, 'Uji downtime tidak aktif.');
      const external = INTERFACES.filter((i) => i.external);
      const target = external[s.hub.ticks % external.length]?.id;
      const queued = { ...s.hub.queued };
      if (target) queued[target] = (queued[target] ?? 0) + 1;
      queued.satusehat = (queued.satusehat ?? 0) + 1;
      return { ...s, hub: { ...s.hub, queued, ticks: s.hub.ticks + 1 } };
    }
    case 'hub.pulih': {
      must(s.hub.down, 'Uji downtime tidak aktif.');
      const synced = { ...s.hub.synced };
      for (const [id, count] of Object.entries(s.hub.queued) as [InterfaceId, number][])
        synced[id] = (synced[id] ?? 0) + count;
      const total = Object.values(s.hub.queued).reduce((n, x) => n + (x ?? 0), 0);
      return {
        ...s,
        hub: {
          ...s.hub,
          down: null,
          queued: {},
          synced,
          restored: `${total} transaksi lokal disinkronkan berurutan tanpa duplikasi.`,
        },
        audit: audit('Uji downtime dipulihkan'),
      };
    }
  }
}

/** Hasil penunjang menambah Observation/Procedure/MedicationRequest yang antre berurutan dalam demo. */
function supportMessages(s: IntegrationState, ev: Parameters<typeof reduceSupport>[1]): IntegrationState {
  const support = reduceSupport(s.support, ev);
  const newResults = support.released.slice(s.support.released.length);
  const visits = [...s.visits];
  for (const result of newResults) {
    const sample = support.samples.find((x) => x.id === result.id);
    const exam = support.exams.find((x) => x.id === result.id);
    const patient =
      sample?.patient ??
      exam?.patient ??
      support.prescriptions.find((x) => x.id === result.id)?.patient ??
      support.cultures.find((x) => x.id === result.id)?.patient ??
      support.pa.find((x) => x.id === result.id)?.patient ??
      support.diagnostics.find((x) => x.id === result.id)?.patient ??
      support.operations.find((x) => x.id === result.id)?.patient;
    if (!patient) continue;
    const id = `ss-${patient.id}`;
    let v: Visit = visits.find((v) => v.id === id) ?? {
      id,
      encounterNo: `DEMO-${patient.rm}`,
      kind: 'Rawat jalan',
      unit: sample?.location ?? 'Radiologi',
      patient: { name: patient.name, rm: patient.rm, nikMasked: '•••', ihs: null, ihsFound: 'DEMO-IHS' },
      resources: [
        {
          id: `${id}-enc`,
          type: 'Encounter',
          label: 'Kunjungan demo · menunggu pemetaan IHS',
          code: null,
          at: null,
          sent: false,
          resourceId: null,
          error: null,
          holdReason: null,
          payload: {},
        },
      ],
    };
    v = {
      ...v,
      resources: [
        ...v.resources,
        {
          id: `hasil-${result.id}`,
          type:
            result.source === 'operasi'
              ? 'Procedure'
              : result.source === 'farmasi'
                ? 'MedicationRequest'
                : 'Observation',
          label: `${result.source} tervalidasi`,
          code: null,
          at: result.at,
          sent: false,
          resourceId: null,
          error: null,
          holdReason: null,
          payload: { source: result.source, id: result.id },
        },
      ],
    };
    const index = visits.findIndex((x) => x.id === id);
    if (index >= 0) visits[index] = v;
    else visits.push(v);
  }
  return { ...s, support, visits };
}
export const integrationClinicalSubscriptions = [
  on(clinicalOrderSource, (s: IntegrationState, ev) => ({
    ...s,
    support: receiveClinicalOrder(s.support, ev),
  })),
  on(clinicalConsentSource, (s: IntegrationState, ev) => ({
    ...s,
    support: receiveClinicalConsent(s.support, ev),
  })),
];

export const integrationDomain = defineDomain('integrasi', {
  initial: initialIntegrationState,
  eventSchema: integrationEventSchema,
  reduce: reduceIntegration,
  screens: ['integrasi', 'satusehat', 'bpjs', 'kemenkes', 'perangkat', 'api-publik'],
  subscriptions: [
    on(supportDomain, supportMessages),
    ...integrationClinicalSubscriptions,
    on(criticalDomain, (s: IntegrationState, ev) => ({ ...s, support: supportReadBack(s.support, ev) })),
  ],
});
