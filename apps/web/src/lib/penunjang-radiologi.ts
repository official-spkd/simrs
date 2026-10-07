import type { RadModality, RadStatus, RadiologyExam, RadiologyModality } from '@simrs/shared';
import { doseError, reportError, startError } from '@simrs/shared';
import type { GateDenial, StatusTone } from './penunjang';

/** Aturan murni dipindah ke `@simrs/shared` (rencana fase 4 §4.0a); diekspor ulang untuk pemakai lama. */
export { doseError, reportError, startError };

/**
 * S03 · Fungsi murni tampilan radiologi (mode presentasi, ADR-0023): status worklist, kode ICD-9-CM, templat
 * ekspertise, gerbang mulai (identitas, skrining kontras), dosis CT wajib, dan syarat tanda tangan radiolog.
 */

export const MODALITY_LABEL: Record<RadModality, string> = {
  CT: 'CT scan',
  DR: 'Radiografi (DR)',
  USG: 'USG',
  MRI: 'MRI',
  ANGIO: 'Angiografi',
};

export const RAD_STATUS_VIEW: Record<RadStatus, { label: string; tone: StatusTone }> = {
  terjadwal: { label: 'Terjadwal', tone: 'neutral' },
  berlangsung: { label: 'Berlangsung', tone: 'brand' },
  ekspertise: { label: 'Menunggu ekspertise', tone: 'warning' },
  ditandatangani: { label: 'Ditandatangani', tone: 'success' },
};

export const RAD_FLOW: readonly RadStatus[] = ['terjadwal', 'berlangsung', 'ekspertise', 'ditandatangani'];

/** Kode prosedur ICD-9-CM, atau "kode belum dipetakan". */
export function procedureCodeText(code: string | null): string {
  return code ? `ICD-9-CM ${code}` : 'kode belum dipetakan';
}

/** Okupansi slot modalitas hari ini. */
export function slotView(m: RadiologyModality): { text: string; percent: number; full: boolean } {
  const percent = Math.round((m.slotsUsed / m.slotsTotal) * 100);
  return { text: `${m.slotsUsed}/${m.slotsTotal} slot`, percent, full: m.slotsUsed >= m.slotsTotal };
}

export const MODALITY_STATUS: Record<RadiologyModality['status'], { label: string; tone: StatusTone }> = {
  siap: { label: 'Siap', tone: 'success' },
  dipakai: { label: 'Sedang dipakai', tone: 'brand' },
  perawatan: { label: 'Perawatan', tone: 'warning' },
};

/** Urutan worklist: cito aktif → berlangsung → menunggu ekspertise → terjadwal (jam) → ditandatangani. */
export function sortExams<T extends RadiologyExam>(exams: readonly T[]): T[] {
  const rank: Record<RadStatus, number> = { berlangsung: 1, ekspertise: 2, terjadwal: 3, ditandatangani: 5 };
  const r = (e: RadiologyExam) =>
    e.priority === 'cito' && e.status !== 'ditandatangani' ? 0 : rank[e.status];
  return [...exams].sort((a, b) => r(a) - r(b) || a.scheduledAt.localeCompare(b.scheduledAt));
}

export interface ExpertiseTemplate {
  id: string;
  label: string;
  findings: string;
  impression: string;
}

export const EXPERTISE_TEMPLATES: readonly ExpertiseTemplate[] = [
  {
    id: 'toraks',
    label: 'Foto toraks normal',
    findings:
      'Cor: ukuran dan bentuk normal (CTR < 0,5). Pulmo: corakan bronkovaskular normal, tidak tampak infiltrat atau nodul. Sinus kostofrenikus kanan dan kiri tajam. Diafragma licin. Tulang yang tervisualisasi intak.',
    impression: 'Cor dan pulmo dalam batas normal.',
  },
  {
    id: 'ct-kepala',
    label: 'CT kepala tanpa kontras',
    findings:
      'Parenkim otak: diferensiasi substansia grisea dan alba baik, tidak tampak lesi hipodens atau hiperdens. Sistem ventrikel dan sisterna normal. Garis tengah tidak bergeser. Kalvaria intak.',
    impression: 'Tidak tampak perdarahan intrakranial atau lesi fokal.',
  },
  {
    id: 'usg-abdomen',
    label: 'USG abdomen',
    findings:
      'Hepar: ukuran normal, ekostruktur homogen, tepi tajam. Kandung empedu: dinding tidak menebal, tidak tampak batu. Pankreas, lien, dan kedua ginjal dalam batas normal. Tidak tampak cairan bebas.',
    impression: 'USG abdomen dalam batas normal.',
  },
  {
    id: 'angiografi',
    label: 'Angiografi koroner',
    findings:
      'Left main: normal. LAD: stenosis __% segmen proksimal. LCx: tidak tampak stenosis bermakna. RCA: dominan, tidak tampak stenosis bermakna. Aliran TIMI 3 pada seluruh arteri.',
    impression: 'Penyakit jantung koroner satu pembuluh (LAD).',
  },
  { id: 'kosong', label: 'Tanpa templat', findings: '', impression: '' },
];

