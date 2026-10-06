import {
  type ComponentCode,
  COMPONENTS,
  CORE_MODULES,
  defaultModuleEnabled,
  TENANT_SETTINGS,
  type TenantSettingKey,
} from '@simrs/shared';

/**
 * P10/P12 · Pengaturan RS (mode presentasi, ADR-0023): modul aktif per RS (`tenant_modules`), pengaturan umum
 * (registri `TENANT_SETTINGS` bersama API, nilai divalidasi skema yang sama), dan template cetak berversi.
 */

export type ModuleState = Record<ComponentCode, boolean>;

export const MODULE_CODES = Object.keys(COMPONENTS) as ComponentCode[];

/**
 * Dependensi langsung antarmodul dari docs/02 (kolom Dependensi), hanya kode tunggal; rentang/lapisan ("S01–S08",
 * "lapisan 3–4", "Semua di atas") tidak dipakai sebagai gerbang di layar ini.
 */
export const MODULE_DEPENDS: Partial<Record<ComponentCode, readonly ComponentCode[]>> = {
  P02: ['P01'],
  P03: ['P02'],
  P04: ['P02', 'P03'],
  P05: ['P01', 'I05', 'I02'],
  P07: ['P06'],
  P08: ['P02', 'I05'],
  P09: ['P02'],
  P10: ['P01'],
  P12: ['P08'],
  F01: ['P01', 'I03'],
  F02: ['F01', 'P05'],
  F03: ['P05', 'F06'],
  F04: ['F03', 'I03'],
  F05: ['F03', 'F06'],
  F06: ['I03'],
  F07: ['I04', 'K13'],
  F08: ['K05', 'U01'],
  K01: ['F03', 'P09'],
  K02: ['K06', 'K07', 'K09'],
  K03: ['K06', 'K12'],
  K04: ['K05', 'K07'],
  K05: ['P01'],
  K06: ['P07'],
  K07: ['P04', 'P08'],
  K08: ['P06'],
  K10: ['K07'],
  K11: ['P08'],
  K12: ['S04', 'S05'],
  K13: ['K08', 'P08'],
  K14: ['K08', 'S01', 'S03', 'S04'],
  K15: ['P07', 'K12'],
  S01: ['K09'],
  S02: ['S01'],
  S03: ['K09'],
  S04: ['K09', 'P06'],
  S05: ['S04', 'B01'],
  S06: ['K09', 'K11'],
  S07: ['K09'],
  S08: ['K09'],
  S09: ['S01', 'S03', 'P09'],
  S10: ['P07', 'P08'],
  U01: ['P01', 'P10'],
  U03: ['U02'],
  U04: ['U03', 'F06'],
  U05: ['U06', 'I03'],
  U06: ['K08', 'P06'],
  U08: ['U01', 'U07'],
  U09: ['U03', 'I05'],
  U10: ['B01', 'U07'],
  B01: ['P01', 'P06'],
  B02: ['B01'],
  B03: ['P01'],
  B04: ['B03', 'P03'],
  B05: ['B03', 'U08'],
  B07: ['K12', 'S02'],
  B08: ['S02', 'S04'],
  B09: ['P04', 'P08'],
  B12: ['P08'],
  B13: ['P09', 'I07'],
  I01: ['P10', 'P11'],
  I02: ['I01', 'P06'],
  I03: ['I01'],
  I04: ['I01'],
  I05: ['I01'],
  I06: ['I01', 'P13'],
  I07: ['F02', 'F04', 'K13', 'U03'],
  I12: ['P03', 'I01'],
};

export const LAYER_LABEL: Record<string, string> = {
  platform: 'Platform',
  'front-office': 'Front office',
  klinis: 'Klinis RME',
  penunjang: 'Penunjang',
  keuangan: 'Keuangan',
  'back-office': 'Back office',
  integrasi: 'Integrasi & kanal',
};

/** Keadaan bawaan RS (MVP aktif, Lanjut mati) ditimpa pilihan RS. */
export function moduleStateFrom(overrides: Partial<Record<ComponentCode, boolean>>): ModuleState {
  return Object.fromEntries(
    MODULE_CODES.map((c) => [c, overrides[c] ?? defaultModuleEnabled(c)]),
  ) as ModuleState;
}

export const isCoreModule = (code: ComponentCode) => (CORE_MODULES as readonly string[]).includes(code);

/** Modul aktif yang bergantung langsung pada `code`. */
export function activeDependents(code: ComponentCode, state: ModuleState): ComponentCode[] {
  return MODULE_CODES.filter((c) => state[c] && (MODULE_DEPENDS[c] ?? []).includes(code));
}

/** Dependensi `code` yang sedang mati. */
export function missingDeps(code: ComponentCode, state: ModuleState): ComponentCode[] {
  return (MODULE_DEPENDS[code] ?? []).filter((d) => !state[d]);
}

export type ToggleCheck = { ok: true } | { ok: false; reason: string };

/** Boleh membalik status modul ini dari keadaan `state`? */
export function canToggle(code: ComponentCode, state: ModuleState): ToggleCheck {
  if (state[code]) {
    if (isCoreModule(code)) return { ok: false, reason: 'Modul inti, tidak bisa dimatikan.' };
    const deps = activeDependents(code, state);
    if (deps.length > 0)
      return { ok: false, reason: `Dipakai modul aktif ${deps.join(', ')}; matikan itu dulu.` };
    return { ok: true };
  }
  const missing = missingDeps(code, state);
  if (missing.length > 0) return { ok: false, reason: `Butuh ${missing.join(', ')} aktif dulu.` };
  return { ok: true };
}

