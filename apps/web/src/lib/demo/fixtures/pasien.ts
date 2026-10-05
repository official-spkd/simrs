import type { PoliQueueItem } from '@simrs/shared';
import type { ScenarioId } from '../engine/types';
import { CONSENT_ID, ENCOUNTER_ID, PATIENT_ID } from './ids';

/**
 * Pasien fiktif bersama untuk SEMUA layar mode presentasi (ADR-0023). Mockup memakai nomor RM/umur yang saling
 * bertentangan; di sini satu identitas baku per pasien. NIK hanya ditampilkan tersamar dengan awalan fiktif 9999,
 * nomor BPJS berawalan 0000, telepon 0812-0000-xxxx. Tiga pasien pertama adalah pasien skenario Simulasi.
 */
export interface DemoPatient {
  id: string;
  rm: string;
  nama: string;
  jk: 'L' | 'P';
  /** ISO `YYYY-MM-DD`. */
  tanggalLahir: string;
  /** Umur (tahun) per hari demo 5 Okt 2026. */
  umur: number;
  nikMasked: string;
  bpjsMasked: string | null;
  penjamin: 'BPJS' | 'Umum' | 'Asuransi';
  /** Hak kelas BPJS / kelas asuransi. */
  kelas: 'Kelas 1' | 'Kelas 2' | 'Kelas 3' | null;
  /** Kosong = tidak ada alergi tercatat. */
  alergi: readonly string[];
  telepon: string;
  alamat: string;
  /** Riwayat penting ringkas untuk banner/ringkasan. */
  riwayat: string;
  /** Pasien skenario Simulasi (keadaannya mengikuti mesin skenario). */
  scenario?: ScenarioId;
}

