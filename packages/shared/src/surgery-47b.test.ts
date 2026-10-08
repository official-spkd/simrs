import { describe, expect, it } from 'vitest';
import { formSchemaSchema, validateAnswers } from './forms';
import {
  ANESTHESIA_RECORD_FORM,
  asaLabel,
  PRE_ANESTHESIA_FORM,
  PRE_ANESTHESIA_FORM_CODE,
} from './schemas/anestesi';
import { surgerySpecimenInputSchema, surgerySpecimenSentPayloadSchema } from './schemas/surgery-specimen';

/** Fase 4 §4.7b · Formulir anestesi pustaka (P07) dan kontrak spesimen PA (S06 → S02). Data fiktif. */
describe('formulir anestesi pustaka', () => {
  it('kedua formulir sah sebagai skema P07; hak tulis dokter', () => {
    for (const f of [PRE_ANESTHESIA_FORM, ANESTHESIA_RECORD_FORM]) {
      expect(formSchemaSchema.safeParse(f.schema).success, f.code).toBe(true);
      expect(f.writeRoles).toEqual(['dokter']);
    }
    expect(PRE_ANESTHESIA_FORM.code).toBe(PRE_ANESTHESIA_FORM_CODE);
  });

  it('puasa wajib kecuali darurat; ASA + E dari isian', () => {
    const schema = formSchemaSchema.parse(PRE_ANESTHESIA_FORM.schema);
    const base = {
      asa: 'asa_2',
      mallampati: 'm1',
      teknik: 'umum',
      rencana: 'Anestesi umum',
      persetujuan_anestesi: 'ya',
    };
    expect(validateAnswers(schema, { ...base, darurat: 'tidak' })).toHaveProperty('puasa_sejak');
    expect(validateAnswers(schema, { ...base, darurat: 'ya' })).toEqual({});
    expect(asaLabel({ asa: 'asa_3', darurat: 'ya' })).toBe('ASA IIIE');
    expect(asaLabel({ asa: 'asa_1', darurat: 'tidak' })).toBe('ASA I');
    expect(asaLabel({ asa: 'kelas_lain' })).toBeNull();
  });
});

describe('spesimen PA dari kamar operasi', () => {
  const item = {
    site: 'Kandung empedu',
    examination: 'histopatologi',
    containers: 1,
    fixative: 'formalin_10',
    clinicalNote: 'Kolelitiasis, singkirkan keganasan',
  };

  it('potong beku wajib segar; cito bawaan tidak; 1–10 spesimen', () => {
    expect(surgerySpecimenInputSchema.parse({ items: [item] }).items[0]?.cito).toBe(false);
    expect(
      surgerySpecimenInputSchema.safeParse({ items: [{ ...item, examination: 'potong_beku' }] }).success,
    ).toBe(false);
    expect(
      surgerySpecimenInputSchema.safeParse({
        items: [{ ...item, examination: 'potong_beku', fixative: 'segar' }],
      }).success,
    ).toBe(true);
    expect(surgerySpecimenInputSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it('muatan event tanpa isi klinis (hanya id + jenis pemeriksaan)', () => {
    const shape = Object.keys(surgerySpecimenSentPayloadSchema.shape).sort();
    expect(shape).toEqual([
      'cito',
      'encounterId',
      'examination',
      'operativeReportId',
      'patientId',
      'surgeryCaseId',
      'surgerySpecimenId',
      'unitId',
    ]);
  });
});
