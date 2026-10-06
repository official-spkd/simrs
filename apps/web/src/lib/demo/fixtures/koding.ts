import type { BerkasKoding, Bukti, KodeBerkas, SumberKode } from '../../keuangan-koding';
import { ICD9_NAME, ICD10_NAME } from './keuangan';
import { pasienRef } from './keuangan-ref';
import { PERSONA, STAF } from './staf';

/**
 * U06 · Data dummy workbench koder (mode presentasi, ADR-0023). Kode ICD-10/ICD-9-CM hanya dari contoh seed yang sama
 * dengan layar Klaim (`ICD10_NAME`, `ICD9_NAME`); kode di luar daftar itu gagal saat modul dimuat. Pasien fiktif.
 */

function code(
  id: string,
  system: KodeBerkas['system'],
  c: string,
  role: KodeBerkas['role'],
  source: SumberKode,
  sourceNote: string,
  extra: Partial<KodeBerkas> = {},
): KodeBerkas {
  const name = (system === 'ICD-10' ? ICD10_NAME : ICD9_NAME)[c];
  if (!name) throw new Error(`${system} ${c} bukan contoh seed`);
  return {
    id,
    system,
    code: c,
    name,
    role,
    source,
    sourceNote,
    needsEvidence: false,
    evidence: null,
    keepReason: null,
    suggestion: null,
    ...extra,
  };
}

const ev = (id: string, label: string, source: SumberKode): Bukti => ({ id, label, source });

/** Bukti klinis yang tersedia di RME per berkas (pilihan tautan bukti koder). */
export const BUKTI_RME: Readonly<Record<string, readonly Bukti[]>> = {
  'kb-yusuf': [
    ev('b-y1', 'Kreatinin serial 1,1 → 2,4 mg/dL (LIS, 2–3 Okt)', 'lab'),
    ev('b-y2', 'Kultur sputum: S. pneumoniae (LIS, 3 Okt)', 'lab'),
    ev('b-y3', 'Foto toraks: konsolidasi lobus kanan bawah (RIS, 1 Okt)', 'radiologi'),
  ],
  'kb-aminah': [ev('b-a1', 'Laktat 4,8 mmol/L dan MAP 58 mmHg (CPPT ICU, 3 Okt 22.10)', 'cppt')],
  'kb-joko': [
    ev('b-j1', 'Kalium 6,1 mmol/L (LIS, 9 Sep 05.40)', 'lab'),
    ev('b-j2', 'Foto femur: fraktur batang femur kanan (RIS, 8 Sep)', 'radiologi'),
  ],
};

