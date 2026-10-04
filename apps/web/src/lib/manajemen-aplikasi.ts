import {
  type CriticalValueState,
  type DoctorAppInbox,
  formatRupiah,
  type PatientAppHome,
} from '@simrs/shared';
import { formatSimClock } from './demo/engine/format';
import { firstOpenTask, taskKey } from './demo/engine/run';
import type { RunResult, TaskValue } from './demo/engine/types';
import { DOCTOR_APP_PATIENT_ID } from './demo/fixtures/ids';
import {
  COSIGN_NOTES,
  DOCTOR_PATIENTS,
  DOCTOR_SCHEDULE,
  GLUCOSE_TARGET,
  LAB_DISPLAY,
  MEDICINE_ADVICE,
  SURYO_BOOKING,
  SURYO_GLUCOSE,
} from './demo/fixtures/manajemen';
import { demoQueueBoard, NO_PROGRESS, SCENARIO_RJ } from './demo/fixtures/front-office';
import { patientById, patientByScenario } from './demo/fixtures/pasien';
import { poliByCode } from './demo/fixtures/rs';
import { PERSONA, STAF } from './demo/fixtures/staf';

/**
 * Proyeksi pasien skenario ke pratinjau aplikasi pasien/dokter (I07–I08). Murni: menerima hasil replay skenario
 * (`RunResult`) sehingga tampilan ponsel selalu sama dengan kemajuan Simulasi di layar mana pun.
 */

function stepIndex(R: RunResult, stepId: string): number {
  const i = R.def.steps.findIndex((s) => s.id === stepId);
  if (i < 0) throw new Error(`Langkah ${stepId} tidak ada di skenario ${R.def.id}`);
  return i;
}

/** Kunci tugas `stepId.taskId`; langkah/tugas yang salah ketik → galat (bukan diam-diam "belum"). */
function keyOf(R: RunResult, stepId: string, taskId: string): string {
  const i = stepIndex(R, stepId);
  if (!R.def.steps[i]?.tasks.some((t) => t.id === taskId)) {
    throw new Error(`Tugas ${stepId}.${taskId} tidak ada di skenario ${R.def.id}`);
  }
  return taskKey(i, taskId);
}

export function taskDone(R: RunResult, stepId: string, taskId: string): boolean {
  return R.done.has(keyOf(R, stepId, taskId));
}

export function taskValue(R: RunResult, stepId: string, taskId: string): TaskValue | undefined {
  return R.done.get(keyOf(R, stepId, taskId));
}

/** Jam selesai tugas ("07.13" atau "Sab 3 Okt · 22.27"), atau null bila belum. */
export function taskTime(R: RunResult, stepId: string, taskId: string): string | null {
  const m = R.doneAt.get(keyOf(R, stepId, taskId));
  return m === undefined ? null : formatSimClock(R.def, m);
}

/** Skenario belum disentuh sama sekali (langkah pertama, tanpa tugas selesai). */
export function scenarioUntouched(R: RunResult): boolean {
  return R.step === 0 && R.done.size === 0 && !R.finished;
}

const activeStep = (R: RunResult) => (R.finished ? null : (R.def.steps[R.step]?.id ?? null));

/** "A-031 (admisi)" → "A-031". */
const queueCode = (antrean: string) => antrean.split(' ')[0] ?? antrean;

type LabRow = PatientAppHome['labResults'][number];

/** Baris hasil lab ramah pasien dari teks rekam medis skenario, mis. "HbA1c 8,4% (tinggi)". */
export function labRow(text: string, index: number): LabRow {
  const m = LAB_DISPLAY.find((d) => text.startsWith(d.prefix));
  const rest = m ? text.slice(m.prefix.length).trim() : text;
  const flagMatch = /\((tinggi|rendah)\)/i.exec(rest);
  const flag = flagMatch?.[1]?.toLowerCase() === 'rendah' ? 'rendah' : flagMatch ? 'tinggi' : 'normal';
  const [main = rest, ...extra] = rest.replace(/\s*\([^)]*\)/g, '').split(' · ');
  return {
    id: m?.id ?? `hasil-${index + 1}`,
    name: m?.name ?? text,
    value: main.trim(),
    reference: [m?.reference ?? 'Penjelasan dari dokter saat kontrol', ...extra].join(' · '),
    flag,
    loinc: m?.loinc ?? null,
  };
}

type MedicineRow = PatientAppHome['medicines'][number];

