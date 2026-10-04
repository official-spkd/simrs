import { SEED_REF_SAMPLES } from '@simrs/db';
import {
  queueBoardSchema,
  registrationDeskSchema,
  registrationPatientSchema,
  weeklyScheduleSchema,
} from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import { advanceTo, applyAction, runScenario, taskKey } from './demo/engine/run';
import type { ScenarioEvent } from './demo/engine/types';
import {
  counterTickets,
  demoQueueBoard,
  demoRegistrationDesk,
  demoWeeklySchedule,
  type FrontOfficeProgress,
  kioskTickets,
  NO_PROGRESS,
  registrationPatients,
  SCENARIO_RJ,
  scenarioRegistrationPatient,
} from './demo/fixtures/front-office';
import { demoBeds } from './demo/fixtures/rawat-inap';
import { POLI, queueNo } from './demo/fixtures/rs';
import { DOKTER } from './demo/fixtures/staf';
import { RAWAT_JALAN } from './demo/skenario/rawat-jalan';
import {
  adjustQuota,
  boardCallNext,
  type BoardState,
  dayLong,
  dayShort,
  deskQuota,
  diagnosisProblem,
  frontOfficeProgress,
  keypadDisplay,
  keypadHint,
  matchPatient,
  nextQueueNo,
  parseQueueNo,
  quotaUsage,
  referralExpired,
  referralMeta,
  registrationPrimary,
  registrationProgress,
  type RegistrationFlow,
  simClock,
  slotCell,
  slotTimeShort,
  taskDoneAt,
} from './front-office';

const ALL: FrontOfficeProgress = { ticket: true, called: true, sep: true, doctorCalled: true };
const AFTER_SEP: FrontOfficeProgress = { ticket: true, called: true, sep: true, doctorCalled: false };

/** Putar otomatis skenario rawat jalan sampai tugas `step.task` selesai. */
function seqUntil(stepId: string, taskId: string): ScenarioEvent[] {
  const si = RAWAT_JALAN.steps.findIndex((s) => s.id === stepId);
  let seq: ScenarioEvent[] = [];
  for (let guard = 0; guard < 200; guard++) {
    if (runScenario(RAWAT_JALAN, seq).done.has(taskKey(si, taskId))) return seq;
    const r = applyAction(RAWAT_JALAN, seq, { type: 'auto' });
    if (!r.ok) throw new Error(r.error);
    seq = r.seq;
  }
  throw new Error(`${stepId}.${taskId} tidak tercapai`);
}

const progressAt = (seq: ScenarioEvent[]) => frontOfficeProgress(runScenario(RAWAT_JALAN, seq));

describe('kontrak data dummy front office', () => {
  it('setiap proyeksi lolos skema ketat (yang nanti dipenuhi API)', () => {
    for (const p of [NO_PROGRESS, AFTER_SEP, ALL]) {
      expect(() => weeklyScheduleSchema.parse(demoWeeklySchedule(p))).not.toThrow();
      expect(() => queueBoardSchema.parse(demoQueueBoard(p))).not.toThrow();
      expect(() => registrationDeskSchema.parse(demoRegistrationDesk(p))).not.toThrow();
    }
    expect(() => registrationPatientSchema.parse(scenarioRegistrationPatient())).not.toThrow();
  });

  it('jadwal: 6 dokter fixture bersama × Sen 5 – Sab 10 Okt; cuti Rabu dr. Bagus, pengganti dr. Melati', () => {
    const w = demoWeeklySchedule();
    expect(w.doctors.map((d) => d.id)).toEqual([
      'dr-andini',
      'dr-rahmat',
      'dr-bagus',
      'dr-melati',
      'dr-yudha',
      'dr-kartika',
    ]);
    for (const d of w.doctors) expect(DOKTER.find((x) => x.id === d.id)?.nama).toBe(d.name);
    expect(w.days.map(dayShort)).toEqual(['Sen 5', 'Sel 6', 'Rab 7', 'Kam 8', 'Jum 9', 'Sab 10']);
    expect(dayLong(w.days[0] ?? '')).toBe('Senin 5 Okt');
    const cuti = w.doctors.find((d) => d.id === 'dr-bagus')?.slots[2];
    expect(cuti).toMatchObject({ kind: 'cuti', relatedDoctorId: 'dr-melati', affectedPatients: 18 });
    expect(cuti?.hfisSynced).toBe(false);
    expect(w.hfis.differences.map((x) => x.slotId)).toEqual([cuti?.id]);
    const sub = w.doctors.find((d) => d.id === 'dr-melati')?.slots[2];
    expect(sub).toMatchObject({ kind: 'pengganti', relatedDoctorId: 'dr-bagus', quota: null });
  });

  it('kode diagnosa rujukan ⊂ contoh seed ICD-10 dengan label yang sama', () => {
    const seed = new Map(SEED_REF_SAMPLES.icd10.map((c) => [c.code, c.display]));
    const refs = [...registrationPatients(), scenarioRegistrationPatient()].flatMap((p) => p.referrals);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(seed.get(r.diagnosis.code), r.id).toBe(r.diagnosis.label);
  });

  it('pasien meja pendaftaran dari fixture bersama; identitas tersamar', () => {
    const list = registrationPatients();
    expect(list[0]?.name).toBe('Siti Rahmawati');
    for (const p of list) {
      expect(p.nikMasked).toMatch(/^9999•+\d{4}$/);
      expect(p.phoneMasked).toMatch(/^0812-••••-\d{4}$/);
      if (p.defaultPayer === 'BPJS') expect(p.eligibility?.status).toBe('aktif');
      else expect(p.eligibility).toBeNull();
    }
    expect(list.some((p) => p.id === SCENARIO_RJ.patientId)).toBe(false);
  });

  it('pasien dengan surat kontrol hari ini bukan pasien rawat inap di layar lain', () => {
    const inpatients = new Set(demoBeds().flatMap((b) => (b.patientLabel ? [b.patientLabel] : [])));
    for (const p of registrationPatients()) expect(inpatients.has(p.name), p.name).toBe(false);
    const maria = registrationPatients().find((p) => p.id === 'ps-maria');
    expect(maria?.referrals).toEqual([
      expect.objectContaining({ kind: 'surat-kontrol', poliCode: 'PD', doctorId: 'dr-rahmat' }),
    ]);
  });
});

