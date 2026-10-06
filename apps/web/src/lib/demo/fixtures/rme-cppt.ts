import type { CpptSign, Handover, Sbar } from '../../rme-cppt';
import { cpptNoteId, ENCOUNTER_ID } from './ids';
import { at } from './rawat-inap';
import { PERSONA, STAF, STAF_LAIN } from './staf';
import { DEMO_TODAY } from './waktu';

/**
 * K07 · Keadaan awal CPPT hari demo di luar entri rawat inap (`rawat-inap.ts`): verifikasi DPJP atas CPPT PPA lain
 * dan riwayat serah terima SBAR. Selaras worklist: CPPT farmasi 08.15 dan koreksi perawat 22.25 Ny. Endang belum
 * diverifikasi DPJP; serah terima malam → pagi sudah diterima persona perawat.
 */

const T = (hm: string) => at(DEMO_TODAY, hm);

/** Verifikasi DPJP yang sudah ada (id entri → penanda tangan). */
export const CPPT_VERIFIED: Readonly<Record<string, CpptSign>> = {
  [cpptNoteId(ENCOUNTER_ID.endang, 3)]: { by: STAF.dpjpPenyakitDalam, at: T('09.20') },
  [cpptNoteId(ENCOUNTER_ID.endang, 4)]: { by: STAF.dpjpPenyakitDalam, at: T('07.35') },
};

/** Serah terima terakhir per kunjungan (shift malam → pagi). */
export const HANDOVERS: Readonly<Record<string, readonly Handover[]>> = {
  [ENCOUNTER_ID.endang]: [
    {
      id: `${ENCOUNTER_ID.endang}-sbar-1`,
      shift: 'Malam → pagi',
      giver: STAF_LAIN.perawat[0],
      receiver: PERSONA.perawat,
      givenAt: T('07.00'),
      acceptedAt: T('07.06'),
      sbar: {
        s: 'Tidur cukup, batuk berkurang, tidak sesak.',
        b: 'Pneumonia komunitas + DM tipe 2, hari rawat ke-5; alergi amoksisilin.',
        a: 'TTV stabil, SpO2 96% udara bebas (koreksi catatan 22.25). GDS 06.00 188 mg/dL.',
        r: 'Seftriakson dosis terakhir 08.00; cek GDS sebelum makan; rencana pulang setelah resume DPJP.',
      },
    },
  ],
  [ENCOUNTER_ID.yusuf]: [
    {
      id: `${ENCOUNTER_ID.yusuf}-sbar-1`,
      shift: 'Malam → pagi',
      giver: STAF_LAIN.perawat[2],
      receiver: STAF_LAIN.perawat[3],
      givenAt: T('07.00'),
      acceptedAt: T('07.04'),
      sbar: {
        s: 'Sesak berkurang setelah HD kemarin.',
        b: 'CKD stadium 5 on HD; AV shunt lengan kiri (jangan ukur TD/infus di kiri).',
        a: 'Balans −350 mL, edema berkurang; thrill AV shunt melemah.',
        r: 'Puasa sebelum kateter HD 13.00; balans cairan ketat 600 mL/hari.',
      },
    },
  ],
};

/** Petugas shift siang yang bisa menerima serah terima. */
export const NEXT_SHIFT_STAFF: readonly string[] = [
  STAF_LAIN.perawat[1],
  STAF_LAIN.perawat[2],
  STAF_LAIN.bidan[0],
];

export const NEXT_SHIFT_LABEL = 'Pagi → siang · 14.00';

/** SBAR awal dari data rekam (dapat disunting sebelum diserahkan). */
export function draftSbar(a: {
  lastAssessment: string;
  background: string;
  ews: string;
  plan: string;
}): Sbar {
  return { s: a.lastAssessment, b: a.background, a: a.ews, r: a.plan };
}
