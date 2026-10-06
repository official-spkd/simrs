import { type Bed, BED_STATUSES, type BedRequest, type BedStatus, WARD_CLASSES } from '@simrs/shared';
import { z } from 'zod';
import { defineDomain, on } from './demo/store/define';
import { igdDomain } from './klinis-igd-toko';
import { resumeDomain } from './rawat-inap-resume-toko';

/**
 * Toko demo bersama (ADR-0085) · domain `tempat-tidur`: status bed (pasien tiba, pulang, kebersihan, perbaikan) dan
 * alokasi bed untuk permintaan rawat inap. Melanggan `klinis-igd` (permintaan bed dari IGD masuk antrean; pasien
 * meninggal membatalkan permintaannya) dan `resume-medis` (resume final membuka "pasien sudah pulang"). Kejadian
 * keluar (kontrak untuk command center CX-3 dan Dasbor): `bed.status`, `bed.dialokasikan`.
 */

const isoInstant = z.iso.datetime({ offset: true });
const bedCode = z.string().min(1).max(12);

export const bedEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    /** Transisi status satu bed (urutan transisi diperiksa server). */
    type: z.literal('bed.status'),
    bedCode,
    from: z.enum(BED_STATUSES),
    to: z.enum(BED_STATUSES),
    note: z.string().max(80),
    /** Bed dikosongkan (pasien keluar): label pasien dan kunjungan dilepas. */
    clear: z.boolean(),
    /** Kunjungan pasien bed ini (bila ada), untuk aliran ke Rawat inap dan IGD. */
    encounterId: z.string().min(1).max(60).nullable(),
    at: isoInstant,
  }),
  z.strictObject({
    /** Bed siap dialokasikan ke permintaan rawat inap (bed jadi "dipesan"). */
    type: z.literal('bed.dialokasikan'),
    requestId: z.string().min(1).max(80),
    bedCode,
    wardCode: z.string().min(1).max(20),
    patientLabel: z.string().min(1).max(80),
    /** Kunjungan IGD pasien bila permintaan dari IGD (dicocokkan server lewat RM). */
    encounterId: z.string().min(1).max(60).nullable(),
    from: z.string().min(1).max(60),
    at: isoInstant,
  }),
]);
export type BedEvent = z.infer<typeof bedEventSchema>;

export interface BedPatchStored {
  status: BedStatus;
  note: string;
  patientLabel?: string | null;
  encounterId?: string | null;
  at: string;
  by: string;
}

export interface BedAllocation {
  bedCode: string;
  wardCode: string;
  patientLabel: string;
  encounterId: string | null;
  from: string;
  at: string;
  by: string;
}

export interface IgdBedRequest extends Omit<BedRequest, 'candidates' | 'waitMinutes' | 'late' | 'scenario'> {
  encounterId: string;
  requestedAt: string;
}

export interface BedState {
  beds: Readonly<Record<string, BedPatchStored>>;
  allocations: Readonly<Record<string, BedAllocation>>;
  /** Permintaan bed dari IGD (langganan `klinis-igd/admisi.diminta`). */
  igdRequests: readonly IgdBedRequest[];
  /** Kunjungan yang permintaannya dibatalkan (pasien meninggal). */
  cancelled: Readonly<Record<string, string>>;
  /** Resume final per kunjungan (langganan `resume-medis/resume.final`). */
  resumeFinal: Readonly<Record<string, string>>;
  /** Kunjungan yang pasiennya sudah keluar dari bed (pulang), jam keluar. */
  discharged: Readonly<Record<string, string>>;
}

export const BED_INITIAL: BedState = {
  beds: {},
  allocations: {},
  igdRequests: [],
  cancelled: {},
  resumeFinal: {},
  discharged: {},
};

/** Transisi status bed yang diizinkan (selain alokasi): label tombol dan catatan baru. */
export const BED_NEXT: Partial<
  Record<BedStatus, { label: string; to: BedStatus; note: (t: string) => string; clear?: boolean }>
> = {
  dipesan: { label: 'Pasien tiba · tandai terisi', to: 'terisi', note: (t) => `H1 · masuk ${t}` },
  pulang: { label: 'Pasien sudah pulang', to: 'kotor', note: (t) => `kosong sejak ${t}`, clear: true },
  kotor: { label: 'Tandai dibersihkan', to: 'dibersihkan', note: (t) => `mulai dibersihkan ${t}` },
  dibersihkan: { label: 'Selesai dibersihkan · siap pakai', to: 'siap', note: (t) => `siap ${t}` },
  rusak: { label: 'Perbaikan selesai · siap pakai', to: 'siap', note: (t) => `diperbaiki ${t}` },
};

