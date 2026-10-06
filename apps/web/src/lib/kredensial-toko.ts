import { z } from 'zod';
import { type ActorRef, actorRef, idSchema, must, roleBlock, whenSchema } from './backoffice-toko';
import { type DemoActor, defineDomain, on } from './demo/store/define';
import { GRANTED_PRIVILEGES, PRIVILEGE_APPLICATIONS } from './demo/fixtures/kredensial';
import { EMPLOYEES } from './demo/fixtures/pegawai';
import { DEMO_TODAY } from './demo/fixtures/waktu';
import {
  credentialVerifyBlock,
  type GrantedPrivilege,
  type PrivilegeDecision,
  reviewBlock,
  rkkExpiry,
  rkkNumber,
} from './kredensial';
import type { License } from './sdm';
import { hrDomain } from './sdm-toko';

/**
 * B04 · Domain toko demo `kredensial` (ADR-0085, CX-3): verifikasi berkas → telaah mitra bestari → rekomendasi
 * komite → RKK + SPK terbit oleh direktur. Langkah hanya posisi berhak (utang bug 6 Okt): telaah dan rapat komite
 * oleh posisi Dokter (bukan praktisi yang diajukan; rapat komite oleh pengguna lain dari penelaah), RKK oleh posisi
 * Manajemen (direktur). Melanggan `sdm` (`sip.diperbarui`): verifikasi memakai izin praktik terbaru dari SDM.
 * `granted` adalah RKK berlaku untuk `orderGuard` (CPOE CD-2 bisa membaca domain ini).
 */

export const CREDENTIAL_DOMAIN = 'kredensial';
export const REVIEW_ROLES = ['dokter'] as const;
export const COMMITTEE_ROLES = ['dokter'] as const;
export const DIRECTOR_ROLES = ['manajemen'] as const;
const decision = z.enum(['diberikan', 'supervisi', 'tidak']);

export const credentialEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('berkas.diverifikasi'),
    id: idSchema,
    docs: z.array(z.boolean()).max(20),
    when: whenSchema,
  }),
  z.strictObject({
    type: z.literal('telaah.dikirim'),
    id: idSchema,
    decisions: z.record(z.string().min(1).max(120), decision),
    note: z.string().trim().min(10).max(600),
    when: whenSchema,
  }),
  z.strictObject({ type: z.literal('komite.disetujui'), id: idSchema, when: whenSchema }),
  z.strictObject({ type: z.literal('rkk.diterbitkan'), id: idSchema, when: whenSchema }),
]);
export type CredentialEvent = z.infer<typeof credentialEventSchema>;

export interface CredentialProgress {
  stage: 0 | 1 | 2 | 3 | 4;
  docs: boolean[];
  decisions: Record<string, PrivilegeDecision>;
  note: string;
  at: Partial<Record<1 | 2 | 3 | 4, string>>;
  by: Partial<Record<1 | 2 | 3 | 4, ActorRef>>;
  rkk: { number: string; expiry: string } | null;
}

export interface CredentialStoreState {
  apps: Record<string, CredentialProgress>;
  granted: GrantedPrivilege[];
  seq: number;
  /** Izin praktik terbaru per pegawai (fixture + SIP baru dari SDM). */
  licenses: Record<string, License[]>;
}

export function initialCredentials(): CredentialStoreState {
  return {
    apps: Object.fromEntries(
      PRIVILEGE_APPLICATIONS.map((a) => [
        a.id,
        {
          stage: a.stage,
          docs: a.documents.map((d) => d.ok),
          decisions: {},
          note: '',
          at: a.verifiedAt ? { 1: a.verifiedAt } : {},
          by: {},
          rkk: null,
        } satisfies CredentialProgress,
      ]),
    ),
    granted: GRANTED_PRIVILEGES.map((g) => ({ ...g })),
    seq: 14,
    licenses: Object.fromEntries(EMPLOYEES.map((e) => [e.id, [...e.licenses]])),
  };
}

/** Izin praktik terbaru praktisi (nama), untuk verifikasi berkas dan uji CPOE. */
export function licensesOf(s: CredentialStoreState, practitioner: string): License[] {
  const e = EMPLOYEES.find((x) => x.name === practitioner);
  return e ? (s.licenses[e.id] ?? [...e.licenses]) : [];
}