export const BERKAS_KODING: readonly BerkasKoding[] = [
  {
    id: 'kb-yusuf',
    patient: pasienRef('yusuf', 'Anggrek A-15 · pulang 5 Okt', 'BPJS kelas 1'),
    episode: 'Rawat inap 1–5 Okt 2026 · 4 hari',
    dpjp: STAF.dpjpPenyakitDalam,
    status: 'perlu-koding',
    sent: false,
    verifierNote: null,
    query: null,
    versions: [],
    codes: [
      code('y-1', 'ICD-10', 'J18.9', 'utama', 'resume', 'Resume medis ber-TTE 5 Okt 07.50', {
        suggestion: {
          code: 'J13',
          name: ICD10_NAME.J13 ?? 'J13',
          why: 'Kuman penyebab teridentifikasi; kode spesifik lebih tepat dari "tidak spesifik".',
          evidence: ev('b-y2', 'Kultur sputum: S. pneumoniae (LIS, 3 Okt)', 'lab'),
          decided: null,
        },
      }),
      code('y-2', 'ICD-10', 'E11.9', 'sekunder', 'cppt', 'CPPT DPJP 1 Okt (riwayat DM, insulin)'),
      code('y-3', 'ICD-10', 'N17.9', 'sekunder', 'cppt', 'CPPT DPJP 3 Okt ("AKI pre-renal")', {
        needsEvidence: true,
      }),
      code('y-4', 'ICD-9-CM', '89.65', 'prosedur', 'lab', 'Order AGD 1 Okt (LIS)'),
      code('y-5', 'ICD-9-CM', '99.18', 'prosedur', 'cppt', 'eMAR cairan elektrolit 1–3 Okt'),
    ],
  },
  {
    id: 'kb-aminah',
    patient: pasienRef('aminah', 'ICU 7 · pindah bangsal 5 Okt', 'BPJS kelas 3'),
    episode: 'Rawat inap 30 Sep – berjalan · 6 hari (ICU 4 hari)',
    dpjp: 'dr. Sinta Maharani, Sp.PD-KGH',
    status: 'query-dpjp',
    sent: false,
    verifierNote: null,
    versions: [],
    query: {
      question:
        'Mohon konfirmasi diagnosis syok septik (R57.2): CPPT ICU mencatat norepinefrin 2 hari, tetapi resume hanya menulis sepsis. Bila benar, mohon addendum resume.',
      to: 'dr. Sinta Maharani, Sp.PD-KGH',
      askedAt: '2026-10-04T14:20:00+07:00',
      answer: null,
      answeredAt: null,
      confirms: 'R57.2',
    },
    codes: [
      code('a-1', 'ICD-10', 'A41.9', 'utama', 'resume', 'Resume medis (draf) 4 Okt'),
      code('a-2', 'ICD-10', 'R57.2', 'sekunder', 'cppt', 'CPPT ICU 3 Okt 22.10', { needsEvidence: true }),
      code('a-3', 'ICD-10', 'N18.3', 'sekunder', 'resume', 'Resume medis (riwayat PGK)'),
      code('a-4', 'ICD-9-CM', '00.17', 'prosedur', 'cppt', 'eMAR norepinefrin 3–4 Okt'),
      code('a-5', 'ICD-9-CM', '96.71', 'prosedur', 'cppt', 'CPPT ICU ventilator 3–5 Okt'),
    ],
  },
  {
    id: 'kb-joko',
    patient: pasienRef('joko', 'Kenanga · pulang 14 Sep', 'BPJS kelas 1'),
    episode: 'Rawat inap 8–14 Sep 2026 · 6 hari · ORIF femur',
    dpjp: STAF.dpjpBedah,
    status: 'pending',
    sent: true,
    verifierNote:
      'Verifikator BPJS (2 Okt): diagnosis sekunder E87.5 hiperkalemia tanpa bukti laboratorium terlampir; mohon dilengkapi atau dikoreksi.',
    query: null,
    versions: [
      {
        version: 1,
        at: '2026-09-16T09:40:00+07:00',
        by: PERSONA.koder,
        note: 'Koding awal, terkirim E-Klaim',
      },
    ],
    codes: [
      code('j-1', 'ICD-10', 'S72.3', 'utama', 'resume', 'Resume medis ber-TTE 14 Sep', {
        evidence: ev('b-j2', 'Foto femur: fraktur batang femur kanan (RIS, 8 Sep)', 'radiologi'),
      }),
      code('j-2', 'ICD-10', 'E87.5', 'sekunder', 'cppt', 'CPPT 9 Sep ("hiperkalemia ringan")', {
        needsEvidence: true,
      }),
      code('j-3', 'ICD-9-CM', '79.35', 'prosedur', 'laporan-operasi', 'Laporan operasi 9 Sep'),
    ],
  },
];

/** Audit koding sampel (auditor ≠ koder; periode September). */
export const AUDIT_KODING = {
  period: 'September 2026',
  sampled: 48,
  agreed: 46,
  auditor: PERSONA.petugasRm,
  findings: [
    'INV-2609-01742 · kode prosedur 88.72 tanpa laporan ekokardiografi · dikoreksi versi 2',
    'INV-2609-01805 · diagnosis utama tertukar dengan sekunder · dikoreksi sebelum kirim',
  ],
} as const;