describe('aturan kuota', () => {
  it('hampir penuh mulai 80%, penuh 100%', () => {
    expect(quotaUsage(23, 30).level).toBe('tersedia');
    expect(quotaUsage(24, 30)).toMatchObject({ level: 'hampir-penuh', percent: 80 });
    expect(quotaUsage(30, 30).level).toBe('penuh');
    expect(quotaUsage(0, 0).level).toBe('penuh');
  });

  it('kuota tidak bisa di bawah pasien yang sudah booking per kelompok penjamin', () => {
    const q = { jkn: 18, nonJkn: 6, bookedJkn: 17, bookedNonJkn: 6 };
    expect(adjustQuota(q, 'jkn', -1)).toEqual({ ...q, jkn: 17 });
    expect(adjustQuota({ ...q, jkn: 17 }, 'jkn', -1)).toBeNull();
    expect(adjustQuota(q, 'nonJkn', -1)).toBeNull();
    expect(adjustQuota(q, 'nonJkn', 2)).toEqual({ ...q, nonJkn: 8 });
  });

  it('sel jadwal: kuota, ≥ 80% hampir penuh, 100% penuh, cuti, pengganti, tidak praktik', () => {
    const w = demoWeeklySchedule();
    const cell = (doc: string, day: number) => {
      const s = w.doctors.find((d) => d.id === doc)?.slots[day];
      if (!s) throw new Error('slot');
      return slotCell(s, s.quota, s.hfisSynced);
    };
    expect(cell('dr-andini', 0)).toMatchObject({ kind: 'ok', time: '08–12', note: '22/30' });
    expect(cell('dr-andini', 1)).toMatchObject({ kind: 'full', note: '26/30', status: 'Kuota hampir penuh' });
    const bagus = w.doctors.find((d) => d.id === 'dr-bagus')?.slots[0];
    if (!bagus?.quota) throw new Error('slot');
    expect(slotCell(bagus, bagus.quota, true)).toMatchObject({ note: '18/20', status: 'Kuota hampir penuh' });
    // Kuota non-JKN diturunkan sampai batas booking → 100% terisi: "penuh", bukan "hampir penuh".
    const habis = { ...bagus.quota, nonJkn: bagus.quota.bookedNonJkn };
    expect(slotCell(bagus, habis, true)).toMatchObject({
      kind: 'full',
      note: '18/18',
      status: 'Kuota penuh',
    });
    expect(cell('dr-bagus', 2)).toMatchObject({ kind: 'off', time: 'Cuti', note: 'HFIS belum diubah' });
    expect(cell('dr-melati', 2)).toMatchObject({ kind: 'sub', note: 'pengganti' });
    expect(cell('dr-andini', 4)).toMatchObject({ kind: 'none', note: 'tidak praktik' });
    expect(cell('dr-yudha', 0).time).toBe('09.30–12');
    expect(slotTimeShort('13.00', '15.30')).toBe('13–15.30');
  });

  it('kuota meja pendaftaran = slot Senin jadwal; kuota JKN habis → dokter tidak bisa dipilih pasien BPJS', () => {
    const desk = demoRegistrationDesk();
    expect(desk.quotas.map((q) => q.doctorId)).toEqual([
      'dr-andini',
      'dr-rahmat',
      'dr-bagus',
      'dr-yudha',
      'dr-kartika',
    ]);
    const andini = desk.quotas[0];
    if (!andini) throw new Error('kuota');
    expect(deskQuota(andini, 'BPJS', false)).toMatchObject({ used: 22, total: 30, jknText: '17/24' });
    expect(deskQuota(andini, 'BPJS', true)).toMatchObject({ used: 23, jknText: '18/24', nonJknText: '5/6' });
    const bagus = desk.quotas.find((q) => q.doctorId === 'dr-bagus');
    if (!bagus) throw new Error('kuota');
    expect(deskQuota(bagus, 'BPJS', false).full).toBe(true);
    expect(deskQuota(bagus, 'Umum', false).full).toBe(false);
  });
});