export function bedConflict(s: BedState, d: BedEvent): string | null {
  switch (d.type) {
    case 'bed.dialokasikan':
      if (s.allocations[d.requestId]) return 'Permintaan ini sudah dialokasikan.';
      if (
        Object.values(s.allocations).some(
          (a) => a.bedCode === d.bedCode && s.beds[d.bedCode]?.status === 'dipesan',
        )
      )
        return `${d.bedCode} sudah dipesan untuk pasien lain.`;
      if (d.encounterId && s.cancelled[d.encounterId]) return s.cancelled[d.encounterId] ?? null;
      return null;
    case 'bed.status': {
      const cur = s.beds[d.bedCode]?.status;
      if (cur && cur !== d.from) return 'Status bed sudah berubah; muat ulang papan.';
      return BED_NEXT[d.from]?.to === d.to ? null : 'Transisi status bed tidak sah.';
    }
  }
}

export const bedDomain = defineDomain<BedState, BedEvent>('tempat-tidur', {
  initial: () => BED_INITIAL,
  eventSchema: bedEventSchema,
  screens: ['bed', 'ranap', 'igd'],
  subscriptions: [
    on(igdDomain, (s: BedState, ev) => {
      const d = ev.data;
      if (d.type === 'admisi.diminta') {
        return {
          ...s,
          igdRequests: [
            ...s.igdRequests,
            {
              id: d.requestId,
              encounterId: d.encounterId,
              patientName: d.patientName,
              sex: d.sex,
              ageYears: d.ageYears,
              rm: d.rm,
              from: d.from,
              need: d.need,
              kelas: d.kelas,
              requestedAt: d.at,
            },
          ],
        };
      }
      if (d.type === 'pasien.meninggal') {
        return {
          ...s,
          cancelled: {
            ...s.cancelled,
            [d.encounterId]: 'Pasien sudah dinyatakan meninggal: admisi ditolak.',
          },
        };
      }
      return s;
    }),
    on(resumeDomain, (s: BedState, ev) =>
      ev.data.type === 'resume.final'
        ? { ...s, resumeFinal: { ...s.resumeFinal, [ev.data.encounterId]: ev.data.signedAt } }
        : s,
    ),
  ],
  validate: (s, ev) => bedConflict(s, ev),
  reduce: (s, ev) => {
    const d = ev.data;
    const conflict = bedConflict(s, d);
    if (conflict) throw new Error(conflict);
    if (d.type === 'bed.dialokasikan') {
      return {
        ...s,
        allocations: {
          ...s.allocations,
          [d.requestId]: {
            bedCode: d.bedCode,
            wardCode: d.wardCode,
            patientLabel: d.patientLabel,
            encounterId: d.encounterId,
            from: d.from,
            at: d.at,
            by: ev.actor.name,
          },
        },
        beds: {
          ...s.beds,
          [d.bedCode]: {
            status: 'dipesan',
            note: `dari ${d.from}`,
            patientLabel: d.patientLabel,
            encounterId: d.encounterId,
            at: d.at,
            by: ev.actor.name,
          },
        },
      };
    }
    const prev = s.beds[d.bedCode];
    return {
      ...s,
      discharged: d.clear && d.encounterId ? { ...s.discharged, [d.encounterId]: d.at } : s.discharged,
      beds: {
        ...s.beds,
        [d.bedCode]: {
          status: d.to,
          note: d.note,
          ...(d.clear
            ? { patientLabel: null, encounterId: null }
            : prev
              ? { patientLabel: prev.patientLabel, encounterId: prev.encounterId }
              : {}),
          at: d.at,
          by: ev.actor.name,
        },
      },
    };
  },
});

/** Terapkan status bed tersimpan ke papan. */
export function applyBeds(beds: readonly Bed[], s: BedState): Bed[] {
  return beds.map((b) => {
    const p = s.beds[b.code];
    if (!p) return b;
    return {
      ...b,
      status: p.status,
      note: p.note,
      ...(p.patientLabel !== undefined ? { patientLabel: p.patientLabel } : {}),
      ...(p.encounterId !== undefined ? { encounterId: p.encounterId } : {}),
    };
  });
}

export interface AdmissionFlow {
  encounterId: string;
  patientLabel: string;
  bedCode: string;
  wardCode: string;
  from: string;
  status: 'dipesan' | 'terisi';
  at: string;
}

/**
 * Pasien IGD yang sudah dialokasikan bed (dipesan) atau sudah tiba di bangsal (terisi): untuk papan IGD ("bed …
 * dipesan") dan daftar Rawat inap ("masuk dari IGD").
 */
export function admissionFlows(s: BedState): AdmissionFlow[] {
  return Object.values(s.allocations).flatMap((a) => {
    if (!a.encounterId) return [];
    const st = s.beds[a.bedCode]?.status;
    if (st !== 'dipesan' && st !== 'terisi') return [];
    if (s.beds[a.bedCode]?.encounterId !== a.encounterId) return [];
    return [
      {
        encounterId: a.encounterId,
        patientLabel: a.patientLabel,
        bedCode: a.bedCode,
        wardCode: a.wardCode,
        from: a.from,
        status: st,
        at: s.beds[a.bedCode]?.at ?? a.at,
      },
    ];
  });
}

/** Kelas ruang yang sah (validasi isian permintaan). */
export const isWardClass = (k: string): k is (typeof WARD_CLASSES)[number] =>
  (WARD_CLASSES as readonly string[]).includes(k);
