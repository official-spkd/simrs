import {
  formatTanggal,
  type HfisDifferenceItem,
  type HfisPullSnapshot,
  parseHfisJadwal,
  type ScheduleDoctor,
  type ScheduleSlot,
  scheduleCellId,
  toWallClock,
  type WeeklySchedule,
} from '@simrs/shared';

/**
 * F01 · Logika murni layar Jadwal (tanpa DB, diuji unit): perbandingan jadwal RS vs tarikan HFIS dan model tampilan
 * grid minggu (`weeklyScheduleSchema`).
 *
 * Perbandingan per poli × tanggal yang SUDAH ditarik dari HFIS (tanggal tanpa tarikan tidak dibandingkan):
 * - RS cuti, HFIS praktik → catat cuti di aplikasi HFIS (web service tidak bisa mencatat cuti per tanggal);
 * - RS praktik, HFIS libur → aplikasi HFIS; kapasitas HFIS ≠ kuota RS → aplikasi HFIS;
 * - RS praktik tanpa jadwal HFIS, jam beda, atau HFIS praktik tanpa sesi RS → kirim templat (`bpjs.hfis.update`).
 * Dokter tanpa kode HFIS atau poli tanpa kode BPJS tidak ikut dibandingkan (dianggap sesuai).
 */

export interface RsSession {
  id: string;
  practitionerId: string;
  practitionerName: string;
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  room: string | null;
  date: string;
  /** `HH:MM`. */
  start: string;
  end: string;
  kind: 'praktik' | 'cuti';
  substituteId: string | null;
  substituteName: string | null;
  note: string | null;
  quotaJkn: number;
  quotaNonJkn: number;
  bookedJkn: number;
  bookedNonJkn: number;
  updatedAt: Date;
}

export interface HfisPull {
  fetchedAt: Date;
  snapshot: HfisPullSnapshot;
}

export interface HfisMapping {
  /** practitionerId → kode dokter HFIS. */
  doctorCode: ReadonlyMap<string, number>;
  /** kode dokter HFIS → praktisi. */
  practitionerByCode: ReadonlyMap<number, { id: string; name: string }>;
  /** serviceId → kode poli BPJS. */
  poliCode: ReadonlyMap<string, string>;
}

export interface HfisComparison {
  items: HfisDifferenceItem[];
  /** Sesi yang sama dengan HFIS (atau tidak perlu dibandingkan). */
  synced: Set<string>;
  unpulledDates: string[];
  lastPulledAt: Date | null;
}

const pullKey = (serviceId: string, date: string) => `${serviceId}|${date}`;
const jam = (start: string, end: string) => `${toWallClock(start)}–${toWallClock(end)}`;
const hari = (date: string) => formatTanggal(`${date}T00:00:00Z`);

/** Tarikan terbaru per poli × tanggal (masukan boleh tidak urut). */
export function latestPulls(pulls: readonly HfisPull[]): Map<string, HfisPull> {
  const out = new Map<string, HfisPull>();
  for (const p of pulls) {
    const key = pullKey(p.snapshot.serviceId, p.snapshot.tanggal);
    const cur = out.get(key);
    if (!cur || cur.fetchedAt < p.fetchedAt) out.set(key, p);
  }
  return out;
}