/** Perubahan yang belum disimpan (draf vs tersimpan). */
export function moduleDiff(
  saved: ModuleState,
  draft: ModuleState,
): Array<{ code: ComponentCode; on: boolean }> {
  return MODULE_CODES.filter((c) => saved[c] !== draft[c]).map((c) => ({ code: c, on: draft[c] }));
}

// ---------------------------------------------------------------------------------------------------------
// Pengaturan umum (P10/P12 · `TENANT_SETTINGS`)
// ---------------------------------------------------------------------------------------------------------

/** Pengaturan yang tampil di layar demo (urut tampil), dikelompokkan per area. */
export const SETTING_GROUPS: ReadonlyArray<{ title: string; keys: readonly TenantSettingKey[] }> = [
  {
    title: 'Keamanan sesi',
    keys: ['session.idle_minutes', 'login.max_failed_attempts', 'break_glass.duration_minutes'],
  },
  { title: 'Layanan', keys: ['service.hours', 'queue.avg_service_minutes', 'booking.max_days_ahead'] },
  { title: 'Klinis', keys: ['resume.deadline_hours', 'emar.late_minutes', 'bed.boarding_alert_hours'] },
];

export type SettingDraft = Partial<Record<TenantSettingKey, unknown>>;

/** Nilai isian (teks) → nilai pengaturan (angka bila skemanya angka). */
export function coerceSetting(key: TenantSettingKey, raw: unknown): unknown {
  const def = TENANT_SETTINGS[key].default;
  if (typeof def === 'number' && typeof raw === 'string') return raw.trim() === '' ? Number.NaN : Number(raw);
  return raw;
}

/** Galat per kunci (pesan skema bersama API); kosong = semua valid. */
export function validateSettings(draft: SettingDraft): Partial<Record<TenantSettingKey, string>> {
  const errors: Partial<Record<TenantSettingKey, string>> = {};
  for (const [key, raw] of Object.entries(draft) as Array<[TenantSettingKey, unknown]>) {
    const r = TENANT_SETTINGS[key].schema.safeParse(coerceSetting(key, raw));
    if (!r.success) {
      const issue = r.error.issues[0];
      errors[key] =
        issue?.code === 'invalid_type'
          ? 'Isi dengan angka'
          : issue?.code === 'too_small'
            ? `Minimal ${String((issue as { minimum?: number | bigint }).minimum)}`
            : issue?.code === 'too_big'
              ? `Maksimal ${String((issue as { maximum?: number | bigint }).maximum)}`
              : (issue?.message ?? 'Nilai tidak valid');
    }
  }
  return errors;
}

/** Kunci yang nilainya berubah dibanding tersimpan. */
export function changedSettings(saved: SettingDraft, draft: SettingDraft): TenantSettingKey[] {
  return (Object.keys(draft) as TenantSettingKey[]).filter(
    (k) => JSON.stringify(coerceSetting(k, draft[k])) !== JSON.stringify(saved[k]),
  );
}

// ---------------------------------------------------------------------------------------------------------
// Template cetak (P12)
// ---------------------------------------------------------------------------------------------------------

export type TemplateKind = 'kop' | 'label' | 'gelang' | 'etiket' | 'kuitansi';

/** Pasien contoh fiktif untuk pratinjau cetak. */
export interface SamplePatient {
  nama: string;
  rm: string;
  tanggalLahir: string;
  jk: 'L' | 'P';
  alergi: readonly string[];
  penjamin: string;
}

export interface PrintTemplate {
  id: TemplateKind;
  name: string;
  /** Ukuran kertas/label. */
  size: string;
  version: number;
  publishedAt: string;
  publishedBy: string;
  header: string;
  subheader: string;
  showQr: boolean;
  showBarcode: boolean;
  showAllergy: boolean;
  footer: string;
}

/**
 * Gerbang template sebelum terbit: gelang wajib menampilkan alergi + barcode RM (identifikasi pasien, SKP 1),
 * dokumen ber-TTE (kop) wajib QR verifikasi, kuitansi wajib QR verifikasi, kop wajib nama RS.
 */
export function templateIssues(t: PrintTemplate): string[] {
  const out: string[] = [];
  if (t.header.trim().length < 3) out.push('Baris kop (nama RS) wajib diisi, minimal 3 huruf.');
  if (t.id === 'gelang' && !t.showAllergy) out.push('Gelang pasien wajib menampilkan penanda alergi.');
  if ((t.id === 'gelang' || t.id === 'label') && !t.showBarcode) {
    out.push('Gelang dan label pasien wajib memuat barcode nomor RM (pindai eMAR).');
  }
  if ((t.id === 'kop' || t.id === 'kuitansi') && !t.showQr) {
    out.push('Dokumen bertanda tangan elektronik wajib memuat QR verifikasi.');
  }
  if (t.footer.length > 120) out.push('Catatan kaki maksimal 120 karakter.');
  return out;
}

const TEMPLATE_FIELDS = ['header', 'subheader', 'showQr', 'showBarcode', 'showAllergy', 'footer'] as const;

export function templateChanged(a: PrintTemplate, b: PrintTemplate): boolean {
  return TEMPLATE_FIELDS.some((f) => a[f] !== b[f]);
}
