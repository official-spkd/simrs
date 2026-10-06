import type { CultureCase, PaCase } from '../../penunjang-mikro';
import { DOCTOR_ID, PATIENT_ID } from './ids';
import { at, doctorName, supportPatient } from './penunjang';
import { PERSONA, STAF, STAF_LAIN } from './staf';

/**
 * S02 · Data dummy mikrobiologi dan patologi anatomi (ADR-0023), selaras layar Lab dan Pusat hasil kritis: kultur
 * darah Ny. Siti Aminah (L2610040398) tumbuh batang Gram negatif pukul 08.50 dan sudah dilaporkan sebagai nilai
 * kritis; kultur sputum Ny. Endang (S. pneumoniae, sensitif seftriakson) sudah final; kultur sputum Tn. Hendro
 * menunggu uji kepekaan. PA: kandung empedu Tn. Fajar (kolesistektomi pagi ini) dan biopsi kolon Ny. Maria.
 * Dokter Sp.PA fiktif.
 */

export const DOKTER_PA = 'dr. Hendra Wiguna, Sp.PA';
const ANALIS_MIKRO = STAF_LAIN.analis[0] ?? PERSONA.analisLab;

export function demoCultures(): CultureCase[] {
  return [
    {
      id: 'mk-01',
      labNo: 'L2610040398',
      patient: supportPatient(PATIENT_ID.aminah),
      location: 'ICU/ICCU · ICU 7',
      dpjp: doctorName(DOCTOR_ID.rahmat),
      specimen: 'Kultur darah (2 botol aerob)',
      blood: true,
      takenAt: at('22.10', -1),
      receivedAt: at('22.35', -1),
      growth: { grew: true, at: at('08.40') },
      gram: { result: 'Batang Gram negatif', at: at('08.50'), by: ANALIS_MIKRO },
      organism: null,
      ast: {},
      astAt: null,
      final: null,
      preliminary:
        'Laporan awal 09.02: batang Gram negatif · nilai kritis dilaporkan ke DPJP dengan read-back',
    },
    {
      id: 'mk-02',
      labNo: 'L2610030221',
      patient: supportPatient(PATIENT_ID.hendro),
      location: 'ICU/ICCU · ICU 2',
      dpjp: doctorName(DOCTOR_ID.kartika),
      specimen: 'Kultur aspirat trakea',
      blood: false,
      takenAt: at('07.00', -2),
      receivedAt: at('07.30', -2),
      growth: { grew: true, at: at('08.15', -1) },
      gram: { result: 'Batang Gram negatif', at: at('08.40', -1), by: ANALIS_MIKRO },
      organism: { name: 'Klebsiella pneumoniae', at: at('08.30'), by: ANALIS_MIKRO },
      ast: {},
      astAt: null,
      final: null,
      preliminary: 'Laporan awal 4 Okt 08.40: batang Gram negatif',
    },
    {
      id: 'mk-03',
      labNo: 'L2610040402',
      patient: supportPatient(PATIENT_ID.aminah),
      location: 'ICU/ICCU · ICU 7',
      dpjp: doctorName(DOCTOR_ID.rahmat),
      specimen: 'Kultur urin (kateter)',
      blood: false,
      takenAt: at('22.15', -1),
      receivedAt: at('22.40', -1),
      growth: null,
      gram: null,
      organism: null,
      ast: {},
      astAt: null,
      final: null,
      preliminary: null,
    },
    {
      id: 'mk-04',
      labNo: 'L2610010187',
      patient: supportPatient(PATIENT_ID.endang),
      location: 'Bangsal Melati · M-203',
      dpjp: doctorName(DOCTOR_ID.kartika),
      specimen: 'Kultur sputum',
      blood: false,
      takenAt: at('06.30', -4),
      receivedAt: at('07.05', -4),
      growth: { grew: true, at: at('08.00', -3) },
      gram: { result: 'Diplokokus Gram positif', at: at('08.20', -3), by: ANALIS_MIKRO },
      organism: { name: 'Streptococcus pneumoniae', at: at('09.10', -2), by: ANALIS_MIKRO },
      ast: { Penisilin: 'S', Seftriakson: 'S', Eritromisin: 'R', Levofloksasin: 'S' },
      astAt: at('10.30', -2),
      final: { at: at('11.05', -2), by: STAF.dokterPatologiKlinik },
      preliminary: 'Laporan awal 2 Okt 08.20: diplokokus Gram positif',
    },
  ];
}

export function demoPaCases(): PaCase[] {
  return [
    {
      id: 'pa-01',
      paNo: 'PA-2610-0031',
      patient: supportPatient(PATIENT_ID.fajar),
      location: 'Kamar operasi · OK 2 (kini ruang pulih)',
      dpjp: doctorName(DOCTOR_ID.yohanes),
      specimen: 'Kandung empedu utuh (kolesistektomi laparoskopik)',
      clinical: 'Kolelitiasis simptomatik (ICD-10 K80.2)',
      receivedAt: at('10.05'),
      macro: '',
      micro: '',
      diagnosis: '',
      signed: null,
      addenda: [],
    },
    {
      id: 'pa-02',
      paNo: 'PA-2610-0024',
      patient: supportPatient(PATIENT_ID.maria),
      location: 'Poli Penyakit Dalam (pra-kemoterapi)',
      dpjp: doctorName(DOCTOR_ID.rahmat),
      specimen: 'Biopsi kolon sigmoid (kolonoskopi 1 Okt)',
      clinical: 'Neoplasma ganas kolon (ICD-10 C18.9), evaluasi',
      receivedAt: at('13.20', -4),
      macro:
        'Empat keping jaringan putih kecoklatan, ukuran terbesar 0,4 cm, kenyal. Seluruhnya diproses (1 kaset).',
      micro:
        'Jaringan mukosa kolon dengan kelenjar atipik, inti pleomorfik dan hiperkromatik, mitosis mudah ditemukan, menginfiltrasi lamina propria.',
      diagnosis: '',
      signed: null,
      addenda: [],
    },
  ];
}