export const PASIEN: readonly DemoPatient[] = [
  {
    id: PATIENT_ID.suryo,
    rm: '00-28-44-17',
    nama: 'Tn. Suryo Adi Nugroho',
    jk: 'L',
    tanggalLahir: '1972-06-18',
    umur: 54,
    nikMasked: '9999••••••••0617',
    bpjsMasked: '0000281•••417',
    penjamin: 'BPJS',
    kelas: 'Kelas 2',
    alergi: [],
    telepon: '0812-0000-2844',
    alamat: 'Jl. Melati Raya 8, Jakarta Pusat',
    riwayat: 'DM tipe 2 sejak 2018 · hipoglikemia berat 2025',
    scenario: 'rawat-jalan',
  },
  {
    id: PATIENT_ID.hartono,
    rm: '00-61-30-05',
    nama: 'Tn. Hartono Wibisono',
    jk: 'L',
    tanggalLahir: '1965-04-12',
    umur: 61,
    nikMasked: '9999••••••••0412',
    bpjsMasked: '0000613•••005',
    penjamin: 'BPJS',
    kelas: 'Kelas 1',
    alergi: [],
    telepon: '0812-0000-6130',
    alamat: 'Jl. Cempaka Putih 21, Jakarta Pusat',
    riwayat: 'Hipertensi · CKD st. 3 · obat rutin amlodipin, omeprazol',
    scenario: 'igd-ranap',
  },
  {
    id: PATIENT_ID.ratna,
    rm: '00-52-03-19',
    nama: 'Ny. Ratna Sari',
    jk: 'P',
    tanggalLahir: '1981-02-20',
    umur: 45,
    nikMasked: '9999••••••••0220',
    bpjsMasked: '0000520•••319',
    penjamin: 'BPJS',
    kelas: 'Kelas 2',
    alergi: [],
    telepon: '0812-0000-5203',
    alamat: 'Jl. Kenari 3, Jakarta Pusat',
    riwayat: 'Kolelitiasis simptomatik · rencana laparoskopi elektif',
    scenario: 'elektif-btn',
  },
  {
    id: PATIENT_ID.siti,
    rm: '00-12-45-78',
    nama: 'Siti Rahmawati',
    jk: 'P',
    tanggalLahir: '1972-03-14',
    umur: 54,
    nikMasked: '9999••••••••4521',
    bpjsMasked: '0000123•••890',
    penjamin: 'BPJS',
    kelas: 'Kelas 2',
    alergi: [],
    telepon: '0812-0000-4567',
    alamat: 'Jl. Kenanga 12, Jakarta Timur',
    riwayat: 'Hipertensi esensial · kontrol rutin Poli PD',
  },
  {
    id: PATIENT_ID.endang,
    rm: '00-07-61-33',
    nama: 'Ny. Endang Wijaya',
    jk: 'P',
    tanggalLahir: '1965-09-02',
    umur: 61,
    nikMasked: '9999••••••••0902',
    bpjsMasked: '0000076•••133',
    penjamin: 'BPJS',
    kelas: 'Kelas 2',
    alergi: ['Amoksisilin'],
    telepon: '0812-0000-0761',
    alamat: 'Jl. Teratai 5, Jakarta Selatan',
    riwayat: 'Pneumonia komunitas · DM tipe 2',
  },
  {
    id: PATIENT_ID.darmawan,
    rm: '00-19-74-03',
    nama: 'Tn. Darmawan Putra',
    jk: 'L',
    tanggalLahir: '1979-01-25',
    umur: 47,
    nikMasked: '9999••••••••0125',
    bpjsMasked: null,
    penjamin: 'Asuransi',
    kelas: 'Kelas 1',
    alergi: ['Ibuprofen'],
    telepon: '0812-0000-1974',
    alamat: 'Jl. Flamboyan 17, Jakarta Barat',
    riwayat: 'Gout · dispepsia',
  },
  {
    id: PATIENT_ID.lestiani,
    rm: '00-58-02-41',
    nama: 'Ny. Lestiani Hapsari',
    jk: 'P',
    tanggalLahir: '1960-11-08',
    umur: 65,
    nikMasked: '9999••••••••1108',
    bpjsMasked: '0000580•••241',
    penjamin: 'BPJS',
    kelas: 'Kelas 3',
    alergi: [],
    telepon: '0812-0000-5802',
    alamat: 'Jl. Dahlia 9, Bekasi',
    riwayat: 'Infark serebral 2024 · hipertensi',
  },
  {
    id: PATIENT_ID.yusuf,
    rm: '00-27-63-15',
    nama: 'Tn. Yusuf Hidayat',
    jk: 'L',
    tanggalLahir: '1956-05-30',
    umur: 70,
    nikMasked: '9999••••••••0530',
    bpjsMasked: '0000276•••315',
    penjamin: 'BPJS',
    kelas: 'Kelas 1',
    alergi: [],
    telepon: '0812-0000-2763',
    alamat: 'Jl. Kamboja 2, Jakarta Timur',
    riwayat: 'CKD st. 5 · hemodialisis rutin',
  },
  {
    id: PATIENT_ID.rizky,
    rm: '00-38-12-09',
    nama: 'Tn. Rizky Ramadhan',
    jk: 'L',
    tanggalLahir: '1997-07-14',
    umur: 29,
    nikMasked: '9999••••••••0714',
    bpjsMasked: '0000381•••209',
    penjamin: 'BPJS',
    kelas: 'Kelas 3',
    alergi: [],
    telepon: '0812-0000-3812',
    alamat: 'Jl. Sawo 11, Depok',
    riwayat: 'Fraktur batang femur (KLL) · pasca ORIF',
  },
  {
    id: PATIENT_ID.maria,
    rm: '00-41-27-88',
    nama: 'Ny. Maria Ulfa',
    jk: 'P',
    tanggalLahir: '1968-03-03',
    umur: 58,
    nikMasked: '9999••••••••0303',
    bpjsMasked: '0000412•••788',
    penjamin: 'BPJS',
    kelas: 'Kelas 2',
    alergi: [],
    telepon: '0812-0000-4127',
    alamat: 'Jl. Anggrek 4, Jakarta Utara',
    riwayat: 'Neoplasma ganas kolon · siklus kemoterapi',
  },
  {
    id: PATIENT_ID.wulan,
    rm: '00-45-27-90',
    nama: 'Ny. Wulan Sari Dewi',
    jk: 'P',
    tanggalLahir: '1994-08-21',
    umur: 32,
    nikMasked: '9999••••••••0821',
    bpjsMasked: '0000452•••790',
    penjamin: 'BPJS',
    kelas: 'Kelas 2',
    alergi: [],
    telepon: '0812-0000-4527',
    alamat: 'Jl. Seroja 6, Tangerang Selatan',
    riwayat: 'G2P1A0 hamil 39 minggu · riwayat SC',
  },
  {
    id: PATIENT_ID.raka,
    rm: '00-33-18-62',
    nama: 'An. Raka Pratama',
    jk: 'L',
    tanggalLahir: '2019-02-11',
    umur: 7,
    nikMasked: '9999••••••••0211',
    bpjsMasked: '0000331•••862',
    penjamin: 'BPJS',
    kelas: 'Kelas 2',
    alergi: [],
    telepon: '0812-0000-3318',
    alamat: 'Jl. Bougenville 14, Jakarta Selatan',
    riwayat: 'Demam berdarah dengue hari ke-4',
  },
  {
    id: PATIENT_ID.sutan,
    rm: '00-50-11-36',
    nama: 'Tn. Sutan Batubara',
    jk: 'L',
    tanggalLahir: '1974-12-09',
    umur: 51,
    nikMasked: '9999••••••••1209',
    bpjsMasked: '0000501•••136',
    penjamin: 'BPJS',
    kelas: 'Kelas 1',
    alergi: [],
    telepon: '0812-0000-5011',
    alamat: 'Jl. Mangga 22, Jakarta Barat',
    riwayat: 'Angina tidak stabil · hipertensi',
  },
  {
    id: PATIENT_ID.ayu,
    rm: '00-63-40-77',
    nama: 'Ny. Ayu Lestari',
    jk: 'P',
    tanggalLahir: '1986-04-17',
    umur: 40,
    nikMasked: '9999••••••••0417',
    bpjsMasked: null,
    penjamin: 'Umum',
    kelas: null,
    alergi: [],
    telepon: '0812-0000-6340',
    alamat: 'Jl. Pinus 1, Jakarta Selatan',
    riwayat: 'Infeksi saluran napas atas',
  },
  {
    id: PATIENT_ID.hendro,
    rm: '00-17-55-90',
    nama: 'Tn. Hendro Gunawan',
    jk: 'L',
    tanggalLahir: '1963-10-01',
    umur: 63,
    nikMasked: '9999••••••••1001',
    bpjsMasked: '0000175•••590',
    penjamin: 'BPJS',
    kelas: 'Kelas 2',
    alergi: [],
    telepon: '0812-0000-1755',
    alamat: 'Jl. Jati 7, Bogor',
    riwayat: 'Pneumonia · gagal napas akut (ICU)',
  },
  {
    id: PATIENT_ID.aminah,
    rm: '00-22-08-14',
    nama: 'Ny. Siti Aminah',
    jk: 'P',
    tanggalLahir: '1955-06-06',
    umur: 71,
    nikMasked: '9999••••••••0606',
    bpjsMasked: '0000220•••814',
    penjamin: 'BPJS',
    kelas: 'Kelas 3',
    alergi: ['Kotrimoksazol (sulfa)'],
    telepon: '0812-0000-2208',
    alamat: 'Jl. Kelapa 19, Jakarta Timur',
    riwayat: 'Sepsis · syok septik (dirawat ICU)',
  },
  {
    id: PATIENT_ID.nadia,
    rm: '00-71-26-58',
    nama: 'An. Nadia Putri',
    jk: 'P',
    tanggalLahir: '2022-01-30',
    umur: 4,
    nikMasked: '9999••••••••0130',
    bpjsMasked: '0000712•••658',
    penjamin: 'BPJS',
    kelas: 'Kelas 2',
    alergi: [],
    telepon: '0812-0000-7126',
    alamat: 'Jl. Rambutan 3, Jakarta Timur',
    riwayat: 'Demam, tidak spesifik',
  },
  {
    id: PATIENT_ID.fajar,
    rm: '00-36-92-11',
    nama: 'Tn. Fajar Nugraha',
    jk: 'L',
    tanggalLahir: '1991-09-09',
    umur: 35,
    nikMasked: '9999••••••••0909',
    bpjsMasked: null,
    penjamin: 'Asuransi',
    kelas: 'Kelas 1',
    alergi: [],
    telepon: '0812-0000-3692',
    alamat: 'Jl. Cendana 10, Jakarta Selatan',
    riwayat: 'Batu kandung empedu tanpa kolesistitis',
  },
  {
    id: PATIENT_ID.dewi,
    rm: '00-44-73-29',
    nama: 'Ny. Dewi Kurniasih',
    jk: 'P',
    tanggalLahir: '1977-12-24',
    umur: 48,
    nikMasked: '9999••••••••1224',
    bpjsMasked: '0000447•••329',
    penjamin: 'BPJS',
    kelas: 'Kelas 2',
    alergi: [],
    telepon: '0812-0000-4473',
    alamat: 'Jl. Beringin 5, Jakarta Utara',
    riwayat: 'Dispepsia · gastritis kronis',
  },
  {
    id: PATIENT_ID.bonifasius,
    rm: '00-29-85-47',
    nama: 'Tn. Bonifasius Tarigan',
    jk: 'L',
    tanggalLahir: '1969-02-02',
    umur: 57,
    nikMasked: '9999••••••••0202',
    bpjsMasked: '0000298•••547',
    penjamin: 'BPJS',
    kelas: 'Kelas 1',
    alergi: [],
    telepon: '0812-0000-2985',
    alamat: 'Jl. Akasia 8, Jakarta Barat',
    riwayat: 'Infark miokard akut non-ST elevasi (2025)',
  },
  // Pasien tambahan roster hari demo: papan IGD, Poli PD, kasir, farmasi, dan kamar bersalin tidak lagi meminjam
  // pasien dari layar lain.
  {
    id: PATIENT_ID.sumarni,
    rm: '00-66-21-04',
    nama: 'Ny. Sumarni Pakpahan',
    jk: 'P',
    tanggalLahir: '1974-08-11',
    umur: 52,
    nikMasked: '9999••••••••0811',
    bpjsMasked: null,
    penjamin: 'Umum',
    kelas: null,
    alergi: [],
    telepon: '0812-0000-6621',
    alamat: 'Jl. Nangka 15, Jakarta Timur',
    riwayat: 'Kolelitiasis · nyeri perut kanan atas berulang',
  },
  {
    id: PATIENT_ID.joko,
    rm: '00-47-90-12',
    nama: 'Tn. Joko Susilo',
    jk: 'L',
    tanggalLahir: '1980-05-19',
    umur: 46,
    nikMasked: '9999••••••••0519',
    bpjsMasked: '0000479•••012',
    penjamin: 'BPJS',
    kelas: 'Kelas 1',
    alergi: [],
    telepon: '0812-0000-4790',
    alamat: 'Jl. Duku 6, Depok',
    riwayat: 'Fraktur batang femur kanan · ORIF Sep 2026',
  },
  {
    id: PATIENT_ID.fauzi,
    rm: '00-53-18-27',
    nama: 'Tn. Ahmad Fauzi',
    jk: 'L',
    tanggalLahir: '1977-02-03',
    umur: 49,
    nikMasked: '9999••••••••0203',
    bpjsMasked: '0000531•••827',
    penjamin: 'BPJS',
    kelas: 'Kelas 2',
    alergi: [],
    telepon: '0812-0000-5318',
    alamat: 'Jl. Kemuning 21, Jakarta Utara',
    riwayat: 'Dispepsia · perokok aktif',
  },
  {
    id: PATIENT_ID.robert,
    rm: '00-24-66-81',
    nama: 'Tn. Robert Manurung',
    jk: 'L',
    tanggalLahir: '1962-11-27',
    umur: 63,
    nikMasked: '9999••••••••1127',
    bpjsMasked: '0000246•••681',
    penjamin: 'BPJS',
    kelas: 'Kelas 1',
    alergi: [],
    telepon: '0812-0000-2466',
    alamat: 'Jl. Bambu Kuning 2, Jakarta Timur',
    riwayat: 'Gagal jantung · infark miokard lama · rawat ICU 28 Sep – 3 Okt 2026',
  },
  {
    id: PATIENT_ID.gilang,
    rm: '00-69-05-33',
    nama: 'Tn. Gilang Mahendra',
    jk: 'L',
    tanggalLahir: '1996-03-08',
    umur: 30,
    nikMasked: '9999••••••••0308',
    bpjsMasked: null,
    penjamin: 'Umum',
    kelas: null,
    alergi: [],
    telepon: '0812-0000-6905',
    alamat: 'Jl. Kenari Raya 30, Jakarta Pusat',
    riwayat: 'Infeksi saluran napas atas',
  },
  {
    id: PATIENT_ID.wahyuni,
    rm: '00-31-57-46',
    nama: 'Ny. Sri Wahyuni',
    jk: 'P',
    tanggalLahir: '1969-07-22',
    umur: 57,
    nikMasked: '9999••••••••0722',
    bpjsMasked: '0000315•••746',
    penjamin: 'BPJS',
    kelas: 'Kelas 2',
    alergi: [],
    telepon: '0812-0000-3157',
    alamat: 'Jl. Delima 8, Jakarta Timur',
    riwayat: 'Hipertensi esensial · dislipidemia · peserta PRB',
  },
  {
    id: PATIENT_ID.rohana,
    rm: '00-14-82-59',
    nama: 'Ny. Rohana Siregar',
    jk: 'P',
    tanggalLahir: '1966-01-15',
    umur: 60,
    nikMasked: '9999••••••••0115',
    bpjsMasked: '0000148•••259',
    penjamin: 'BPJS',
    kelas: 'Kelas 2',
    alergi: ['Amoksisilin'],
    telepon: '0812-0000-1482',
    alamat: 'Jl. Matraman Dalam 4, Jakarta Timur',
    riwayat: 'Pneumonia komunitas (rawat inap Sep 2026) · DM tipe 2',
  },
  {
    id: PATIENT_ID.sugeng,
    rm: '00-59-34-70',
    nama: 'Tn. Sugeng Riyadi',
    jk: 'L',
    tanggalLahir: '1964-04-05',
    umur: 62,
    nikMasked: '9999••••••••0405',
    bpjsMasked: '0000593•••470',
    penjamin: 'BPJS',
    kelas: 'Kelas 3',
    alergi: [],
    telepon: '0812-0000-5934',
    alamat: 'Jl. Pala 12, Bekasi',
    riwayat: 'Infark serebral lama · hipertensi · nyeri pinggang (curiga HNP)',
  },
  {
    id: PATIENT_ID.fransiska,
    rm: '00-72-13-95',
    nama: 'Ny. Fransiska Lumbantobing',
    jk: 'P',
    tanggalLahir: '1978-09-30',
    umur: 48,
    nikMasked: '9999••••••••0930',
    bpjsMasked: null,
    penjamin: 'Asuransi',
    kelas: 'Kelas 1',
    alergi: [],
    telepon: '0812-0000-7213',
    alamat: 'Jl. Cikini Raya 40, Jakarta Pusat',
    riwayat: 'Hiperurisemia · obesitas',
  },
  {
    id: PATIENT_ID.anisa,
    rm: '00-80-42-16',
    nama: 'Ny. Anisa Rahmadani',
    jk: 'P',
    tanggalLahir: '1999-06-12',
    umur: 27,
    nikMasked: '9999••••••••0612',
    bpjsMasked: '0000804•••216',
    penjamin: 'BPJS',
    kelas: 'Kelas 3',
    alergi: [],
    telepon: '0812-0000-8042',
    alamat: 'Jl. Sukun 9, Tangerang',
    riwayat: 'G1P0A0 hamil 38 minggu · gawat janin',
  },
  {
    id: PATIENT_ID.lukman,
    rm: '00-35-61-88',
    nama: 'Tn. Lukman Hakim',
    jk: 'L',
    tanggalLahir: '1975-12-02',
    umur: 50,
    nikMasked: '9999••••••••1202',
    bpjsMasked: '0000356•••188',
    penjamin: 'BPJS',
    kelas: 'Kelas 2',
    alergi: [],
    telepon: '0812-0000-3561',
    alamat: 'Jl. Salak 3, Jakarta Selatan',
    riwayat: 'DM tipe 2 · kontrol rutin Poli PD',
  },
];

