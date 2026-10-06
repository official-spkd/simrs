import {
  type EdTrackingItem,
  SAFETY_REASON_MIN,
  triageLevelSchema,
  type TriageLevel,
  WARD_CLASSES,
} from '@simrs/shared';
import { z } from 'zod';
import { defineDomain } from './demo/store/define';
import { newWalkIn, type WalkInKind } from './rawat-inap';

/**
 * Toko demo bersama (ADR-0085) · domain `klinis-igd`: papan IGD yang bertahan (pasien datang sendiri, triase, dokter
 * penanggung jawab, permintaan bed rawat inap, disposisi meninggal). Kejadian keluar (kontrak):
 * - `triase.disimpan` → command center (sensus IGD per level; CX-3);
 * - `admisi.diminta` → papan tempat tidur (`tempat-tidur`, CD-2) + command center (CX-3);
 * - `pasien.meninggal` → rekam medis administratif dan klaim (CX-2/CX-3); admisi pasien ini ditolak.
 *
 * Disposisi meninggal mengikuti usulan K-1 (`docs/13` §8, **menunggu konfirmasi pemilik produk**): hanya dokter yang
 * berelasi dengan pasien (dokter penanggung jawab IGD dari sesi), wajib jam kematian, sebab kematian ICD-10 dari seed,
 * dan surat keterangan kematian ber-TTE.
 */

const encounterId = z.string().min(1).max(60);
const isoInstant = z.iso.datetime({ offset: true });
const triageLevel = triageLevelSchema;

/**
 * Sebab kematian yang bisa dipilih: subset kode ICD-10 seed data rujukan (`packages/db/src/seed-ref.ts`), bukan kode
 * karangan. Backend memakai pencarian ICD-10 penuh.
 */
export const DEATH_CAUSES: ReadonlyArray<{ code: string; display: string }> = [
  { code: 'A41.9', display: 'Sepsis, tidak spesifik' },
  { code: 'I21.4', display: 'Infark miokard akut non-ST elevasi' },
  { code: 'I63.9', display: 'Infark serebral' },
  { code: 'J18.9', display: 'Pneumonia, tidak spesifik' },
  { code: 'J96.0', display: 'Gagal napas akut' },
  { code: 'N17.9', display: 'Gagal ginjal akut' },
  { code: 'R57.2', display: 'Syok septik' },
  { code: 'R57.9', display: 'Syok, tidak spesifik' },
];

export const igdEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    /** Pasien datang sendiri / tanpa identitas masuk area triase (id sementara dibangkitkan server). */
    type: z.literal('pasien.datang'),
    encounterId: z.string().regex(/^kj-igd-(anon|baru)-[1-9]\d{0,3}$/),
    kind: z.enum(['tanpa-identitas', 'baru']),
    arrivedAt: isoInstant,
  }),
  z.strictObject({
    /** Triase tersimpan; level di bawah saran sistem wajib alasan (diperiksa server, tercatat untuk audit). */
    type: z.literal('triase.disimpan'),
    encounterId,
    level: triageLevel,
    suggestedLevel: triageLevel,
    overrideReason: z.string().trim().min(SAFETY_REASON_MIN).max(500).nullable(),
    orders: z.array(z.string().min(1).max(80)).max(6),
    chiefComplaint: z.string().trim().min(1).max(120),
    at: isoInstant,
  }),
  z.strictObject({
    /** Dokter sesi menjadi dokter penanggung jawab pasien IGD (relasi dokter–pasien). */
    type: z.literal('dokter.ditetapkan'),
    encounterId,
    at: isoInstant,
  }),
  z.strictObject({
    /** Disposisi rawat inap: permintaan bed ke papan tempat tidur. */
    type: z.literal('admisi.diminta'),
    encounterId,
    requestId: z.string().min(1).max(80),
    patientId: z.string().min(1).max(60).nullable(),
    patientName: z.string().min(1).max(80),
    rm: z.string().nullable(),
    sex: z.enum(['L', 'P']),
    ageYears: z.int().min(0).max(130),
    /** Asal, mis. "IGD B4". */
    from: z.string().min(1).max(60),
    need: z.string().trim().min(3).max(80),
    kelas: z.enum(WARD_CLASSES),
    at: isoInstant,
  }),
  z.strictObject({
    /** Disposisi meninggal (usulan K-1, menunggu konfirmasi pemilik produk). */
    type: z.literal('pasien.meninggal'),
    encounterId,
    patientId: z.string().min(1).max(60).nullable(),
    patientName: z.string().min(1).max(80),
    /** Jam kematian (ISO). */
    diedAt: isoInstant,
    causeCode: z.string().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/),
    causeLabel: z.string().min(1).max(120),
    /** Nomor surat keterangan kematian (ber-TTE dokter). */
    certificateNo: z.string().min(1).max(40),
    at: isoInstant,
  }),
]);
export type IgdEvent = z.infer<typeof igdEventSchema>;

export interface IgdTriage {
  level: TriageLevel;
  suggestedLevel: TriageLevel;
  overrideReason: string | null;
  orders: readonly string[];
  chiefComplaint: string;
  at: string;
  by: string;
}

export interface IgdAdmission {
  requestId: string;
  from: string;
  need: string;
  kelas: (typeof WARD_CLASSES)[number];
  at: string;
  by: string;
}

export interface IgdDeath {
  patientName: string;
  diedAt: string;
  causeCode: string;
  causeLabel: string;
  certificateNo: string;
  at: string;
  by: string;
}

