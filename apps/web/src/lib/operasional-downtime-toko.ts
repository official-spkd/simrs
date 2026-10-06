import { z } from 'zod';
import { defineDomain } from './demo/store/define';
import { DOWNTIME_PAPER_FORMS, EMERGENCY_PACK } from './demo/fixtures/operasional';
import {
  CAUSE_LABEL,
  canDo,
  type DowntimeAction,
  type DowntimeState,
  initialDowntime,
  reduceDowntime,
} from './operasional-downtime';

/**
 * P13 · Domain toko demo `downtime` (ADR-0085): mesin keadaan latihan/penanganan downtime (`reduceDowntime`) yang
 * tersimpan per RS demo, sehingga banner downtime bisa dibaca semua layar (`downtimeBannerOf`) dan log insiden
 * mencatat pelaku dari sesi. Aturan seluruhnya murni (`canDo` terhadap keadaan) sehingga domain ini `generic`:
 * kejadian dikirim lewat Server Action generik, hak posisi = pemakai layar Mode downtime.
 */

export const DOWNTIME_DOMAIN = 'downtime';

const reason = z.string().max(300);

export const downtimeEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('activate'), cause: z.enum(['bpjs', 'jaringan']), reason }),
  z.strictObject({ type: z.literal('print') }),
  z.strictObject({ type: z.literal('offline-registration') }),
  z.strictObject({ type: z.literal('tick') }),
  z.strictObject({ type: z.literal('recover') }),
  z.strictObject({ type: z.literal('back-entry'), id: z.string().min(1).max(40), reason }),
  z.strictObject({ type: z.literal('sync') }),
  z.strictObject({ type: z.literal('reset') }),
]) satisfies z.ZodType<DowntimeAction>;

export interface DowntimeLogEntry {
  /** Menit simulasi (jam layar = DEMO_NOW + menit). */
  clock: number;
  text: string;
  by: string;
}

export interface DowntimeStoreState {
  s: DowntimeState;
  log: readonly DowntimeLogEntry[];
  /** Pelaku aktivasi terakhir (untuk banner). */
  activatedBy: string | null;
}

/** Teks log insiden per aksi (null = tidak dicatat, mis. waktu berjalan atau batch sinkron lanjutan). */
export function downtimeLogText(a: DowntimeAction, prev: DowntimeState): string | null {
  switch (a.type) {
    case 'activate':
      return `Mode downtime diaktifkan · ${CAUSE_LABEL[a.cause]}`;
    case 'print':
      return `Paket cetak darurat ${EMERGENCY_PACK.ward} dicetak`;
    case 'offline-registration':
      return 'Pasien didaftarkan di server edge (offline)';
    case 'recover':
      return 'Layanan pulih · downtime diakhiri';
    case 'back-entry': {
      const f = DOWNTIME_PAPER_FORMS.find((x) => x.id === a.id);
      return f ? `Entri susulan: ${f.form} · ${f.patient}` : null;
    }
    case 'sync':
      return prev.stage === 2 ? 'Sinkronisasi antrean kirim dimulai' : null;
    case 'reset':
      return 'Latihan downtime direset';
    case 'tick':
      return null;
  }
}

export const downtimeDomain = defineDomain<DowntimeStoreState, DowntimeAction>(DOWNTIME_DOMAIN, {
  initial: () => ({ s: initialDowntime(), log: [], activatedBy: null }),
  eventSchema: downtimeEventSchema,
  screens: ['downtime'],
  generic: true,
  validate: (st, a) => {
    const c = canDo(st.s, a, DOWNTIME_PAPER_FORMS);
    return c.ok ? null : c.reason;
  },
  reduce: (st, ev) => {
    const a = ev.data;
    const c = canDo(st.s, a, DOWNTIME_PAPER_FORMS);
    if (!c.ok) throw new Error(c.reason);
    const next = reduceDowntime(st.s, a, DOWNTIME_PAPER_FORMS);
    const text = downtimeLogText(a, st.s);
    return {
      s: next,
      log: text ? [{ clock: next.clock, text, by: ev.actor.name }, ...st.log] : st.log,
      activatedBy: a.type === 'activate' ? ev.actor.name : a.type === 'reset' ? null : st.activatedBy,
    };
  },
});

/** Keadaan banner downtime untuk layar lain (null bila normal/selesai). */
export interface DowntimeBanner {
  /** `aktif` = layanan terganggu; `pemulihan` = pulih, entri susulan/sinkron belum selesai. */
  phase: 'aktif' | 'pemulihan';
  cause: DowntimeState['cause'];
  causeLabel: string;
  reason: string;
  /** Menit simulasi saat mulai (tampilkan dengan jam layar). */
  startedAt: number | null;
  /** Sisa pesan antrean kirim di server edge. */
  backlog: number;
  by: string | null;
}

export function downtimeBannerOf(st: DowntimeStoreState): DowntimeBanner | null {
  const s = st.s;
  if (s.stage === 0 || s.stage === 4) return null;
  return {
    phase: s.stage === 1 ? 'aktif' : 'pemulihan',
    cause: s.cause,
    causeLabel: CAUSE_LABEL[s.cause],
    reason: s.reason,
    startedAt: s.startedAt,
    backlog: s.backlog.sep + s.backlog.task + s.backlog.satusehat,
    by: st.activatedBy,
  };
}
