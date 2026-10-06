import type { BedStatus } from '@simrs/shared';

/**
 * I09 · Command center (melengkapi Dasbor direksi): keterisian bed real-time per ruang, IGD (pasien menunggu bed),
 * antrean rawat jalan per poli, dan alert keputusan berbasis aturan yang ditindaklanjuti beralasan. Fungsi murni;
 * "maju 15 menit" menerapkan peristiwa simulasi yang deterministik (ADR-0023).
 */

export interface CcBed {
  code: string;
  wardCode: string;
  status: BedStatus;
}

export interface CcWard {
  code: string;
  name: string;
  beds: number;
}

export interface CcEdItem {
  id: string;
  label: string;
  status: string;
  losMinutes: number;
  triageLevel: number | null;
}

export interface CcQueue {
  poliCode: string;
  poliName: string;
  waiting: number;
  current: string | null;
}

export interface CcState {
  minute: number;
  beds: CcBed[];
  ed: CcEdItem[];
  queues: CcQueue[];
  ambulances: number;
}

export const BOR_ALERT = 85;
export const BOARDING_ALERT_MINUTES = 120;
export const QUEUE_ALERT = 3;

const OCCUPIED: readonly BedStatus[] = ['terisi', 'pulang'];

export interface WardRow {
  code: string;
  name: string;
  total: number;
  occupied: number;
  ready: number;
  turnover: number;
  bor: number;
}

export function wardRows(wards: readonly CcWard[], beds: readonly CcBed[]): WardRow[] {
  return wards.map((w) => {
    const list = beds.filter((b) => b.wardCode === w.code);
    const occupied = list.filter((b) => OCCUPIED.includes(b.status)).length;
    return {
      code: w.code,
      name: w.name,
      total: list.length,
      occupied,
      ready: list.filter((b) => b.status === 'siap').length,
      turnover: list.filter(
        (b) => b.status === 'kotor' || b.status === 'dibersihkan' || b.status === 'pulang',
      ).length,
      bor: list.length ? Math.round((occupied / list.length) * 100) : 0,
    };
  });
}

export function boarding(ed: readonly CcEdItem[]): CcEdItem[] {
  return ed.filter((i) => i.status === 'tunggu-bed').sort((a, b) => b.losMinutes - a.losMinutes);
}

export interface DecisionAlert {
  id: string;
  level: 'critical' | 'warning';
  title: string;
  detail: string;
  rule: string;
  actions: readonly string[];
  href: string;
  hrefLabel: string;
}

/** Alert keputusan dari keadaan saat ini (aturan ambang tetap). */
export function decisionAlerts(state: CcState, wards: readonly CcWard[]): DecisionAlert[] {
  const out: DecisionAlert[] = [];
  const rows = wardRows(wards, state.beds);
  const hot = rows.filter((r) => r.bor > BOR_ALERT && r.total >= 4);
  if (hot.length) {
    out.push({
      id: 'bor',
      level: hot.some((r) => r.ready === 0) ? 'critical' : 'warning',
      title: `BOR di atas ${BOR_ALERT}% di ${hot.length} ruang`,
      detail: hot.map((r) => `${r.name} ${r.bor}% (siap ${r.ready})`).join(' · '),
      rule: `BOR ruang > ${BOR_ALERT}%`,
      actions: [
        'Percepat pulang lewat ruang tunggu pulang',
        'Buka bed cadangan (surge)',
        'Pantau, belum perlu tindakan',
      ],
      href: '/klinis/tempat-tidur',
      hrefLabel: 'Buka manajemen tempat tidur',
    });
  }
  const b = boarding(state.ed);
  const longest = b[0];
  if (longest && (b.length >= 2 || longest.losMinutes > BOARDING_ALERT_MINUTES)) {
    out.push({
      id: 'boarding',
      level: longest.losMinutes > BOARDING_ALERT_MINUTES ? 'critical' : 'warning',
      title: `${b.length} pasien IGD menunggu bed rawat inap`,
      detail: `Terlama ${longest.losMinutes} menit (${longest.label})`,
      rule: `Menunggu bed > ${BOARDING_ALERT_MINUTES} menit atau ≥ 2 pasien`,
      actions: [
        'Prioritaskan bed siap untuk IGD',
        'Aktifkan rawat sementara di HCU',
        'Pantau, belum perlu tindakan',
      ],
      href: '/klinis/tempat-tidur',
      hrefLabel: 'Cari bed siap',
    });
  }
  const long = state.queues.filter((q) => q.waiting > QUEUE_ALERT);
  if (long.length) {
    out.push({
      id: 'antrean',
      level: 'warning',
      title: `Antrean menumpuk di ${long.length} poli`,
      detail: long.map((q) => `${q.poliName} ${q.waiting} menunggu`).join(' · '),
      rule: `Menunggu > ${QUEUE_ALERT} pasien`,
      actions: [
        'Tambah dokter pendamping',
        'Alihkan pasien kontrol ke sesi siang',
        'Pantau, belum perlu tindakan',
      ],
      href: '/jadwal',
      hrefLabel: 'Buka jadwal dokter',
    });
  }
  return out;
}

