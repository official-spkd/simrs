import { RESUME_CHECK_IDS, type ResumeCheckId } from '../schemas/rawat-inap';

/**
 * K13 · Kelengkapan resume medis: 12 butir wajib (urutan tetap) sebelum TTE DPJP. Aturan murni; server memeriksa ulang
 * saat finalisasi (potongan 3.6), web untuk pratinjau dan mode presentasi.
 */

export const RESUME_CHECK_LABEL: Readonly<Record<ResumeCheckId, string>> = {
  ident: 'Identitas pasien dan data kunjungan',
  anamnesis: 'Alasan masuk dan anamnesis',
  fisik: 'Pemeriksaan fisik masuk dan pulang',
  penunjang: 'Hasil penunjang penting',
  diagnosis: 'Diagnosis utama dan sekunder berkode',
  prosedur: 'Prosedur berkode ICD-9-CM',
  terapi: 'Ringkasan terapi dari eMAR',
  rekonsiliasi: 'Rekonsiliasi obat pulang dikonfirmasi DPJP',
  edukasi: 'Edukasi pasien terdokumentasi',
  instruksi: 'Instruksi pulang dan tanda bahaya',
  kontrol: 'Jadwal kontrol dan surat kontrol',
  kondisi: 'Kondisi dan cara pulang',
};

export interface ResumeCompleteness {
  done: number;
  total: number;
  /** Label butir yang belum terpenuhi (huruf kecil, urutan tetap). */
  missing: string[];
  missingIds: ResumeCheckId[];
  complete: boolean;
}

/**
 * Kelengkapan dari daftar centang; butir yang tidak ada di daftar dianggap belum. `required` = butir wajib (bawaan
 * 12 butir rawat inap; resume rawat jalan ringkas memakai `RESUME_RJ_CHECK_IDS`).
 */
export function resumeCompleteness(
  checklist: ReadonlyArray<{ id: ResumeCheckId; done: boolean }>,
  required: readonly ResumeCheckId[] = RESUME_CHECK_IDS,
): ResumeCompleteness {
  const byId = new Map(checklist.map((c) => [c.id, c.done]));
  const missingIds = RESUME_CHECK_IDS.filter((id) => required.includes(id) && !byId.get(id));
  return {
    done: required.length - missingIds.length,
    total: required.length,
    missing: missingIds.map((id) => RESUME_CHECK_LABEL[id].toLowerCase()),
    missingIds,
    complete: missingIds.length === 0,
  };
}

const filled = (s: string | null | undefined): boolean => (s?.trim().length ?? 0) > 0;

/**
 * Bukti dari data sumber resume (dihimpun server dari asesmen, observasi, hasil, kondisi, prosedur, eMAR, edukasi,
 * surat kontrol). Teks kosong = belum terhimpun/ditulis.
 */
export interface ResumeEvidence {
  /** Identitas + data kunjungan (RM, tanggal masuk/pulang, DPJP) lengkap. */
  identityComplete: boolean;
  anamnesis: string | null;
  physicalOnAdmission: string | null;
  physicalOnDischarge: string | null;
  /** Ringkasan hasil penunjang penting; teks "tidak ada" yang ditulis DPJP juga sah. */
  importantResults: string | null;
  /** Diagnosis utama berkode ICD-10 (satu). */
  primaryDiagnosisCoded: boolean;
  /** Diagnosis sekunder yang belum berkode (0 = semua berkode atau tidak ada). */
  uncodedSecondaryDiagnoses: number;
  /** Prosedur yang belum berkode ICD-9-CM (0 = semua berkode atau tidak ada prosedur). */
  uncodedProcedures: number;
  therapySummary: string | null;
  reconciliationConfirmed: boolean;
  education: string | null;
  dischargeInstructions: string | null;
  /** Jadwal kontrol (tanggal/poli) atau keterangan tidak perlu kontrol yang ditulis DPJP. */
  followUp: string | null;
  dischargeCondition: string | null;
  dischargeMethod: string | null;
}

/** Daftar 12 butir dari bukti sumber (server, potongan 3.6). */
export function resumeChecklist(e: ResumeEvidence): Array<{ id: ResumeCheckId; done: boolean }> {
  const done: Record<ResumeCheckId, boolean> = {
    ident: e.identityComplete,
    anamnesis: filled(e.anamnesis),
    fisik: filled(e.physicalOnAdmission) && filled(e.physicalOnDischarge),
    penunjang: filled(e.importantResults),
    diagnosis: e.primaryDiagnosisCoded && e.uncodedSecondaryDiagnoses === 0,
    prosedur: e.uncodedProcedures === 0,
    terapi: filled(e.therapySummary),
    rekonsiliasi: e.reconciliationConfirmed,
    edukasi: filled(e.education),
    instruksi: filled(e.dischargeInstructions),
    kontrol: filled(e.followUp),
    kondisi: filled(e.dischargeCondition) && filled(e.dischargeMethod),
  };
  return RESUME_CHECK_IDS.map((id) => ({ id, done: done[id] }));
}
