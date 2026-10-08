import {
  ARRIVAL_MODE_LABEL,
  type BedBoardApi,
  type BedStatus,
  type EdBoardApi,
  type EdBoardItem,
  type EdBoardView,
  type EdZone,
  manualBedTransitionAllowed,
  TRIAGE_DISCRIMINATORS,
  type TriageVitals,
} from '@simrs/shared';
import { CARE_CLASS_LABEL } from './platform-struktur';
import type { EdBoardRow } from './rawat-inap';

/**
 * W3 · Pemetaan papan IGD/bed API ke tampilan layar (murni, diuji tanpa browser). Komponen papan dipakai bersama mode
 * presentasi (`EdBoardTable`), jadi item API dipetakan ke `EdBoardRow` dengan nilai nyata: tanpa angka atau nama
 * karangan; yang belum ada ditulis apa adanya ("Belum ditriase", "Belum ada penjamin").
 */

const SEX_SHORT: Record<EdBoardItem['sex'], string> = { male: 'L', female: 'P', unknown: '?' };

export function ageLabel(ageYears: number | null): string {
  return ageYears === null ? 'umur ?' : `${ageYears} th`;
}

/** Keluhan papan = diskriminator triase terkini (bukan teks bebas); belum ditriase ditulis apa adanya. */
export function complaintOf(item: Pick<EdBoardItem, 'triage'>, view: EdBoardView = 'klinis'): string {
  const t = item.triage;
  // Papan administratif (loket IGD, ADR-0109): isi triase tidak dikirim API.
  if (view === 'administratif') return 'Triase oleh petugas klinis IGD';
  if (!t) return 'Belum ditriase';
  if (t.discriminators.length === 0) return 'Tanpa diskriminator (tanda vital)';
  return t.discriminators.map((d) => TRIAGE_DISCRIMINATORS[d].label).join(' · ');
}

export function edRowFromApi(item: EdBoardItem, view: EdBoardView = 'klinis'): EdBoardRow {
  return {
    encounterId: item.encounterId,
    bed: item.bedCode,
    // Belum ditempatkan di zona mana pun = masih di area triase (T).
    zone: item.zone ?? 'T',
    patientName: item.patientName,
    sex: SEX_SHORT[item.sex],
    ageLabel: ageLabel(item.ageYears),
    guarantor: item.payer?.name ?? 'Belum ada penjamin',
    triageLevel: item.triage?.level ?? null,
    ...(view === 'administratif' ? { triageHidden: true } : {}),
    chiefComplaint: complaintOf(item, view),
    doctor: item.doctor,
    losMinutes: item.losMinutes,
    status: item.status ?? 'registrasi',
    scenario: false,
  };
}

export function arrivalLabel(mode: EdBoardItem['arrivalMode']): string {
  return mode ? ARRIVAL_MODE_LABEL[mode] : 'Cara datang belum dicatat';
}

/** Tanda vital triase untuk ubin panel (label + nilai + bendera tidak normal sederhana dari ambang dewasa). */
export function vitalTiles(v: TriageVitals): Array<{ label: string; value: string; abnormal: boolean }> {
  const out: Array<{ label: string; value: string; abnormal: boolean }> = [];
  if (v.sbp !== null)
    out.push({
      label: 'TD',
      value: `${v.sbp}/${v.dbp ?? '–'}`,
      abnormal: v.sbp < 90 || v.sbp >= 180,
    });
  if (v.hr !== null) out.push({ label: 'Nadi', value: String(v.hr), abnormal: v.hr >= 111 || v.hr <= 50 });
  if (v.rr !== null) out.push({ label: 'Napas', value: String(v.rr), abnormal: v.rr >= 25 || v.rr <= 8 });
  if (v.spo2 !== null) out.push({ label: 'SpO2', value: `${v.spo2}%`, abnormal: v.spo2 <= 94 });
  if (v.temp !== null)
    out.push({
      label: 'Suhu',
      value: String(v.temp).replace('.', ','),
      abnormal: v.temp >= 38 || v.temp < 35,
    });
  if (v.gcs !== null) out.push({ label: 'GCS', value: String(v.gcs), abnormal: v.gcs <= 14 });
  return out;
}