export interface IgdState {
  walkIns: ReadonlyArray<{ encounterId: string; kind: WalkInKind; arrivedAt: string }>;
  triage: Readonly<Record<string, IgdTriage>>;
  doctor: Readonly<Record<string, { name: string; userId: string; at: string }>>;
  admission: Readonly<Record<string, IgdAdmission>>;
  death: Readonly<Record<string, IgdDeath>>;
}

export const IGD_INITIAL: IgdState = { walkIns: [], triage: {}, doctor: {}, admission: {}, death: {} };

export const DEAD_NO_ADMISSION = 'Pasien sudah dinyatakan meninggal: admisi rawat inap ditolak.';

export function igdConflict(s: IgdState, d: IgdEvent): string | null {
  if (d.type !== 'pasien.datang' && s.death[d.encounterId]) {
    return d.type === 'admisi.diminta' ? DEAD_NO_ADMISSION : 'Pasien sudah dinyatakan meninggal.';
  }
  switch (d.type) {
    case 'pasien.datang':
      return s.walkIns.some((w) => w.encounterId === d.encounterId)
        ? 'Pasien ini sudah tercatat datang.'
        : null;
    case 'admisi.diminta':
      return s.admission[d.encounterId] ? 'Permintaan bed pasien ini sudah dikirim.' : null;
    case 'dokter.ditetapkan':
    case 'triase.disimpan':
    case 'pasien.meninggal':
      return null;
  }
}

export const igdDomain = defineDomain<IgdState, IgdEvent>('klinis-igd', {
  initial: () => IGD_INITIAL,
  eventSchema: igdEventSchema,
  screens: ['igd', 'bed'],
  validate: (s, ev) => igdConflict(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const conflict = igdConflict(s, d);
    if (conflict) throw new Error(conflict);
    switch (d.type) {
      case 'pasien.datang':
        return {
          ...s,
          walkIns: [...s.walkIns, { encounterId: d.encounterId, kind: d.kind, arrivedAt: d.arrivedAt }],
        };
      case 'triase.disimpan':
        return {
          ...s,
          triage: {
            ...s.triage,
            [d.encounterId]: {
              level: d.level,
              suggestedLevel: d.suggestedLevel,
              overrideReason: d.overrideReason,
              orders: d.orders,
              chiefComplaint: d.chiefComplaint,
              at: d.at,
              by: ev.actor.name,
            },
          },
        };
      case 'dokter.ditetapkan':
        return {
          ...s,
          doctor: {
            ...s.doctor,
            [d.encounterId]: { name: ev.actor.name, userId: ev.actor.userId, at: d.at },
          },
        };
      case 'admisi.diminta':
        return {
          ...s,
          admission: {
            ...s.admission,
            [d.encounterId]: {
              requestId: d.requestId,
              from: d.from,
              need: d.need,
              kelas: d.kelas,
              at: d.at,
              by: ev.actor.name,
            },
          },
        };
      case 'pasien.meninggal':
        return {
          ...s,
          death: {
            ...s.death,
            [d.encounterId]: {
              patientName: d.patientName,
              diedAt: d.diedAt,
              causeCode: d.causeCode,
              causeLabel: d.causeLabel,
              certificateNo: d.certificateNo,
              at: d.at,
              by: ev.actor.name,
            },
          },
        };
    }
  },
});

/** Pasien datang sendiri yang tersimpan, sebagai baris papan IGD. */
export function walkInItems(s: IgdState): EdTrackingItem[] {
  return s.walkIns.map((w) => {
    const n = Number(/-(\d+)$/.exec(w.encounterId)?.[1] ?? '1');
    return newWalkIn(w.kind, n, w.arrivedAt);
  });
}

/** Terapkan triase dan dokter tersimpan ke baris papan; pasien yang meninggal keluar dari papan. */
export function applyIgd(items: readonly EdTrackingItem[], s: IgdState): EdTrackingItem[] {
  return items
    .filter((p) => !s.death[p.encounterId])
    .map((p) => {
      if (p.scenario) return p;
      const t = s.triage[p.encounterId];
      const doc = s.doctor[p.encounterId];
      const adm = s.admission[p.encounterId];
      return {
        ...p,
        ...(t
          ? {
              triageLevel: t.level,
              chiefComplaint: t.chiefComplaint,
              status: p.status === 'registrasi' || p.status === 'triase' ? 'tunggu-dokter' : p.status,
            }
          : {}),
        ...(doc ? { doctor: doc.name } : {}),
        ...(adm ? { status: 'tunggu-bed' as const } : {}),
      };
    });
}

/** Id permintaan bed dari IGD (unik per kunjungan). */
export const igdBedRequestId = (encounterId: string) => `rb-igd-${encounterId}`.slice(0, 80);

/** Nomor surat keterangan kematian demo: `SKK/<RS>/<urut>` (penomoran resmi per tenant menyusul backend). */
export function certificateNo(tenantCode: string, n: number): string {
  return `SKK/${tenantCode}/${String(n).padStart(4, '0')}`;
}

/** Kelas hak rawat bawaan dari penjamin pasien (BPJS: kelas kepesertaan; selain itu Kelas 1). */
export function defaultKelas(kelas: string | null | undefined): (typeof WARD_CLASSES)[number] {
  const k = WARD_CLASSES.find((w) => w === `Kelas ${(kelas ?? '').replace(/\D/g, '')}`);
  return k ?? 'Kelas 1';
}