export function patientById(id: string): DemoPatient | undefined {
  return PASIEN.find((p) => p.id === id);
}

export function patientByScenario(id: ScenarioId): DemoPatient | undefined {
  return PASIEN.find((p) => p.scenario === id);
}

type PatientKey = keyof typeof PATIENT_ID;
const KEY_OF_PATIENT = new Map(
  (Object.keys(PATIENT_ID) as PatientKey[]).map((k) => [PATIENT_ID[k] as string, k]),
);

function keyOf(patientId: string): PatientKey {
  const k = KEY_OF_PATIENT.get(patientId);
  if (!k) throw new Error(`Pasien ${patientId} tidak ada di PATIENT_ID`);
  return k;
}

/**
 * Id kunjungan aktif pasien di hari demo (opak, `ENCOUNTER_ID`), dipakai di rute berparameter agar tautan antar-layar
 * konsisten: `/klinis/order/<id>`, `/klinis/rawat-inap/<id>`, `/klinis/resume/<id>`.
 */
export function encounterIdOf(patientId: string): string {
  return ENCOUNTER_ID[keyOf(patientId)];
}

export function patientByEncounterId(encounterId: string): DemoPatient | undefined {
  return PASIEN.find((p) => encounterIdOf(p.id) === encounterId);
}

/** Id dokumen persetujuan tindakan di tablet (opak, `CONSENT_ID`): `/tablet/persetujuan/<id>`. */
export function consentIdOf(patientId: string): string {
  return CONSENT_ID[keyOf(patientId)];
}