/** Templat bawaan menurut prosedur. */
export function templateFor(e: Pick<RadiologyExam, 'procedure' | 'modality'>): ExpertiseTemplate {
  const p = e.procedure.toLowerCase();
  const id = p.includes('toraks')
    ? 'toraks'
    : p.includes('ct kepala')
      ? 'ct-kepala'
      : p.includes('usg abdomen')
        ? 'usg-abdomen'
        : e.modality === 'ANGIO'
          ? 'angiografi'
          : 'kosong';
  return EXPERTISE_TEMPLATES.find((t) => t.id === id) ?? (EXPERTISE_TEMPLATES.at(-1) as ExpertiseTemplate);
}

export const RAD_EXAM_UNKNOWN = 'Pemeriksaan tidak ditemukan di worklist radiologi.';

/*
 * Gerbang Server Action radiologi atas rekaman yang dicari server di worklist sesi (klien hanya mengirim id):
 * kebutuhan skrining kontras dan dosis CT dibaca dari order, bukan dari input klien. Status kemajuan tidak
 * diperiksa karena langkah lokal (mulai, akuisisi) tidak tersimpan.
 */

/** Mulai pemeriksaan: identitas 2 penanda; skrining kontras bila order-nya berkontras. */
export function radStartGate(
  exam: Pick<RadiologyExam, 'contrast'> | undefined,
  identityChecked: boolean,
  contrastChecked: boolean,
): GateDenial | null {
  if (!exam) return { message: RAD_EXAM_UNKNOWN };
  const err = startError(exam, identityChecked, contrastChecked);
  return err ? { message: err } : null;
}

/** Selesai akuisisi: dosis CT wajib bila modalitas order-nya CT. */
export function radFinishGate(
  exam: Pick<RadiologyExam, 'modality'> | undefined,
  ctdiVol: number | null,
  dlp: number | null,
): GateDenial | null {
  if (!exam) return { message: RAD_EXAM_UNKNOWN };
  const err = doseError(exam.modality, ctdiVol, dlp);
  return err ? { message: err, field: 'dose' } : null;
}

/** TTE radiolog: pemeriksaan ada di worklist dan ekspertise lengkap. */
export function radSignGate(
  exam: Pick<RadiologyExam, 'id'> | undefined,
  findings: string,
  impression: string,
): GateDenial | null {
  if (!exam) return { message: RAD_EXAM_UNKNOWN };
  const err = reportError(findings, impression);
  return err ? { message: err, field: 'report' } : null;
}

/** Tindakan di layar (simulasi, tidak disimpan) atas satu pemeriksaan. */
export interface RadLocal {
  startedAt?: string;
  finishedAt?: string;
  dose?: { ctdiVol: number; dlp: number } | null;
  report?: { findings: string; impression: string; radiologist: string; signedAt: string };
}

/** Gabungkan tindakan lokal secara berurutan: mulai → selesai akuisisi → ekspertise ditandatangani. */
export function applyRadLocal(e: RadiologyExam, l: RadLocal | undefined): RadiologyExam {
  if (!l) return e;
  let out = e;
  if (l.startedAt && out.status === 'terjadwal')
    out = { ...out, status: 'berlangsung', startedAt: l.startedAt };
  if (l.finishedAt && out.status === 'berlangsung')
    out = { ...out, status: 'ekspertise', dose: l.dose ?? out.dose };
  if (l.report && out.status === 'ekspertise') out = { ...out, status: 'ditandatangani', report: l.report };
  return out;
}

/** Angka isian dosis: desimal koma ("12,5") atau titik ("12.5"), tanpa pemisah ribuan; null bila tidak sah. */
export function parseDecimal(input: string): number | null {
  const t = input.trim().replace(',', '.');
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
