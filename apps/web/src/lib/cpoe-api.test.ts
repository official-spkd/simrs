import { orderSubmitInputSchema } from '@simrs/shared';
import { describe, expect, it } from 'vitest';
import {
  type DraftLine,
  draftFingerprint,
  evaluateInput,
  lineProblems,
  newDraftLine,
  sendBlocker,
  submitInput,
} from './cpoe-api';

const ENC = '0199a000-0000-7000-8000-0000000000e1';
const drugLine = (over: Partial<DraftLine> = {}): DraftLine => ({
  ...newDraftLine(
    { id: '0199a000-0000-7000-8000-0000000000d1', kind: 'obat', name: 'Sefadroksil 500 mg kapsul' },
    'a',
  ),
  ...over,
});
const labLine = () =>
  newDraftLine({ id: '0199a000-0000-7000-8000-0000000000b1', kind: 'lab', name: 'Hemoglobin' }, 'b');

describe('CPOE mode api · baris order', () => {
  it('obat wajib dosis, rute, aturan pakai; penunjang tidak', () => {
    expect(lineProblems(drugLine())).toEqual(['dosis', 'aturan pakai']);
    expect(lineProblems(drugLine({ dose: '500 mg', frequency: '3x1' }))).toEqual([]);
    expect(lineProblems(labLine())).toEqual([]);
  });

  it('pratinjau CDS berjalan untuk isian yang belum lengkap; kirim menunggu isian lengkap', () => {
    const lines = [drugLine(), labLine()];
    expect(orderSubmitInputSchema.safeParse(evaluateInput(ENC, lines, null)).success).toBe(true);
    expect(submitInput(ENC, lines, null)).toBeNull();
    const ready = [
      drugLine({ dose: '500 mg', frequency: '3x1', override: 'Riwayat aman sebelumnya' }),
      labLine(),
    ];
    const input = submitInput(ENC, ready, null);
    expect(orderSubmitInputSchema.safeParse(input).success).toBe(true);
    expect(input?.items[0]).toMatchObject({
      type: 'obat',
      dose: '500 mg',
      override: 'Riwayat aman sebelumnya',
    });
  });

  it('sidik daftar berubah bila isi berubah (Idempotency-Key baru)', () => {
    const a = draftFingerprint([drugLine({ dose: '500 mg' })], null);
    expect(draftFingerprint([drugLine({ dose: '500 mg' })], null)).toBe(a);
    expect(draftFingerprint([drugLine({ dose: '250 mg' })], null)).not.toBe(a);
  });

  it('tombol kirim: alasan tertulis untuk daftar kosong, belum lengkap, menunggu CDS, dan diblokir', () => {
    expect(sendBlocker([], null, false)).toMatch(/Belum ada order/);
    expect(sendBlocker([drugLine()], null, false)).toMatch(/Lengkapi Sefadroksil/);
    const ready = [drugLine({ dose: '500 mg', frequency: '3x1' })];
    expect(sendBlocker(ready, null, true)).toMatch(/Menunggu/);
    const blocked = {
      encounterId: ENC,
      blocked: true,
      lines: [
        {
          index: 0,
          name: 'Sefadroksil 500 mg kapsul',
          findings: [],
          top: { level: 'block' as const, rule: 'alergi-silang' as const, message: 'Diblokir' },
          blocked: true,
          overridden: false,
        },
      ],
    };
    expect(sendBlocker(ready, blocked, false)).toMatch(/1 order diblokir CDS/);
    expect(
      sendBlocker(
        ready,
        { ...blocked, blocked: false, lines: [{ ...blocked.lines[0]!, blocked: false }] },
        false,
      ),
    ).toBeNull();
  });
});