describe('nomor antrean', () => {
  it('format `<kode>-<3 digit>`; nomor baru melewati nomor yang dicadangkan', () => {
    expect(queueNo('PD', 27)).toBe('PD-027');
    expect(parseQueueNo('PD-027')).toEqual({ code: 'PD', n: 27 });
    expect(parseQueueNo('PD27')).toBeNull();
    expect(nextQueueNo('PD', ['PD-026', 'PD-027', 'JT-099'])).toBe('PD-028');
    expect(nextQueueNo('F', [])).toBe('F-001');
  });

  it('tiket loket: A-031 milik Tn. Suryo dan tidak dipakai walk-in', () => {
    expect(counterTickets(NO_PROGRESS).map((t) => t.ticket)).toEqual(['A-028', 'A-029', 'A-030']);
    const waiting = counterTickets({ ...NO_PROGRESS, ticket: true });
    expect(waiting[0]).toEqual({ ticket: SCENARIO_RJ.ticket, patientId: SCENARIO_RJ.patientId });
    expect(counterTickets(AFTER_SEP).map((t) => t.ticket)).toEqual(['A-032', 'A-033', 'A-034']);
  });

  it('tiket lokal anjungan: nomor A bebas setelah antrean loket dan A-031, tidak pernah mundur', () => {
    expect(kioskTickets(NO_PROGRESS)).toMatchObject({
      bpjs: { no: 'A-032' },
      umum: { no: 'A-033' },
      skenario: { no: SCENARIO_RJ.ticket },
    });
    expect(kioskTickets(AFTER_SEP)).toMatchObject({ bpjs: { no: 'A-035' }, umum: { no: 'A-036' } });
    for (const p of [NO_PROGRESS, { ...NO_PROGRESS, ticket: true }, AFTER_SEP, ALL]) {
      const k = kioskTickets(p);
      const taken = [...counterTickets(p).map((t) => t.ticket), SCENARIO_RJ.ticket];
      const top = Math.max(...taken.map((t) => parseQueueNo(t)?.n ?? 0));
      expect(parseQueueNo(k.bpjs.no)).toEqual({ code: 'A', n: top + 1 });
      expect(parseQueueNo(k.umum.no)).toEqual({ code: 'A', n: top + 2 });
    }
  });

  it('nomor poli di papan dan meja pendaftaran tidak bertabrakan', () => {
    for (const p of [NO_PROGRESS, AFTER_SEP, ALL]) {
      const board = demoQueueBoard(p);
      const desk = demoRegistrationDesk(p);
      for (const q of desk.quotas) {
        const c = board.clinics.find((x) => x.poliCode === q.poliCode);
        const known = [c?.current, ...(c?.waiting ?? []), ...(c?.reserved ?? [])].filter(Boolean);
        expect(known, q.doctorId).not.toContain(q.nextQueueNo);
      }
    }
    expect(POLI.filter((p) => p.lantai === 2).map((p) => p.code)).toEqual(
      demoQueueBoard().clinics.map((c) => c.poliCode),
    );
  });
});