export function compareWithHfis(input: {
  sessions: readonly RsSession[];
  pulls: ReadonlyMap<string, HfisPull>;
  mapping: HfisMapping;
  dates: readonly string[];
  serviceNames: ReadonlyMap<string, string>;
}): HfisComparison {
  const { sessions, pulls, mapping, dates } = input;
  const items: HfisDifferenceItem[] = [];
  const synced = new Set<string>();
  const unpulled = new Set<string>();
  let lastPulledAt: Date | null = null;

  for (const p of pulls.values()) {
    if (dates.includes(p.snapshot.tanggal) && (!lastPulledAt || p.fetchedAt > lastPulledAt)) {
      lastPulledAt = p.fetchedAt;
    }
  }

  const add = (
    s: { practitionerId: string; practitionerName: string; serviceId: string; date: string },
    sessionId: string | null,
    kind: HfisDifferenceItem['kind'],
    text: string,
    resolution: HfisDifferenceItem['resolution'],
  ) =>
    items.push({
      practitionerId: s.practitionerId,
      practitionerName: s.practitionerName,
      serviceId: s.serviceId,
      date: s.date,
      sessionId,
      slotId: scheduleCellId(s.practitionerId, s.date),
      kind,
      text,
      resolution,
    });

  for (const s of sessions) {
    const code = mapping.doctorCode.get(s.practitionerId);
    if (code === undefined || !mapping.poliCode.has(s.serviceId)) {
      synced.add(s.id);
      continue;
    }
    const pull = pulls.get(pullKey(s.serviceId, s.date));
    if (!pull) {
      unpulled.add(s.date);
      continue;
    }
    const entries = pull.snapshot.jadwal.filter((j) => j.kodedokter === code);
    const name = s.practitionerName;
    if (s.kind === 'cuti') {
      const praktik = entries.find((e) => !e.libur);
      if (praktik) {
        add(
          s,
          s.id,
          'hfis-praktik-rs-cuti',
          `${name} masih tercatat praktik ${hari(s.date)} ${praktik.jadwal.replace(' - ', '–').replaceAll(':', '.')} di HFIS, padahal cuti di jadwal RS. Catat cuti di aplikasi HFIS; pasien Mobile JKN bisa salah booking.`,
          'aplikasi-hfis',
        );
      } else synced.add(s.id);
      continue;
    }
    const same = entries.find((e) => {
      const j = parseHfisJadwal(e.jadwal);
      return j?.buka === s.start && j.tutup === s.end;
    });
    if (!same) {
      if (entries.length > 0) {
        add(
          s,
          s.id,
          'jam-beda',
          `${name} ${hari(s.date)}: jam di HFIS ${entries.map((e) => e.jadwal).join(', ')}, di jadwal RS ${jam(s.start, s.end)}. Kirim jadwal ke HFIS.`,
          'kirim',
        );
      } else {
        add(
          s,
          s.id,
          'rs-praktik-hfis-tidak',
          `${name} praktik ${hari(s.date)} ${jam(s.start, s.end)} di jadwal RS, tetapi tidak tercatat di HFIS. Kirim jadwal ke HFIS.`,
          'kirim',
        );
      }
      continue;
    }
    if (same.libur) {
      add(
        s,
        s.id,
        'rs-praktik-hfis-libur',
        `${name} tercatat libur ${hari(s.date)} di HFIS, padahal praktik di jadwal RS. Hapus catatan libur di aplikasi HFIS.`,
        'aplikasi-hfis',
      );
      continue;
    }
    const total = s.quotaJkn + s.quotaNonJkn;
    if (same.kapasitaspasien !== total) {
      add(
        s,
        s.id,
        'kapasitas-beda',
        `Kuota ${name} ${hari(s.date)} di jadwal RS ${total} pasien, kapasitas di HFIS ${same.kapasitaspasien}. Ubah kapasitas di aplikasi HFIS; Mobile JKN masih memakai kapasitas HFIS.`,
        'aplikasi-hfis',
      );
      continue;
    }
    synced.add(s.id);
  }

  // Praktik di HFIS tanpa sesi RS (dokter tidak praktik di jadwal RS hari itu).
  for (const pull of pulls.values()) {
    const { serviceId, tanggal } = pull.snapshot;
    if (!dates.includes(tanggal)) continue;
    for (const e of pull.snapshot.jadwal) {
      if (e.libur) continue;
      const p = mapping.practitionerByCode.get(e.kodedokter);
      if (!p) continue;
      const hasSession = sessions.some(
        (s) => s.practitionerId === p.id && s.serviceId === serviceId && s.date === tanggal,
      );
      if (hasSession) continue;
      add(
        { practitionerId: p.id, practitionerName: p.name, serviceId, date: tanggal },
        null,
        'hfis-praktik-rs-tidak',
        `${p.name} tercatat praktik ${hari(tanggal)} ${e.jadwal.replace(' - ', '–').replaceAll(':', '.')} di HFIS, tetapi tidak ada di jadwal RS. Kirim jadwal ke HFIS.`,
        'kirim',
      );
    }
  }

  items.sort((a, b) => a.date.localeCompare(b.date) || a.practitionerName.localeCompare(b.practitionerName));
  return { items, synced, unpulledDates: [...unpulled].sort(), lastPulledAt };
}