export interface SimEvent {
  label: string;
  apply: (s: CcState) => CcState;
}

const firstIndex = (beds: readonly CcBed[], pred: (b: CcBed) => boolean) => beds.findIndex(pred);

function setBed(s: CcState, i: number, status: BedStatus): CcState {
  if (i < 0) return s;
  return { ...s, beds: s.beds.map((b, j) => (j === i ? { ...b, status } : b)) };
}

/** Peristiwa 15 menit berikutnya (berputar): pulang → bersih → IGD dapat bed → ambulans tiba. */
export const SIM_EVENTS: readonly SimEvent[] = [
  {
    label: 'Pasien rencana pulang keluar; bed menunggu dibersihkan',
    apply: (s) =>
      setBed(
        s,
        firstIndex(s.beds, (b) => b.status === 'pulang'),
        'kotor',
      ),
  },
  {
    label: 'Bed selesai dibersihkan dan siap dipakai',
    apply: (s) =>
      setBed(
        s,
        firstIndex(s.beds, (b) => b.status === 'dibersihkan' || b.status === 'kotor'),
        'siap',
      ),
  },
  {
    label: 'Pasien IGD terlama mendapat bed rawat inap',
    apply: (s) => {
      const wait = boarding(s.ed)[0];
      const i = firstIndex(s.beds, (b) => b.status === 'siap');
      if (!wait || i < 0) return s;
      return { ...setBed(s, i, 'terisi'), ed: s.ed.filter((e) => e.id !== wait.id) };
    },
  },
  {
    label: 'Ambulans tiba; pasien baru masuk triase',
    apply: (s) => ({
      ...s,
      ambulances: Math.max(0, s.ambulances - 1),
      ed: [
        ...s.ed,
        {
          id: `amb-${s.minute}`,
          label: 'Pasien ambulans baru',
          status: 'triase',
          losMinutes: 0,
          triageLevel: 2,
        },
      ],
    }),
  },
];

/** Maju 15 menit: LOS IGD +15, tiap poli melayani 2 pasien, lalu satu peristiwa simulasi. */
export function advance(s: CcState, step: number): { state: CcState; event: string } {
  const ev = SIM_EVENTS[step % SIM_EVENTS.length];
  const base: CcState = {
    ...s,
    minute: s.minute + 15,
    ed: s.ed.map((e) => ({ ...e, losMinutes: e.losMinutes + 15 })),
    queues: s.queues.map((q) => ({ ...q, waiting: Math.max(0, q.waiting - 2) })),
  };
  return ev ? { state: ev.apply(base), event: ev.label } : { state: base, event: '' };
}
