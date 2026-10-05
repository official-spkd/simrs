import { describe, expect, it } from 'vitest';
import {
  CONSENT_INFORMATION_KEYS,
  CONSENT_TEMPLATE_SAMPLE,
  consentCreateInputSchema,
  EDUCATION_FORM_SAMPLE,
  formReadyProblems,
  formSchemaSchema,
} from './index';

const base = {
  encounterId: '0199a000-0000-7000-8000-0000000000aa',
  templateCode: 'persetujuan_tindakan',
  procedure: 'Pemasangan kateter vena sentral',
  explainedAt: '2026-10-06T02:00:00.000Z',
  information: {},
  decision: 'setuju',
  refusalReason: null,
  signerKind: 'pasien',
  signer: { name: 'Pasien Fiktif', relation: null, method: 'nama', imageDocumentId: null },
  familyWitness: null,
  staffWitnessUserId: '0199a000-0000-7000-8000-0000000000bb',
};

describe('K11 · kontrak persetujuan tindakan', () => {
  it('templat contoh lolos skema formulir dan memuat ketujuh butir wajib', () => {
    for (const def of [CONSENT_TEMPLATE_SAMPLE, EDUCATION_FORM_SAMPLE]) {
      const schema = formSchemaSchema.parse(def.schema);
      expect(formReadyProblems(schema), def.code).toEqual([]);
    }
    const keys = formSchemaSchema
      .parse(CONSENT_TEMPLATE_SAMPLE.schema)
      .sections.flatMap((s) => s.fields.filter((f) => f.required).map((f) => f.key));
    expect(keys).toEqual([...CONSENT_INFORMATION_KEYS]);
  });

  it('penolakan wajib alasan ≥ 10; persetujuan tanpa alasan; goresan wajib berkas; wali wajib hubungan', () => {
    expect(consentCreateInputSchema.safeParse(base).success).toBe(true);
    expect(consentCreateInputSchema.safeParse({ ...base, decision: 'tolak' }).success).toBe(false);
    expect(
      consentCreateInputSchema.safeParse({
        ...base,
        decision: 'tolak',
        refusalReason: 'Ingin pendapat kedua',
      }).success,
    ).toBe(true);
    expect(
      consentCreateInputSchema.safeParse({ ...base, refusalReason: 'Alasan yang tidak perlu' }).success,
    ).toBe(false);
    expect(
      consentCreateInputSchema.safeParse({ ...base, signer: { ...base.signer, method: 'goresan' } }).success,
    ).toBe(false);
    expect(consentCreateInputSchema.safeParse({ ...base, signerKind: 'wali' }).success).toBe(false);
  });
});