describe('papan antrean', () => {
  const toState = (p: FrontOfficeProgress): BoardState => {
    const b = demoQueueBoard(p);
    return { clinics: b.clinics, calling: b.calling, history: b.history };
  };

  it('panggilan bergiliran antarpoli; riwayat maksimal 4; antrean ditambah agar minimal dua menunggu', () => {
    let s = toState(NO_PROGRESS);
    s = boardCallNext(s);
    expect(s.calling).toEqual({ queueNo: 'JT-010', poliCode: 'JT' });
    expect(s.history[0]).toEqual({ queueNo: 'PD-025', poliCode: 'PD' });
    for (let i = 0; i < 12; i++) s = boardCallNext(s);
    expect(s.history).toHaveLength(4);
    for (const c of s.clinics) expect(c.waiting.length).toBeGreaterThanOrEqual(2);
  });

  it('PD-027 (Tn. Suryo) dicadangkan: tidak pernah dipanggil otomatis dan tidak dipakai pasien lain', () => {
    let s = toState(NO_PROGRESS);
    const called: string[] = [];
    for (let i = 0; i < 40; i++) {
      s = boardCallNext(s);
      called.push(s.calling.queueNo);
    }
    expect(called).not.toContain('PD-027');
    expect(called).toContain('PD-028');

    let after = toState(AFTER_SEP);
    for (let i = 0; i < 40; i++) after = boardCallNext(after);
    const pd = after.clinics.find((c) => c.poliCode === 'PD');
    expect(pd?.current).toBe('PD-026');
    expect(pd?.waiting.slice(0, 2)).toEqual(['PD-027', 'PD-028']);
  });
});

describe('pendaftaran: langkah dan alasan tombol utama', () => {
  const base: RegistrationFlow = {
    found: true,
    payer: 'BPJS',
    checked: false,
    referralChosen: false,
    diagnosisError: '',
    sepIssued: false,
    doctorChosen: true,
    scheduleLocked: false,
    consent: true,
    done: false,
  };

  it('alasan selalu tertulis sampai syarat langkah aktif terpenuhi', () => {
    expect(registrationPrimary({ ...base, found: false }).reason).toBe(
      'Langkah 1 belum selesai: cari pasien dulu.',
    );
    expect(registrationPrimary(base).reason).toBe('Cek kepesertaan BPJS dulu.');
    expect(registrationPrimary({ ...base, checked: true }).reason).toBe('Pilih rujukan aktif dulu.');
    const ready = { ...base, checked: true, referralChosen: true };
    expect(registrationPrimary({ ...ready, diagnosisError: diagnosisProblem(' ') }).reason).toBe(
      'Isi diagnosa awal dulu.',
    );
    expect(registrationPrimary({ ...ready, diagnosisError: diagnosisProblem('hipertensi') }).reason).toBe(
      'Periksa kode ICD-10 diagnosa awal.',
    );
    expect(registrationPrimary(ready)).toEqual({
      kind: 'sep',
      label: 'Terbitkan SEP dan daftarkan',
      reason: '',
    });
    const sep = { ...ready, sepIssued: true, doctorChosen: false };
    expect(registrationPrimary(sep)).toMatchObject({
      kind: 'tujuan',
      reason: 'Pilih dokter dengan kuota tersedia.',
    });
    const tujuan = { ...sep, doctorChosen: true, scheduleLocked: true, consent: false };
    expect(registrationPrimary(tujuan).reason).toBe('Persetujuan umum belum ditandatangani pasien.');
    expect(registrationProgress({ ...tujuan, consent: true, done: true }).active).toBe(4);
  });

  it('pasien umum/asuransi melewati SEP', () => {
    const umum = { ...base, payer: 'Umum' as const };
    expect(registrationProgress(umum)).toEqual({ done: [true, true, false, false], active: 2 });
    expect(registrationPrimary(umum).kind).toBe('tujuan');
  });

  it('diagnosa awal: wajib dan diawali kode ICD-10', () => {
    expect(diagnosisProblem('I10 · Hipertensi esensial (primer)')).toBe('');
    expect(diagnosisProblem('E11.9')).toBe('');
    expect(diagnosisProblem('')).toMatch(/wajib/);
    expect(diagnosisProblem('i10 hipertensi')).toMatch(/ICD-10/);
  });

  it('rujukan kedaluwarsa tidak bisa dipakai; keterangan rujukan', () => {
    const [kontrol, fktp, lama] = registrationPatients()[0]?.referrals ?? [];
    if (!kontrol || !fktp || !lama) throw new Error('rujukan');
    expect(referralExpired(kontrol, '2026-10-05')).toBe(false);
    expect(referralExpired(lama, '2026-10-05')).toBe(true);
    expect(referralMeta(kontrol, '2026-10-05')).toBe('dari kunjungan 12 Sep 2026 · berlaku s.d. 12 Okt 2026');
    expect(referralMeta(fktp, '2026-10-05')).toBe('I10 · berlaku s.d. 28 Des 2026 · kunjungan ke-3');
    expect(referralMeta(lama, '2026-10-05')).toBe('K30 · berakhir 1 Sep 2026 · kunjungan ke-2');
  });
});