/** "Metformin 1000 mg 2×1 · 30 hari" → nama + aturan pakai ramah pasien. */
export function medicineRow(text: string, index: number): MedicineRow {
  const [main = text, ...extra] = text.split(' · ');
  const freq = /^(.*?)\s+(\d+)×(\d+)\s*(.*)$/.exec(main);
  const name = freq?.[1] ?? main;
  const advice = MEDICINE_ADVICE.find((a) => name.startsWith(a.prefix))?.advice ?? freq?.[4];
  const parts = [freq ? `${freq[2]}× sehari` : null, advice || null].filter(Boolean).join(', ');
  return {
    id: `obat-${index + 1}`,
    name,
    instruction: [parts || 'Sesuai petunjuk apoteker', ...extra].join(' · '),
  };
}

type FeedItem = PatientAppHome['feed'][number];

/** Notifikasi aplikasi pasien dari tugas skenario yang sudah selesai (terbaru di atas). */
export function patientFeed(R: RunResult): FeedItem[] {
  const rec = R.rec;
  const items: FeedItem[] = [
    {
      id: 'booking',
      title: 'Booking kontrol terkonfirmasi',
      detail: `Kode ${SURYO_BOOKING} · ${STAF.dpjpPenyakitDalam}`,
      when: 'Jum 2 Okt',
      tone: 'brand',
    },
  ];
  const add = (step: string, task: string, item: Omit<FeedItem, 'when'>) => {
    const when = taskTime(R, step, task);
    if (when) items.push({ ...item, when });
  };
  const code = queueCode(rec.antrean);
  add('kedatangan', 'tiket', {
    id: 'checkin',
    title: 'Check-in berhasil',
    detail: 'Tiket antrean admisi A-031 · tunggu panggilan loket',
    tone: 'info',
  });
  add('pendaftaran', 'sep', {
    id: 'sep',
    title: 'SEP terbit, antrean poli aktif',
    detail: `Nomor antrean ${code} · Poli Penyakit Dalam`,
    tone: 'info',
  });
  add('pemeriksaan-dokter', 'panggil', {
    id: 'dipanggil',
    title: 'Giliran Anda dipanggil',
    detail: `${code} · silakan masuk ke ruang periksa`,
    tone: 'warning',
  });
  add('laboratorium', 'validasi', {
    id: 'lab',
    title: 'Hasil lab sudah tersedia',
    detail: `${rec.hasil.length} pemeriksaan · sudah divalidasi dokter`,
    tone: 'brand',
  });
  add('farmasi', 'serah', {
    id: 'obat',
    title: 'Obat diserahkan',
    detail: `${rec.obat.length} obat · pengingat minum aktif`,
    tone: 'success',
  });
  add('kasir', 'tutup', {
    id: 'kasir',
    title: 'Administrasi selesai',
    detail: `Dijamin BPJS · biaya pasien ${formatRupiah(rec.bayarPasien ?? 0n)}`,
    tone: 'success',
  });
  add('pasca', 'notif', {
    id: 'resume',
    title: 'Resume kunjungan terkirim',
    detail: 'Resume, hasil lab, dan pengingat obat',
    tone: 'info',
  });
  add('pasca', 'kontrol', {
    id: 'kontrol',
    title: 'Jadwal kontrol dibuat',
    detail: rec.kontrol || 'Kontrol berikutnya',
    tone: 'brand',
  });
  return items.reverse();
}

/** Nomor loket yang sedang dilayani saat Tn. Suryo menunggu (tiket A-028–A-030 di depannya). */
const SERVING = { admisi: 'A-028', admisiAhead: 3 } as const;

/** Poli PD saat Tn. Suryo menunggu: nomor dilayani dan pasien di depannya, dari papan antrean (roster hari demo). */
function poliServing(): { serving: string | null; ahead: number } {
  const pd = demoQueueBoard({ ...NO_PROGRESS, sep: true }).clinics.find((c) => c.poliCode === 'PD');
  return {
    serving: pd?.current ?? null,
    ahead: Math.max(0, pd?.waiting.indexOf(SCENARIO_RJ.poliQueue) ?? 0),
  };
}