/** Isian tanda vital (teks dari input) → `TriageVitals`; kosong = tidak diukur. Null bila ada angka yang tidak sah. */
export function parseVitals(form: Record<keyof TriageVitals, string>): TriageVitals | null {
  const int = (s: string): number | null | undefined => {
    const t = s.trim();
    if (!t) return null;
    return /^\d{1,3}$/.test(t) ? Number(t) : undefined;
  };
  const dec = (s: string): number | null | undefined => {
    const t = s.trim().replace(',', '.');
    if (!t) return null;
    return /^\d{2}(\.\d)?$/.test(t) ? Number(t) : undefined;
  };
  const v = {
    sbp: int(form.sbp),
    dbp: int(form.dbp),
    hr: int(form.hr),
    rr: int(form.rr),
    spo2: int(form.spo2),
    temp: dec(form.temp),
    gcs: int(form.gcs),
  };
  if (Object.values(v).some((x) => x === undefined)) return null;
  const r = v as TriageVitals;
  const within = (n: number | null, lo: number, hi: number) => n === null || (n >= lo && n <= hi);
  const ok =
    within(r.sbp, 30, 300) &&
    within(r.dbp, 10, 200) &&
    within(r.hr, 10, 300) &&
    within(r.rr, 0, 80) &&
    within(r.spo2, 40, 100) &&
    within(r.temp, 25, 45) &&
    within(r.gcs, 3, 15);
  return ok ? r : null;
}

export function vitalsForm(v: TriageVitals | null): Record<keyof TriageVitals, string> {
  const s = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
  return {
    sbp: s(v?.sbp),
    dbp: s(v?.dbp),
    hr: s(v?.hr),
    rr: s(v?.rr),
    spo2: s(v?.spo2),
    temp: v?.temp === null || v?.temp === undefined ? '' : String(v.temp).replace('.', ','),
    gcs: s(v?.gcs),
  };
}

/** Bed IGD yang boleh dipilih untuk penempatan: bed siap + bed yang sedang ditempati pasien ini. */
export function placementOptions(beds: EdBoardApi['beds'], current: string | null): EdBoardApi['beds'] {
  return beds.filter((b) => b.status === 'siap' || b.bedId === current);
}

export const ZONE_OF_ROOM: Record<string, EdZone> = { R: 'R', B: 'B', K: 'K' };

/** Zona dari kode bed IGD (`IGD-R-A` → R); null bila tidak terbaca. */
export function zoneOfBedCode(code: string): EdZone | null {
  const m = /^IGD-([RBK])-/.exec(code);
  return m ? (ZONE_OF_ROOM[m[1] as string] ?? null) : null;
}

/** Transisi status bed manual dari papan (registri bersama, ditegakkan ulang API). */
export function manualTargets(from: BedStatus): BedStatus[] {
  const all: BedStatus[] = ['siap', 'terisi', 'pulang', 'dipesan', 'kotor', 'dibersihkan', 'rusak'];
  return all.filter((to) => to !== from && manualBedTransitionAllowed(from, to));
}

export function careClassLabel(c: string | null): string {
  if (!c) return 'Tanpa kelas';
  return (CARE_CLASS_LABEL as Record<string, string>)[c] ?? c;
}

type ApiBed = BedBoardApi['units'][number]['beds'][number];
type ApiUnit = BedBoardApi['units'][number];

/** Bed kandidat alokasi permintaan: bed `siap` di unit rawat inap, kelas sama, unit sama bila diminta. */
export function allocationCandidates(
  board: BedBoardApi,
  req: Pick<BedBoardApi['requests'][number], 'careClass' | 'unitId' | 'isolation'>,
): Array<{ unit: ApiUnit; bed: ApiBed }> {
  const out: Array<{ unit: ApiUnit; bed: ApiBed }> = [];
  for (const unit of board.units) {
    if (unit.kind !== 'rawat_inap') continue;
    if (req.unitId && unit.unitId !== req.unitId) continue;
    for (const bed of unit.beds) {
      if (bed.status !== 'siap') continue;
      const cls = req.isolation ? 'isolasi' : req.careClass;
      if (bed.careClass !== cls) continue;
      out.push({ unit, bed });
    }
  }
  return out;
}

/** Bed tujuan transfer: bed `siap` di unit rawat inap mana pun (lingkup unit ditegakkan API), selain bed asal. */
export function transferTargets(
  board: BedBoardApi,
  fromBedId: string,
): Array<{ unit: ApiUnit; bed: ApiBed }> {
  return board.units
    .filter((u) => u.kind === 'rawat_inap')
    .flatMap((unit) =>
      unit.beds.filter((b) => b.status === 'siap' && b.bedId !== fromBedId).map((bed) => ({ unit, bed })),
    );
}
