import { DOCTOR_ID } from './ids';
/**
 * Staf fiktif untuk mode presentasi (ADR-0023). Nama dibuat-buat dan tidak merujuk staf RS mana pun; placeholder
 * mockup ("dr. [Nama DPJP]") diganti nama-nama ini agar presentasi terbaca wajar. Nama persona akun presentasi
 * (`PRESENTATION_PERSONAS` di `@simrs/db`) dipakai ulang di sini agar layar dan akun yang login konsisten.
 */
export const STAF = {
  dpjpPenyakitDalam: 'dr. Andini Prameswari, Sp.PD',
  dpjpJantung: 'dr. Bagus Santoso, Sp.JP',
  dpjpBedah: 'dr. Yohanes Kurnia, Sp.B',
  dokterJagaIgd: 'dr. Rina Kusuma',
  dokterPatologiKlinik: 'dr. Maya Lestari, Sp.PK',
} as const;

/** Nama akun presentasi per posisi (sama dengan `PRESENTATION_PERSONAS`, dijaga tes). */
export const PERSONA = {
  petugasPendaftaran: 'Bambang Kurniawan',
  perawat: 'Ns. Maya Sari, S.Kep',
  bidan: 'Bd. Ratih Puspitasari, S.Tr.Keb',
  dokter: 'dr. Andini Prameswari, Sp.PD',
  dokterResiden: 'dr. Rina Kusuma',
  apoteker: 'apt. Dewi Anggraini, S.Farm.',
  analisLab: 'Fitri Handayani, A.Md.AK',
  radiografer: 'Bayu Saputra, A.Md.Rad',
  kasir: 'Hendra Wijaya',
  koder: 'Arif Nugroho, A.Md.RMIK',
  akuntan: 'Yulia Permatasari, S.E., Ak.',
  petugasRm: 'Dian Lestari, A.Md.RMIK',
  direktur: 'dr. Satria Wibisana, MARS',
  auditorMutu: 'Ns. Lina Marlina, M.Kep',
  petugasPrivasi: 'Teguh Prasetyo, S.H.',
} as const;

export interface DemoDoctor {
  id: string;
  nama: string;
  /** Kode poli (`POLI` di `rs.ts`), null untuk dokter non-poli (IGD, patologi klinik, anestesi, radiologi). */
  poli: string | null;
  spesialisasi: string;
}

/** Dokter fiktif. Jadwal, kuota, DPJP, dan tim operasi di semua layar memakai daftar ini. */
export const DOKTER: readonly DemoDoctor[] = [
  { id: DOCTOR_ID.andini, nama: STAF.dpjpPenyakitDalam, poli: 'PD', spesialisasi: 'Penyakit dalam' },
  { id: DOCTOR_ID.rahmat, nama: 'dr. Rahmat Hidayat, Sp.PD', poli: 'PD', spesialisasi: 'Penyakit dalam' },
  {
    id: DOCTOR_ID.sinta,
    nama: 'dr. Sinta Maharani, Sp.PD-KGH',
    poli: 'PD',
    spesialisasi: 'Ginjal hipertensi',
  },
  { id: DOCTOR_ID.bagus, nama: STAF.dpjpJantung, poli: 'JT', spesialisasi: 'Jantung' },
  { id: DOCTOR_ID.melati, nama: 'dr. Melati Kusumawardani, Sp.JP', poli: 'JT', spesialisasi: 'Jantung' },
  { id: DOCTOR_ID.yudha, nama: 'dr. Yudha Pratama, Sp.N', poli: 'SR', spesialisasi: 'Saraf' },
  { id: DOCTOR_ID.kartika, nama: 'dr. Kartika Sari, Sp.P', poli: 'PR', spesialisasi: 'Paru' },
  { id: DOCTOR_ID.nadia, nama: 'dr. Nadia Rahmawati, Sp.A', poli: 'AN', spesialisasi: 'Anak' },
  { id: DOCTOR_ID.yohanes, nama: STAF.dpjpBedah, poli: 'BD', spesialisasi: 'Bedah' },
  {
    id: DOCTOR_ID.hana,
    nama: 'dr. Hana Wijayanti, Sp.OG',
    poli: 'OG',
    spesialisasi: 'Kebidanan dan kandungan',
  },
  { id: DOCTOR_ID.rina, nama: STAF.dokterJagaIgd, poli: null, spesialisasi: 'Dokter jaga IGD' },
  { id: DOCTOR_ID.maya, nama: STAF.dokterPatologiKlinik, poli: null, spesialisasi: 'Patologi klinik' },
  { id: DOCTOR_ID.ferry, nama: 'dr. Ferry Setiawan, Sp.An', poli: null, spesialisasi: 'Anestesi' },
  { id: DOCTOR_ID.arman, nama: 'dr. Arman Siregar, Sp.Rad', poli: null, spesialisasi: 'Radiologi' },
];

/** Perawat/bidan/apoteker fiktif tambahan (selain persona) untuk daftar jaga, CPPT, serah terima. */
export const STAF_LAIN = {
  perawat: [
    'Ns. Yudi Pratama, S.Kep',
    'Ns. Rosa Elvira, S.Kep',
    'Ns. Fikri Ananda, S.Kep',
    'Ns. Galih Saputra, S.Kep',
  ],
  bidan: ['Bd. Wina Kartikasari, S.Tr.Keb'],
  apoteker: ['apt. Rudi Hermawan, S.Farm.'],
  analis: ['Sari Rahmawati, A.Md.AK'],
} as const;

export function doctorById(id: string): DemoDoctor | undefined {
  return DOKTER.find((d) => d.id === id);
}