function poliMessage(R: RunResult): string {
  switch (activeStep(R)) {
    case 'asesmen-perawat':
      return 'Asesmen awal oleh perawat poli (tensi dan gula darah).';
    case 'pemeriksaan-dokter':
      return taskDone(R, 'pemeriksaan-dokter', 'panggil')
        ? `Sedang diperiksa ${STAF.dpjpPenyakitDalam}.`
        : 'Menunggu panggilan dokter di ruang tunggu poli.';
    case 'laboratorium':
      return taskDone(R, 'laboratorium', 'validasi')
        ? 'Hasil lab sudah keluar. Kembali ke ruang tunggu poli.'
        : 'Pengambilan sampel darah di laboratorium lantai 1.';
    case 'resep':
      return 'Dokter menyusun resep dan rencana terapi.';
    case 'farmasi':
      return taskDone(R, 'farmasi', 'serah')
        ? 'Obat sudah diterima. Silakan ke kasir.'
        : 'Obat sedang disiapkan di instalasi farmasi.';
    case 'kasir':
      return 'Silakan ke kasir untuk menyelesaikan administrasi.';
    default:
      return 'Menunggu panggilan perawat poli. Kami kirim notifikasi saat tersisa 3 pasien.';
  }
}

/** I07 · Beranda aplikasi Tn. Suryo menurut kemajuan skenario rawat jalan. */
export function patientAppHome(R: RunResult): PatientAppHome {
  const p = patientByScenario('rawat-jalan');
  if (!p) throw new Error('Pasien skenario rawat jalan tidak ada di fixture');
  const rec = R.rec;
  const pd = poliByCode('PD');
  const poliName = `Poli ${pd?.name ?? 'Penyakit Dalam'}`;
  const room = pd ? `${poliName} · lantai ${pd.lantai}, ${pd.room}` : poliName;
  const day = 'Senin 5 Okt';
  const code = queueCode(rec.antrean);
  const done = (s: string, t: string) => taskDone(R, s, t);

  let queue: PatientAppHome['queue'];
  if (!done('kedatangan', 'tiket')) {
    queue = {
      stage: 'booking',
      title: `${poliName} · ${day}`,
      numberLabel: 'Kode booking',
      number: SURYO_BOOKING,
      serving: null,
      ahead: null,
      location: 'Anjungan pendaftaran · lantai 1',
      message: done('kedatangan', 'scan')
        ? 'Kode booking terbaca. Lanjutkan verifikasi biometrik dan ambil tiket.'
        : `Pindai kode ini di anjungan untuk check-in. ${STAF.dpjpPenyakitDalam} praktik mulai 07.30.`,
    };
  } else if (!done('pendaftaran', 'sep')) {
    const called = done('pendaftaran', 'panggil');
    queue = {
      stage: 'admisi',
      title: `Loket pendaftaran · ${day}`,
      numberLabel: 'Nomor antrean admisi',
      number: code,
      serving: called ? code : SERVING.admisi,
      ahead: called ? 0 : SERVING.admisiAhead,
      location: 'Loket pendaftaran · lantai 1',
      message: called
        ? 'Anda sedang dilayani di loket pendaftaran.'
        : 'Menunggu panggilan loket untuk verifikasi BPJS.',
    };
  } else if (!(R.finished || done('kasir', 'tutup'))) {
    const called = done('pemeriksaan-dokter', 'panggil');
    queue = {
      stage: 'poli',
      title: `${poliName} · ${day}`,
      numberLabel: 'Nomor antrean Anda',
      number: code,
      serving: called ? code : poliServing().serving,
      ahead: called ? 0 : poliServing().ahead,
      location: room,
      message: poliMessage(R),
    };
  } else {
    queue = {
      stage: 'pulang',
      title: `Kunjungan selesai · ${day}`,
      numberLabel: 'Nomor antrean',
      number: code,
      serving: null,
      ahead: null,
      location: room,
      message: rec.kontrol
        ? `Kontrol berikutnya: ${rec.kontrol.split(' · ').at(-1) ?? rec.kontrol}.`
        : 'Terima kasih. Resume dan pengingat obat tersedia di aplikasi.',
    };
  }

  const validated = done('laboratorium', 'validasi');
  const labStatus = validated
    ? `Dirilis ${taskTime(R, 'laboratorium', 'validasi')} · divalidasi ${STAF.dokterPatologiKlinik}`
    : done('laboratorium', 'hasil')
      ? 'Hasil sedang divalidasi dokter patologi klinik. Tampil di sini setelah dirilis.'
      : done('laboratorium', 'sampling')
        ? 'Sampel sedang diperiksa di laboratorium.'
        : done('pemeriksaan-dokter', 'order')
          ? 'Dokter meminta pemeriksaan lab. Hasil tampil setelah divalidasi.'
          : 'Belum ada hasil lab untuk kunjungan hari ini.';

  const handed = done('farmasi', 'serah');
  const medicinesStatus = handed
    ? `Diserahkan ${taskTime(R, 'farmasi', 'serah')} · pengingat minum aktif`
    : done('resep', 'tte')
      ? 'Resep sudah di farmasi, obat sedang disiapkan.'
      : 'Belum ada resep untuk kunjungan hari ini.';

  const [kontrolLabel = '', kontrolDate = ''] = rec.kontrol.split(' · ');
  return {
    greeting: `Pak ${p.nama.replace(/^Tn\.\s*/, '').split(' ')[0] ?? p.nama}`,
    initials: rec.initials,
    fullName: p.nama,
    rm: p.rm,
    payer: p.kelas ? `${p.penjamin} · ${p.kelas}` : p.penjamin,
    queue,
    labResults: validated ? rec.hasil.map(labRow) : [],
    labStatus,
    medicines: handed ? rec.obat.map(medicineRow) : [],
    medicinesStatus,
    controlVisit:
      done('pasca', 'kontrol') && rec.kontrol
        ? { label: kontrolLabel, date: kontrolDate || kontrolLabel }
        : null,
    feed: patientFeed(R),
    glucose: SURYO_GLUCOSE,
    glucoseTarget: { ...GLUCOSE_TARGET },
  };
}