// ---------------------------------------------------------------------------------------------------------------
// Roster hari demo: Sen, 5 Okt 2026 · 10.45 (`DEMO_NOW`)
// ---------------------------------------------------------------------------------------------------------------

/** Tempat fisik pasien pada jam demo. */
export type Lokasi =
  | { di: 'skenario' }
  | { di: 'pendaftaran' }
  | { di: 'poli'; poli: string }
  | { di: 'igd'; bed: string }
  | { di: 'ranap'; bed: string }
  | { di: 'kamar-bersalin' }
  | { di: 'kamar-operasi'; kamar: string }
  | { di: 'radiologi'; ruang: string }
  | { di: 'kasir'; antrean: string }
  | { di: 'farmasi' };

/** Kunci banding lokasi: `igd:B5`, `ranap:M-203`, `farmasi`. */
export function lokasiKey(l: Lokasi): string {
  switch (l.di) {
    case 'poli':
      return `poli:${l.poli}`;
    case 'igd':
    case 'ranap':
      return `${l.di}:${l.bed}`;
    case 'kamar-operasi':
      return `kamar-operasi:${l.kamar}`;
    case 'radiologi':
      return `radiologi:${l.ruang}`;
    case 'kasir':
      return `kasir:${l.antrean}`;
    default:
      return l.di;
  }
}

