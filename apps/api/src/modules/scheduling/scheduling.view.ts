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
  /** Sesi cuti: pasien sudah dialihkan. */
  transferredAt: Date | null;
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

/** ID sel grid: sesi ke-`index` (0 = paling pagi) dokter itu pada tanggal itu; index 0 = `scheduleCellId` biasa. */
export function scheduleSlotCellId(practitionerId: string, date: string, index = 0): string {
  return scheduleCellId(index === 0 ? practitionerId : `${practitionerId}#${index + 1}`, date);
}

/** Urutan sesi ini di antara sesi dokter × poli × tanggal yang sama (urut jam mulai). */
function sessionIndex(sessions: readonly RsSession[], s: RsSession): number {
  return sessions
    .filter((x) => x.practitionerId === s.practitionerId && x.serviceId === s.serviceId && x.date === s.date)
    .sort((a, b) => a.start.localeCompare(b.start))
    .findIndex((x) => x.id === s.id);
}
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

  const byId = new Map(sessions.map((x) => [x.id, x]));
  const cellIndex = (sessionId: string | null) => {
    const session = sessionId ? byId.get(sessionId) : undefined;
    return session ? Math.max(0, sessionIndex(sessions, session)) : 0;
  };
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
      slotId: scheduleSlotCellId(s.practitionerId, s.date, cellIndex(sessionId)),
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

/**
 * Grid minggu: baris per dokter × poli yang punya sesi (atau menggantikan) di minggu itu. Dokter dengan dua sesi atau
 * lebih di satu hari (pagi + sore) mendapat baris tambahan "(sesi 2)", "(sesi 3)": baris ke-k memuat sesi ke-k (urut
 * jam mulai) tiap hari, sehingga kontrak tampilan tetap satu sel per hari per baris.
 */
export function buildWeek(input: {
  weekStart: string;
  days: readonly string[];
  sessions: readonly RsSession[];
  comparison: HfisComparison;
}): WeeklySchedule {
  const { days, sessions, comparison } = input;
  type Entry = { session: RsSession; role: 'own' | 'pengganti' };
  type Group = {
    practitionerId: string;
    name: string;
    serviceId: string;
    code: string;
    poli: string;
    room: string;
    /** Per tanggal: sesi sendiri + sesi yang digantikan, urut jam mulai. */
    byDate: Map<string, Entry[]>;
  };
  const groups = new Map<string, Group>();
  const add = (practitionerId: string, name: string, s: RsSession, role: Entry['role']) => {
    const key = `${practitionerId}|${s.serviceId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        practitionerId,
        name,
        serviceId: s.serviceId,
        code: s.serviceCode,
        poli: s.serviceName,
        room: s.room?.trim() || s.serviceName,
        byDate: new Map(),
      };
      groups.set(key, g);
    }
    const list = g.byDate.get(s.date) ?? [];
    list.push({ session: s, role });
    list.sort((a, b) => a.session.start.localeCompare(b.session.start));
    g.byDate.set(s.date, list);
  };
  for (const s of sessions) {
    add(s.practitionerId, s.practitionerName, s, 'own');
    if (s.kind === 'cuti' && s.substituteId && s.substituteName)
      add(s.substituteId, s.substituteName, s, 'pengganti');
  }
  const hfisOnly = new Set(
    comparison.items.filter((i) => i.kind === 'hfis-praktik-rs-tidak').map((i) => i.slotId),
  );
  const usedIds = new Set<string>();

  const doctors: ScheduleDoctor[] = [...groups.values()]
    .sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name))
    .flatMap((g) => {
      const baseId = usedIds.has(g.practitionerId) ? `${g.practitionerId}~${g.code}` : g.practitionerId;
      usedIds.add(g.practitionerId);
      const rowCount = Math.max(1, ...[...g.byDate.values()].map((l) => l.length));
      return Array.from({ length: rowCount }, (_, k): ScheduleDoctor => {
        const slots = days.map((date): ScheduleSlot => {
          const cell = scheduleSlotCellId(g.practitionerId, date, k);
          const entry = g.byDate.get(date)?.[k];
          const base = { id: cell, date, relatedDoctorId: null, affectedPatients: null };
          if (!entry) {
            return {
              ...base,
              sessionId: null,
              kind: 'libur',
              start: null,
              end: null,
              quota: null,
              hfisSynced: !hfisOnly.has(cell),
            };
          }
          const s = entry.session;
          const common = {
            sessionId: s.id,
            hfisSynced: comparison.synced.has(s.id),
            updatedAt: s.updatedAt.toISOString(),
            transferredAt: s.transferredAt?.toISOString() ?? null,
          };
          if (entry.role === 'pengganti') {
            return {
              ...base,
              ...common,
              kind: 'pengganti',
              start: toWallClock(s.start),
              end: toWallClock(s.end),
              quota: null,
              relatedDoctorId: s.practitionerId,
            };
          }
          if (s.kind === 'cuti') {
            return {
              ...base,
              ...common,
              kind: 'cuti',
              start: null,
              end: null,
              quota: null,
              relatedDoctorId: s.substituteId,
              affectedPatients: s.bookedJkn + s.bookedNonJkn,
            };
          }
          return {
            ...base,
            ...common,
            kind: 'praktik',
            start: toWallClock(s.start),
            end: toWallClock(s.end),
            quota: {
              jkn: s.quotaJkn,
              nonJkn: s.quotaNonJkn,
              bookedJkn: s.bookedJkn,
              bookedNonJkn: s.bookedNonJkn,
            },
          };
        });
        return {
          id: k === 0 ? baseId : `${baseId}~${k + 1}`,
          name: k === 0 ? g.name : `${g.name} (sesi ${k + 1})`,
          poliCode: g.code,
          poliName: g.poli,
          room: g.room,
          slots,
        };
      });
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
