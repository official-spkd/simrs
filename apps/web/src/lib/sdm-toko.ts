import { z } from 'zod';
import {
  type ActorRef,
  actorRef,
  idSchema,
  jamSchema,
  type LogLine,
  must,
  pushLog,
  whenSchema,
} from './backoffice-toko';
import { defineDomain } from './demo/store/define';
import { draftRoster, EMPLOYEES, ROSTER_STAFF, ROSTER_UNIT } from './demo/fixtures/pegawai';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import {
  assign,
  daysBetween,
  type License,
  overHours,
  publishBlock,
  restViolations,
  type Roster,
  rosterGaps,
  SHIFTS,
  unassign,
  worstLicense,
} from './sdm';

/**
 * B03 · Domain toko demo `sdm` (ADR-0085, CX-3): izin praktik (SIP baru, pengingat), pembukaan NIK beralasan (jejak
 * audit), pegawai keluar, dan jadwal dinas (draf → terbit → revisi). Gerbang terbit jadwal di toko: minimum per
 * dinas, jeda istirahat setelah malam (pagi DAN siang), dan batas 40 jam/minggu (utang bug 6 Okt).
 *
 * Kejadian `sip.diperbarui` dilanggan Kredensial (domain `kredensial`): verifikasi berkas memakai izin terbaru.
 */

export const HR_DOMAIN = 'sdm';
export const MIN_HR_REASON = 10;
const shift = z.enum(['P', 'S', 'M']);
const day = z.number().int().min(0).max(6);

export const hrEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('sip.diperbarui'),
    employeeId: idSchema,
    number: z.string().trim().min(6).max(40),
    until: z.iso.date(),
    jam: jamSchema,
  }),
  z.strictObject({ type: z.literal('pengingat.dikirim'), employeeId: idSchema, jam: jamSchema }),
  z.strictObject({
    type: z.literal('nik.dibuka'),
    employeeId: idSchema,
    reason: z.string().trim().min(MIN_HR_REASON).max(300),
    jam: jamSchema,
  }),
  z.strictObject({
    type: z.literal('pegawai.keluar'),
    employeeId: idSchema,
    reason: z.string().trim().min(MIN_HR_REASON).max(300),
    jam: jamSchema,
  }),
  z.strictObject({ type: z.literal('dinas.ditambah'), day, shift, staffId: idSchema }),
  z.strictObject({ type: z.literal('dinas.dilepas'), day, shift, staffId: idSchema }),
  z.strictObject({ type: z.literal('jadwal.diterbitkan'), when: whenSchema }),
  z.strictObject({ type: z.literal('jadwal.direvisi'), when: whenSchema }),
]);
export type HrEvent = z.infer<typeof hrEventSchema>;

export interface EmployeeProgress {
  licenses: License[];
  remindedAt: string | null;
  left: { jam: string; reason: string; by: string } | null;
}

export interface HrStoreState {
  employees: Record<string, EmployeeProgress>;
  /** Jejak pembukaan NIK utuh (siapa, kapan, alasan). */
  nikAudit: Array<{ employeeId: string; jam: string; reason: string; by: string }>;
  roster: Roster;
  version: number;
  published: { version: number; when: string; by: ActorRef } | null;
  log: LogLine[];
}

export function initialHr(): HrStoreState {
  return {
    employees: Object.fromEntries(
      EMPLOYEES.map((e) => [e.id, { licenses: [...e.licenses], remindedAt: null, left: null }]),
    ),
    nikAudit: [],
    roster: draftRoster(),
    version: 1,
    published: null,
    log: [],
  };
}

const ROSTER_IDS = ROSTER_STAFF.map((e) => e.id);
const DAYS = ROSTER_UNIT.dayLabels.length;

/** Gerbang terbit jadwal (sama dengan yang tampil di layar). */
export function rosterPublishBlock(roster: Roster): string | null {
  return publishBlock(
    rosterGaps(roster, DAYS, ROSTER_UNIT.minimum),
    restViolations(roster, DAYS),
    overHours(roster, ROSTER_IDS),
  );
}