function gate(s: CredentialStoreState, ev: CredentialEvent, actor: DemoActor): string | null {
  const a = PRIVILEGE_APPLICATIONS.find((x) => x.id === ev.id);
  const p = s.apps[ev.id];
  if (!a || !p) return 'Pengajuan tidak ditemukan.';
  switch (ev.type) {
    case 'berkas.diverifikasi': {
      if (p.stage !== 0) return `${a.number} sudah diverifikasi.`;
      if (ev.docs.length !== a.documents.length) return 'Daftar berkas tidak sesuai pengajuan.';
      return credentialVerifyBlock(
        licensesOf(s, a.practitioner),
        DEMO_TODAY,
        a.documents.map((d, i) => ({ label: d.label, ok: ev.docs[i] ?? false })),
      );
    }
    case 'telaah.dikirim': {
      if (p.stage !== 1) return `${a.number} belum siap ditelaah.`;
      const role = roleBlock(actor, REVIEW_ROLES, 'Telaah oleh mitra bestari (posisi Dokter).');
      if (role) return role;
      if (actor.name === a.practitioner) return 'Praktisi tidak bisa menelaah pengajuannya sendiri.';
      return reviewBlock(a.items, ev.decisions, ev.note);
    }
    case 'komite.disetujui': {
      if (p.stage !== 2) return `${a.number} belum ditelaah atau sudah direkomendasikan.`;
      const role = roleBlock(
        actor,
        COMMITTEE_ROLES,
        `Rekomendasi diputus rapat ${a.committee.toLowerCase()} (posisi Dokter).`,
      );
      if (role) return role;
      if (actor.name === a.practitioner) return 'Praktisi tidak bisa memutus pengajuannya sendiri.';
      if (p.by[2]?.userId === actor.userId)
        return 'Rapat komite diputus pengguna lain dari mitra bestari penelaah (pemisahan tugas).';
      return null;
    }
    case 'rkk.diterbitkan':
      if (p.stage !== 3) return `${a.number} belum direkomendasikan komite.`;
      return roleBlock(actor, DIRECTOR_ROLES, 'RKK dan SPK diterbitkan direktur (posisi Manajemen).');
  }
}

export const credentialDomain = defineDomain<CredentialStoreState, CredentialEvent>(CREDENTIAL_DOMAIN, {
  initial: initialCredentials,
  eventSchema: credentialEventSchema,
  screens: ['kredensial'],
  generic: true,
  validate: (s, ev, actor) => gate(s, ev, actor),
  subscriptions: [
    on(hrDomain, (s, ev) => {
      if (ev.data.type !== 'sip.diperbarui') return s;
      const d = ev.data;
      const cur = s.licenses[d.employeeId];
      if (!cur) return s;
      return {
        ...s,
        licenses: {
          ...s.licenses,
          [d.employeeId]: cur.map((l) =>
            l.kind === 'SIP'
              ? { kind: 'SIP' as const, number: `SIP ${d.number.trim()}`, expiry: d.until }
              : l,
          ),
        },
      };
    }),
  ],
  reduce: (s, ev) => {
    const d = ev.data;
    must(gate(s, d, ev.actor));
    const by = actorRef(ev.actor);
    const a = PRIVILEGE_APPLICATIONS.find((x) => x.id === d.id);
    const p = s.apps[d.id] as CredentialProgress;
    const put = (stage: 1 | 2 | 3 | 4, patch: Partial<CredentialProgress> = {}) => ({
      ...s.apps,
      [d.id]: { ...p, stage, at: { ...p.at, [stage]: d.when }, by: { ...p.by, [stage]: by }, ...patch },
    });
    switch (d.type) {
      case 'berkas.diverifikasi':
        return { ...s, apps: put(1, { docs: [...d.docs] }) };
      case 'telaah.dikirim':
        return { ...s, apps: put(2, { decisions: { ...d.decisions }, note: d.note.trim() }) };
      case 'komite.disetujui':
        return { ...s, apps: put(3) };
      case 'rkk.diterbitkan': {
        if (!a) return s;
        const number = rkkNumber(s.seq);
        const expiry = rkkExpiry(DEMO_TODAY);
        const items = a.items.filter((i) => p.decisions[i] && p.decisions[i] !== 'tidak');
        return {
          ...s,
          seq: s.seq + 1,
          granted: [
            ...s.granted.filter((g) => !(g.practitioner === a.practitioner && a.items.includes(g.item))),
            ...items.map((item) => ({
              practitioner: a.practitioner,
              item,
              decision: p.decisions[item] as 'diberikan' | 'supervisi',
              expiry,
            })),
          ],
          apps: put(4, { rkk: { number, expiry } }),
        };
      }
    }
  },
});
