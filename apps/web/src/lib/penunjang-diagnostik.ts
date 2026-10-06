import type { SupportPatient } from '@simrs/shared';

/**
 * S10 · Penunjang diagnostik lain (mode presentasi, ADR-0023): EKG, ekokardiografi, endoskopi, dan rehabilitasi
 * medik. Alur order → jadwal → pelaksanaan (cek identitas) → hasil terstruktur/ekspertise per templat (formulir P07)
 * → TTE. Temuan kritis (mis. STEMI) masuk jalur S09. Kode ICD-9-CM hanya dari contoh seed (89.52, 88.72); tindakan
 * tanpa kode seed ditandai "belum dipetakan".
 */

export type DiagKind = 'ekg' | 'echo' | 'endoskopi' | 'rehab';

export interface DiagTemplate {
  label: string;
  /** Kode ICD-9-CM dari seed, null = belum dipetakan. */
  icd9cm: string | null;
  fields: readonly string[];
  /** Pelaksana ekspertise (dokter spesialis fiktif). */
  reader: string;
  slots: readonly string[];
  preparation: string | null;
}

export const TEMPLATES: Readonly<Record<DiagKind, DiagTemplate>> = {
  ekg: {
    label: 'EKG 12 sadapan',
    icd9cm: '89.52',
    fields: ['Irama', 'Laju jantung', 'Aksis', 'Segmen ST / gelombang T', 'Kesimpulan'],
    reader: 'dr. Bagus Santoso, Sp.JP',
    slots: ['Segera (cito, di tempat)', '11.30 · ruang EKG', '13.00 · ruang EKG'],
    preparation: null,
  },
  echo: {
    label: 'Ekokardiografi transtorakal',
    icd9cm: '88.72',
    fields: ['Fraksi ejeksi', 'Dimensi ruang jantung', 'Katup', 'Kesimpulan'],
    reader: 'dr. Melati Kusumawardani, Sp.JP',
    slots: ['13.30 · lab ekokardiografi', '15.00 · lab ekokardiografi', 'Sel, 6 Okt 2026 · 08.30'],
    preparation: null,
  },
  endoskopi: {
    label: 'Endoskopi saluran cerna atas (EGD)',
    icd9cm: null,
    fields: ['Esofagus', 'Lambung', 'Duodenum', 'Kesimpulan'],
    reader: 'dr. Rahmat Hidayat, Sp.PD',
    slots: ['Sel, 6 Okt 2026 · 08.00', 'Sel, 6 Okt 2026 · 10.00', 'Rab, 7 Okt 2026 · 08.00'],
    preparation: 'Puasa 8 jam sebelum tindakan; persetujuan tindakan endoskopi',
  },
  rehab: {
    label: 'Rehabilitasi medik · fisioterapi',
    icd9cm: null,
    fields: ['Asesmen fungsional', 'Program terapi', 'Target', 'Kesimpulan'],
    reader: 'dr. Anita Purnamasari, Sp.KFR',
    slots: [
      '14.00 · di bangsal',
      'Sel, 6 Okt 2026 · 09.00 · gym rehab',
      'Sel, 6 Okt 2026 · 14.00 · di bangsal',
    ],
    preparation: null,
  },
};

export type DiagStage = 'order' | 'terjadwal' | 'dilaksanakan' | 'ditandatangani';

export const DIAG_STEPS: ReadonlyArray<{ id: DiagStage; label: string }> = [
  { id: 'order', label: 'Order diterima' },
  { id: 'terjadwal', label: 'Terjadwal' },
  { id: 'dilaksanakan', label: 'Dilaksanakan' },
  { id: 'ditandatangani', label: 'Ekspertise ber-TTE' },
];

export interface DiagOrder {
  id: string;
  kind: DiagKind;
  patient: SupportPatient;
  location: string;
  orderedBy: string;
  orderedAt: string;
  priority: 'cito' | 'rutin';
  indication: string;
  slot: string | null;
  performedAt: string | null;
  performedBy: string | null;
  findings: Readonly<Record<string, string>>;
  critical: boolean;
  signed: { at: string; by: string } | null;
}

export function diagStage(o: DiagOrder): DiagStage {
  if (o.signed) return 'ditandatangani';
  if (o.performedAt) return 'dilaksanakan';
  if (o.slot) return 'terjadwal';
  return 'order';
}

export type DiagGateCode = 'STAGE' | 'SLOT_UNKNOWN' | 'IDENTITY_REQUIRED' | 'FINDINGS_INCOMPLETE';

export const DIAG_GATE_TEXT: Record<DiagGateCode, string> = {
  STAGE: 'Langkah ini belum bisa dilakukan; selesaikan tahap sebelumnya dulu.',
  SLOT_UNKNOWN: 'Pilih slot jadwal yang tersedia.',
  IDENTITY_REQUIRED: 'Konfirmasi identitas pasien (dua pengenal) sebelum pemeriksaan dimulai.',
  FINDINGS_INCOMPLETE: 'Semua isian ekspertise wajib diisi sebelum ditandatangani.',
};

export type DiagAction =
  | { type: 'jadwal'; slot: string }
  | { type: 'laksana'; identityConfirmed: boolean }
  | { type: 'tte'; findings: Readonly<Record<string, string>>; critical: boolean };

export function applyDiag(
  o: DiagOrder,
  a: DiagAction,
  ctx: { at: string; by: string },
): { ok: true; next: DiagOrder; message: string } | { ok: false; code: DiagGateCode } {
  const t = TEMPLATES[o.kind];
  const st = diagStage(o);
  switch (a.type) {
    case 'jadwal':
      if (st !== 'order') return { ok: false, code: 'STAGE' };
      if (!t.slots.includes(a.slot)) return { ok: false, code: 'SLOT_UNKNOWN' };
      return {
        ok: true,
        next: { ...o, slot: a.slot },
        message: `${t.label} ${o.patient.name} dijadwalkan: ${a.slot}`,
      };
    case 'laksana':
      if (st !== 'terjadwal') return { ok: false, code: 'STAGE' };
      if (!a.identityConfirmed) return { ok: false, code: 'IDENTITY_REQUIRED' };
      return {
        ok: true,
        next: { ...o, performedAt: ctx.at, performedBy: ctx.by },
        message: `${t.label} ${o.patient.name} dilaksanakan; menunggu ekspertise ${t.reader}`,
      };
    case 'tte': {
      if (st !== 'dilaksanakan') return { ok: false, code: 'STAGE' };
      if (!t.fields.every((f) => (a.findings[f] ?? '').trim().length > 0))
        return { ok: false, code: 'FINDINGS_INCOMPLETE' };
      return {
        ok: true,
        next: {
          ...o,
          findings: { ...a.findings },
          critical: a.critical,
          signed: { at: ctx.at, by: t.reader },
        },
        message: `Ekspertise ${t.label} ditandatangani (TTE ${t.reader})${a.critical ? ' · temuan kritis diteruskan ke Pusat hasil kritis' : ''}`,
      };
    }
  }
}

export function codeLabel(kind: DiagKind): string {
  const code = TEMPLATES[kind].icd9cm;
  return code ? `ICD-9-CM ${code}` : 'ICD-9-CM belum dipetakan';
}