/** Grid minggu: satu baris per dokter × poli yang punya sesi (atau menggantikan) di minggu itu. */
export function buildWeek(input: {
  weekStart: string;
  days: readonly string[];
  sessions: readonly RsSession[];
  comparison: HfisComparison;
}): WeeklySchedule {
  const { days, sessions, comparison } = input;
  type Row = {
    practitionerId: string;
    name: string;
    serviceId: string;
    code: string;
    poli: string;
    room: string;
  };
  const rows = new Map<string, Row>();
  const addRow = (practitionerId: string, name: string, s: RsSession) => {
    const key = `${practitionerId}|${s.serviceId}`;
    if (!rows.has(key)) {
      rows.set(key, {
        practitionerId,
        name,
        serviceId: s.serviceId,
        code: s.serviceCode,
        poli: s.serviceName,
        room: s.room?.trim() || s.serviceName,
      });
    }
  };
  for (const s of sessions) {
    addRow(s.practitionerId, s.practitionerName, s);
    if (s.kind === 'cuti' && s.substituteId && s.substituteName) addRow(s.substituteId, s.substituteName, s);
  }
  const hfisOnly = new Set(
    comparison.items.filter((i) => i.kind === 'hfis-praktik-rs-tidak').map((i) => i.slotId),
  );
  const byStart = (a: RsSession, b: RsSession) => a.start.localeCompare(b.start);
  const usedIds = new Set<string>();

  const doctors: ScheduleDoctor[] = [...rows.values()]
    .sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name))
    .map((r) => {
      const id = usedIds.has(r.practitionerId) ? `${r.practitionerId}~${r.code}` : r.practitionerId;
      usedIds.add(r.practitionerId);
      const slots = days.map((date): ScheduleSlot => {
        const cell = scheduleCellId(r.practitionerId, date);
        const own = sessions
          .filter(
            (s) => s.practitionerId === r.practitionerId && s.serviceId === r.serviceId && s.date === date,
          )
          .sort(byStart)[0];
        const base = {
          id: cell,
          date,
          relatedDoctorId: null,
          affectedPatients: null,
        };
        if (own?.kind === 'praktik') {
          return {
            ...base,
            sessionId: own.id,
            kind: 'praktik',
            start: toWallClock(own.start),
            end: toWallClock(own.end),
            quota: {
              jkn: own.quotaJkn,
              nonJkn: own.quotaNonJkn,
              bookedJkn: own.bookedJkn,
              bookedNonJkn: own.bookedNonJkn,
            },
            hfisSynced: comparison.synced.has(own.id),
            updatedAt: own.updatedAt.toISOString(),
          };
        }
        if (own?.kind === 'cuti') {
          return {
            ...base,
            sessionId: own.id,
            kind: 'cuti',
            start: null,
            end: null,
            quota: null,
            relatedDoctorId: own.substituteId,
            affectedPatients: own.bookedJkn + own.bookedNonJkn,
            hfisSynced: comparison.synced.has(own.id),
            updatedAt: own.updatedAt.toISOString(),
          };
        }
        const covered = sessions.find(
          (s) =>
            s.kind === 'cuti' &&
            s.substituteId === r.practitionerId &&
            s.serviceId === r.serviceId &&
            s.date === date,
        );
        if (covered) {
          return {
            ...base,
            sessionId: covered.id,
            kind: 'pengganti',
            start: toWallClock(covered.start),
            end: toWallClock(covered.end),
            quota: null,
            relatedDoctorId: covered.practitionerId,
            hfisSynced: comparison.synced.has(covered.id),
            updatedAt: covered.updatedAt.toISOString(),
          };
        }
        return {
          ...base,
          sessionId: null,
          kind: 'libur',
          start: null,
          end: null,
          quota: null,
          hfisSynced: !hfisOnly.has(cell),
        };
      });
      return { id, name: r.name, poliCode: r.code, poliName: r.poli, room: r.room, slots };
    });

  return {
    weekStart: input.weekStart,
    days: [...days],
    doctors,
    hfis: {
      lastSyncAt: comparison.lastPulledAt?.toISOString() ?? null,
      differences: comparison.items
        .filter((i) => days.includes(i.date))
        .map((i) => ({ slotId: i.slotId, text: i.text, resolution: i.resolution })),
    },
  };
}