describe('pendaftaran: pencarian pasien', () => {
  const list = registrationPatients();
  it('No. RM, NIK, No. BPJS, nama + tanggal lahir', () => {
    expect(matchPatient('00-12-45-78', list)?.name).toBe('Siti Rahmawati');
    expect(matchPatient('00124578', list)?.name).toBe('Siti Rahmawati');
    expect(matchPatient('9999••••••••4521', list)?.name).toBe('Siti Rahmawati');
    expect(matchPatient('0000123000890', list)?.name).toBe('Siti Rahmawati');
    expect(matchPatient('maria', list)?.rm).toBe('00-41-27-88');
    expect(matchPatient('Siti 14-03-1972', list)?.id).toBe('ps-siti');
    expect(matchPatient('Siti 15-03-1972', list)).toBeNull();
    expect(matchPatient('zz', list)).toBeNull();
    expect(matchPatient('Tidak Ada', list)).toBeNull();
  });
});

describe('anjungan: keypad', () => {
  it('digit dikelompokkan per 4 dengan sisa bergaris bawah', () => {
    expect(keypadDisplay('261005', 10)).toBe('2610 05__ __');
    expect(keypadDisplay('', 16)).toBe('____ ____ ____ ____');
    expect(keypadHint('', 13)).toBe('13 digit diperlukan');
    expect(keypadHint('2610', 10)).toBe('Kurang 6 digit lagi');
    expect(keypadHint(SCENARIO_RJ.bookingCode, 10)).toBe('Lengkap. Sentuh Lanjut.');
  });
});

describe('proyeksi Tn. Suryo (skenario rawat jalan) per milestone', () => {
  it('awal: belum ada di loket; PD-027 belum di antrean poli', () => {
    const p = progressAt([]);
    expect(p).toEqual(NO_PROGRESS);
    expect(demoRegistrationDesk(p).counter.tickets[0]?.ticket).toBe('A-028');
    expect(demoQueueBoard(p).clinics[0]?.waiting).not.toContain('PD-027');
  });

  it('kedatangan.tiket: A-031 terdepan di loket 3', () => {
    const p = progressAt(seqUntil('kedatangan', 'tiket'));
    expect(p).toEqual({ ...NO_PROGRESS, ticket: true });
    expect(demoRegistrationDesk(p).counter.tickets[0]).toEqual({ ticket: 'A-031', patientId: 'ps-suryo' });
    const reached = advanceTo(RAWAT_JALAN, [], 1);
    if (!reached.ok) throw new Error(reached.error);
    expect(progressAt(reached.seq)).toEqual(p);
  });

  it('pendaftaran.sep: PD-027 berikutnya di Poli PD, kuota dr. Andini Senin bertambah satu', () => {
    const p = progressAt(seqUntil('pendaftaran', 'sep'));
    expect(p).toEqual(AFTER_SEP);
    const pd = demoQueueBoard(p).clinics[0];
    expect(pd?.waiting.slice(0, 2)).toEqual(['PD-026', 'PD-027']);
    expect(pd?.reserved).toEqual(['PD-027']);
    const mon = demoWeeklySchedule(p).doctors[0]?.slots[0];
    expect(mon?.quota?.bookedJkn).toBe(18);
    expect(demoRegistrationDesk(p).counter.tickets[0]?.ticket).toBe('A-032');
    // Cap waktu catatan Tn. Suryo di loket (Terdaftar, Tercetak) = jam naskah saat ini = jam SEP terbit.
    const R = runScenario(RAWAT_JALAN, seqUntil('pendaftaran', 'sep'));
    expect(simClock(R.clock)).toMatch(/^\d{2}\.\d{2}$/);
    expect(simClock(R.clock)).toBe(taskDoneAt(R, 'pendaftaran', 'sep'));
  });

  it('pemeriksaan-dokter.panggil: PD-027 SEDANG DIPANGGIL', () => {
    const p = progressAt(seqUntil('pemeriksaan-dokter', 'panggil'));
    expect(p).toEqual(ALL);
    const b = demoQueueBoard(p);
    expect(b.calling).toEqual({ queueNo: 'PD-027', poliCode: 'PD' });
    expect(b.clinics[0]?.reserved).toEqual([]);
  });
});
