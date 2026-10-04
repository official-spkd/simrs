/**
 * P06 · Master data dan terminologi. Data rujukan global (skema `ref`, tanpa tenant) yang dipakai semua RS:
 * sistem kode baku + wilayah administratif. Tidak ada kode yang dikarang: dataset resmi diimpor lewat
 * `pnpm db:import-ref`; seed lokal hanya contoh kecil yang diambil dari mockup proyek.
 */

export const REF_CODE_SYSTEMS = {
  icd10: {
    label: 'ICD-10',
    uri: 'http://hl7.org/fhir/sid/icd-10',
    pattern: /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/,
    hint: 'Huruf + 2 digit, opsional titik + 1–4 karakter (mis. J18.9)',
  },
  icd9cm: {
    label: 'ICD-9-CM (prosedur)',
    uri: 'http://hl7.org/fhir/sid/icd-9-cm',
    pattern: /^[0-9]{2}(\.[0-9]{1,2})?$/,
    hint: '2 digit, opsional titik + 1–2 digit (mis. 51.23)',
  },
  loinc: {
    label: 'LOINC',
    uri: 'http://loinc.org',
    pattern: /^[0-9]{1,7}-[0-9]$/,
    hint: 'Angka + strip + check digit (mis. 718-7)',
  },
  kfa: {
    label: 'KFA',
    uri: 'http://sys-ids.kemkes.go.id/kfa',
    pattern: /^[0-9]{8}$/,
    hint: '8 digit (mis. 93000387)',
  },
} as const;
export type RefCodeSystem = keyof typeof REF_CODE_SYSTEMS;
export const REF_CODE_SYSTEM_IDS = Object.keys(REF_CODE_SYSTEMS) as [RefCodeSystem, ...RefCodeSystem[]];

/**
 * Check digit LOINC (algoritma mod 10 / Luhn atas bagian sebelum strip). Menangkap salah ketik saat impor.
 */
export function loincCheckDigitValid(code: string): boolean {
  const m = /^([0-9]{1,7})-([0-9])$/.exec(code);
  if (!m) return false;
  const digits = (m[1] as string).split('').map(Number).reverse();
  let sum = 0;
  digits.forEach((d, i) => {
    if (i % 2 === 0) {
      const doubled = d * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    } else sum += d;
  });
  return (10 - (sum % 10)) % 10 === Number(m[2]);
}

/** Kode valid untuk sistemnya (format + check digit LOINC). */
export function isValidRefCode(system: RefCodeSystem, code: string): boolean {
  if (!REF_CODE_SYSTEMS[system].pattern.test(code)) return false;
  return system === 'loinc' ? loincCheckDigitValid(code) : true;
}

/** Wilayah administratif (kode Kemendagri): provinsi `31`, kab/kota `31.75`, kecamatan `31.75.01`, desa `31.75.01.1001`. */
export const REGION_LEVELS = ['provinsi', 'kabupaten', 'kecamatan', 'desa'] as const;
export type RegionLevel = (typeof REGION_LEVELS)[number];

const REGION_PATTERN = /^[0-9]{2}(\.[0-9]{2}(\.[0-9]{2}(\.[0-9]{4})?)?)?$/;

/** Tingkat dan induk dari kode wilayah; null bila format tidak dikenal. */
export function regionInfo(code: string): { level: RegionLevel; parent: string | null } | null {
  if (!REGION_PATTERN.test(code)) return null;
  const parts = code.split('.');
  const level = REGION_LEVELS[parts.length - 1] as RegionLevel;
  return { level, parent: parts.length > 1 ? parts.slice(0, -1).join('.') : null };
}