// ─── I08 · Aplikasi dokter ──────────────────────────────────────────────────────────────────────────────────

const stepReached = (R: RunResult, stepId: string) => R.finished || R.step >= stepIndex(R, stepId);

/** Lokasi Tn. Hartono saat nilai kritis keluar (langkah asesmen dokter IGD). */
const CRITICAL_LOCATION = 'IGD · bed resusitasi 2';
/** Isi pratinjau lokal (skenario belum disentuh; mockup AppDokter). Skenario berjalan memakai rekam medisnya. */
const LOCAL_RESULT_AT = '10.39';
const LOCAL_ECG = 'Irama sinus, gelombang T tinggi runcing';
const LOCAL_TTV = '158/94 · 112 · 24 · 94%';

/**
 * Tn. Hartono masuk daftar konsulen saat asesmen dokter IGD dimulai (atau di pratinjau lokal); sebelum itu
 * aplikasi tidak boleh mendahului cerita IGD.
 */
export function hartonoListed(R: RunResult): boolean {
  return scenarioUntouched(R) || stepReached(R, 'asesmen-dokter');
}

/** Order lab Tn. Hartono sudah dikirim (`asesmen-dokter.orderset`)? Pratinjau lokal: hasil sudah keluar. */
export function hartonoLabOrdered(R: RunResult): boolean {
  return scenarioUntouched(R) || taskDone(R, 'asesmen-dokter', 'orderset');
}

/** Hasil lab (kalium kritis) sudah keluar (`nilai-kritis.hasil`)? */
const resultOut = (R: RunResult) => scenarioUntouched(R) || taskDone(R, 'nilai-kritis', 'hasil');

/** Temuan EKG: baru ada setelah `asesmen-dokter.ekg` (teks dari rekam medis skenario). */
export function hartonoEcg(R: RunResult): string {
  if (scenarioUntouched(R)) return LOCAL_ECG;
  if (!taskDone(R, 'asesmen-dokter', 'ekg')) return 'Belum direkam';
  const text = R.rec.hasil
    .find((h) => h.startsWith('EKG:'))
    ?.slice('EKG:'.length)
    .trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : 'Tersimpan di RME';
}

/**
 * Status nilai kritis kalium Tn. Hartono (skenario IGD → rawat inap, langkah `nilai-kritis`):
 * - tugas `readback` sedang giliran → tombol aplikasi menjalankan tugas skenario itu;
 * - skenario belum disentuh → simulasi lokal di layar ini (pratinjau mandiri);
 * - selain itu tampil sesuai kemajuan (menunggu hasil/laporan, atau sudah diterima).
 */
