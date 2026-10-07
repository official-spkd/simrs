import { describe, expect, it } from 'vitest';
import {
  CONSENT_INFORMATION_KEYS,
  CONSENT_TEMPLATE_SAMPLE,
  consentDraftCreateInputSchema,
  consentDraftRefuseInputSchema,
  consentDraftSignaturesInputSchema,
  consentRevokeInputSchema,
  EDUCATION_FORM_SAMPLE,
  formReadyProblems,
  formSchemaSchema,
} from './index';

const signer = { name: 'Pasien Fiktif', relation: null, method: 'nama', imageDocumentId: null };

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

  it('draf: templat + tindakan + isian; waktu penjelasan boleh kosong', () => {
    const draft = {
      templateCode: 'persetujuan_tindakan',
      procedure: 'Pemasangan kateter vena sentral',
      signerKind: 'pasien',
      information: {},
      explainedAt: null,
    };
    expect(consentDraftCreateInputSchema.safeParse(draft).success).toBe(true);
    expect(consentDraftCreateInputSchema.safeParse({ ...draft, signerKind: 'dokter' }).success).toBe(false);
  });

  it('tanda tangan: ketujuh butir dipahami, goresan wajib berkas, saksi keluarga wajib hubungan', () => {
    const base = { acknowledged: [...CONSENT_INFORMATION_KEYS], signer, familyWitness: null };
    expect(consentDraftSignaturesInputSchema.safeParse(base).success).toBe(true);
    expect(
      consentDraftSignaturesInputSchema.safeParse({
        ...base,
        acknowledged: CONSENT_INFORMATION_KEYS.slice(1),
      }).success,
    ).toBe(false);
    expect(
      consentDraftSignaturesInputSchema.safeParse({ ...base, signer: { ...signer, method: 'goresan' } })
        .success,
    ).toBe(false);
    expect(
      consentDraftSignaturesInputSchema.safeParse({ ...base, familyWitness: { ...signer, relation: null } })
        .success,
    ).toBe(false);
  });

  it('penolakan dan pencabutan wajib alasan ≥ 10; wali wajib hubungan', () => {
    expect(consentDraftRefuseInputSchema.safeParse({ reason: 'pendek' }).success).toBe(false);
    expect(consentDraftRefuseInputSchema.safeParse({ reason: 'Ingin pendapat kedua' }).success).toBe(true);
    const revoke = { reason: 'Pasien berubah pikiran', signerKind: 'pasien', signer, familyWitness: null };
    expect(consentRevokeInputSchema.safeParse(revoke).success).toBe(true);
    expect(consentRevokeInputSchema.safeParse({ ...revoke, signerKind: 'wali' }).success).toBe(false);
  });
});
