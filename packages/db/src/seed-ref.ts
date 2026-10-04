import type { RefCodeSystem } from '@simrs/shared';
import type { CsvRecord } from './csv';
import type { PrismaClient } from './generated/prisma/client';
import { importConcepts } from './ref';

/**
 * P06 · Contoh kecil data rujukan untuk lokal/demo, diambil apa adanya dari kode yang SUDAH dipakai
 * `design/mockups` (Klaim, Lab, CPOE, Main, dst.). Bukan dataset resmi: versi ditandai `contoh-mockup`.
 * Dataset resmi (WHO/Kemenkes, loinc.org, KFA) diimpor lewat `pnpm db:import-ref` dan tidak ditimpa seed ini.
 * Wilayah tidak di-seed: impor berkas resmi Kemendagri.
 */
type Sample = { code: string; display: string; extra?: Record<string, string> };

export const SEED_REF_SAMPLES: Record<RefCodeSystem, Sample[]> = {
  icd10: [
    { code: 'A41.9', display: 'Sepsis, tidak spesifik' },
    { code: 'A91', display: 'Demam berdarah dengue' },
    { code: 'C18.9', display: 'Neoplasma ganas kolon' },
    { code: 'E11.9', display: 'Diabetes melitus tipe 2 tanpa komplikasi' },
    { code: 'E78.5', display: 'Hiperlipidemia, tidak spesifik' },
    { code: 'E87.2', display: 'Asidosis' },
    { code: 'E87.5', display: 'Hiperkalemia' },
    { code: 'I10', display: 'Hipertensi esensial (primer)' },
    { code: 'I20.0', display: 'Angina tidak stabil' },
    { code: 'I21.4', display: 'Infark miokard akut non-ST elevasi' },
    { code: 'I63.9', display: 'Infark serebral' },
    { code: 'J06.9', display: 'Infeksi saluran napas atas akut' },
    { code: 'J13', display: 'Pneumonia akibat S. pneumoniae' },
    { code: 'J18.9', display: 'Pneumonia, tidak spesifik' },
    { code: 'J96.0', display: 'Gagal napas akut' },
    { code: 'K30', display: 'Dispepsia' },
    { code: 'K80.2', display: 'Batu kandung empedu tanpa kolesistitis' },
    { code: 'M10.9', display: 'Gout, tidak spesifik' },
    { code: 'N17.9', display: 'Gagal ginjal akut' },
    { code: 'N18.3', display: 'Penyakit ginjal kronik stadium 3' },
    { code: 'N18.5', display: 'Penyakit ginjal kronik stadium 5' },
    { code: 'O82.0', display: 'Persalinan dengan seksio sesarea elektif' },
    { code: 'R50.9', display: 'Demam, tidak spesifik' },
    { code: 'R57.2', display: 'Syok septik' },
    { code: 'R57.9', display: 'Syok, tidak spesifik' },
    { code: 'S72.3', display: 'Fraktur batang femur' },
    { code: 'Z37.0', display: 'Lahir hidup tunggal' },
    { code: 'Z51.1', display: 'Sesi kemoterapi' },
    { code: 'Z99.2', display: 'Ketergantungan dialisis' },
  ],
  icd9cm: [
    { code: '00.17', display: 'Infus agen vasopresor' },
    { code: '38.93', display: 'Pemasangan kateter vena sentral' },
    { code: '39.95', display: 'Hemodialisis' },
    { code: '51.23', display: 'Kolesistektomi laparoskopik' },
    { code: '66.39', display: 'Sterilisasi tuba bilateral' },
    { code: '74.1', display: 'Seksio sesarea segmen bawah' },
    { code: '79.35', display: 'Reduksi terbuka dengan fiksasi internal femur' },
    { code: '87.03', display: 'CT scan kepala' },
    { code: '88.56', display: 'Angiografi koroner' },
    { code: '88.72', display: 'Ekokardiografi' },
    { code: '88.76', display: 'USG abdomen' },
    { code: '89.03', display: 'Pemeriksaan dan evaluasi' },
    { code: '89.52', display: 'EKG' },
    { code: '89.65', display: 'Analisis gas darah arteri' },
    { code: '93.90', display: 'Ventilasi non-invasif' },
    { code: '96.71', display: 'Ventilasi mekanik < 96 jam' },
    { code: '96.72', display: 'Ventilasi mekanik ≥ 96 jam' },
    { code: '99.18', display: 'Infus cairan elektrolit' },
    { code: '99.25', display: 'Injeksi kemoterapi' },
    { code: '99.55', display: 'Imunisasi bayi baru lahir' },
  ],
  loinc: [
    { code: '1988-5', display: 'CRP' },
    { code: '2345-7', display: 'Glukosa sewaktu' },
    { code: '883-9', display: 'Golongan darah ABO' },
    { code: '2085-9', display: 'HDL' },
    { code: '4548-4', display: 'HbA1c' },
    { code: '718-7', display: 'Hemoglobin' },
    { code: '2823-3', display: 'Kalium' },
    { code: '2075-0', display: 'Klorida' },
    { code: '2093-3', display: 'Kolesterol total' },
    { code: '2160-0', display: 'Kreatinin' },
    { code: '13457-7', display: 'LDL' },
    { code: '6690-2', display: 'Leukosit' },
    { code: '2951-2', display: 'Natrium' },
    { code: '10331-7', display: 'Rhesus' },
    { code: '2571-8', display: 'Trigliserida' },
    { code: '777-3', display: 'Trombosit' },
    { code: '10839-9', display: 'Troponin I' },
    { code: '3094-0', display: 'Ureum' },
  ],
  kfa: [
    { code: '93000387', display: 'Klopidogrel 75 mg tablet', extra: { fornas: 'true' } },
    { code: '93000655', display: 'Bisoprolol 2,5 mg tablet', extra: { fornas: 'true' } },
    { code: '93000914', display: 'Atorvastatin 40 mg tablet', extra: { fornas: 'true' } },
    { code: '93001152', display: 'Omeprazol 40 mg injeksi', extra: { fornas: 'true' } },
    { code: '93002210', display: 'Enoksaparin 60 mg/0,6 mL injeksi', extra: { high_alert: 'true' } },
  ],
};

export const SEED_REF_VERSION = 'contoh-mockup';

/**
 * Isi contoh untuk sistem yang masih kosong (idempoten; tidak menyentuh sistem yang sudah berisi data,
 * termasuk dataset resmi). Mengembalikan jumlah konsep yang ditambahkan.
 */
export async function seedRefSamples(prisma: PrismaClient): Promise<number> {
  let added = 0;
  for (const [system, samples] of Object.entries(SEED_REF_SAMPLES) as Array<[RefCodeSystem, Sample[]]>) {
    added += await prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM ref.concepts WHERE system = ${system}`;
      if ((row?.n ?? 0) > 0) return 0;
      const records: CsvRecord[] = samples.map((s, i) => ({
        line: i + 2,
        values: { code: s.code, display: s.display, ...s.extra },
      }));
      const report = await importConcepts(tx, system, records, {
        version: SEED_REF_VERSION,
        source: 'design/mockups (contoh, bukan dataset resmi)',
      });
      if (report.errors.length > 0) {
        throw new Error(`Contoh ${system} tidak valid: ${report.errors.map((e) => e.message).join('; ')}`);
      }
      return report.inserted;
    });
  }
  return added;
}