export function criticalValue(R: RunResult): DoctorAppInbox['critical'] {
  const p = patientByScenario('igd-ranap');
  if (!p) throw new Error('Pasien skenario IGD tidak ada di fixture');
  const ks = stepIndex(R, 'nilai-kritis');
  const hasil = taskDone(R, 'nilai-kritis', 'hasil');
  const readback = taskDone(R, 'nilai-kritis', 'readback');
  const open = !R.finished && R.step === ks ? firstOpenTask(R, ks) : null;
  const untouched = scenarioUntouched(R);
  let state: CriticalValueState = 'menunggu-hasil';
  if (readback) state = 'diterima';
  else if (open?.id === 'readback' || untouched) state = 'perlu-readback';
  else if (hasil) state = 'menunggu-laporan';
  const lapor = taskValue(R, 'nilai-kritis', 'lapor');
  return {
    state,
    mode: untouched ? 'lokal' : 'skenario',
    stepIndex: open?.id === 'readback' ? ks : null,
    patientName: p.nama,
    rm: p.rm,
    location: CRITICAL_LOCATION,
    analyte: 'Kalium',
    loinc: '2823-3',
    // Nilai baru ada setelah hasil keluar; sebelumnya tidak dikirim ke aplikasi sama sekali.
    value: hasil || untouched ? '6,8' : '—',
    unit: 'mmol/L',
    reportedBy: PERSONA.analisLab,
    reportedTo: typeof lapor === 'string' ? lapor : null,
    resultAt: hasil ? taskTime(R, 'nilai-kritis', 'hasil') : untouched ? LOCAL_RESULT_AT : null,
    acceptedAt: readback ? taskTime(R, 'nilai-kritis', 'readback') : null,
    ecg: hartonoEcg(R),
  };
}

/** Catatan baris Tn. Hartono di daftar pasien, mengikuti kemajuan order → hasil → read-back. */
function hartonoNote(R: RunResult, critical: DoctorAppInbox['critical']): string {
  if (!hartonoLabOrdered(R)) return 'Suspek SKA · belum ada order lab';
  switch (critical.state) {
    case 'menunggu-hasil':
      return 'Suspek SKA · menunggu hasil lab';
    case 'diterima':
      return `Suspek SKA, K ${critical.value} · read-back ${critical.acceptedAt ?? ''}`.trim();
    default:
      return `Suspek SKA, K ${critical.value} · nilai kritis belum diterima`;
  }
}

/**
 * I08 · Kotak masuk aplikasi dokter konsulen penyakit dalam. Tn. Hartono, EKG, diagnosis, dan tanda vital
 * mengikuti milestone skenario IGD (tidak mendahului cerita); pratinjau lokal memakai isi mockup.
 */
export function doctorAppInbox(R: RunResult): DoctorAppInbox {
  const p = patientByScenario('igd-ranap');
  if (!p) throw new Error('Pasien skenario IGD tidak ada di fixture');
  const rec = R.rec;
  const critical = criticalValue(R);
  const untouched = scenarioUntouched(R);
  const diagnosis =
    rec.dx.length > 0
      ? rec.dx.join(' · ')
      : resultOut(R)
        ? 'Suspek sindrom koroner akut · hiperkalemia'
        : 'Suspek sindrom koroner akut';
  const hartono: DoctorAppInbox['patients'] = hartonoListed(R)
    ? [
        {
          id: DOCTOR_APP_PATIENT_ID.hartono,
          name: p.nama,
          age: p.umur,
          rm: p.rm,
          location: untouched ? CRITICAL_LOCATION : rec.lokasi,
          note: hartonoNote(R, critical),
          ews: 6,
          level: 'tinggi',
          hospitalDay: stepReached(R, 'rawat-inap') ? 'H1' : 'H0',
          details: [
            { label: 'Diagnosis kerja', value: diagnosis },
            { label: 'EKG', value: critical.ecg },
            {
              label: 'Tanda vital (TD · N · RR · SpO2)',
              value: rec.ttv || (untouched ? LOCAL_TTV : 'Belum diukur'),
            },
            { label: 'Riwayat', value: p.riwayat },
          ],
        },
      ]
    : [];
  const others = DOCTOR_PATIENTS.map(({ patientId, ...row }) => {
    const pt = patientById(patientId);
    if (!pt) throw new Error(`Pasien ${patientId} tidak ada di fixture`);
    return { ...row, name: pt.nama, age: pt.umur, rm: pt.rm };
  });
  return {
    doctorName: PERSONA.dokter,
    doctorRole: 'KSM Penyakit Dalam · jaga konsulen',
    critical,
    orderVerifyCount: 2,
    coderQueryCount: 1,
    patients: [...hartono, ...others],
    cosign: COSIGN_NOTES.map((c) => ({ ...c })),
    schedule: DOCTOR_SCHEDULE.map((s) => ({ ...s })),
  };
}