export interface RosterEntry {
  patientId: string;
  /**
   * Tempat pasien pukul 10.45. `skenario` = pasien Simulasi; tempatnya mengikuti mesin skenario (proyeksi), bukan
   * fixture statis.
   */
  lokasi: Lokasi;
  /** Tempat kedua yang sah secara klinis (mis. bed tetap dipegang selama di ruang pulih), wajib beralasan. */
  juga?: ReadonlyArray<{ lokasi: Lokasi; alasan: string }>;
  /** Poli yang dikunjungi atau didaftar hari ini (kode `POLI`): order penunjang dari poli harus cocok. */
  poliHariIni?: readonly string[];
  /** Cerita ringkas hari demo (untuk pembawa presentasi dan peninjau). */
  cerita: string;
}

/**
 * Roster baku hari demo: setiap pasien `PASIEN` punya tepat satu tempat pukul 10.45, kecuali tempat kedua yang sah
 * secara klinis (`juga`). Fixture per layar (IGD, poli, papan TV, bed, rawat inap, OK, kasir, lab, farmasi,
 * radiologi) harus cocok dengan daftar ini; dijaga `fixtures.test.ts`.
 */
export const ROSTER: readonly RosterEntry[] = [
  {
    patientId: PATIENT_ID.suryo,
    lokasi: { di: 'skenario' },
    cerita: 'Skenario rawat jalan: anjungan A-031 → loket 3 → Poli PD PD-027 → lab → farmasi → kasir K-015.',
  },
  {
    patientId: PATIENT_ID.hartono,
    lokasi: { di: 'skenario' },
    cerita: 'Skenario IGD → rawat inap: IGD R2 → ICU 3 / HCU 2 → Anggrek A-12.',
  },
  {
    patientId: PATIENT_ID.ratna,
    lokasi: { di: 'skenario' },
    cerita: 'Skenario elektif TPDI × BTN: admisi → VIP 3 atau Melati M-210 → OK 2 pukul 10.30.',
  },
  {
    patientId: PATIENT_ID.siti,
    lokasi: { di: 'pendaftaran' },
    poliHariIni: ['PD'],
    cerita:
      'Baru datang kontrol hipertensi dengan surat kontrol Poli PD: di anjungan/loket 3, belum terdaftar (tiket A-032, antrean PD-028).',
  },
  {
    patientId: PATIENT_ID.endang,
    lokasi: { di: 'ranap', bed: 'M-203' },
    juga: [
      {
        lokasi: { di: 'kasir', antrean: 'K-007' },
        alasan: 'Keluarga melunasi selisih naik kelas di kasir sebelum pasien pulang',
      },
    ],
    cerita:
      'Pneumonia + DM, Melati M-203 hari ke-5, pulang hari ini: resume menunggu TTE, resep pulang di farmasi, tagihan final (sisa Rp 250.400 lewat QRIS setelah EDC ditolak).',
  },
  {
    patientId: PATIENT_ID.darmawan,
    lokasi: { di: 'poli', poli: 'PD' },
    poliHariIni: ['PD'],
    cerita:
      'Gout + dispepsia, menunggu dipanggil di Poli PD (PD-026); CPOE dengan blok CDS alergi ibuprofen.',
  },
  {
    patientId: PATIENT_ID.lestiani,
    lokasi: { di: 'igd', bed: 'B3' },
    cerita:
      'Kode stroke di IGD B3 sejak 10.10: CT kepala sudah diekspertise, lab tambahan menunggu sampel, minta bed kelas 3.',
  },
  {
    patientId: PATIENT_ID.yusuf,
    lokasi: { di: 'ranap', bed: 'A-15' },
    cerita:
      'CKD st. 5, Anggrek A-15 hari ke-3: kalium kritis 6,4 (10.39) belum dilaporkan; pasang kateter HD di OK 1 pukul 13.00.',
  },
  {
    patientId: PATIENT_ID.rizky,
    lokasi: { di: 'kamar-operasi', kamar: 'OK 4' },
    juga: [
      {
        lokasi: { di: 'ranap', bed: 'K-412' },
        alasan: 'Bed Kenanga tetap milik pasien selama di ruang pulih; kembali ke bed setelah pulih',
      },
    ],
    cerita:
      'Fraktur femur (KLL) masuk 2 Okt; ORIF di OK 4 selesai 10.28, kini di ruang pulih; foto kontrol 11.00.',
  },
  {
    patientId: PATIENT_ID.maria,
    lokasi: { di: 'radiologi', ruang: 'CT 1' },
    poliHariIni: ['PD'],
    cerita:
      'Kemoterapi: lab pra-kemo, kateter vena sentral di OK 1 selesai 09.52, kini CT restaging; kontrol dr. Rahmat 13.00 lalu rawat inap (minta bed kelas 2).',
  },
  {
    patientId: PATIENT_ID.wulan,
    lokasi: { di: 'ranap', bed: 'W-322' },
    cerita:
      'SC elektif pagi ini di OK 3 (bayi lahir 07.52), kini di Mawar W-322; cicilan naik kelas VIP baru diajukan.',
  },
  {
    patientId: PATIENT_ID.raka,
    lokasi: { di: 'ranap', bed: 'W-308' },
    cerita:
      'DBD hari sakit ke-4, Mawar W-308 hari rawat ke-2: lab serial cito, tagihan berjalan, deposit naik kelas lewat VA setelah kartu kredit ditolak.',
  },
  {
    patientId: PATIENT_ID.sutan,
    lokasi: { di: 'ranap', bed: 'VIP 2' },
    cerita:
      'Angina tidak stabil, pindah ke Paviliun VIP 2 setelah deposit naik kelas lunas 09.12; resep ditahan CDS, angiografi 13.00, konsul PD (eGFR 42).',
  },
  {
    patientId: PATIENT_ID.ayu,
    lokasi: { di: 'kasir', antrean: 'K-011' },
    poliHariIni: ['PD'],
    cerita: 'Umum, ISPA: Poli PD PD-022 selesai 09.14, tagihan berjalan menunggu dibayar di kasir K-011.',
  },
  {
    patientId: PATIENT_ID.hendro,
    lokasi: { di: 'ranap', bed: 'ICU 2' },
    cerita:
      'Pneumonia + gagal napas, ICU 2 hari ke-3 (ventilator): foto toraks portabel berlangsung, persetujuan CVC di tablet.',
  },
  {
    patientId: PATIENT_ID.aminah,
    lokasi: { di: 'ranap', bed: 'ICU 7' },
    cerita: 'Syok septik, ICU 7 hari ke-2: resep cito meropenem, kultur darah dalam inkubasi.',
  },
  {
    patientId: PATIENT_ID.nadia,
    lokasi: { di: 'igd', bed: 'B4' },
    cerita:
      'Demam anak, observasi di IGD B4; obat dari depo IGD siap diserahkan. Deposit rawat inap 1 Okt sudah dikembalikan (batal rawat).',
  },
  {
    patientId: PATIENT_ID.fajar,
    lokasi: { di: 'kamar-operasi', kamar: 'OK 2' },
    cerita:
      'Kolesistektomi laparoskopik elektif di OK 2 selesai 09.24, di ruang pulih menunggu bed kelas 1; uang muka VA (webhook gagal), cicilan selisih plafon asuransi.',
  },
  {
    patientId: PATIENT_ID.dewi,
    lokasi: { di: 'poli', poli: 'PD' },
    poliHariIni: ['PD'],
    cerita: 'Dispepsia, Poli PD PD-023: menunggu hasil darah lengkap dan ekspertise USG abdomen.',
  },
  {
    patientId: PATIENT_ID.bonifasius,
    lokasi: { di: 'farmasi' },
    poliHariIni: ['JT'],
    cerita:
      'Pulang rawat angina 3 Okt, kontrol Poli Jantung pagi ini; tagihan lunas, menunggu serah terima obat PRB; refund lab APS diproses.',
  },
  {
    patientId: PATIENT_ID.sumarni,
    lokasi: { di: 'igd', bed: 'B5' },
    cerita:
      'Umum, kolik bilier: di IGD B5 sejak 06.05 menunggu bed kelas 1 (terlambat); USG sudah diekspertise, deposit QRIS (selisih MDR), kolesistektomi 14.00.',
  },
  {
    patientId: PATIENT_ID.joko,
    lokasi: { di: 'igd', bed: 'B6' },
    cerita:
      'Nyeri lutut kanan setelah jatuh, IGD B6. Riwayat ORIF femur Sep 2026 (klaim dispute tarif, cicilan naik kelas VIP).',
  },
  {
    patientId: PATIENT_ID.fauzi,
    lokasi: { di: 'igd', bed: 'B7' },
    cerita: 'Nyeri ulu hati sejak pagi, IGD B7 menunggu dokter (EKG).',
  },
  {
    patientId: PATIENT_ID.robert,
    lokasi: { di: 'igd', bed: 'B8' },
    cerita:
      'Sesak + kaki bengkak, IGD B8 menunggu lab, minta bed jantung kelas 1 telemetri; pulang rawat ICU 3 Okt (dua laporan IKP).',
  },
  {
    patientId: PATIENT_ID.gilang,
    lokasi: { di: 'igd', bed: 'K1' },
    cerita: 'Umum, ISPA fast track di IGD K1: sudah bayar EDC 10.38, siap pulang.',
  },
  {
    patientId: PATIENT_ID.wahyuni,
    lokasi: { di: 'farmasi' },
    poliHariIni: ['PD'],
    cerita:
      'Kontrol hipertensi Poli PD PD-024 selesai 09.40, tagihan lunas 09.55, menunggu obat PRB di farmasi.',
  },
  {
    patientId: PATIENT_ID.rohana,
    lokasi: { di: 'poli', poli: 'PD' },
    poliHariIni: ['PD'],
    cerita:
      'Kontrol pasca rawat pneumonia + DM, sedang diperiksa dr. Andini (PD-025); alergi amoksisilin (blok CDS di CPOE).',
  },
  {
    patientId: PATIENT_ID.sugeng,
    lokasi: { di: 'farmasi' },
    poliHariIni: ['SR'],
    cerita:
      'Kontrol Poli Saraf, tagihan lunas; resep PRB ditelaah, QRIS sitikolin (non-Fornas) kedaluwarsa; MRI lumbosakral 14.00.',
  },
  {
    patientId: PATIENT_ID.fransiska,
    lokasi: { di: 'kasir', antrean: 'K-009' },
    poliHariIni: ['PD'],
    cerita:
      'Asuransi, kontrol hiperurisemia di Poli PD (PD-021); tagihan final (ekses plafon) menunggu dibayar di kasir K-009.',
  },
  {
    patientId: PATIENT_ID.anisa,
    lokasi: { di: 'kamar-bersalin' },
    cerita:
      'Hamil 38 minggu, gawat janin: lab dan resep pra-operasi dari kamar bersalin, SC cito di OK 3 pukul 11.00.',
  },
  {
    patientId: PATIENT_ID.lukman,
    lokasi: { di: 'kasir', antrean: 'K-010' },
    poliHariIni: ['PD'],
    cerita:
      'Kontrol DM di Poli PD (PD-020); tagihan BPJS final menunggu ditutup di kasir K-010, klaim RJ siap.',
  },
];

