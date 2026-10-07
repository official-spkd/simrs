import type { SupportErrorCode } from '../errors';
import type { RadModality } from '../schemas/penunjang';
import type { ContrastScreening } from '../schemas/penunjang-api';

/**
 * S03 · Aturan murni radiologi (rencana fase 4 §4.0a/§4.4): gerbang mulai (identitas, skrining kontras), selesai
 * (dosis CT), dan tanda tangan ekspertise. Dipindah/digeneralisasi dari `apps/web/src/lib/penunjang-radiologi.ts`.
 */

/** Pesan gerbang mulai (mode presentasi dan petunjuk layar): identitas 2 penanda; kontras wajib skrining. */
export function startError(e: { contrast: boolean }, identity: boolean, contrast: boolean): string | null {
  if (!identity) return 'Cek identitas pasien dengan 2 penanda lebih dulu.';
  if (e.contrast && !contrast) return 'Skrining kontras (eGFR, riwayat alergi, puasa) wajib sebelum mulai.';
  return null;
}

/** Dosis CT wajib sebelum dikirim ke ekspertise: CTDIvol 0–200 mGy, DLP 0–5.000 mGy·cm. */
export function doseError(modality: RadModality, ctdiVol: number | null, dlp: number | null): string | null {
  if (modality !== 'CT') return null;
  if (ctdiVol === null || !(ctdiVol > 0 && ctdiVol <= 200)) return 'Isi CTDIvol (mGy) antara 0 dan 200.';
  if (dlp === null || !(dlp > 0 && dlp <= 5000)) return 'Isi DLP (mGy·cm) antara 0 dan 5.000.';
  return null;
}

/** Syarat tanda tangan ekspertise: temuan ≥ 20 karakter, kesan ≥ 10 karakter, tanpa isian templat "__". */
export function reportError(findings: string, impression: string): string | null {
  if (findings.trim().length < 20) return 'Temuan wajib diisi (minimal 20 karakter).';
  if (impression.trim().length < 10) return 'Kesan wajib diisi (minimal 10 karakter).';
  if (findings.includes('__') || impression.includes('__'))
    return 'Lengkapi isian templat yang masih kosong (__).';
  return null;
}

/** Perempuan usia subur (12–55 tahun) wajib status kehamilan diketahui sebelum kontras. */
export function pregnancyCheckRequired(sex: 'male' | 'female' | 'unknown', ageYears: number | null): boolean {
  return sex === 'female' && ageYears !== null && ageYears >= 12 && ageYears <= 55;
}

/**
 * Gerbang server mulai pemeriksaan (§4.4): identitas dikonfirmasi; prosedur kontras butuh skrining lengkap, tanpa
 * alergi kontras tercatat, eGFR ≥ ambang RS, dan bukan hamil. Kegagalan skrining hanya lolos dengan override dokter
 * beralasan (`canOverride` dari izin + peran sesi).
 */
export function imagingStartBlock(s: {
  identityConfirmed: boolean;
  contrast: boolean;
  screening: ContrastScreening | null;
  contrastAllergy: boolean;
  egfr: number | null;
  egfrMin: number;
  sex: 'male' | 'female' | 'unknown';
  ageYears: number | null;
  overrideReason: string | null;
  canOverride: boolean;
}): Extract<SupportErrorCode, 'CONTRAST_SCREENING_REQUIRED'> | 'IDENTITY_REQUIRED' | null {
  if (!s.identityConfirmed) return 'IDENTITY_REQUIRED';
  if (!s.contrast) return null;
  const sc = s.screening;
  const pregnancyOk =
    !pregnancyCheckRequired(s.sex, s.ageYears) ||
    sc?.pregnancy === 'tidak_hamil' ||
    sc?.pregnancy === 'tidak_berlaku';
  const passes =
    sc !== null &&
    sc.contrastAllergyAsked &&
    !s.contrastAllergy &&
    s.egfr !== null &&
    s.egfr >= s.egfrMin &&
    pregnancyOk;
  if (passes) return null;
  return s.canOverride && (s.overrideReason ?? '').trim().length >= 10 ? null : 'CONTRAST_SCREENING_REQUIRED';
}

/** Gerbang selesai akuisisi: CT wajib CTDIvol + DLP (juga CHECK database). */
export function imagingCompleteBlock(
  modality: RadModality,
  ctdiVol: number | null,
  dlp: number | null,
): Extract<SupportErrorCode, 'CT_DOSE_REQUIRED'> | null {
  return doseError(modality, ctdiVol, dlp) ? 'CT_DOSE_REQUIRED' : null;
}
