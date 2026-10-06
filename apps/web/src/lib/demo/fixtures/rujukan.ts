import type { DemoReferral } from '../../rujukan';
import { PATIENT_ID } from './ids';
import { PASIEN } from './pasien';
import { STAF } from './staf';

/**
 * FE1 · F07 rujukan fiktif hari demo (Sen, 5 Okt 2026). Nomor BPJS berawalan PPK RS fiktif `0301R001` atau PPK FKTP
 * fiktif `0301U0xx`; faskes lain dibuat-buat. Diagnosis hanya kode `SEED_REF_SAMPLES` (dijaga tes).
 */

function who(id: string): Pick<DemoReferral, 'patientId' | 'patientName' | 'rm'> {
  const p = PASIEN.find((x) => x.id === id);
  if (!p) throw new Error(`Pasien rujukan ${id} tidak ada`);
  return { patientId: p.id, patientName: p.nama, rm: p.rm };
}

const NONE = { status: 'not_required', sentAt: null, error: null } as const;

export const DEMO_REFERRALS: readonly DemoReferral[] = [
  {
    id: 'rjk-0412',
    kind: 'rujukan-fktp',
    status: 'used',
    number: '0301U0271025P000412',
    ...who(PATIENT_ID.darmawan),
    facility: 'Puskesmas Kecamatan Contoh Barat',
    target: 'Poli Penyakit Dalam',
    diagnosis: { code: 'M10.9', display: 'Gout, tidak spesifik' },
    issuedOn: '2026-09-21',
    validUntil: '2026-12-20',
    plannedDate: null,
    practitioner: null,
    note: 'Kunjungan ke-2 dari rujukan ini · dipakai SEP pagi ini',
    sync: NONE,
  },
  {
    id: 'rjk-0388',
    kind: 'rujukan-fktp',
    status: 'active',
    number: '0301U0141025P000388',
    ...who(PATIENT_ID.maria),
    facility: 'Klinik Pratama Contoh Sejahtera',
    target: 'Poli Penyakit Dalam',
    diagnosis: { code: 'E11.9', display: 'Diabetes melitus tipe 2 tanpa komplikasi' },
    issuedOn: '2026-07-10',
    validUntil: '2026-10-08',
    plannedDate: null,
    practitioner: null,
    note: 'Masa berlaku hampir habis; kontrol berikutnya perlu rujukan baru atau surat kontrol.',
    sync: NONE,
  },
  {
    id: 'skt-0045',
    kind: 'surat-kontrol',
    status: 'pending',
    number: null,
    ...who(PATIENT_ID.endang),
    facility: 'Bangsal Melati (pulang hari ini)',
    target: 'Poli Penyakit Dalam',
    diagnosis: { code: 'J18.9', display: 'Pneumonia, tidak spesifik' },
    issuedOn: '2026-10-05',
    validUntil: null,
    plannedDate: '2026-10-12',
    practitioner: STAF.dpjpPenyakitDalam,
    note: 'Kontrol 1 minggu pasca rawat inap, bawa hasil foto toraks.',
    sync: { status: 'pending', sentAt: null, error: null },
    simOutcome: { result: 'issued', number: '0301R0011025K000045' },
  },
  {
    id: 'spri-0019',
    kind: 'spri',
    status: 'pending',
    number: null,
    ...who(PATIENT_ID.yusuf),
    facility: 'Poli Penyakit Dalam',
    target: 'Bangsal Mawar',
    diagnosis: { code: 'N18.5', display: 'Penyakit ginjal kronik stadium 5' },
    issuedOn: '2026-10-05',
    validUntil: null,
    plannedDate: '2026-10-04',
    practitioner: STAF.dpjpPenyakitDalam,
    note: 'Rawat inap untuk inisiasi hemodialisis.',
    sync: {
      status: 'rejected',
      sentAt: null,
      error: { code: 'BPJS_TANGGAL_TIDAK_VALID', message: 'Tanggal tidak valid' },
    },
  },
  {
    id: 'rk-0007',
    kind: 'rujukan-keluar',
    status: 'pending',
    number: null,
    ...who(PATIENT_ID.sutan),
    facility: 'RS Jantung Contoh Nusantara (PPK 0302R009)',
    target: null,
    diagnosis: { code: 'I21.4', display: 'Infark miokard akut non-ST elevasi' },
    issuedOn: '2026-10-05',
    validUntil: null,
    plannedDate: '2026-10-05',
    practitioner: STAF.dpjpJantung,
    note: 'Rujukan penuh rawat inap untuk angiografi koroner; fasilitas kateterisasi tidak tersedia.',
    sync: {
      status: 'dead',
      sentAt: null,
      error: {
        code: 'BPJS_UNAVAILABLE',
        message: 'VClaim tidak menjawab setelah 5× coba ulang; pesan di DLQ.',
      },
    },
  },
  {
    id: 'int-0031',
    kind: 'rujukan-internal',
    status: 'active',
    number: 'RI-261005-0031',
    ...who(PATIENT_ID.lestiani),
    facility: 'Poli Penyakit Dalam',
    target: 'Poli Jantung',
    diagnosis: { code: 'I10', display: 'Hipertensi esensial (primer)' },
    issuedOn: '2026-10-05',
    validUntil: null,
    plannedDate: '2026-10-05',
    practitioner: STAF.dpjpJantung,
    note: 'Konsul evaluasi jantung sebelum penyesuaian obat antihipertensi.',
    sync: NONE,
  },
];