export function rosterOf(patientId: string): RosterEntry | undefined {
  return ROSTER.find((r) => r.patientId === patientId);
}

/** Satu baris antrean poli. */
export interface AntreanPoli {
  no: string;
  patientId: string;
  status: PoliQueueItem['status'];
  /** Jam dipanggil ke ruang periksa (`07.58`), null bila belum. Urutan panggilan = riwayat papan TV. */
  dipanggil: string | null;
}

/**
 * Antrean Poli Penyakit Dalam dr. Andini (Ruang 2) hari ini: satu sumber nomor dan status untuk layar Pemeriksaan
 * dan papan antrean TV. PD-027 milik Tn. Suryo (skenario; masuk lewat proyeksi setelah SEP terbit).
 */
export const ANTREAN_POLI_PD: readonly AntreanPoli[] = [
  { no: 'PD-020', patientId: PATIENT_ID.lukman, status: 'selesai', dipanggil: '08.40' },
  { no: 'PD-021', patientId: PATIENT_ID.fransiska, status: 'selesai', dipanggil: '08.52' },
  { no: 'PD-022', patientId: PATIENT_ID.ayu, status: 'selesai', dipanggil: '09.04' },
  { no: 'PD-023', patientId: PATIENT_ID.dewi, status: 'menunggu-hasil', dipanggil: '09.16' },
  { no: 'PD-024', patientId: PATIENT_ID.wahyuni, status: 'selesai', dipanggil: '09.26' },
  { no: 'PD-025', patientId: PATIENT_ID.rohana, status: 'diperiksa', dipanggil: '10.31' },
  { no: 'PD-026', patientId: PATIENT_ID.darmawan, status: 'menunggu', dipanggil: null },
];

/** Nomor antrean Poli PD berikutnya untuk pendaftaran baru (sesudah PD-027 milik Tn. Suryo). */
export const NEXT_POLI_PD = 28;