export function sipBlock(number: string, until: string, today = DEMO_TODAY): string | null {
  if (number.trim().length < 6) return 'Isi nomor SIP baru.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return 'Isi masa berlaku dengan format TTTT-BB-HH.';
  return daysBetween(today, until) <= 0 ? 'Masa berlaku harus setelah hari ini.' : null;
}

function gate(s: HrStoreState, ev: HrEvent): string | null {
  switch (ev.type) {
    case 'sip.diperbarui':
    case 'pengingat.dikirim':
    case 'nik.dibuka':
    case 'pegawai.keluar': {
      const e = s.employees[ev.employeeId];
      if (!e) return 'Pegawai tidak ditemukan.';
      if (ev.type === 'nik.dibuka') return null;
      if (e.left) return 'Pegawai sudah keluar.';
      if (ev.type === 'pegawai.keluar') return null;
      const w = worstLicense(e.licenses, DEMO_TODAY);
      if (ev.type === 'sip.diperbarui') {
        if (w.status !== 'kedaluwarsa' || w.license?.kind !== 'SIP') return 'SIP pegawai ini masih berlaku.';
        return sipBlock(ev.number, ev.until);
      }
      if (w.status !== 'segera') return 'Izin praktik tidak dalam masa pengingat.';
      return e.remindedAt ? 'Pengingat sudah dikirim.' : null;
    }
    case 'dinas.ditambah':
    case 'dinas.dilepas': {
      if (s.published) return 'Jadwal sudah terbit; buat revisi dulu.';
      if (!ROSTER_IDS.includes(ev.staffId)) return 'Perawat tidak ada di daftar unit.';
      const cells = s.roster[ev.day];
      if (ev.type === 'dinas.dilepas')
        return cells?.[ev.shift]?.includes(ev.staffId) ? null : 'Perawat tidak ada di dinas ini.';
      return SHIFTS.some((x) => cells?.[x]?.includes(ev.staffId)) ? 'Perawat sudah dinas di hari itu.' : null;
    }
    case 'jadwal.diterbitkan':
      return s.published ? 'Jadwal sudah terbit.' : rosterPublishBlock(s.roster);
    case 'jadwal.direvisi':
      return s.published ? null : 'Jadwal masih draf.';
  }
}

export const hrDomain = defineDomain<HrStoreState, HrEvent>(HR_DOMAIN, {
  initial: initialHr,
  eventSchema: hrEventSchema,
  screens: ['sdm'],
  generic: true,
  validate: (s, ev) => gate(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    must(gate(s, d));
    const by = actorRef(ev.actor);
    const emp = (id: string, p: Partial<EmployeeProgress>) => ({
      ...s.employees,
      [id]: { ...(s.employees[id] as EmployeeProgress), ...p },
    });
    switch (d.type) {
      case 'sip.diperbarui': {
        const cur = s.employees[d.employeeId] as EmployeeProgress;
        const licenses = cur.licenses.map((l) =>
          l.kind === 'SIP' ? { kind: 'SIP' as const, number: `SIP ${d.number.trim()}`, expiry: d.until } : l,
        );
        return {
          ...s,
          employees: emp(d.employeeId, { licenses }),
          log: pushLog(s.log, { jam: d.jam, text: `SIP baru ${d.employeeId} dicatat`, by: by.name }),
        };
      }
      case 'pengingat.dikirim':
        return { ...s, employees: emp(d.employeeId, { remindedAt: d.jam }) };
      case 'nik.dibuka':
        return {
          ...s,
          nikAudit: [
            { employeeId: d.employeeId, jam: d.jam, reason: d.reason.trim(), by: by.name },
            ...s.nikAudit,
          ].slice(0, 50),
        };
      case 'pegawai.keluar':
        return {
          ...s,
          employees: emp(d.employeeId, { left: { jam: d.jam, reason: d.reason.trim(), by: by.name } }),
        };
      case 'dinas.ditambah':
        return { ...s, roster: assign(s.roster, d.day, d.shift, d.staffId) };
      case 'dinas.dilepas':
        return { ...s, roster: unassign(s.roster, d.day, d.shift, d.staffId) };
      case 'jadwal.diterbitkan':
        return { ...s, published: { version: s.version, when: d.when, by } };
      case 'jadwal.direvisi':
        return { ...s, published: null, version: s.version + 1 };
    }
  },
});
