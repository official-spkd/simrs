import { signerNameMatches } from './rawat-inap';
import { hasReason } from './rme';

/**
 * K11 · Edukasi pasien dan keluarga terintegrasi lintas PPA (melengkapi persetujuan tindakan): materi, metode,
 * sasaran, verifikasi pemahaman (teach-back), rencana edukasi ulang bila belum paham, tanda tangan penerima +
 * atestasi edukator. Catatan final immutable. Logika murni.
 */

export const EDU_TOPICS = {
  penyakit: 'Diagnosis, kondisi, dan rencana perawatan',
  obat: 'Obat: dosis, cara pakai, efek samping',
  insulin: 'Insulin pen dan tanda hipoglikemia',
  diet: 'Diet dan nutrisi',
  jatuh: 'Pencegahan jatuh',
  nyeri: 'Manajemen nyeri',
  tindakan: 'Tindakan yang direncanakan: manfaat, risiko, alternatif',
  pulang: 'Perawatan di rumah dan tanda bahaya untuk kembali',
  infeksi: 'Kebersihan tangan dan pencegahan infeksi',
} as const;
export type EduTopic = keyof typeof EDU_TOPICS;

export const EDU_METHODS = {
  lisan: 'Lisan / diskusi',
  demonstrasi: 'Demonstrasi + redemonstrasi',
  leaflet: 'Leaflet',
  video: 'Video',
} as const;
export type EduMethod = keyof typeof EDU_METHODS;

export type Understanding = 'paham' | 'perlu-diulang' | 'tidak-paham';

export const UNDERSTANDING_LABEL: Record<Understanding, string> = {
  paham: 'Paham (mampu menjelaskan ulang)',
  'perlu-diulang': 'Perlu diulang',
  'tidak-paham': 'Belum paham',
};

export type Recipient = 'pasien' | 'keluarga' | 'pasien-keluarga';

export const RECIPIENT_LABEL: Record<Recipient, string> = {
  pasien: 'Pasien',
  keluarga: 'Keluarga / pendamping',
  'pasien-keluarga': 'Pasien dan keluarga',
};

export interface EduRecord {
  id: string;
  topics: EduTopic[];
  methods: EduMethod[];
  educator: string;
  /** Profesi edukator, mis. "Perawat", "Dietisien". */
  profession: string;
  recipient: Recipient;
  recipientName: string;
  understanding: Understanding;
  /** Ucapan ulang penerima (teach-back). */
  teachBack: string;
  /** Rencana edukasi ulang (instan ISO) bila belum paham. */
  repeatAt: string | null;
  /** Nama yang diketik penerima sebagai tanda tangan. */
  signature: string;
  at: string;
}

export interface EduDraft {
  topics: EduTopic[];
  methods: EduMethod[];
  recipient: Recipient;
  recipientName: string;
  understanding: Understanding | '';
  teachBack: string;
  repeatAt: string;
  signature: string;
  attested: boolean;
}

export const EMPTY_EDU: EduDraft = {
  topics: [],
  methods: [],
  recipient: 'pasien',
  recipientName: '',
  understanding: '',
  teachBack: '',
  repeatAt: '',
  signature: '',
  attested: false,
};

/** Gerbang simpan edukasi; urutan pesan mengikuti urutan isian di layar. Null = boleh disimpan. */
export function eduBlocker(d: EduDraft): string | null {
  if (d.topics.length === 0) return 'Pilih minimal satu materi edukasi.';
  if (d.methods.length === 0) return 'Pilih metode edukasi.';
  if (!d.recipientName.trim()) return 'Isi nama penerima edukasi.';
  if (!d.understanding) return 'Catat hasil verifikasi pemahaman.';
  if (d.understanding === 'paham' && !hasReason(d.teachBack)) {
    return 'Tulis ucapan ulang penerima (teach-back) sebagai bukti paham, minimal 10 karakter.';
  }
  if (d.understanding !== 'paham' && !d.repeatAt) return 'Belum paham: jadwalkan edukasi ulang.';
  if (!signerNameMatches(d.signature, d.recipientName)) {
    return 'Tanda tangan penerima: ketik nama yang sama dengan nama penerima.';
  }
  if (!d.attested) return 'Centang atestasi edukator.';
  return null;
}

/** Materi wajib yang sudah terverifikasi paham, yang perlu diulang, dan yang belum diberikan. */
export function topicCoverage(
  records: readonly EduRecord[],
  required: readonly EduTopic[],
): { paham: EduTopic[]; ulang: EduTopic[]; belum: EduTopic[] } {
  const latest = new Map<EduTopic, Understanding>();
  for (const r of [...records].sort((a, b) => a.at.localeCompare(b.at))) {
    for (const t of r.topics) latest.set(t, r.understanding);
  }
  return {
    paham: required.filter((t) => latest.get(t) === 'paham'),
    ulang: required.filter((t) => latest.has(t) && latest.get(t) !== 'paham'),
    belum: required.filter((t) => !latest.has(t)),
  };
}

/** Persetujuan tindakan baru boleh ditandatangani setelah edukasi tindakan terverifikasi paham. */
export function consentReady(records: readonly EduRecord[]): boolean {
  return topicCoverage(records, ['tindakan']).paham.length === 1;
}

/** Profesi edukator dari peran sesi. */
export function professionOf(role: string | null): string {
  switch (role) {
    case 'dokter':
      return 'Dokter (DPJP)';
    case 'dokter_residen':
      return 'Dokter residen';
    case 'bidan':
      return 'Bidan';
    case 'apoteker':
      return 'Apoteker';
    default:
      return 'Perawat';
  }
}
