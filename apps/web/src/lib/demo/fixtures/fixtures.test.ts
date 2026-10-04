import { PRESENTATION_PERSONAS } from '@simrs/db';
import { describe, expect, it } from 'vitest';
import { runScenario } from '../engine/run';
import { SCENARIOS } from '../skenario';
import { CICILAN, KAMAR_OK, KASUS_SKENARIO_OK, REFUND, REKONSILIASI, TRANSAKSI } from './btn';
import { demoExecutiveDashboard } from './dasbor';
import {
  DEFAULT_PATIENT_ID,
  demoQueueBoard,
  type FrontOfficeProgress,
  NO_PROGRESS,
  registrationPatients,
  SCENARIO_RJ,
} from './front-office';
import { STATIC_CLAIMS, STATIC_INVOICES } from './keuangan';
import { demoCpoeEncounters, demoPoliWorklist } from './klinis';
import { COSIGN_NOTES, DOCTOR_PATIENTS, INCIDENTS } from './manajemen';
import {
  ANTREAN_POLI_PD,
  consentIdOf,
  encounterIdOf,
  type Lokasi,
  lokasiKey,
  NEXT_POLI_PD,
  PASIEN,
  patientByEncounterId,
  patientById,
  patientByScenario,
  ROSTER,
  rosterOf,
} from './pasien';
import { demoLabSamples, demoPrescriptions, demoRadiologyExams } from './penunjang';
import {
  CONSENT_IDS,
  demoBedRequests,
  demoBeds,
  demoEdBoardBase,
  demoEndangResume,
  demoInpatients,
  RESUME_ENCOUNTERS,
  SCENARIO_BEDS,
} from './rawat-inap';
import { BANGSAL, POLI, queueNo, UNIT } from './rs';
import { DOKTER, PERSONA } from './staf';
import { DEMO_NOW, DEMO_TODAY } from './waktu';

