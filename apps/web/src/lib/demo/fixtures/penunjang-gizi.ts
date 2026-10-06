import type { Delivery, DietOrder, MealTime, Menu } from '../../penunjang-gizi';
import { DOCTOR_ID, PATIENT_ID } from './ids';
import { at, doctorName, supportPatient } from './penunjang';

/**
 * S07 · Data dummy gizi (ADR-0023), selaras roster hari demo: pasien rawat inap Melati, Anggrek, Mawar, Paviliun
 * VIP, dan ICU. Ny. Wulan tercatat alergi udang (asesmen gizi) dan menu siang mengandung udang (gerbang alergi);
 * Tn. Sutan puasa untuk angiografi 13.00 (tidak diantar); order diet An. Raka baru diubah DPJP dan belum
 * diverifikasi serta belum diskrining. Ahli gizi fiktif.
 */

export const AHLI_GIZI = 'Rina Oktaviani, S.Gz';

const menu = (name: string, ...ingredients: string[]): Menu => ({ name, ingredients });

export function demoDietOrders(): DietOrder[] {
  return [
    {
      id: 'gz-01',
      patient: supportPatient(PATIENT_ID.endang),
      ward: 'Bangsal Melati',
      bed: 'M-203',
      dpjp: doctorName(DOCTOR_ID.kartika),
      diet: 'Diet DM 1.700 kkal',
      texture: 'biasa',
      route: 'oral',
      notes: 'Pulang hari ini setelah makan siang',
      orderedAt: at('07.10', -4),
      status: 'diverifikasi',
      verifiedBy: AHLI_GIZI,
      npo: null,
      foodAllergies: [],
      screening: { at: at('15.20', -4), by: AHLI_GIZI, score: 1 },
      menus: {
        pagi: menu('Nasi merah, telur dadar, tumis buncis', 'nasi merah', 'telur', 'buncis'),
        siang: menu(
          'Nasi merah, pepes ikan nila, sayur bening bayam, pepaya',
          'nasi merah',
          'ikan nila',
          'bayam',
          'pepaya',
        ),
        sore: menu('Nasi merah, ayam bakar, capcay', 'nasi merah', 'ayam', 'sayuran'),
      },
      substitute: menu('Nasi merah, tahu bacem, sayur bening', 'nasi merah', 'tahu', 'bayam'),
    },
    {
      id: 'gz-02',
      patient: supportPatient(PATIENT_ID.yusuf),
      ward: 'Bangsal Anggrek',
      bed: 'A-15',
      dpjp: doctorName(DOCTOR_ID.sinta),
      diet: 'Diet rendah protein 40 g, rendah kalium',
      texture: 'lunak',
      route: 'oral',
      notes: 'Kalium kritis 6,4 pagi ini: hindari pisang, kentang, tomat',
      orderedAt: at('08.00', -2),
      status: 'diverifikasi',
      verifiedBy: AHLI_GIZI,
      npo: null,
      foodAllergies: [],
      screening: { at: at('14.00', -2), by: AHLI_GIZI, score: 2 },
      menus: {
        pagi: menu('Bubur nasi, telur rebus putih, labu siam', 'nasi', 'putih telur', 'labu siam'),
        siang: menu('Nasi tim, ayam suwir, wortel rebus, apel', 'nasi', 'ayam', 'wortel', 'apel'),
        sore: menu('Nasi tim, ikan kukus, sawi rebus', 'nasi', 'ikan', 'sawi'),
      },
      substitute: menu('Nasi tim, tahu kukus, labu siam', 'nasi', 'tahu', 'labu siam'),
    },
    {
      id: 'gz-03',
      patient: supportPatient(PATIENT_ID.wulan),
      ward: 'Bangsal Mawar',
      bed: 'W-322',
      dpjp: doctorName(DOCTOR_ID.hana),
      diet: 'Diet TKTP nifas 2.300 kkal',
      texture: 'biasa',
      route: 'oral',
      notes: 'Pasca SC pagi ini; menyusui',
      orderedAt: at('08.10'),
      status: 'diverifikasi',
      verifiedBy: AHLI_GIZI,
      npo: null,
      foodAllergies: ['udang'],
      screening: { at: at('09.05'), by: AHLI_GIZI, score: 0 },
      menus: {
        pagi: menu('Bubur sumsum, susu', 'tepung beras', 'santan', 'susu'),
        siang: menu(
          'Nasi, udang balado, sayur asem, tempe goreng, jeruk',
          'nasi',
          'udang',
          'sayuran',
          'tempe',
          'jeruk',
        ),
        sore: menu('Nasi, ayam goreng, sop sayur, semangka', 'nasi', 'ayam', 'sayuran', 'semangka'),
      },
      substitute: menu(
        'Nasi, ayam bumbu kuning, sayur asem, tempe goreng, jeruk',
        'nasi',
        'ayam',
        'sayuran',
        'tempe',
        'jeruk',
      ),
    },
    {
      id: 'gz-04',
      patient: supportPatient(PATIENT_ID.raka),
      ward: 'Bangsal Mawar',
      bed: 'W-308',
      dpjp: doctorName(DOCTOR_ID.nadia),
      diet: 'Diet lunak anak 1.300 kkal',
      texture: 'lunak',
      route: 'oral',
      notes: 'DBD hari sakit ke-4; diubah dari diet biasa (mual)',
      orderedAt: at('10.20'),
      status: 'baru',
      verifiedBy: null,
      npo: null,
      foodAllergies: [],
      screening: null,
      menus: {
        pagi: menu('Bubur ayam', 'nasi', 'ayam'),
        siang: menu('Nasi tim ayam, sup wortel, jus jambu', 'nasi', 'ayam', 'wortel', 'jambu'),
        sore: menu('Bubur ikan, labu kuning', 'nasi', 'ikan', 'labu kuning'),
      },
      substitute: menu('Bubur tahu, sup wortel', 'nasi', 'tahu', 'wortel'),
    },
    {
      id: 'gz-05',
      patient: supportPatient(PATIENT_ID.sutan),
      ward: 'Paviliun VIP',
      bed: 'VIP 2',
      dpjp: doctorName(DOCTOR_ID.bagus),
      diet: 'Diet jantung II rendah garam 1.900 kkal',
      texture: 'biasa',
      route: 'oral',
      notes: 'Puasa sejak 07.00 untuk angiografi koroner 13.00',
      orderedAt: at('16.00', -1),
      status: 'diverifikasi',
      verifiedBy: AHLI_GIZI,
      npo: { reason: 'Persiapan angiografi koroner pukul 13.00', until: 'tindakan selesai' },
      foodAllergies: [],
      screening: { at: at('17.10', -1), by: AHLI_GIZI, score: 0 },
      menus: {
        pagi: menu('(puasa)', '—'),
        siang: menu('Nasi, ikan bakar tanpa garam, sayur bening, melon', 'nasi', 'ikan', 'sayuran', 'melon'),
        sore: menu('Nasi, ayam rebus, tumis labu', 'nasi', 'ayam', 'labu'),
      },
      substitute: menu('Nasi, tahu kukus, sayur bening', 'nasi', 'tahu', 'sayuran'),
    },
    {
      id: 'gz-06',
      patient: supportPatient(PATIENT_ID.hendro),
      ward: 'ICU/ICCU',
      bed: 'ICU 2',
      dpjp: doctorName(DOCTOR_ID.kartika),
      diet: 'Diet cair enteral 1.500 kkal (6 × 250 mL)',
      texture: 'cair',
      route: 'sonde',
      notes: 'Via NGT; cek residu lambung sebelum pemberian',
      orderedAt: at('09.00', -2),
      status: 'diverifikasi',
      verifiedBy: AHLI_GIZI,
      npo: null,
      foodAllergies: [],
      screening: { at: at('11.00', -2), by: AHLI_GIZI, score: 3 },
      menus: {
        pagi: menu('Formula enteral standar 250 mL', 'formula enteral'),
        siang: menu('Formula enteral standar 250 mL', 'formula enteral'),
        sore: menu('Formula enteral standar 250 mL', 'formula enteral'),
      },
      substitute: menu('Formula enteral standar 250 mL', 'formula enteral'),
    },
  ];
}

/** Distribusi makan pagi sudah selesai (dengan sisa makanan); siang baru disiapkan. */
export function demoDeliveries(): Record<string, Delivery> {
  const done = (hhmm: string, leftover: number): Delivery => ({
    status: 'diterima',
    substituted: false,
    overrideReason: null,
    at: at(hhmm),
    leftover,
  });
  return {
    'gz-01|pagi': done('06.42', 25),
    'gz-02|pagi': done('06.45', 50),
    'gz-03|pagi': done('06.50', 0),
    'gz-04|pagi': done('06.52', 75),
    'gz-06|pagi': done('06.35', 0),
  };
}

export const DEFAULT_MEAL: MealTime = 'siang';