describe('fixture bersama mode presentasi', () => {
  it('nama persona sama dengan akun presentasi yang login', () => {
    const names = new Set(PRESENTATION_PERSONAS.map((p) => p.displayName));
    for (const n of Object.values(PERSONA)) expect(names, n).toContain(n);
  });

  it('kapasitas bangsal sama dengan Dasbor direksi (rawat inap kelas, ICU, isolasi)', () => {
    const cap = demoExecutiveDashboard('hari-ini').capacity;
    const kelas = BANGSAL.filter((b) => b.kelas.startsWith('Kelas') || b.kelas === 'VIP');
    const sum = (k: 'beds' | 'occupied', list: typeof BANGSAL) => list.reduce((a, b) => a + b[k], 0);
    expect(cap.find((c) => c.id === 'ranap-kelas')).toMatchObject({
      used: sum('occupied', kelas),
      total: sum('beds', kelas),
    });
    const icu = BANGSAL.find((b) => b.code === 'ICU');
    expect(cap.find((c) => c.id === 'icu')).toMatchObject({ used: icu?.occupied, total: icu?.beds });
    const iso = BANGSAL.find((b) => b.code === 'ISOLASI');
    expect(cap.find((c) => c.id === 'isolasi')).toMatchObject({ used: iso?.occupied, total: iso?.beds });
  });

  it('unit seed dan poli konsisten; nomor antrean berformat docs/04', () => {
    for (const p of POLI) if (p.unitCode) expect(Object.keys(UNIT)).toContain(p.unitCode);
    expect(new Set(POLI.map((p) => p.code)).size).toBe(POLI.length);
    expect(queueNo('PD', 27)).toBe('PD-027');
    for (const d of DOKTER) if (d.poli) expect(POLI.map((p) => p.code)).toContain(d.poli);
    expect(new Set(DOKTER.map((d) => d.id)).size).toBe(DOKTER.length);
  });

  it('pasien: RM unik, identitas jelas fiktif (NIK 9999, BPJS 0000, HP 0812-0000)', () => {
    expect(new Set(PASIEN.map((p) => p.rm)).size).toBe(PASIEN.length);
    expect(new Set(PASIEN.map((p) => p.id)).size).toBe(PASIEN.length);
    for (const p of PASIEN) {
      expect(p.rm).toMatch(/^00-\d{2}-\d{2}-\d{2}$/);
      expect(p.nikMasked).toMatch(/^9999•{8}\d{4}$/);
      if (p.bpjsMasked) expect(p.bpjsMasked).toMatch(/^0000\d{3}•{3}\d{3}$/);
      expect(p.telepon).toMatch(/^0812-0000-\d{4}$/);
      expect(p.penjamin === 'BPJS').toBe(p.bpjsMasked !== null);
      const [y = 0, m = 0, d = 0] = p.tanggalLahir.split('-').map(Number);
      const [ty = 0, tm = 0, td = 0] = DEMO_TODAY.split('-').map(Number);
      expect(p.umur, p.id).toBe(ty - y - (tm < m || (tm === m && td < d) ? 1 : 0));
    }
  });

  it('pasien skenario sama dengan rekam medis awal di naskah Simulasi', () => {
    for (const def of Object.values(SCENARIOS)) {
      const p = patientByScenario(def.id);
      expect(p, def.id).toBeDefined();
      expect(p).toMatchObject({ nama: def.base.nama, rm: def.base.rm, umur: def.base.umur, jk: def.base.jk });
      expect(p?.riwayat).toBe(def.base.riwayat);
    }
  });

  it('id kunjungan dan persetujuan baku per pasien, bisa dipetakan balik', () => {
    expect(encounterIdOf('ps-suryo')).toBe('kj-suryo');
    expect(consentIdOf('ps-hartono')).toBe('pk-hartono');
    for (const p of PASIEN) expect(patientByEncounterId(encounterIdOf(p.id))?.id).toBe(p.id);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Roster hari demo (Sen, 5 Okt 2026 · 10.45): satu pasien satu tempat di semua layar
// ---------------------------------------------------------------------------------------------------------------

const rj0 = runScenario(SCENARIOS['rawat-jalan'], []);
const AFTER_SEP: FrontOfficeProgress = { ticket: true, called: true, sep: true, doctorCalled: false };
const DOCTOR_CALLED: FrontOfficeProgress = { ...AFTER_SEP, doctorCalled: true };
const POLI_KODE = new Map(POLI.flatMap((p) => [[p.name, p.code] as const, [p.code, p.code] as const]));
const minutesOfDay = (iso: string) => {
  const [h = 0, m = 0] = iso.slice(11, 16).split(':').map(Number);
  return h * 60 + m;
};

type Tempat = Lokasi | { poliAsal: string };

/** Teks lokasi order/permintaan (`IGD · B3`, `Bangsal Melati · M-203`, `Poli Saraf`) → tempat, atau poli asal order. */
function tempatDari(text: string): Tempat {
  const igd = /^IGD (?:· )?([A-Z]\d+)$/.exec(text)?.[1];
  if (igd) return { di: 'igd', bed: igd };
  const ranap = /^(?:Bangsal \S+|Paviliun VIP|ICU\/ICCU) · (.+)$/.exec(text)?.[1];
  if (ranap) return { di: 'ranap', bed: ranap };
  const pulih = /^Ruang pulih (?:· )?(OK \d)$/.exec(text)?.[1];
  if (pulih) return { di: 'kamar-operasi', kamar: pulih };
  if (text.startsWith('Kamar bersalin')) return { di: 'kamar-bersalin' };
  const poli = /^Poli (.+?)(?: \(| · |$)/.exec(text)?.[1];
  const kode = poli ? POLI_KODE.get(poli) : undefined;
  if (kode) return { poliAsal: kode };
  throw new Error(`Lokasi fixture tidak dikenali: "${text}"`);
}

interface Jejak {
  patientId: string;
  tempat: Tempat;
  sumber: string;
}

/** Semua jejak pasien non-skenario di fixture per layar pada jam demo (keadaan awal, Simulasi belum berjalan). */
function jejakLayar(): Jejak[] {
  const out: Jejak[] = [];
  const add = (patientId: string, tempat: Tempat, sumber: string) => out.push({ patientId, tempat, sumber });
  add(DEFAULT_PATIENT_ID, { di: 'pendaftaran' }, 'pendaftaran');
  for (const q of demoPoliWorklist(rj0).items) {
    if (q.scenario === null && q.status !== 'selesai')
      add(q.patientId, { di: 'poli', poli: 'PD' }, q.queueNo);
  }
  for (const e of demoEdBoardBase(DEMO_NOW).items) {
    if (e.patientId && e.bed) add(e.patientId, { di: 'igd', bed: e.bed }, `IGD ${e.bed}`);
  }
  const beds = demoBeds();
  for (const b of beds) {
    const p = b.encounterId ? patientByEncounterId(b.encounterId) : undefined;
    if (p) add(p.id, { di: 'ranap', bed: b.code }, `bed ${b.code}`);
  }
  for (const d of demoInpatients())
    add(d.summary.patientId, { di: 'ranap', bed: d.summary.bed }, 'rawat inap');
  for (const r of demoBedRequests(beds)) {
    const p = PASIEN.find((x) => x.rm === r.rm);
    if (p) add(p.id, tempatDari(r.from), r.id);
  }
  for (const i of STATIC_INVOICES) {
    if (i.queueNo && i.status !== 'lunas') add(i.patient.id, { di: 'kasir', antrean: i.queueNo }, i.id);
  }
  for (const s of demoLabSamples()) add(s.patient.id, tempatDari(s.location), s.id);
  for (const rx of demoPrescriptions()) {
    add(rx.patient.id, tempatDari(rx.location), rx.id);
    if (rx.setting === 'rawat-jalan') add(rx.patient.id, { di: 'farmasi' }, `${rx.id} (menunggu obat)`);
  }
  for (const e of demoRadiologyExams()) {
    add(e.patient.id, tempatDari(e.location), e.id);
    if (e.status === 'berlangsung' && !e.room.startsWith('Portabel')) {
      add(e.patient.id, { di: 'radiologi', ruang: e.room }, `${e.id} (berlangsung)`);
    }
  }
  const now = minutesOfDay(DEMO_NOW);
  for (const room of KAMAR_OK) {
    for (const c of room.cases) {
      if (c.scenario) continue;
      const end = c.startMin + c.durationMin;
      // Sedang dioperasi, atau selesai kurang dari 30 menit lalu (masih di ruang pulih kamar itu).
      if (c.status === 'berjalan' || (c.status === 'selesai' && end <= now && now - end < 30)) {
        add(c.patient.id, { di: 'kamar-operasi', kamar: room.name }, c.id);
      }
    }
  }
  return out;
}

function tempatRoster(patientId: string): Lokasi[] {
  const r = rosterOf(patientId);
  return r ? [r.lokasi, ...(r.juga ?? []).map((j) => j.lokasi)] : [];
}

describe('roster hari demo (Sen, 5 Okt 2026 · 10.45)', () => {
  it('satu entri roster per pasien; hanya pasien skenario yang tempatnya diatur mesin Simulasi', () => {
    expect(ROSTER.map((r) => r.patientId).sort()).toEqual(PASIEN.map((p) => p.id).sort());
    for (const r of ROSTER) {
      expect(r.cerita.length, r.patientId).toBeGreaterThan(20);
      expect(r.lokasi.di === 'skenario', r.patientId).toBe(patientById(r.patientId)?.scenario !== undefined);
    }
  });

  it('dua tempat sekaligus hanya bila sah secara klinis dan beralasan', () => {
    const sah = new Set(['ranap+kasir', 'kamar-operasi+ranap']);
    for (const r of ROSTER) {
      for (const j of r.juga ?? []) {
        expect(j.alasan.length, r.patientId).toBeGreaterThanOrEqual(20);
        expect(sah, r.patientId).toContain(`${r.lokasi.di}+${j.lokasi.di}`);
      }
    }
  });

  it('setiap tempat pasien di layar mana pun cocok dengan roster, dan setiap tempat roster tampak di layar', () => {
    const fisik = new Map<string, Set<string>>();
    for (const j of jejakLayar()) {
      const r = rosterOf(j.patientId);
      expect(r, `${j.sumber}: ${j.patientId} tidak ada di ROSTER`).toBeDefined();
      expect(r?.lokasi.di, `${j.sumber}: pasien skenario di fixture statis`).not.toBe('skenario');
      if ('poliAsal' in j.tempat) {
        // Order dari poli: pasien memang berkunjung atau terdaftar di poli itu hari ini.
        expect(
          r?.poliHariIni ?? [],
          `${j.sumber}: ${j.patientId} tidak ke poli ${j.tempat.poliAsal}`,
        ).toContain(j.tempat.poliAsal);
        continue;
      }
      const set = fisik.get(j.patientId) ?? new Set<string>();
      set.add(lokasiKey(j.tempat));
      fisik.set(j.patientId, set);
    }
    for (const r of ROSTER) {
      if (r.lokasi.di === 'skenario') continue;
      const expected = tempatRoster(r.patientId).map(lokasiKey).sort();
      expect([...(fisik.get(r.patientId) ?? [])].sort(), r.patientId).toEqual(expected);
    }
  });

  it('Poli PD: layar Pemeriksaan = roster antrean, nomor unik, PD-027 milik Tn. Suryo, walk-in berikutnya PD-028', () => {
    const nos = ANTREAN_POLI_PD.map((a) => a.no);
    expect(new Set(nos).size).toBe(nos.length);
    expect(nos).not.toContain(SCENARIO_RJ.poliQueue);
    expect(queueNo('PD', NEXT_POLI_PD)).toBe('PD-028');
    for (const no of nos) expect(no < queueNo('PD', NEXT_POLI_PD), no).toBe(true);
    const items = demoPoliWorklist(rj0).items;
    expect(items.map((i) => [i.queueNo, i.patientId, i.status])).toEqual(
      ANTREAN_POLI_PD.map((a) => [a.no, a.patientId, a.status]),
    );
    expect(ANTREAN_POLI_PD.filter((a) => a.status === 'diperiksa')).toHaveLength(1);
    for (const a of ANTREAN_POLI_PD) {
      expect(rosterOf(a.patientId)?.lokasi.di === 'poli', a.no).toBe(a.status !== 'selesai');
      expect(a.dipanggil === null, a.no).toBe(a.status === 'menunggu');
    }
    // Daftar CPOE kunjungan hari ini = antrean poli (pasien rawat inap seperti Ny. Endang tidak ikut).
    const cpoe = demoCpoeEncounters(rj0, runScenario(SCENARIOS['igd-ranap'], [])).map((e) => e.encounterId);
    expect(cpoe).toEqual(ANTREAN_POLI_PD.map((a) => encounterIdOf(a.patientId)));
  });

  it('papan TV Poli PD memakai nomor layar Pemeriksaan di tiap tahap skenario rawat jalan', () => {
    const items = demoPoliWorklist(rj0).items;
    const known = new Set([...items.map((i) => i.queueNo), SCENARIO_RJ.poliQueue]);
    const waiting = items.filter((i) => i.status === 'menunggu').map((i) => i.queueNo);
    for (const p of [NO_PROGRESS, AFTER_SEP, DOCTOR_CALLED]) {
      const b = demoQueueBoard(p);
      const pd = b.clinics.find((c) => c.poliCode === 'PD');
      const history = b.history.filter((h) => h.poliCode === 'PD').map((h) => h.queueNo);
      for (const no of [pd?.current, ...(pd?.waiting ?? []), ...history]) {
        expect(known, `${JSON.stringify(p)} → ${no}`).toContain(no);
      }
      expect(
        pd?.waiting.filter((no) => no !== SCENARIO_RJ.poliQueue),
        JSON.stringify(p),
      ).toEqual(waiting);
    }
    const diperiksa = items.find((i) => i.status === 'diperiksa')?.queueNo;
    expect(demoQueueBoard(NO_PROGRESS).calling).toEqual({ queueNo: diperiksa, poliCode: 'PD' });
    expect(demoQueueBoard(AFTER_SEP).clinics[0]?.waiting).toContain(SCENARIO_RJ.poliQueue);
    expect(demoQueueBoard(DOCTOR_CALLED).calling.queueNo).toBe(SCENARIO_RJ.poliQueue);
  });

  it('nomor dan bed unik per layar; bed dan nomor skenario tidak dipakai pasien lain', () => {
    const ed = demoEdBoardBase(DEMO_NOW).items;
    expect(new Set(ed.map((e) => e.bed)).size).toBe(ed.length);
    expect(ed.map((e) => e.bed)).not.toContain('R2');
    const kasir = STATIC_INVOICES.flatMap((i) => (i.queueNo ? [i.queueNo] : []));
    expect(new Set(kasir).size).toBe(kasir.length);
    expect(kasir).not.toContain(queueNo('K', 15));
    for (const b of demoBeds()) if (SCENARIO_BEDS.includes(b.code)) expect(b.encounterId, b.code).toBeNull();
    const owner = new Map(STATIC_INVOICES.map((i) => [i.number, i.patient.id]));
    for (const t of TRANSAKSI) {
      const id = owner.get(t.invoiceNo);
      if (id) expect(t.patient.id, `${t.id} ${t.invoiceNo}`).toBe(id);
    }
    const ok = KAMAR_OK.flatMap((r) => r.cases.map((c) => c.id));
    expect(new Set(ok).size).toBe(ok.length);
    expect(KASUS_SKENARIO_OK.scenario).toBe(true);
  });

  it('pasien di berkas (klaim, TPDI, cicilan, IKP, aplikasi dokter, resume, persetujuan) ada di roster', () => {
    const ids = new Set<string>([
      ...registrationPatients().map((p) => p.id),
      ...STATIC_CLAIMS.map((c) => c.patient.id),
      ...TRANSAKSI.map((t) => t.patient.id),
      ...REFUND.map((r) => r.patient.id),
      ...CICILAN.map((c) => c.patient.id),
      ...DOCTOR_PATIENTS.map((d) => d.patientId),
      ...KAMAR_OK.flatMap((r) => r.cases.map((c) => c.patient.id)),
      ...RESUME_ENCOUNTERS.map((e) => patientByEncounterId(e)?.id ?? e),
      ...CONSENT_IDS.map((c) => c.replace(/^pk-/, 'ps-')),
    ]);
    for (const id of ids) expect(rosterOf(id), id).toBeDefined();
    const names = new Set(PASIEN.map((p) => p.nama));
    for (const r of REKONSILIASI) if (r.label !== 'Tanpa referensi') expect(names, r.id).toContain(r.label);
    for (const c of COSIGN_NOTES) expect(names, c.id).toContain(c.patientName);
    const rms = new Set(PASIEN.map((p) => p.rm));
    for (const i of INCIDENTS) if (i.patientRm) expect(rms, i.id).toContain(i.patientRm);
    // Aplikasi dokter: bed dan hari rawat sama dengan roster dan rekam rawat inap.
    const inpatients = demoInpatients();
    for (const d of DOCTOR_PATIENTS) {
      const r = rosterOf(d.patientId);
      expect(r?.lokasi.di, d.id).toBe('ranap');
      if (r?.lokasi.di === 'ranap') expect(d.location.endsWith(r.lokasi.bed), d.id).toBe(true);
      const ip = inpatients.find((x) => x.summary.patientId === d.patientId);
      if (ip) expect(d.hospitalDay, d.id).toBe(`H${ip.summary.day}`);
    }
  });

  it('Ny. Endang: rawat inap Melati M-203 dan pulang hari ini, bukan pasien Poli PD', () => {
    expect(rosterOf('ps-endang')?.lokasi).toEqual({ di: 'ranap', bed: 'M-203' });
    expect(ANTREAN_POLI_PD.some((a) => a.patientId === 'ps-endang')).toBe(false);
    expect(demoBeds().find((b) => b.code === 'M-203')).toMatchObject({
      status: 'pulang',
      encounterId: 'kj-endang',
    });
    expect(demoEndangResume().dischargeAt.slice(0, 10)).toBe(DEMO_TODAY);
    expect(STATIC_INVOICES.find((i) => i.id === 'inv-endang')).toMatchObject({
      status: 'final',
      encounter: { kind: 'rawat-inap', discharged: true },
    });
    expect(demoPrescriptions().find((r) => r.id === 'rx-endang')?.tag).toBe('Pulang');
  });
});
